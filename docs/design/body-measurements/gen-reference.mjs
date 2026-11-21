// Builds the body map SVGs and the measuring guide from the app's own front figure
// (src/lib/exercise-art/muscle-map.ts, exported to front.json) and fills plan.src.html.
import fs from "node:fs";
const dir = new URL(".", import.meta.url).pathname;
const fig = JSON.parse(fs.readFileSync(dir + "front.json", "utf8"));

const defs = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><g id="bm-fig">${fig.shapes
  .map((s) => `<path d="${s.d}" fill="${s.m ? "var(--fig2)" : "var(--fig)"}"/>`)
  .join("")}${fig.lines.map((d) => `<path d="${d}" fill="none" stroke="var(--figline)" stroke-width="1.2"/>`).join("")}</g></defs></svg>`;

// Circumference sites, in figure coordinates (200 x 400; screen-left is the person's right side).
const C = [
  { n: 1, name: "Neck", y: 58, x1: 89.6, x2: 110.4, side: "R", ly: 50 },
  { n: 2, name: "Shoulders", y: 92, x1: 47.5, x2: 152.5, side: "L", ly: 88 },
  { n: 3, name: "Chest", y: 104, x1: 67, x2: 133, side: "R", ly: 100 },
  { n: 4, name: "Waist", y: 150, x1: 71.5, x2: 128.5, side: "R", ly: 150 },
  { n: 5, name: "Hips", y: 200, x1: 67.5, x2: 132.5, side: "R", ly: 200 },
  { n: 6, name: "Upper arm", y: 128, x1: 46.9, x2: 64.7, side: "L", ly: 130, lr: true },
  { n: 7, name: "Forearm", y: 174, x1: 45.9, x2: 60.9, side: "L", ly: 176, lr: true },
  { n: 8, name: "Thigh", y: 238, x1: 69.1, x2: 97.3, side: "L", ly: 238, lr: true },
  { n: 9, name: "Calf", y: 322, x1: 72.4, x2: 88.7, side: "L", ly: 322, lr: true },
];

const band = (x1, x2, y, w = 1.8) => {
  const rx = (x2 - x1) / 2 + 0.6, ry = Math.max(2, rx * 0.12);
  return `<path d="M${x1 - 0.6} ${y}A${rx} ${ry} 0 0 1 ${x2 + 0.6} ${y}" fill="none" stroke="var(--accent)" stroke-width="${w * 0.6}" stroke-dasharray="2 2" opacity=".8"/>` +
    `<path d="M${x1 - 0.6} ${y}A${rx} ${ry} 0 0 0 ${x2 + 0.6} ${y}" fill="none" stroke="var(--accent)" stroke-width="${w}" stroke-linecap="round"/>`;
};
const badge = (cx, cy, n, r = 8) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="var(--accent)"/><text x="${cx}" y="${cy + 3.4}" text-anchor="middle" font-size="${r * 1.15}" font-weight="700" fill="var(--onaccent)">${n}</text>`;

const X0 = 120, LX = 104, RX = 336;
function callout(s) {
  const left = s.side === "L";
  const ex = X0 + (left ? s.x1 : s.x2) + (left ? -1.5 : 1.5);
  const cx = left ? LX : RX;
  const knee = left ? cx + 14 : cx - 14;
  const lead = `<polyline points="${ex},${s.y} ${knee + (left ? 10 : -10)},${s.y} ${knee},${s.ly} ${cx + (left ? 8 : -8)},${s.ly}" fill="none" stroke="var(--lead)" stroke-width=".8"/>`;
  const label = `<text x="${left ? cx - 13 : cx + 13}" y="${s.ly + 4}" text-anchor="${left ? "end" : "start"}" font-size="12" font-weight="600" fill="var(--fg)">${s.name}</text>` +
    (s.lr ? `<text x="${left ? cx - 13 : cx + 13}" y="${s.ly + 17}" text-anchor="${left ? "end" : "start"}" font-size="9.5" fill="var(--muted)">left and right</text>` : "");
  return lead + badge(cx, s.ly, s.n) + label;
}

const circMap = `<svg class="bodymap" viewBox="0 0 440 400" role="img" aria-label="Front body figure with nine tape lines: neck, shoulders, chest, waist, hips, upper arm, forearm, thigh and calf">
<use href="#bm-fig" x="${X0}" y="0"/>
${C.map((s) => `<g transform="translate(${X0} 0)">${band(s.x1, s.x2, s.y)}</g>`).join("")}
${C.map(callout).join("")}
</svg>`;

