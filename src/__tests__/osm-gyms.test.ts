import { parseNominatim, parseOverpass, roundCoordinate } from "@/lib/utils/osm-gyms";
import { describe, expect, it } from "vitest";

describe("parseNominatim", () => {
  it("keeps gyms and reads their address from the display name", () => {
    const json = [
      {
        osm_type: "node",
        osm_id: 123,
        lat: "59.9296",
        lon: "10.7146",
        category: "leisure",
        type: "fitness_centre",
        name: "SATS Majorstuen",
        display_name: "SATS Majorstuen, 12, Kirkeveien, Majorstuen, Frogner, Oslo, 0368, Norge",
      },
      { osm_type: "way", osm_id: 9, lat: "59.9", lon: "10.7", category: "amenity", type: "cafe", name: "Cafe" },
      { osm_type: "way", osm_id: 10, lat: "59.9", lon: "10.7", category: "leisure", type: "sports_centre", name: "" },
    ];
    expect(parseNominatim(json)).toEqual([
      { osmRef: "node/123", name: "SATS Majorstuen", lat: 59.9296, lng: 10.7146, address: "12, Kirkeveien, Majorstuen" },
    ]);
  });

  it("returns nothing for an error body", () => {
    expect(parseNominatim({ error: "Bad request" })).toEqual([]);
  });
});

describe("parseOverpass", () => {
  it("reads nodes and the centre of ways, and skips unnamed gyms", () => {
    const json = {
      elements: [
        {
          type: "node",
          id: 1,
          lat: 59.91,
          lon: 10.75,
          tags: { name: "Elixia", "addr:street": "Storgata", "addr:housenumber": "5", "addr:city": "Oslo" },
        },
        { type: "way", id: 2, center: { lat: 59.92, lon: 10.76 }, tags: { name: "3T" } },
        { type: "node", id: 3, lat: 59.93, lon: 10.77, tags: {} },
      ],
    };
    expect(parseOverpass(json)).toEqual([
      { osmRef: "node/1", name: "Elixia", lat: 59.91, lng: 10.75, address: "Storgata 5, Oslo" },
      { osmRef: "way/2", name: "3T", lat: 59.92, lng: 10.76, address: null },
    ]);
  });
});

describe("roundCoordinate", () => {
  it("keeps two decimals", () => {
    expect(roundCoordinate(59.929612)).toBe(59.93);
    expect(roundCoordinate(-10.71461)).toBe(-10.71);
  });
});
