import { shortDay } from "@/lib/utils/seasons";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * A day label that the server and the browser render the same (PR #231 CI):
 * Linux WebKit's ICU formats en-GB "weekday short, day, month short" as
 * "Wed, 4 Nov" where Node gives "Wed 4 Nov", so a label made with Intl in a
 * client component did not hydrate. The label must not depend on Intl.
 */

afterEach(() => vi.restoreAllMocks());

describe("shortDay", () => {
  it("writes the weekday, day and month by the calendar", () => {
    expect(shortDay("2026-11-04")).toBe("Wed 4 Nov");
    expect(shortDay("2026-11-08")).toBe("Sun 8 Nov");
    expect(shortDay("2027-01-01")).toBe("Fri 1 Jan");
  });

  it("gives the same text whatever the engine's date formatting says", () => {
    // What an older ICU (Linux WebKit) returns for the same options.
    vi.spyOn(Date.prototype, "toLocaleDateString").mockReturnValue("Wed, 4 Nov");
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => ({ format: () => "Wed, 4 Nov" }) as unknown as Intl.DateTimeFormat);
    expect(shortDay("2026-11-04")).toBe("Wed 4 Nov");
  });
});
