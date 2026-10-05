import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType
} from "docx";
import { jsPDF } from "jspdf";
import pptxgen from "pptxgenjs";

export async function exportToPowerPoint(report) {
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Trium Limited";
  pptx.subject = "Venture benchmark research";
  pptx.title = `Benchmark: ${report.ideaName || "Venture"}`;
  pptx.company = "Trium Limited";
  pptx.theme = {
    headFontFace: "Aptos Display",
    bodyFontFace: "Aptos",
    lang: "en-NG",
  };
  const color = { ink: "1B1C19", muted: "625B53", accent: "924700", paper: "FBF9F4", card: "F1EFE9" };
  const titleSlide = pptx.addSlide();
  titleSlide.background = { color: color.paper };
  titleSlide.addText("TRIUM  /  VENTURE INTELLIGENCE", { x: 0.65, y: 0.45, w: 8, h: 0.25, fontSize: 10, bold: true, charSpacing: 1.5, color: color.accent });
  titleSlide.addText(report.ideaName || "Venture benchmark", { x: 0.65, y: 1.2, w: 12, h: 0.8, fontSize: 30, bold: true, color: color.ink, breakLine: false });
  titleSlide.addText(report.sector || "Sector not specified", { x: 0.68, y: 2.0, w: 12, h: 0.4, fontSize: 15, color: color.muted });
  titleSlide.addText(report.description || "No concept description supplied.", { x: 0.68, y: 2.8, w: 11.5, h: 1.2, fontSize: 18, color: color.ink, breakLine: false, valign: "top", fit: "shrink" });
  titleSlide.addText(`Prepared ${new Date(report.createdAt || Date.now()).toLocaleDateString()}`, { x: 0.68, y: 6.7, w: 6, h: 0.3, fontSize: 10, color: color.muted });

  const peers = report.benchmarks || [];
  for (let offset = 0; offset < peers.length; offset += 4) {
    const slide = pptx.addSlide();
    slide.background = { color: "FFFFFF" };
    slide.addText("BENCHMARK COHORT", { x: 0.55, y: 0.35, w: 4, h: 0.25, fontSize: 10, bold: true, charSpacing: 1.3, color: color.accent });
    slide.addText(`${report.ideaName || "Venture"}: comparable initiatives`, { x: 0.55, y: 0.7, w: 12, h: 0.5, fontSize: 23, bold: true, color: color.ink });
    const rows = [["Company", "Country / tier", "Business model", "Evidence & lesson", "Source"]];
    for (const peer of peers.slice(offset, offset + 4)) {
      rows.push([
        peer.companyName || "Unspecified",
        `${peer.country || "Not verified"} / ${peer.regionTier || "Not classified"}`,
        peer.businessModel || "Not verified",
        [
          `Scale: ${(peer.scaleMetrics || []).map((metric) => `${metric.metric}: ${metric.value}${metric.asOf ? ` (${metric.asOf})` : ""}`).join("; ") || peer.operationalScale || "Not publicly reported"}`,
          `Customers/revenue: ${peer.customersAndRevenues || "Not publicly reported"}`,
          `Execution: ${peer.executionModel || "Not reported"}`,
          `What worked: ${peer.whatWorked || "Not reported"}`,
          `Challenges: ${peer.challenges || "Not reported"}`,
          `Partners: ${peer.keyPartners || "Not publicly reported"}`,
          `Lesson: ${peer.lessonsLearned || "Not stated"}`,
        ].join("\n"),
        peer.sourceUrl || "No verified citation",
      ]);
    }
    slide.addTable(rows, {
      x: 0.55, y: 1.5, w: 12.2, h: 4.9,
      border: { type: "solid", color: "DED8CE", pt: 0.6 },
      fill: "FFFFFF", color: color.ink, fontFace: "Aptos", fontSize: 11,
      rowH: 0.9, colW: [2.0, 1.7, 2.5, 3.7, 2.3],
      margin: 0.12, valign: "mid",
      autoFit: false,
      bold: false,
      rowColors: [color.card],
    });
    slide.addText(`Sources are linked for verification. ${peers.length} sourced peers returned.`, { x: 0.55, y: 6.75, w: 12, h: 0.25, fontSize: 9, color: color.muted });
  }

  const sourceArticles = report.sourceArticles || [];
  for (let offset = 0; offset < sourceArticles.length; offset += 4) {
    const slide = pptx.addSlide();
    slide.background = { color: "FFFFFF" };
    slide.addText("CRAWLED SOURCE EVIDENCE", { x: 0.55, y: 0.35, w: 5, h: 0.25, fontSize: 10, bold: true, charSpacing: 1.3, color: color.accent });
    slide.addText(`${report.ideaName || "Initiative"}: source articles`, { x: 0.55, y: 0.7, w: 12, h: 0.5, fontSize: 23, bold: true, color: color.ink });
    sourceArticles.slice(offset, offset + 4).forEach((article, index) => {
      const y = 1.45 + index * 1.3;
      slide.addText(article.title, { x: 0.65, y, w: 11.8, h: 0.25, fontSize: 14, bold: true, color: color.ink, fit: "shrink" });
      slide.addText(`${article.sourceName} · ${article.sourceRegion}${article.publishedDate ? ` · ${article.publishedDate}` : ""}`, { x: 0.65, y: y + 0.27, w: 11.8, h: 0.2, fontSize: 9, color: color.muted });
      slide.addText(article.summary, { x: 0.65, y: y + 0.49, w: 11.8, h: 0.42, fontSize: 10, color: color.ink, fit: "shrink", valign: "top" });
      slide.addText(`Initiatives: ${(article.relatedInitiatives || []).join(", ") || "None stated"} · ${article.url}`, { x: 0.65, y: y + 0.93, w: 11.8, h: 0.24, fontSize: 8, color: color.accent, fit: "shrink" });
    });
  }

  const synthesisSlides = [
    ["Executive summary", report.executiveSummary],
    ["Market context", report.marketContext],
    ["Cross-market execution patterns", (report.executionInsights || []).map((item) => "• " + item).join("\n")],
    ["Market comparisons and lessons", (report.marketLessons || []).map((item) => "• " + item).join("\n")],
  ].filter(([, text]) => text);
  for (const [heading, text] of synthesisSlides) {
    const slide = pptx.addSlide();
    slide.background = { color: "FFFFFF" };
    slide.addText("COMPARATIVE MARKET REPORT", { x: 0.6, y: 0.4, w: 7, h: 0.25, fontSize: 10, bold: true, charSpacing: 1.4, color: color.accent });
    slide.addText(heading, { x: 0.6, y: 0.9, w: 12, h: 0.55, fontSize: 25, bold: true, color: color.ink });
    slide.addText(text, { x: 0.7, y: 1.8, w: 11.5, h: 4.8, fontSize: 16, color: color.ink, valign: "top", fit: "shrink" });
  }
  const safeName = (report.ideaName || "Venture-Benchmark").replace(/[^\w-]+/g, "-");
  await pptx.writeFile({ fileName: `Trium-Benchmark-${safeName}.pptx` });
}