// Lengths, with dimension lines.
function dim(x, y1, y2, color, w = 1.4) {
  return `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${color}" stroke-width="${w}"/>` +
    `<line x1="${x - 4}" y1="${y1}" x2="${x + 4}" y2="${y1}" stroke="${color}" stroke-width="${w}"/>` +
    `<line x1="${x - 4}" y1="${y2}" x2="${x + 4}" y2="${y2}" stroke="${color}" stroke-width="${w}"/>`;
}
const ext = (x1, y, x2) => `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="var(--lead)" stroke-width=".8" stroke-dasharray="2 2"/>`;
const T = (x) => X0 + x;
const lenMap = `<svg class="bodymap" viewBox="0 0 440 400" role="img" aria-label="Front body figure with length lines: arm length, leg length and inseam, and height for reference">
<use href="#bm-fig" x="${X0}" y="0"/>
<line x1="${T(6)}" y1="384" x2="${T(190)}" y2="384" stroke="var(--lead)" stroke-width="1"/>
${ext(T(100), 9, T(6))}${dim(T(10), 9, 384, "var(--muted)", 1)}
<text x="${T(4)}" y="196" text-anchor="end" font-size="11" fill="var(--muted)">Height</text>
<text x="${T(4)}" y="209" text-anchor="end" font-size="9.5" fill="var(--muted)">in profile now</text>
${ext(T(51), 79, T(30))}${ext(T(49), 227, T(30))}${dim(T(34), 79, 227, "var(--accent)")}
<polyline points="${T(30)},153 ${LX + 8},120" fill="none" stroke="var(--lead)" stroke-width=".8"/>
${badge(LX, 120, 10)}<text x="${LX - 13}" y="124" text-anchor="end" font-size="12" font-weight="600" fill="var(--fg)">Arm length</text>
${ext(T(129), 150, T(180))}${dim(T(176), 150, 384, "var(--accent)")}
<polyline points="${T(184)},250 ${RX - 8},250" fill="none" stroke="var(--lead)" stroke-width=".8"/>
${badge(RX, 250, 11)}<text x="${RX + 13}" y="254" font-size="12" font-weight="600" fill="var(--fg)">Leg length</text>
<text x="${RX + 13}" y="267" font-size="9.5" fill="var(--muted)">outside leg</text>
${dim(T(100), 214, 384, "var(--accent)")}
<polyline points="${T(104)},330 ${T(150)},330 ${RX - 14},318 ${RX - 8},318" fill="none" stroke="var(--lead)" stroke-width=".8"/>
${badge(RX, 318, 12)}<text x="${RX + 13}" y="322" font-size="12" font-weight="600" fill="var(--fg)">Inseam</text>
<text x="${RX + 13}" y="335" font-size="9.5" fill="var(--muted)">inside leg</text>
</svg>`;

// A small map for the phone mockup: tape lines and number dots only.
const miniMap = `<svg class="mini" viewBox="20 0 160 400" role="img" aria-label="Body map with numbered points">
<use href="#bm-fig" x="0" y="0"/>
${C.map((s) => band(s.x1, s.x2, s.y, 2.2) + badge(s.side === "L" ? s.x1 - 2 : s.x2 + 2, s.y, s.n, 7)).join("")}
</svg>`;

