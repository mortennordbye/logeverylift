/**
 * The version of the privacy policy and terms (src/app/privacy, src/app/terms).
 * Bump it, as the effective date, for a change users must accept again: the
 * home screen sends anyone whose user.termsVersion differs to /consent.
 * Wording fixes that don't change what is collected or why need no bump.
 */
export const LEGAL_VERSION = "2026-10-23";

export const CONTROLLER = {
  name: "Morten Victor Nordbye",
  location: "Oslo, Norway",
  email: "morten@nordbye.it",
} as const;

/** Full-screen pages without the bottom nav or the first-run tutorial over them. */
export const LEGAL_PATHS = ["/privacy", "/terms", "/consent"];
