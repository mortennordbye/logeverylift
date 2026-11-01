import { signInRedirect } from "@/lib/utils/sign-in-redirect";
import { describe, expect, it } from "vitest";

describe("signInRedirect", () => {
  it("does not navigate when the server is continuing an OAuth flow", () => {
    expect(signInRedirect({ redirect: true, url: "/api/auth/oauth2/authorize?x=1" }, "/")).toBeNull();
  });

  it("follows a same-origin `from` after a plain sign-in", () => {
    expect(signInRedirect({ redirect: false, token: "t" }, "/history")).toBe("/history");
    expect(signInRedirect({ token: "t" }, null)).toBe("/");
  });

  it("drops a `from` that would leave the site", () => {
    for (const from of ["https://evil.com", "//evil.com", "/\\evil.com", "evil"]) {
      expect(signInRedirect({ redirect: false }, from)).toBe("/");
    }
  });
});
