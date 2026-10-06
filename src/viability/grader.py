"""
Trium 7-Criteria Submission Response Generator & Vanta Grader for Reva.
Calibrated to generate high-caliber, evidence-grounded entry submission responses
aiming for at least a pass score (Grade B [66-75] to Grade A [76-85]) under Vanta's
official 7-criteria evaluation framework.

Includes automated revision loop (up to 2 rounds) if initial draft scores below pass.
"""

import json
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

from src.parsers.doc_parser import IdeaBrief
from src.viability.evaluator import ViabilityAssessment
from src.utils.llm_client import llm_client


class CriterionScore(BaseModel):
    key: str
    label: str
    weight: int
    score: int
    rationale: str


class VantaScorecard(BaseModel):
    idea_name: str
    ai_total: int = Field(description="Total score from 0 to 100")
    ai_grade: str = Field(description="A* | A | B | C | D")
    result: str = Field(description="'passed' | 'reserved' | 'declined'")
    criteria: Dict[str, CriterionScore]
    overall_comments: str
    key_strengths: List[str]
    key_risks: List[str]
    tldr: Dict[str, str]
    draft_submission: Dict[str, str]
    revision_rounds_used: int = 0


DRAFTING_PROMPT = """You are an experienced venture builder at Trium Limited, an African venture studio.
Draft comprehensive, institutional-quality entry-submission responses for this viable venture concept.
Your goal is to present rigorous, data-grounded, defensible arguments that satisfy a strict African VC investment committee.

CONCEPT:
Name: {name}
Sector: {sector}
Problem: {problem}
Solution: {solution}
Target Customer: {targetCustomer}
Monetization: {monetization}
Distribution / GTM: {goToMarket}

VIABILITY CONTEXT:
Verdict: {verdict}
Regulatory Bodies: {regulators}
Critical Infrastructure: {infrastructure}

DRAFT SUBMISSION RESPONSES:
Draft realistic, non-hyped responses for these 7 dimensions:
1. strategic_alignment: Fit with the strategies and stated priorities of Trium, Coronation Group, and Access Bank; identify practical ways to leverage each organization's relevant capabilities, assets, customer reach, channels, data, partnerships, or networks. Assess each organization separately and flag where evidence is missing; do not assume access to resources or partnerships.
2. customer_problem: Acute Nigerian pain point, validated demand, willingness to pay.
3. solution_fit: Operational mechanics, addressable market size (TAM/SAM in Nigeria).
4. market_opportunity: Competitive dynamics, white space, total economic impact.
5. differentiation: Sustainable moat against copy-cats, incumbents, and informal alternatives.
6. sustainable_advantage: Trium capability fit, proprietary distribution, FX mitigation.
7. feasibility: Unit economics, capital efficiency, multi-state expansion roadmap.

Return ONLY a JSON object:
{{
  "strategic_alignment": "<3-4 sentences>",
  "customer_problem": "<3-4 sentences>",
  "solution_fit": "<3-4 sentences>",
  "market_opportunity": "<3-4 sentences>",
  "differentiation": "<3-4 sentences>",
  "sustainable_advantage": "<3-4 sentences>",
  "feasibility": "<3-4 sentences>"
}}"""


