/**
 * Generates PWA icons from an SVG design using sharp.
 * Run with: node scripts/generate-icons.mjs
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const sharp = require("../node_modules/.pnpm/sharp@0.34.5/node_modules/sharp/lib/index.js");
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");

// Icon concept: bold barbell on deep blue gradient background
// Blue matches the app's primary color theme
function buildSvg(size) {
  const s = size; // canvas size
  const cx = s / 2;
  const cy = s / 2;

  // Plate dimensions — scale with canvas, stay inside maskable safe zone (80%)
  const safe = s * 0.82;
  const safeOffset = (s - safe) / 2;

  // Barbell geometry
  const plateW = safe * 0.155;
  const plateH = safe * 0.53;
  const collarW = safe * 0.055;
  const collarH = safe * 0.36;
  const barH = safe * 0.088;
  const barW = safe - 2 * (plateW + collarW);

  const plateX = safeOffset;
  const plateY = cy - plateH / 2;
  const lCollarX = plateX + plateW;
  const collarY = cy - collarH / 2;
  const barX = lCollarX + collarW;
  const barY = cy - barH / 2;
  const rCollarX = barX + barW;
  const rPlateX = rCollarX + collarW;

  const rx = plateW * 0.22;
  const barRx = barH * 0.45;

  // Background: very dark, almost-black with a faint blue warmth
  const bg = "#0d1117";
  // Plate: bright blue
  const plateFill = "#3b82f6";
  // Collar: slightly deeper blue
  const collarFill = "#2563eb";
  // Bar: lighter blue-gray
  const barFill = "#93c5fd";

  // Subtle glow ring behind barbell (gives depth)
  const glowR = safe * 0.38;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="50%" r="60%">
      <stop offset="0%" stop-color="#1e2d45"/>
      <stop offset="100%" stop-color="${bg}"/>
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#3b82f6" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <!-- Background -->
  <rect width="${s}" height="${s}" fill="url(#bg)"/>

  <!-- Glow -->
  <circle cx="${cx}" cy="${cy}" r="${glowR}" fill="url(#glow)"/>

  <!-- Left plate -->
  <rect x="${plateX}" y="${plateY}" width="${plateW}" height="${plateH}" rx="${rx}" fill="${plateFill}"/>

  <!-- Left collar -->
  <rect x="${lCollarX}" y="${collarY}" width="${collarW}" height="${collarH}" rx="${rx * 0.5}" fill="${collarFill}"/>

  <!-- Bar -->
  <rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="${barRx}" fill="${barFill}"/>

  <!-- Right collar -->
  <rect x="${rCollarX}" y="${collarY}" width="${collarW}" height="${collarH}" rx="${rx * 0.5}" fill="${collarFill}"/>

  <!-- Right plate -->
  <rect x="${rPlateX}" y="${plateY}" width="${plateW}" height="${plateH}" rx="${rx}" fill="${plateFill}"/>
</svg>`;
}

async function generate(svgStr, outPath, size) {
  const buf = Buffer.from(svgStr);
  await sharp(buf)
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  console.log(`  ✓ ${outPath.replace(process.cwd(), ".")}`);
}

console.log("Generating PWA icons…");

await generate(buildSvg(512), join(publicDir, "icon-512x512.png"), 512);
await generate(buildSvg(192), join(publicDir, "icon-192x192.png"), 192);
await generate(buildSvg(180), join(publicDir, "apple-touch-icon.png"), 180);

// favicon.ico alternative — tiny 32×32 version baked into public
await generate(buildSvg(32), join(publicDir, "favicon-32.png"), 32);

console.log("Done.");
