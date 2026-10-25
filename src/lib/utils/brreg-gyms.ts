/**
 * Turn Brønnøysund business register (Enhetsregisteret) answers into gym
 * candidates, for gyms OpenStreetMap doesn't have. The fetching lives in
 * src/lib/actions/gyms.ts; these only read the responses, so they can be
 * tested on recorded ones.
 */

export type RegisterUnit = {
  orgnr: string;
  parent: string | null;
  name: string;
  street: string;
  municipality: string;
  postalTown: string;
};

// Sports facilities and fitness centres. Clubs and sports instruction are left
// out: mostly a board member's or a trainer's home address.
const GYM_CODE = /^93\.1[13]0$/;
// A gym filed under another code, like a training centre registered as a clinic.
const GYM_WORD = /(trening|fitness|gym(?!nas)|crossfit|styrke)/i;
const NOT_A_GYM = /(holding|konkursbo|eiendom)/i;

/** The register's sub-units (underenheter): open ones with a street address that look like a gym. */
export function parseRegisterUnits(json: unknown): RegisterUnit[] {
  const embedded = (json as { _embedded?: { underenheter?: unknown[] } } | null)?._embedded;
  const raw = Array.isArray(embedded?.underenheter) ? embedded.underenheter : [json];
  const units: RegisterUnit[] = [];
  type Raw = {
    organisasjonsnummer?: string;
    overordnetEnhet?: string;
    navn?: string;
    nedleggelsesdato?: string;
    naeringskode1?: { kode?: string };
    naeringskode2?: { kode?: string };
    naeringskode3?: { kode?: string };
    beliggenhetsadresse?: { adresse?: string[]; kommunenummer?: string; poststed?: string };
  };
  for (const u of raw as Raw[]) {
    const name = u?.navn;
    const address = u?.beliggenhetsadresse;
    if (!u?.organisasjonsnummer || !name || u.nedleggelsesdato || NOT_A_GYM.test(name)) continue;
    const codes = [u.naeringskode1, u.naeringskode2, u.naeringskode3].map((c) => c?.kode ?? "");
    if (!codes.some((c) => GYM_CODE.test(c)) && !GYM_WORD.test(name)) continue;
    // A "c/o" line means it's registered at someone else's address, often a home.
    const lines = address?.adresse ?? [];
    if (lines.length !== 1 || /^c\/o\b/i.test(lines[0]) || !address?.kommunenummer) continue;
    const street = lines[0];
    units.push({
      orgnr: u.organisasjonsnummer,
      parent: u.overordnetEnhet ?? null,
      name,
      street,
      municipality: address.kommunenummer,
      postalTown: address.poststed ?? "",
    });
  }
  return units;
}

/**
 * Parent organisations (enheter) that may be listed: not a sole trader, whose
 * units carry a private person's name and often their home, and not bankrupt
 * or being wound up.
 */
export function listableParents(json: unknown): Set<string> {
  const embedded = (json as { _embedded?: { enheter?: unknown[] } } | null)?._embedded;
  const ok = new Set<string>();
  type Raw = {
    organisasjonsnummer?: string;
    organisasjonsform?: { kode?: string };
    konkurs?: boolean;
    underAvvikling?: boolean;
    underTvangsavviklingEllerTvangsopplosning?: boolean;
  };
  for (const e of (embedded?.enheter ?? []) as Raw[]) {
    if (!e?.organisasjonsnummer || e.organisasjonsform?.kode === "ENK") continue;
    if (e.konkurs || e.underAvvikling || e.underTvangsavviklingEllerTvangsopplosning) continue;
    ok.add(e.organisasjonsnummer);
  }
  return ok;
}

/** Whether every word of the search starts a word in the name. The register's own name search is fuzzy. */
export function nameMatches(name: string, query: string): boolean {
  const words = name.toLowerCase().split(/[^\p{L}\p{N}]+/u);
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .every((q) => words.some((w) => w.startsWith(q)));
}

const SMALL_WORDS = new Set(["og", "i", "på", "av", "for", "med"]);

/** "STERK HELSE OG TRENING NYDALEN AS" → "Sterk Helse og Trening Nydalen". */
export function displayName(name: string): string {
  return name
    .replace(/\s+(AS|ASA|SA|DA|ANS)$/i, "")
    .toLowerCase()
    .split(" ")
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/** The first hit of a Kartverket address search (ws.geonorge.no/adresser/v1/sok). */
export function parseKartverket(json: unknown): { lat: number; lng: number } | null {
  const hit = (json as { adresser?: { representasjonspunkt?: { lat?: number; lon?: number } }[] } | null)
    ?.adresser?.[0]?.representasjonspunkt;
  const lat = Number(hit?.lat);
  const lng = Number(hit?.lon);
  return Number.isFinite(lat) && Number.isFinite(lng) && hit ? { lat, lng } : null;
}

/** Metres between two points; plenty accurate at gym distances. */
export function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const k = Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot((a.lat - b.lat) * 111_320, (a.lng - b.lng) * 111_320 * k);
}