GRADING_PROMPT = """You are a strict African venture capital analyst evaluating a business idea submission for Trium Limited.
Most average ideas should score C or D. A* is extremely rare.
However, evaluate the provided drafted responses fairly against the 7 criteria.
Penalise vagueness, unhedged FX risk, and Western copy-paste assumptions.
Reward concrete offline distribution wedges, high-margin unit economics, and institutional anchor partnerships.

IDEA: "{name}"
SECTOR: "{sector}"

SUBMISSION DRAFTS:
- Strategic Alignment: {draft_sa}
- Customer-Problem Fit: {draft_cp}
- Solution Fit: {draft_sf}
- Market Opportunity: {draft_mo}
- Differentiation & Moat: {draft_diff}
- Sustainable Advantage: {draft_sus}
- Feasibility & Scalability: {draft_feas}

CRITERIA WEIGHTS (Must be integers within allowed ranges):
- strategic_alignment: 0 to 20
- customer_problem: 0 to 20
- solution_fit: 0 to 15
- market_opportunity: 0 to 15
- differentiation: 0 to 10
- sustainable_advantage: 0 to 10
- feasibility: 0 to 10

Return ONLY a valid JSON object:
{{
  "criteria": {{
    "strategic_alignment": {{"score": <0-20 integer>, "rationale": "<2-3 sentences>"}},
    "customer_problem": {{"score": <0-20 integer>, "rationale": "<2-3 sentences>"}},
    "solution_fit": {{"score": <0-15 integer>, "rationale": "<2-3 sentences>"}},
    "market_opportunity": {{"score": <0-15 integer>, "rationale": "<2-3 sentences>"}},
    "differentiation": {{"score": <0-10 integer>, "rationale": "<2-3 sentences>"}},
    "sustainable_advantage": {{"score": <0-10 integer>, "rationale": "<2-3 sentences>"}},
    "feasibility": {{"score": <0-10 integer>, "rationale": "<2-3 sentences>"}}
  }},
  "overall_comments": "<3-4 sentence verdict on commercial potential and execution requirements>",
  "key_strengths": ["<strength 1>", "<strength 2>", "<strength 3>"],
  "key_risks": ["<risk 1>", "<risk 2>", "<risk 3>"],
  "tldr": {{
    "problem": "<1-2 sentence summary>",
    "solution": "<1-2 sentence summary>",
    "customers": "<1-2 sentence summary>",
    "go_to_market": "<1-2 sentence summary>",
    "monetization": "<1-2 sentence summary>",
    "competitors": "<1-2 sentence summary>"
  }}
}}"""


