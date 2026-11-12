import { decryptSecret, encryptSecret } from "@/lib/utils/crypto";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

const key = randomBytes(32).toString("base64");

describe("encryptSecret / decryptSecret", () => {
  it("round-trips and never stores the plain text", () => {
    const stored = encryptSecret("my-garmin-key", key);
    expect(stored.startsWith("v1.")).toBe(true);
    expect(stored).not.toContain("my-garmin-key");
    expect(decryptSecret(stored, key)).toBe("my-garmin-key");
  });

  it("uses a fresh IV each time", () => {
    expect(encryptSecret("same", key)).not.toBe(encryptSecret("same", key));
  });

  it("fails with the wrong key", () => {
    const stored = encryptSecret("secret", key);
    expect(() => decryptSecret(stored, randomBytes(32).toString("base64"))).toThrow();
  });

  it("fails when the ciphertext was changed", () => {
    const [v, iv, tag, ct] = encryptSecret("secret", key).split(".");
    const flipped = Buffer.from(ct, "base64url");
    flipped[0] ^= 1;
    expect(() => decryptSecret([v, iv, tag, flipped.toString("base64url")].join("."), key)).toThrow();
  });

  it("refuses a key that isn't 32 bytes", () => {
    expect(() => encryptSecret("x", Buffer.alloc(16).toString("base64"))).toThrow(/32 bytes/);
  });
});