/**
 * Generates and downloads a genuine Microsoft Word (.docx) executive memo
 */
export async function exportToWord(report) {
  try {
    const doc = new Document({
      sections: [
        {
          properties: {},
          children: [
            new Paragraph({
              text: "TRIUM LIMITED — DIGITAL INCUBATION STUDIO",
              heading: HeadingLevel.HEADING_2,
              alignment: AlignmentType.CENTER,
              spacing: { after: 120 }
            }),
            new Paragraph({
              text: `Executive Venture Benchmark Memo: ${report.ideaName || "Concept Benchmark"}`,
              heading: HeadingLevel.TITLE,
              alignment: AlignmentType.CENTER,
              spacing: { after: 200 }
            }),
            new Paragraph({
              children: [
                new TextRun({ text: "Sector: ", bold: true }),
                new TextRun(report.sector || "Uncategorized"),
                new TextRun({ text: "   |   Date: ", bold: true }),
                new TextRun(new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })),
                new TextRun({ text: "   |   Scope: ", bold: true }),
                new TextRun(report.scope || "Scope not specified")
              ],
              spacing: { after: 300 }
            }),

            new Paragraph({
              text: "Initiative brief",
              heading: HeadingLevel.HEADING_1,
              spacing: { before: 200, after: 100 }
            }),
            new Paragraph({
              children: [
                new TextRun({ text: "Problem Statement: ", bold: true }),
                new TextRun(report.problem || report.description || "N/A")
              ],
              spacing: { after: 100 }
            }),
            new Paragraph({
              children: [
                new TextRun({ text: "Proposed Solution: ", bold: true }),
                new TextRun(report.solution || report.description || "N/A")
              ],
              spacing: { after: 100 }
            }),
            new Paragraph({
              children: [
                new TextRun({ text: "Target Customer & Market: ", bold: true }),
                new TextRun(report.targetCustomer || "Not specified")
              ],
              spacing: { after: 250 }
            }),

            new Paragraph({ text: "Comparative Market Research", heading: HeadingLevel.HEADING_1, spacing: { before: 200, after: 100 } }),
            ...(report.executiveSummary ? [new Paragraph({ children: [new TextRun({ text: "Executive summary: ", bold: true }), new TextRun(report.executiveSummary)], spacing: { after: 120 } })] : []),
            ...(report.marketContext ? [new Paragraph({ children: [new TextRun({ text: "Market context: ", bold: true }), new TextRun(report.marketContext)], spacing: { after: 160 } })] : []),
            ...(report.executionInsights || []).map((item) => new Paragraph({ text: "Execution pattern: " + item, bullet: { indent: 360 }, spacing: { after: 80 } })),
            ...(report.marketLessons || []).map((item) => new Paragraph({ text: "Market lesson: " + item, bullet: { indent: 360 }, spacing: { after: 80 } })),

            new Paragraph({
              text: "Comparable solutions",
              heading: HeadingLevel.HEADING_1,
              spacing: { before: 200, after: 100 }
            }),
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                new TableRow({
                  children: [
                    new TableCell({ children: [new Paragraph({ text: "Company & Country", bold: true })] }),
                    new TableCell({ children: [new Paragraph({ text: "Region Tier", bold: true })] }),
                    new TableCell({ children: [new Paragraph({ text: "Scale, customers & revenue", bold: true })] }),
                    new TableCell({ children: [new Paragraph({ text: "Business model", bold: true })] }),
                    new TableCell({ children: [new Paragraph({ text: "Execution, lessons & source", bold: true })] })
                  ]
                }),
                ...(report.benchmarks?.map(bm =>
                  new TableRow({
                    children: [
                      new TableCell({ children: [new Paragraph(`${bm.companyName} (${bm.country || "Global"})`)] }),
                      new TableCell({ children: [new Paragraph(bm.regionTier || "Nearby Africa")] }),
                      new TableCell({ children: [new Paragraph([`Scale metrics: ${(bm.scaleMetrics || []).map((metric) => `${metric.metric}: ${metric.value}${metric.asOf ? ` (${metric.asOf})` : ""}`).join("; ") || bm.operationalScale || "Not publicly reported"}`, `Customers/revenue: ${bm.customersAndRevenues || "Not publicly reported"}`].join("\n"))] }),
                      new TableCell({ children: [new Paragraph([bm.businessModel || "Not reported", `Execution: ${bm.executionModel || "Not reported"}`].join("\n"))] }),
                      new TableCell({ children: [new Paragraph([`What worked: ${bm.whatWorked || "Not reported"}`, `Challenges: ${bm.challenges || "Not reported"}`, `Partners: ${bm.keyPartners || "Not publicly reported"}`, bm.lessonsLearned || "No lesson stated", bm.sourceUrl].join("\n"))] })
                    ]
                  })
                ) || [])
              ]
            }),
            new Paragraph({
              text: "Source articles",
              heading: HeadingLevel.HEADING_1,
              spacing: { before: 220, after: 100 }
            }),
            ...(report.sourceArticles?.map((article, index) => new Paragraph({
              children: [
                new TextRun({ text: `${index + 1}. ${article.title} — ${article.sourceName} (${article.sourceRegion})\n`, bold: true }),
                new TextRun(`${article.summary}\n`),
                new TextRun({ text: `Initiatives identified: ${(article.relatedInitiatives || []).join(", ") || "None stated"}\n`, italics: true }),
                new TextRun({ text: article.url, color: "0563C1", underline: {} }),
              ],
              spacing: { after: 140 }
            })) || [])
          ]
        }
      ]
    });

    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Trium_Benchmark_${(report.ideaName || "Report").replace(/\s+/g, "_")}.docx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("Word export failed:", err);
    throw err;
  }
}

