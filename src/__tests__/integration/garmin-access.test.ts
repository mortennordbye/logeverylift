import { garminAllowed, garminAllowedFor } from "@/lib/garmin/access";
import { describe, expect, it, vi } from "vitest";
import { createUser } from "./factories";

/** Garmin is the owner's tool: on only with the encryption key set, and only for admin accounts. */

const env = vi.hoisted(() => ({ GARMIN_KEY_ENCRYPTION_KEY: "k" as string | undefined }));
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return { ...actual, env: new Proxy(actual.env, { get: (t, k) => (k === "GARMIN_KEY_ENCRYPTION_KEY" ? env.GARMIN_KEY_ENCRYPTION_KEY : Reflect.get(t, k)) }) };
});

describe("Garmin access", () => {
  it("allows admins only, and nobody without the key", async () => {
    expect(garminAllowed("admin")).toBe(true);
    expect(garminAllowed("user")).toBe(false);
    expect(garminAllowed(null)).toBe(false);
    expect(await garminAllowedFor((await createUser({ role: "admin" })).id)).toBe(true);
    expect(await garminAllowedFor((await createUser()).id)).toBe(false);

    env.GARMIN_KEY_ENCRYPTION_KEY = undefined;
    expect(garminAllowed("admin")).toBe(false);
    expect(await garminAllowedFor((await createUser({ role: "admin" })).id)).toBe(false);
    env.GARMIN_KEY_ENCRYPTION_KEY = "k";
  });
});
