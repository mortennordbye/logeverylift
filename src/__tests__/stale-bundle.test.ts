import { describe, expect, it } from "vitest";
import { isStaleBundleError } from "@/lib/utils/stale-bundle";

describe("isStaleBundleError", () => {
  it("matches the server-side wording", () => {
    expect(
      isStaleBundleError(
        new Error(
          'Failed to find Server Action "400af1cfffeb0679f2398e69e6e3b119b586b92e87". This request might be from an older or newer deployment.',
        ),
      ),
    ).toBe(true);
  });

  it("matches the generic wording the client actually receives", () => {
    // The 2026-08-24 rollout logged the server text above while the client saw
    // this — matching only the server wording meant recovery never fired.
    expect(
      isStaleBundleError(
        new Error("An unexpected response was received from the server."),
      ),
    ).toBe(true);
  });

  it("matches a plain string rejection", () => {
    expect(isStaleBundleError("Failed to find Server Action \"40abc\"")).toBe(true);
  });

  it("matches when the reason is only on the digest", () => {
    const err = Object.assign(new Error("An error occurred in the Server Components render."), {
      digest: "Failed to find Server Action 40abc",
    });
    expect(isStaleBundleError(err)).toBe(true);
  });

  it("matches a plain object carrying message or digest", () => {
    expect(isStaleBundleError({ message: "failed to find server action 40x" })).toBe(true);
    expect(isStaleBundleError({ digest: "failed to find server action 40x" })).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isStaleBundleError(new Error("FAILED TO FIND SERVER ACTION"))).toBe(true);
  });

  it("ignores ordinary failures that must stay retryable", () => {
    expect(isStaleBundleError(new Error("Failed to fetch"))).toBe(false);
    expect(isStaleBundleError(new Error("NetworkError when attempting to fetch resource."))).toBe(false);
    expect(isStaleBundleError(new Error("Invalid input"))).toBe(false);
    expect(isStaleBundleError(new Error(""))).toBe(false);
  });

  it("ignores empty and non-error values", () => {
    expect(isStaleBundleError(null)).toBe(false);
    expect(isStaleBundleError(undefined)).toBe(false);
    expect(isStaleBundleError(0)).toBe(false);
    expect(isStaleBundleError({})).toBe(false);
    expect(isStaleBundleError({ digest: 12345 })).toBe(false);
  });
});