/**
 * Generates and downloads a clean, executive vector PDF
 */
export function exportToPdf(report) {
  try {
    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4"
    });

    const orange = [224, 112, 0];
    const dark = [27, 28, 25];
    const muted = [95, 94, 94];

    // Header Bar
    doc.setFillColor(...orange);
    doc.rect(0, 0, 210, 16, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("TRIUM LIMITED — DIGITAL INCUBATION STUDIO", 15, 11);

    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text("COMPARATIVE MARKET BENCHMARK REPORT", 210 - 15, 11, { align: "right" });

    let y = 28;

    // Title
    doc.setTextColor(...dark);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(report.ideaName || "Benchmark Report", 15, y);
    y += 7;

    // Subtitle / Meta
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...muted);
    doc.text(`Sector: ${report.sector || "Uncategorized"}  |  Date: ${new Date().toLocaleDateString()}`, 15, y);
    y += 10;

    // Concept Summary Box
    doc.setFillColor(245, 244, 239);
    doc.rect(15, y, 180, 20, "F");
    doc.setTextColor(...dark);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text("Concept Overview:", 18, y + 5);
    doc.setFont("helvetica", "normal");
    const descLines = doc.splitTextToSize(report.description || report.problem || "", 174);
    doc.text(descLines.slice(0, 2), 18, y + 11);
    y += 28;

    const reportSections = [
      ["Executive summary", report.executiveSummary],
      ["Market context", report.marketContext],
      ["Cross-market execution patterns", (report.executionInsights || []).map((item) => "• " + item).join("\n")],
      ["Market comparisons and lessons", (report.marketLessons || []).map((item) => "• " + item).join("\n")],
    ];
    doc.setFontSize(9);
    for (const [heading, content] of reportSections) {
      if (!content) continue;
      const headingLines = doc.splitTextToSize(heading, 180);
      const bodyLines = doc.splitTextToSize(content, 180);
      if (y + 5 + bodyLines.length * 4 > 278) {
        doc.addPage();
        y = 20;
      }
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...dark);
      doc.text(headingLines, 15, y);
      y += headingLines.length * 4 + 1;
      doc.setFont("helvetica", "normal");
      doc.text(bodyLines, 15, y);
      y += bodyLines.length * 4 + 4;
    }

    // Empirical Benchmarks Summary
    doc.setTextColor(...dark);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Empirical Precedent Benchmarks", 15, y);
    y += 6;

    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    if (report.benchmarks?.length) {
      report.benchmarks.forEach((bm) => {
        const details = [
          `Business model: ${bm.businessModel || "Not reported"}`,
          `Customers/revenue: ${bm.customersAndRevenues || "Not publicly reported"}`,
          `Execution: ${bm.executionModel || "Not reported"}`,
          `Partners: ${bm.keyPartners || "Not publicly reported"}`,
          `Scale metrics: ${(bm.scaleMetrics || []).map((metric) => `${metric.metric}: ${metric.value}${metric.asOf ? ` (${metric.asOf})` : ""}`).join("; ") || bm.operationalScale || "Not reported"}`,
          `What worked: ${bm.whatWorked || "Not reported"}`,
          `Challenges: ${bm.challenges || "Not reported"}`,
          `Lesson: ${bm.lessonsLearned || "Not stated"}`,
          `Source: ${bm.sourceUrl}`,
        ].join("\n");
        const detailLines = doc.splitTextToSize(details, 180);
        const blockHeight = 8 + detailLines.length * 3.6;
        if (y + blockHeight > 280) {
          doc.addPage();
          y = 20;
        }
        doc.setFont("helvetica", "bold");
        doc.text(`${bm.companyName} (${bm.country || "Not stated"} · ${bm.regionTier || "Unclassified"})`, 15, y);
        doc.setFont("helvetica", "normal");
        doc.text(detailLines, 15, y + 4);
        y += blockHeight;
      });
    }

    const sourceArticles = report.sourceArticles || [];
    if (sourceArticles.length) {
      doc.addPage();
      y = 20;
      doc.setTextColor(...dark);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text("Crawled Source Articles", 15, y);
      y += 7;
      sourceArticles.forEach((article, index) => {
        const text = [
          `${index + 1}. ${article.title}`,
          `${article.sourceName} · ${article.sourceRegion} · ${article.publishedDate || "Date not stated"}`,
          article.summary,
          `Initiatives identified: ${(article.relatedInitiatives || []).join(", ") || "None stated"}`,
          `Source: ${article.url}`,
        ].join("\n");
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        const lines = doc.splitTextToSize(text, 180);
        const blockHeight = lines.length * 4 + 5;
        if (y + blockHeight > 280) {
          doc.addPage();
          y = 20;
        }
        doc.text(lines, 15, y);
        y += blockHeight;
      });
    }

    // Footer
    doc.setFontSize(7.5);
    doc.setTextColor(...muted);
    doc.text("Confidential — For Internal Trium Studio & Investment Committee Use Only", 105, 290, { align: "center" });

    doc.save(`Trium_Benchmark_${(report.ideaName || "Report").replace(/\s+/g, "_")}.pdf`);
  } catch (err) {
    console.error("PDF export failed:", err);
    throw err;
  }
}
