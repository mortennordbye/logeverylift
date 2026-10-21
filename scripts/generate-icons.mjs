/**
 * Generates PWA icons from an SVG design using sharp.
 * Run with: node scripts/generate-icons.mjs
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const sharp = require("../node_modules/.pnpm/sharp@0.34.5/node_modules/sharp/lib/index.js");
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");

// Icon source: a cast-iron "LOG EVERY LIFT · 20 KG" plate on a bar, on a navy
// studio background. Edit scripts/icon.svg, then rerun this.
// The lettering uses Helvetica Neue, so render on macOS to match the committed PNGs.
const iconSvg = readFileSync(join(__dirname, "icon.svg"));

async function generate(outPath, size) {
  // Render at 2x the 512 viewBox so small sizes are downsampled, not upscaled.
  await sharp(iconSvg, { density: 144 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  console.log(`  ✓ ${outPath.replace(process.cwd(), ".")}`);
}

console.log("Generating PWA icons…");

await generate(join(publicDir, "icon-512x512.png"), 512);
await generate(join(publicDir, "icon-192x192.png"), 192);
await generate(join(publicDir, "apple-touch-icon.png"), 180);

// favicon.ico alternative — tiny 32×32 version baked into public
await generate(join(publicDir, "favicon-32.png"), 32);

console.log("Done.");
