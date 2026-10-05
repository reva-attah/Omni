import type { UserIdentity } from "convex/server";

export function isTriumEmail(email: unknown): email is string {
  return typeof email === "string" && /^[^\s@]+@trium\.ng$/i.test(email);
}

export function isAuthorizedOmniIdentity(
  identity: UserIdentity | null | undefined,
): identity is UserIdentity & { email: string } {
  return isTriumEmail(identity?.email);
}
