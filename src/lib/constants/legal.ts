/**
 * The version of the privacy policy and terms (src/app/privacy, src/app/terms),
 * as its effective date. Bump it when what is collected, why, or who receives
 * it changes: the home screen then tells each user once that the policy was
 * updated (user.policySeenVersion). Wording fixes need no bump.
 */
export const LEGAL_VERSION = "2026-10-31";

/**
 * The oldest accepted version that still counts. The home screen sends anyone
 * who accepted an earlier one (user.termsVersion) to /consent. Raise it to
 * LEGAL_VERSION only for a change users must accept again: a new kind of health
 * data, a new purpose, or new obligations in the terms. A new recipient alone
 * is told, not asked.
 */
export const CONSENT_VERSION = "2026-10-25";

/** Whether version a ("YYYY-MM-DD" or "YYYY-MM-DD.N") is older than b. */
export function legalVersionBefore(a: string, b: string): boolean {
  const [dateA, nA = "1"] = a.split(".");
  const [dateB, nB = "1"] = b.split(".");
  return dateA !== dateB ? dateA < dateB : Number(nA) < Number(nB);
}

export const CONTROLLER = {
  name: "Morten Victor Nordbye",
  location: "Oslo, Norway",
  email: "morten@nordbye.it",
} as const;

/** Full-screen pages without the bottom nav or the first-run tutorial over them. */
export const LEGAL_PATHS = ["/privacy", "/terms", "/consent"];