// The guide. Crops are in figure coordinates.
const G = [
  { n: 1, name: "Neck", crop: [60, 20, 80, 70], y: 58, x1: 89.6, x2: 110.4,
    where: "Just below the Adam's apple (larynx).",
    how: ["Look straight ahead. Keep the shoulders down.", "Put the tape around the neck. Let it go a little down at the front.", "Do not tighten the neck."],
    tip: "Do not swallow while you read the value." },
  { n: 2, name: "Shoulders", crop: [30, 50, 140, 90], y: 92, x1: 47.5, x2: 152.5,
    where: "Around the widest part of the shoulders, over the round shoulder muscle.",
    how: ["Stand with the arms relaxed at the sides.", "Put the tape around both shoulders and the upper back.", "Breathe out normally, then read."],
    tip: "Ask a helper. It is hard to keep the tape level at the back yourself." },
  { n: 3, name: "Chest", crop: [40, 60, 120, 90], y: 104, x1: 67, x2: 133,
    where: "Around the fullest part of the chest, at nipple level, under the armpits.",
    how: ["Lift the arms a little. Put the tape around the chest and over the shoulder blades.", "Lower the arms to the sides.", "Breathe out normally, then read."],
    tip: "Do not fill the lungs and do not tighten the chest." },
  { n: 4, name: "Waist", crop: [40, 110, 120, 90], y: 150, x1: 71.5, x2: 128.5,
    where: "Halfway between the lowest rib and the top of the hip bone. For most people this is the narrowest part, a little above the navel.",
    how: ["Stand with the feet together and the stomach relaxed.", "Put the tape around the waist, level with the floor.", "Breathe out normally, then read at the end of the breath."],
    tip: "Do not pull in the stomach. Use the same point each time." },
  { n: 5, name: "Hips", crop: [40, 160, 120, 90], y: 200, x1: 67.5, x2: 132.5,
    where: "Around the widest part of the buttocks.",
    how: ["Stand with the feet together.", "Put the tape around the hips and buttocks.", "Move the tape up and down to find the widest part. Read there."],
    tip: "Look at the side in a mirror to make sure the tape is level." },
  { n: 6, name: "Upper arm", crop: [11, 85, 90, 90], y: 128, x1: 46.9, x2: 64.7, lr: true,
    where: "Halfway between the tip of the shoulder and the elbow.",
    how: ["Let the arm hang relaxed. Do not tighten the muscle.", "Put the tape around the arm, at a right angle to it.", "Measure the left arm, then the right arm."],
    tip: "Measure relaxed each time, so the values agree." },
  { n: 7, name: "Forearm", crop: [8, 135, 90, 90], y: 174, x1: 45.9, x2: 60.9, lr: true,
    where: "Around the widest part, just below the elbow.",
    how: ["Let the arm hang. Turn the palm to the front. Open the hand.", "Move the tape down from the elbow to find the widest part.", "Measure the left arm, then the right arm."],
    tip: "Do not make a fist." },
  { n: 8, name: "Thigh", crop: [40, 195, 100, 90], y: 238, x1: 69.1, x2: 97.3, lr: true,
    where: "Halfway between the groin crease and the top of the kneecap.",
    how: ["Stand with the weight on both feet. Relax the leg.", "Put the tape around the thigh, level with the floor.", "Measure the left leg, then the right leg."],
    tip: "Measure the distance from the kneecap once. Then use the same distance each time." },
  { n: 9, name: "Calf", crop: [36, 280, 90, 85], y: 322, x1: 72.4, x2: 88.7, lr: true,
    where: "Around the widest part of the calf.",
    how: ["Stand with the weight on both feet.", "Move the tape up and down to find the widest part.", "Measure the left leg, then the right leg."],
    tip: "Do not stand on the toes." },
];
const GL = [
  { n: 10, name: "Arm length",
    where: "From the tip of the shoulder (the bony point at the top) to the wrist bone.",
    how: ["Let the arm hang with a small bend at the elbow.", "Hold the tape on the tip of the shoulder.", "Go along the outside of the arm, over the elbow, to the wrist bone."],
    tip: "A helper must do this one." },
  { n: 11, name: "Leg length",
    where: "From the waist at the side of the body down to the floor.",
    how: ["Stand barefoot with the feet a little apart.", "Hold the tape at the side of the waist.", "Let it go straight down the outside of the leg to the floor."],
    tip: "Use the same waist point as for measurement 4." },
  { n: 12, name: "Inseam",
    where: "From the crotch down to the floor, on the inside of the leg.",
    how: ["Stand barefoot against a wall, with the feet 15 cm apart.", "Push a book up between the legs, level with the floor. Mark the wall at the top of the book.", "Measure from the mark to the floor."],
    tip: "The book method is more accurate than holding the tape in the crotch." },
];

const crop = (g, cls = "crop") => `<svg class="${cls}" viewBox="${g.crop.join(" ")}" role="img" aria-label="Where to measure the ${g.name.toLowerCase()}">
<use href="#bm-fig" x="0" y="0"/>${band(g.x1, g.x2, g.y, 1.6)}</svg>`;
const card = (g, pic) => `<article class="gcard"><div class="gpic">${pic}</div><div class="gtext">
<h4><span class="num">${g.n}</span>${g.name}${g.lr ? ` <span class="lr">left and right</span>` : ""}</h4>
<p class="where">${g.where}</p><ol>${g.how.map((h) => `<li>${h}</li>`).join("")}</ol><p class="tip"><b>Tip</b> · ${g.tip}</p></div></article>`;

