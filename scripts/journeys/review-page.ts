// Review page: turns a capture folder (manifest.json, run.json, shots/) into a static index.html.
//   pnpm journeys:page .journeys/plan/2026-11-14
// The page loads no scripts from outside; the Google Fonts link is optional and falls back to system fonts.
import fs from "node:fs";
import path from "node:path";
import type { ManifestEntry, RunInfo } from "./types";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const CSS = `
:root {
  --bg:#f3f3f1; --card:#ffffff; --inner:#ebebe8; --fg:#141416; --muted:#5f5f66; --line:rgba(20,20,22,.1);
  --accent:#2457d6; --bug:#b3361f; --bug-bg:#fbe9e5;
  --display:"Big Shoulders Display", "Arial Narrow", sans-serif; --ui:"Work Sans", system-ui, sans-serif;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#0b0b0c; --card:#161618; --inner:#222225; --fg:#f4f4f5; --muted:#8d8d93; --line:rgba(244,244,245,.08); --accent:#6b95ff; --bug:#ff8a75; --bug-bg:rgba(255,107,90,.12); color-scheme:dark } }
:root[data-theme="dark"] { --bg:#0b0b0c; --card:#161618; --inner:#222225; --fg:#f4f4f5; --muted:#8d8d93; --line:rgba(244,244,245,.08); --accent:#6b95ff; --bug:#ff8a75; --bug-bg:rgba(255,107,90,.12); color-scheme:dark }
* { box-sizing:border-box }
body { margin:0; background:var(--bg); color:var(--fg); font-family:var(--ui); font-size:15px; line-height:1.5; padding-left:max(16px, env(safe-area-inset-left,0px)); padding-right:max(16px, env(safe-area-inset-right,0px)); padding-block:24px 64px }
.wrap { max-width:1280px; margin:0 auto; display:flex; flex-direction:column; gap:40px }
h1 { font-family:var(--display); font-weight:800; font-size:clamp(40px,8vw,64px); line-height:1; text-transform:uppercase; margin:0 }
.intro { display:flex; flex-direction:column; gap:12px; max-width:70ch }
.intro p { margin:0; color:var(--muted) }
.facts { display:flex; flex-wrap:wrap; gap:8px }
.facts span { background:var(--card); border:1px solid var(--line); border-radius:999px; padding:4px 12px; font-size:13px; font-variant-numeric:tabular-nums }
.facts .b { color:var(--bug) }
nav.toc { position:sticky; top:env(safe-area-inset-top,0px); z-index:5; background:var(--bg); padding-block:10px; display:flex; flex-wrap:wrap; gap:6px; align-items:center; border-bottom:1px solid var(--line) }
nav.toc a { color:var(--fg); text-decoration:none; font-size:13px; padding:8px 12px; border-radius:999px; background:var(--card); min-height:36px; display:inline-flex; align-items:center }
nav.toc a:hover { color:var(--accent) }
.filter { margin-left:auto; display:inline-flex; gap:8px; align-items:center; font-size:13px; padding:8px 4px; cursor:pointer }
.filter input { width:18px; height:18px; accent-color:var(--accent) }
.jhead { display:flex; flex-direction:column; gap:4px; margin-bottom:16px }
.jhead h2 { margin:0; font-size:22px; display:flex; gap:12px; align-items:baseline; text-wrap:balance }
.jn { font-family:var(--display); font-weight:800; font-size:32px; color:var(--accent) }
.jhead p { margin:0; color:var(--muted) }
.jcount { font-size:13px }
.grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(min(100%, 400px), 1fr)); gap:16px }
.step { background:var(--card); border-radius:16px; padding:16px; display:flex; flex-direction:column; gap:10px; min-width:0; border:1px solid var(--line) }
.step.has-bug { border-color:color-mix(in oklab, var(--bug) 55%, transparent) }
.step header { display:flex; gap:10px; align-items:baseline }
.sid { font-size:12px; font-weight:600; color:var(--muted); font-variant-numeric:tabular-nums; min-width:3.2em }
.step h3 { margin:0; font-size:16px; font-weight:600; text-wrap:balance }
.acct { margin:0; font-size:12px; color:var(--muted); letter-spacing:.3px }
.shots { display:flex; gap:12px; align-items:flex-start; overflow-x:auto; padding-bottom:4px }
figure { margin:0; display:flex; flex-direction:column; gap:4px; flex:none }
figcaption { font-size:11px; color:var(--muted); text-align:center }
.shot { padding:0; border:1px solid var(--line); border-radius:12px; overflow:hidden; background:var(--inner); cursor:zoom-in; display:block }
.shot:focus-visible { outline:2px solid var(--accent); outline-offset:2px }
.shot img { display:block; height:auto; max-height:420px; object-fit:cover; object-position:top }
.note { margin:0; font-size:14px; color:var(--fg) }
.note.empty { color:var(--muted); font-style:italic }
.bug, .err { margin:0; background:var(--bug-bg); color:var(--fg); border-radius:10px; padding:10px 12px; font-size:14px; display:flex; gap:10px }
.err { font-size:12px; font-family:ui-monospace, monospace; overflow-wrap:anywhere }
.bug span, .err span { color:var(--bug); font-weight:600; font-size:12px; text-transform:uppercase; letter-spacing:.6px; padding-top:2px; font-family:var(--ui); flex:none }
body.only-bugs .step:not(.has-bug) { display:none }
body.only-bugs .journey:not(:has(.has-bug)) { display:none }
dialog { border:none; padding:0; background:transparent; max-width:96vw; max-height:96vh }
dialog::backdrop { background:rgba(0,0,0,.8) }
dialog img { max-height:92vh; max-width:94vw; border-radius:14px; display:block }
dialog button { position:fixed; top:max(12px, env(safe-area-inset-top,0px)); right:max(12px, env(safe-area-inset-right,0px)); width:44px; height:44px; border-radius:22px; border:none; background:#222225; color:#f4f4f5; font-size:20px; cursor:pointer }
@media (prefers-reduced-motion: no-preference) { html { scroll-behavior:smooth } }
`;

