import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for small secrets stored in the database (a user's Garmin
 * Personal API key). The stored form is "v1.<iv>.<tag>.<ciphertext>", each
 * part base64url, so a later key or algorithm change can tell old rows apart.
 * GCM's tag makes a changed ciphertext fail to decrypt instead of returning
 * garbage.
 */

function keyBytes(keyBase64: string) {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) throw new Error("encryption key must be 32 bytes");
  return key;
}

export function encryptSecret(plain: string, keyBase64: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(keyBase64), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), ct].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function decryptSecret(stored: string, keyBase64: string): string {
  const [version, iv, tag, ct] = stored.split(".");
  if (version !== "v1" || !iv || !tag || !ct) throw new Error("unknown secret format");
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(keyBase64), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}
