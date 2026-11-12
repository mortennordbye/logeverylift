import { callAction, isStaleBundleError } from "@/lib/utils/stale-bundle";
import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";
import { describe, expect, it } from "vitest";

// What the Next 16 client router throws when the server answers an action POST
// with `x-nextjs-action-not-found: 1`
// (node_modules/next/dist/client/components/router-reducer/reducers/server-action-reducer.js).
// "Failed to find Server Action" is only the server's log line; the client
// never sees it.
const nextStaleError = () =>
  new UnrecognizedActionError(
    'Server Action "40c1d2e3f4" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action',
  );

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

  it("recognises the stale-bundle error the Next 16 client really throws", async () => {
    expect(await callAction(Promise.reject(nextStaleError()))).toEqual({ success: false, error: "App updating" });
  });
});

describe("isStaleBundleError", () => {
  it("matches Next's error by class name and by message", () => {
    expect(isStaleBundleError(nextStaleError())).toBe(true);
    const sameText = new Error('Server Action "abc" was not found on the server.');
    expect(isStaleBundleError(sameText)).toBe(true);
    const sameName = Object.assign(new Error("x"), { name: "UnrecognizedActionError" });
    expect(isStaleBundleError(sameName)).toBe(true);
  });

  it("does not match ordinary failures", () => {
    expect(isStaleBundleError(new TypeError("Load failed"))).toBe(false);
    expect(isStaleBundleError(new Error("An unexpected response was received from the server."))).toBe(false);
    expect(isStaleBundleError(undefined)).toBe(false);
  });
});
