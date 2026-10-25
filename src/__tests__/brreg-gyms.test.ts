import {
  displayName,
  listableParents,
  nameMatches,
  parseKartverket,
  parseRegisterUnits,
} from "@/lib/utils/brreg-gyms";
import { describe, expect, it } from "vitest";

// Shaped like data.brreg.no/enhetsregisteret/api/underenheter?navn=sterk%20nydalen
const unit = (navn: string, kode: string, extra: Record<string, unknown> = {}) => ({
  organisasjonsnummer: "934609050",
  overordnetEnhet: "834391422",
  navn,
  naeringskode1: { kode },
  beliggenhetsadresse: { adresse: ["Maridalsveien 323"], postnummer: "0380", poststed: "OSLO", kommunenummer: "0301" },
  ...extra,
});

describe("parseRegisterUnits", () => {
  it("keeps a training centre filed under a clinic code, and fitness-centre units", () => {
    const units = parseRegisterUnits({
      _embedded: {
        underenheter: [
          unit("STERK HELSE OG TRENING NYDALEN AS", "86.210"),
          unit("BOXLAB AS", "93.130"),
          unit("STERK LEGAL", "62.100"),
          unit("STERK HELSE AS", "86.210"),
          unit("OSLO HANDELSGYMNASIUM", "85.310"),
          unit("STERK I LAG AS", "85.510"),
          unit("STERKERE SAMMEN", "93.120"),
        ],
      },
    });
    expect(units.map((u) => u.name)).toEqual(["STERK HELSE OG TRENING NYDALEN AS", "BOXLAB AS"]);
    expect(units[0]).toEqual({
      orgnr: "934609050",
      parent: "834391422",
      name: "STERK HELSE OG TRENING NYDALEN AS",
      street: "Maridalsveien 323",
      municipality: "0301",
      postalTown: "OSLO",
    });
  });

  it("drops closed units, holding companies, bankruptcy estates and units without an address", () => {
    const units = parseRegisterUnits({
      _embedded: {
        underenheter: [
          unit("GONE TRENING AS", "93.130", { nedleggelsesdato: "2024-01-01" }),
          unit("BRAK BULDRING HOLDING AS", "93.130"),
          unit("AKTIV TRENING AS KONKURSBO", "93.130"),
          unit("NO ADDRESS FITNESS AS", "93.130", { beliggenhetsadresse: undefined }),
        ],
      },
    });
    expect(units).toEqual([]);
  });

  it("drops a unit registered care of someone, which is often their home", () => {
    const careOf = (adresse: string[]) =>
      parseRegisterUnits(unit("STERKERE TRENING", "93.130", { beliggenhetsadresse: { adresse, kommunenummer: "0301" } }));
    expect(careOf(["c/o Berit Holsbø", "Oppsalstubben 1A"])).toEqual([]);
    expect(careOf(["c/o Pilar Eiendomsutvikling AS"])).toEqual([]);
    expect(careOf(["Storgata 43"])).toHaveLength(1);
  });
});

describe("listableParents", () => {
  it("leaves out sole traders and organisations being wound up", () => {
    const ok = listableParents({
      _embedded: {
        enheter: [
          { organisasjonsnummer: "1", organisasjonsform: { kode: "AS" } },
          { organisasjonsnummer: "2", organisasjonsform: { kode: "ENK" } },
          { organisasjonsnummer: "3", organisasjonsform: { kode: "AS" }, konkurs: true },
          { organisasjonsnummer: "4", organisasjonsform: { kode: "AS" }, underAvvikling: true },
        ],
      },
    });
    expect([...ok]).toEqual(["1"]);
  });
});

describe("nameMatches", () => {
  it("needs every searched word to start a word in the name", () => {
    expect(nameMatches("STERK HELSE OG TRENING NYDALEN AS", "sterk nydalen")).toBe(true);
    expect(nameMatches("STERK HELSE OG TRENING NYDALEN AS", "sterk nyd")).toBe(true);
    expect(nameMatches("STERK LEGAL", "sterk nydalen")).toBe(false);
    expect(nameMatches("STARK MEDIA", "sterk")).toBe(false);
  });
});

describe("displayName", () => {
  it("drops the company form and keeps small words lower case", () => {
    expect(displayName("STERK HELSE OG TRENING NYDALEN AS")).toBe("Sterk Helse og Trening Nydalen");
    expect(displayName("BISLET BAD OG TRENING AS")).toBe("Bislet Bad og Trening");
    expect(displayName("ÅSANE TRENINGSSENTER")).toBe("Åsane Treningssenter");
  });
});

describe("parseKartverket", () => {
  it("reads the first hit's point, or null without one", () => {
    expect(
      parseKartverket({ adresser: [{ representasjonspunkt: { epsg: "EPSG:4258", lat: 59.9543, lon: 10.7612 } }] }),
    ).toEqual({ lat: 59.9543, lng: 10.7612 });
    expect(parseKartverket({ adresser: [] })).toBeNull();
  });
});

