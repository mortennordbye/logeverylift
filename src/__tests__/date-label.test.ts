import { describe, expect, it } from "vitest";
import { dateLabel } from "@/lib/utils/date-label";

/**
 * Each pattern matches what the locale formatter it replaced wrote in Node,
 * except that September is "Sep" (as WebKit writes it) and not Node's "Sept".
 */
const CASES: [pattern: string, locale: string, options: Intl.DateTimeFormatOptions][] = [
  ["d MMM", "en-GB", { day: "numeric", month: "short" }],
  ["d MMM yyyy", "en-GB", { day: "numeric", month: "short", year: "numeric" }],
  ["EEE d MMM", "en-GB", { weekday: "short", day: "numeric", month: "short" }],
  ["EEE, d MMM yyyy", "en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }],
  ["EEEE d MMMM", "en-GB", { weekday: "long", day: "numeric", month: "long" }],
  ["EEE", "en-GB", { weekday: "short" }],
  ["EEEEE", "en-GB", { weekday: "narrow" }],
  ["MMM d", "en-US", { month: "short", day: "numeric" }],
  ["MMM yyyy", "en-US", { month: "short", year: "numeric" }],
  ["EEEE, MMMM d", "en-US", { weekday: "long", month: "long", day: "numeric" }],
  ["EEE, MMM d, yyyy", "en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }],
];

const DAYS = Array.from({ length: 12 }, (_, m) => [1, 9, 28].map((d) => `2026-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`)).flat();

describe("dateLabel", () => {
  it.each(CASES)("%s reads as %s did", (pattern, locale, options) => {
    for (const day of DAYS) {
      const expected = new Date(`${day}T12:00:00Z`).toLocaleDateString(locale, { ...options, timeZone: "UTC" }).replace(/\bSept\b/, "Sep");
      expect(dateLabel(day, pattern)).toBe(expected);
    }
  });

  it("writes September as Sep", () => {
    expect(dateLabel("2026-09-03", "d MMM")).toBe("3 Sep");
    expect(dateLabel("2026-09-03", "EEEE d MMMM")).toBe("Thursday 3 September");
  });

  it("reads a Date in the runtime's zone, or in UTC when asked", () => {
    const at = new Date(2026, 8, 3, 23, 5);
    expect(dateLabel(at, "d MMM, HH:mm")).toBe("3 Sep, 23:05");
    const utc = new Date(Date.UTC(2026, 8, 3, 23, 5));
    expect(dateLabel(utc, "EEE d MMM HH:mm", { utc: true })).toBe("Thu 3 Sep 23:05");
  });
});