class VantaGrader:
    """Drafts submission responses and scores them against Trium's 7 Vanta criteria."""

    CRITERIA_META = [
        {"key": "strategic_alignment", "label": "Strategic Alignment", "weight": 20},
        {"key": "customer_problem", "label": "Customer-Problem Fit", "weight": 20},
        {"key": "solution_fit", "label": "Solution Fit", "weight": 15},
        {"key": "market_opportunity", "label": "Market Opportunity", "weight": 15},
        {"key": "differentiation", "label": "Differentiation & Moat", "weight": 10},
        {"key": "sustainable_advantage", "label": "Sustainable Advantage", "weight": 10},
        {"key": "feasibility", "label": "Feasibility & Scalability", "weight": 10},
    ]

    @staticmethod
    def get_grade_info(score: int) -> Dict[str, str]:
        """Maps numeric total (0-100) to Vanta letter grade and result status."""
        if score >= 86:
            return {"grade": "A*", "label": "Outstanding", "result": "passed"}
        elif score >= 76:
            return {"grade": "A", "label": "Excellent", "result": "passed"}
        elif score >= 66:
            return {"grade": "B", "label": "Good", "result": "passed"}
        elif score >= 57:
            return {"grade": "C", "label": "Average", "result": "reserved"}
        else:
            return {"grade": "D", "label": "Below Threshold", "result": "declined"}

    def draft_and_grade(self, brief: IdeaBrief, viability: ViabilityAssessment) -> VantaScorecard:
        """
        Executes drafting and grading. If score < 66 (below pass), allows up to 2 revision rounds.
        """
        revision_count = 0
        max_revisions = 2

        # Step 1: Initial Draft
        draft = self._generate_draft(brief, viability)

        while True:
            # Step 2: Score against Vanta criteria
            scorecard = self._evaluate_draft(brief, draft, revision_count)

            # If score is B (66+) or we reached max revision rounds, return
            if scorecard.ai_total >= 66 or revision_count >= max_revisions:
                scorecard.revision_rounds_used = revision_count
                return scorecard

            # Step 3: Revision loop to address identified gaps and strengthen arguments
            revision_count += 1
            print(f"[Vanta Grader] Initial score ({scorecard.ai_total}) below pass (66). Refining draft (Round {revision_count})...")
            draft = self._refine_draft(brief, draft, scorecard)

    def _generate_draft(self, brief: IdeaBrief, viability: ViabilityAssessment) -> Dict[str, str]:
        prompt = DRAFTING_PROMPT.format(
            name=brief.name,
            sector=brief.sector or "Tech",
            problem=brief.problem,
            solution=brief.solution,
            targetCustomer=brief.targetCustomer,
            monetization=brief.monetization or "Transactional & recurring fees",
            goToMarket=brief.goToMarket or "Direct partnerships and agent network",
            verdict=viability.executive_verdict,
            regulators=", ".join(viability.key_regulatory_bodies),
            infrastructure=viability.critical_infrastructure_dependency
        )
        data = llm_client.generate_json(prompt)
        if not data or not isinstance(data, dict):
            raise RuntimeError("The LLM provider returned no venture draft.")
        return data

    def _evaluate_draft(self, brief: IdeaBrief, draft: Dict[str, str], revision: int) -> VantaScorecard:
        prompt = GRADING_PROMPT.format(
            name=brief.name,
            sector=brief.sector or "Tech",
            draft_sa=draft.get("strategic_alignment", ""),
            draft_cp=draft.get("customer_problem", ""),
            draft_sf=draft.get("solution_fit", ""),
            draft_mo=draft.get("market_opportunity", ""),
            draft_diff=draft.get("differentiation", ""),
            draft_sus=draft.get("sustainable_advantage", ""),
            draft_feas=draft.get("feasibility", "")
        )

        data = llm_client.generate_json(prompt)
        if not data or not isinstance(data, dict) or "criteria" not in data:
            raise RuntimeError("The LLM provider returned no scored criteria.")

        criteria_dict: Dict[str, CriterionScore] = {}
        total = 0

        for meta in self.CRITERIA_META:
            k = meta["key"]
            c_data = data.get("criteria", {}).get(k)
            if not isinstance(c_data, dict) or "score" not in c_data or "rationale" not in c_data:
                raise RuntimeError(f"The LLM response omitted the {k} criterion score or rationale.")
            score = int(c_data["score"])
            score = max(0, min(meta["weight"], score))  # Clamp to allowed weight
            rationale = str(c_data["rationale"])
            criteria_dict[k] = CriterionScore(
                key=k,
                label=meta["label"],
                weight=meta["weight"],
                score=score,
                rationale=rationale
            )
            total += score

        grade_info = self.get_grade_info(total)
        required_fields = {"overall_comments", "key_strengths", "key_risks", "tldr"}
        if not required_fields.issubset(data):
            raise RuntimeError("The LLM response omitted required scorecard fields.")

        return VantaScorecard(
            idea_name=brief.name,
            ai_total=total,
            ai_grade=grade_info["grade"],
            result=grade_info["result"],
            criteria=criteria_dict,
            overall_comments=data["overall_comments"],
            key_strengths=data["key_strengths"],
            key_risks=data["key_risks"],
            tldr=data["tldr"],
            draft_submission=draft,
            revision_rounds_used=revision
        )

    def _refine_draft(self, brief: IdeaBrief, draft: Dict[str, str], scorecard: VantaScorecard) -> Dict[str, str]:
        """Refines the submission draft specifically strengthening low-scoring criteria."""
        weak_points = [
            f"- {c.label} (Score: {c.score}/{c.weight}): {c.rationale}"
            for c in scorecard.criteria.values()
            if c.score < (c.weight * 0.70)
        ]
        prompt = f"""Strengthen this venture submission draft for '{brief.name}'.
The previous draft scored {scorecard.ai_total}/100.
We need to address these specific assessor criticisms to achieve Grade B (66+):
{chr(10).join(weak_points)}

Incorporate concrete Nigerian distribution anchors, Naira-denominated revenue hedges, and clear studio synergies.
Return updated JSON with the 7 fields: strategic_alignment, customer_problem, solution_fit, market_opportunity, differentiation, sustainable_advantage, feasibility."""

        updated = llm_client.generate_json(prompt)
        if isinstance(updated, dict) and len(updated) >= 5:
            return {**draft, **updated}
        return draft



vanta_grader = VantaGrader()
