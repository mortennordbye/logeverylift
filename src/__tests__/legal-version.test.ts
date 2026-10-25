import { CONSENT_VERSION, LEGAL_VERSION, legalVersionBefore } from "@/lib/constants/legal";
import { describe, expect, it } from "vitest";

describe("legalVersionBefore", () => {
  it("orders by date, then by the same-day suffix as a number", () => {
    expect(legalVersionBefore("2026-10-23", "2026-10-25")).toBe(true);
    expect(legalVersionBefore("2026-10-25", "2026-10-25.2")).toBe(true);
    expect(legalVersionBefore("2026-10-25.2", "2026-10-25.10")).toBe(true);
    expect(legalVersionBefore("2026-10-25.3", "2026-10-25")).toBe(false);
    expect(legalVersionBefore("2026-10-25", "2026-10-25")).toBe(false);
  });

  it("never requires a version newer than the current one", () => {
    expect(legalVersionBefore(LEGAL_VERSION, CONSENT_VERSION)).toBe(false);
  });
});