const SCRIPT = `
const dlg=document.getElementById('viewer'), big=dlg.querySelector('img');
document.querySelectorAll('.shot').forEach(b=>b.addEventListener('click',()=>{ big.src=b.dataset.src; big.alt=b.getAttribute('aria-label'); dlg.showModal(); }));
dlg.querySelector('button').addEventListener('click',()=>dlg.close());
dlg.addEventListener('click',e=>{ if(e.target===dlg) dlg.close(); });
const f=document.getElementById('only-bugs');
try { f.checked = localStorage.getItem('onlyBugs')==='1'; } catch(e) {}
const apply=()=>{ document.body.classList.toggle('only-bugs', f.checked); try { localStorage.setItem('onlyBugs', f.checked?'1':'0'); } catch(e) {} };
f.addEventListener('change', apply); apply();
`;

function stepCard(entries: ManifestEntry[]) {
  const first = entries[0];
  const t = esc(first.title);
  const unique = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x && x.trim() !== ""))];
  const notes = unique(entries.map((e) => e.note));
  const bugs = unique(entries.map((e) => e.bug));
  const errors = unique(entries.flatMap((e) => e.errors ?? []));
  const shots = entries
    .map(
      (e) =>
        `<figure><button class="shot" type="button" data-src="shots/${esc(e.file)}" aria-label="Open ${t} at ${e.width} px"><img src="shots/${esc(e.file)}" alt="${t}, ${e.width} px wide" loading="lazy" width="${Math.round(e.width / 2)}"></button><figcaption>${e.width} px</figcaption></figure>`,
    )
    .join("");
  const noteHtml = notes.length
    ? notes.map((n) => `<p class="note">${esc(n)}</p>`).join("")
    : `<p class="note empty">No note yet.</p>`;
  return (
    `<article class="step${bugs.length ? " has-bug" : ""}" id="${esc(first.id)}">` +
    `<header><span class="sid">${first.journey}.${String(first.step).padStart(2, "0")}</span><h3>${t}</h3></header>` +
    `<p class="acct">${esc(first.account.replace(/@demo\.local$/, ""))} · ${esc(first.path ?? "")}</p>` +
    `<div class="shots">${shots}</div>${noteHtml}` +
    bugs.map((b) => `<p class="bug"><span>Bug</span>${esc(b)}</p>`).join("") +
    errors.map((e) => `<p class="err"><span>Console</span>${esc(e)}</p>`).join("") +
    `</article>`
  );
}