const guide = `<div class="gcards">${G.map((g) => card(g, crop(g))).join("")}</div>
<h3>Lengths</h3><div class="gcards">${GL.map((g) => card(g, `<div class="lennum">${g.n}</div>`)).join("")}</div>`;

const waist = G[3];
const phoneHowTo = `<div class="howto">${crop(waist, "pcrop")}<p class="small"><b>Where</b> · ${waist.where}</p>
<ol class="small">${waist.how.map((h) => `<li>${h}</li>`).join("")}</ol><p class="small"><b>Tip</b> · ${waist.tip}</p></div>`;

let html = fs.readFileSync(dir + "plan.src.html", "utf8");
for (const [k, v] of Object.entries({ DEFS: defs, CIRCMAP: circMap, LENMAP: lenMap, MINIMAP: miniMap, GUIDE: guide, HOWTO: phoneHowTo }))
  html = html.replace(`<!--${k}-->`, v);
fs.writeFileSync(dir + "body-measurements-plan.html", html);
console.log("written", html.length);

// ── v2 Measurements page: map with values, ratios, rows with trend lines ──
const D = {
  Neck: [38.5, 38.8, 39, 39], Shoulders: [120, 121, 121.5, 122], Chest: [113, 113.5, 113.8, 114],
  Waist: [92, 91.4, 90.8, 90], Hips: [105, 104.6, 104.2, 104],
  "Upper arm": [[35, 35.4, 35.8, 36], [35.5, 36, 36.2, 36.5]], Forearm: [[29.5, 29.8, 30, 30], [30, 30.2, 30.4, 30.5]],
  Thigh: [[59, 59.4, 59.8, 60], [59.5, 59.8, 60, 60]], Calf: [[38.4, 38.4, 38.4, 38.4], [39.2, 39.4, 39.5, 39.5]],
};
const f1 = (v) => (Math.round(v * 10) / 10).toString();
const chg = (a) => { const d = a[a.length - 1] - a[0]; return Math.abs(d) < 0.05 ? "±0" : (d > 0 ? "▲" : "▼") + Math.abs(d).toFixed(1); };
const spark = (series) => {
  const all = series.flat(), mn = Math.min(...all), mx = Math.max(...all), r = mx - mn || 1;
  return `<svg class="spark" viewBox="0 0 48 20" aria-hidden="true">${series.map((a, k) => {
    const pts = a.map((v, i) => [2 + (i * 44) / (a.length - 1), 17 - ((v - mn) / r) * 14]);
    return `<polyline points="${pts.map((p) => p.join(",")).join(" ")}" fill="none" stroke="${k ? "var(--muted)" : "var(--fg)"}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"${k ? ' stroke-dasharray="2 2"' : ""}/><circle cx="${pts[3][0]}" cy="${pts[3][1]}" r="1.8" fill="${k ? "var(--muted)" : "var(--fg)"}"/>`;
  }).join("")}</svg>`;
};
const rows = C.map((s) => {
  const d = D[s.name];
  if (s.lr) {
    const [L, R] = d, diff = R[3] - L[3];
    const flag = Math.abs(diff) >= 1 ? `<div class="flag">${diff > 0 ? "Right" : "Left"} is ${Math.abs(diff).toFixed(1)} cm bigger</div>` : "";
    return `<div class="row2"><div class="nm">${s.n} · ${s.name}${flag}</div>${spark([L, R])}<div class="vv"><div>L ${f1(L[3])} · R ${f1(R[3])}</div><div class="cg">${chg(L)} · ${chg(R)}</div></div></div>`;
  }
  return `<div class="row2"><div class="nm">${s.n} · ${s.name}</div>${spark([d])}<div class="vv"><div>${f1(d[3])} cm</div><div class="cg">${chg(d)}</div></div></div>`;
}).join("");

