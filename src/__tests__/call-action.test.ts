import { callAction } from "@/lib/utils/stale-bundle";
import { describe, expect, it } from "vitest";

describe("callAction", () => {
  it("passes a result through, failed or not", async () => {
    expect(await callAction(Promise.resolve({ success: true as const, data: 1 }))).toEqual({ success: true, data: 1 });
    expect(await callAction(Promise.resolve({ success: false as const, error: "Not found" }))).toEqual({
      success: false,
      error: "Not found",
    });
  });

  it("turns a rejected call into a failed result", async () => {
    const result = await callAction(Promise.reject(new TypeError("Load failed")));
    expect(result).toEqual({ success: false, error: "Couldn't reach the server" });
  });

  it("recognises a stale bundle", async () => {
    const result = await callAction(
      Promise.reject(new Error('Failed to find Server Action "abc". This request might be from an older or newer deployment.')),
    );
    expect(result).toEqual({ success: false, error: "App updating" });
  });
});
