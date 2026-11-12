import { inflateRawSync } from "node:zlib";

/**
 * Read one file out of a ZIP archive, by extension. Garmin's activity download
 * is a ZIP holding a single .fit file; this covers that (stored or deflated
 * entries, read through the central directory) without a ZIP dependency.
 * Returns null when no entry matches.
 */
export function readZipEntry(zip: Buffer, extension: string): Buffer | null {
  // End of central directory: signature 0x06054b50, within the last 64 KB + 22 bytes.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file");

  const entries = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < entries; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error("bad zip central directory");
    const method = zip.readUInt16LE(p + 10);
    const compressedSize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const localOffset = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;

    if (!name.toLowerCase().endsWith(extension.toLowerCase())) continue;

    if (zip.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("bad zip local header");
    const dataStart = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    const data = zip.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) return Buffer.from(data);
    if (method === 8) return inflateRawSync(data);
    throw new Error(`unsupported zip compression ${method}`);
  }
  return null;
}