function main() {
  const dir = process.argv.slice(2).find((a) => a !== "--");
  if (!dir) {
    console.error("Usage: pnpm journeys:page <capture folder>");
    process.exit(1);
  }
  const manifest: ManifestEntry[] = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const run: RunInfo = JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8"));

  // One card per step id, widest shot first.
  const steps = new Map<string, ManifestEntry[]>();
  for (const e of [...manifest].sort((x, y) => x.journey - y.journey || x.step - y.step || y.width - x.width)) {
    const list = steps.get(e.id) ?? [];
    list.push(e);
    steps.set(e.id, list);
  }
  const hasBug = (es: ManifestEntry[]) => es.some((e) => e.bug && e.bug.trim() !== "");
  const allSteps = [...steps.values()];
  const bugSteps = allSteps.filter(hasBug).length;
  const errorCount = new Set(manifest.flatMap((e) => e.errors ?? [])).size;
  const unreviewed = allSteps.filter((es) => es.every((e) => !e.note)).length;

  const journeys = run.journeys.filter((j) => allSteps.some((es) => es[0].journey === j.id));
  const sections = journeys
    .map((j) => {
      const own = allSteps.filter((es) => es[0].journey === j.id);
      const bugs = own.filter(hasBug).length;
      return (
        `<section class="journey" id="j${j.id}"><div class="jhead"><h2><span class="jn">${j.id}</span>${esc(j.title)}</h2>` +
        `<p>${esc(j.summary)}</p><p class="jcount">${plural(own.length, "step")} · ${bugs} with a bug</p></div>` +
        `<div class="grid">${own.map(stepCard).join("")}</div></section>`
      );
    })
    .join("");

  const facts = [
    `<span>${plural(allSteps.length, "step")}</span>`,
    `<span>${plural(manifest.length, "screenshot")}</span>`,
    `<span${bugSteps ? ' class="b"' : ""}>${bugSteps}${bugSteps === 1 ? "step" : "steps"} with a bug</span>`,
    `<span${errorCount ? ' class="b"' : ""}>${plural(errorCount, "console error")}</span>`,
    run.failures.length ? `<span class="b">${plural(run.failures.length, "step")} that failed to run</span>` : "",
    unreviewed ? `<span>${unreviewed} not reviewed</span>` : "",
    `<span>${esc(run.date)} · ${esc(run.branch)} ${esc(run.commit)}</span>`,
  ].join("");
  const accounts = run.accounts.map((a) => `${esc(a.email)} ${esc(a.about)}`).join(". ");
  const failures = run.failures.length
    ? `<p>Steps that failed to run: ${run.failures.map(esc).join("; ")}.</p>`
    : "";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(run.title)} Walkthrough</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@800&family=Work+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
  <div class="intro">
    <h1>${esc(run.title)} walkthrough</h1>
    <p>${esc(run.intro)} Tap a screenshot to see it full size.</p>
    <div class="facts">${facts}</div>
    <p>Accounts: ${accounts}.</p>
    ${run.summary ? `<p>${esc(run.summary)}</p>` : ""}
    ${failures}
  </div>
  <nav class="toc" aria-label="Journeys">${journeys.map((j) => `<a href="#j${j.id}">${j.id} ${esc(j.title)}</a>`).join("")}<label class="filter" for="only-bugs"><input type="checkbox" id="only-bugs"> Only steps with a bug</label></nav>
  ${sections}
</div>
<dialog id="viewer"><img alt=""><button type="button" aria-label="Close">×</button></dialog>
<script>${SCRIPT}</script>
</body>
</html>
`;
  const out = path.join(dir, "index.html");
  fs.writeFileSync(out, html);
  console.log(`Wrote ${out}: ${allSteps.length} steps, ${manifest.length} shots, ${bugSteps} with a bug, ${unreviewed} not reviewed`);
}

main();