const PX = 80, PL = 106, PR = 254;
const phoneMap = `<svg class="pmap" viewBox="0 0 340 392" role="img" aria-label="Body map with the latest value at each point">
<use href="#bm-fig" x="${PX}" y="0"/>
${C.map((s) => {
  const d = D[s.name], left = s.side === "L";
  const ex = PX + (left ? s.x1 : s.x2), tx = left ? PL : PR;
  const val = s.lr ? `${f1(d[0][3])} · ${f1(d[1][3])}` : `${f1(d[3])}`;
  const c = s.lr ? "" : chg(d);
  return `<g transform="translate(${PX} 0)">${band(s.x1, s.x2, s.y, 2)}</g>` +
    `<polyline points="${ex},${s.y} ${left ? tx + 8 : tx - 8},${s.ly}" fill="none" stroke="var(--lead)" stroke-width=".9"/>` +
    `<circle cx="${ex}" cy="${s.y}" r="2.6" fill="var(--accent)"/>` +
    `<text x="${tx}" y="${s.ly - 4}" text-anchor="${left ? "end" : "start"}" font-size="11" fill="var(--muted)">${s.name}</text>` +
    `<text x="${tx}" y="${s.ly + 12}" text-anchor="${left ? "end" : "start"}" font-size="14.5" font-weight="700" fill="var(--fg)">${val}${c && c !== "±0" ? `<tspan font-size="10.5" font-weight="500" fill="var(--muted)" dx="4">${c}</tspan>` : ""}</text>`;
}).join("")}
</svg>`;
html = fs.readFileSync(dir + "body-measurements-plan.html", "utf8").replace("<!--PHONEMAP-->", phoneMap).replace("<!--ROWS-->", rows);
fs.writeFileSync(dir + "body-measurements-plan.html", html);
console.log("v2 written");

// ── Step by step log flow ──
const mirrorG = (g) => ({ ...g, x1: 200 - g.x2, x2: 200 - g.x1, crop: [200 - g.crop[0] - g.crop[2], g.crop[1], g.crop[2], g.crop[3]] });
const keypad = `<div class="kp">${["1","2","3","4","5","6","7","8","9",".","0","⌫"].map((k) => `<span${k === "." || k === "⌫" ? ' class="k"' : ""}>${k}</span>`).join("")}</div>`;
const step = (cap, g, title, sub, n, val, last, short, date) => `<div class="ph"><div class="cap">${cap}</div><div class="screen">
<div class="topbar"><span class="x">Cancel</span><span class="small">${date ? '<span class="link">Today ›</span> · ' : ""}${n} of 13</span></div>
<div class="prog"><i style="width:${(n / 13) * 100}%"></i></div>
<div class="sh">${title}</div><div class="small">${sub}</div>
<div class="howto">${crop(g, "pcrop")}</div>
<div class="small">${short} <span class="link">How to measure ›</span></div>
<div class="big"><span class="num"><span class="sel">${val}</span></span><span class="u">cm</span></div>
<div class="small center">Last time ${last}</div>
<div class="quick"><span>− 0.5</span><span>Same</span><span>+ 0.5</span></div>
<div class="actions"><span class="skip">Skip</span><span class="next">Next</span></div>
${keypad}</div></div>`;
const ua = G.find((g) => g.name === "Upper arm"), wa = G.find((g) => g.name === "Waist");
const steps = [
  step("Step 4 · Waist", wa, "Waist", "Trunk · tape around the body", 4, "90.8", "90.8 cm · 7 Nov", "Halfway between the lowest rib and the hip bone.", false),
  step("Step 8 · Left upper arm", mirrorG(ua), "Upper arm · left", "Left arm · relaxed", 8, "36.0", "35.8 cm · 7 Nov", "Halfway between the shoulder tip and the elbow.", false),
  `<div class="ph"><div class="cap">Done</div><div class="screen">
<div class="done"><div class="ok">✓</div><div class="sh" style="margin-top:8px">Saved · 21 Nov</div><div class="small">12 of 13 parts · 1 skipped</div></div>
<div class="list">${C.map((s) => {
    const d = D[s.name];
    if (s.lr) return `<div class="row"><span>${s.name}</span><span class="v">L ${f1(d[0][3])} · R ${f1(d[1][3])}</span></div>`;
    if (s.name === "Shoulders") return `<div class="row"><span>${s.name}</span><span class="v">Skipped</span></div>`;
    return `<div class="row"><span>${s.name}</span><span class="v">${f1(d[3])} cm <span class="small">${chg(d.slice(2))}</span></span></div>`;
  }).join("")}</div>
<div class="small center" style="margin-top:8px">Tap a value to correct it</div>
<div class="btn">Done</div></div></div>`,
].join("\n");
html = fs.readFileSync(dir + "body-measurements-plan.html", "utf8").replace("<!--STEPS-->", steps);
fs.writeFileSync(dir + "body-measurements-plan.html", html);
console.log("steps written");
