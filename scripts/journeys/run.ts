// Journey capture: walks the journeys of one set against the local app and screenshots every step.
//   pnpm journeys <set> [--journeys 1,3] [--widths 390,320] [--label r2] [--seed] [--base http://localhost:3000]
// See scripts/journeys/README.md.
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Ctx, JourneySet, ManifestEntry, RunInfo, ShotOptions } from "./types";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
const HEIGHTS: Record<number, number> = { 390: 844, 320: 568 };
const heightFor = (w: number) => HEIGHTS[w] ?? Math.round((w * 844) / 390);

function parseArgs(argv: string[]) {
  const args = argv.filter((a) => a !== "--");
  const opts = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--seed") opts.set("seed", "1");
    else if (args[i].startsWith("--")) opts.set(args[i].slice(2), args[++i]);
    else positional.push(args[i]);
  }
  const opt = (name: string) => opts.get(name);
  const set = positional[0];
  const list = (v: string | undefined) => (v ? v.split(",").map((x) => Number(x.trim())) : undefined);
  return {
    set,
    journeys: list(opt("journeys")),
    widths: list(opt("widths")) ?? [390, 320],
    label: opt("label"),
    base: (opt("base") ?? "http://localhost:3000").replace(/\/$/, ""),
    out: opt("out"),
    seed: opts.has("seed"),
  };
}

const git = (...a: string[]) => {
  try {
    return execFileSync("git", a).toString().trim();
  } catch {
    return "";
  }
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.set || !/^[a-z0-9-]+$/.test(args.set)) {
    console.error("Usage: pnpm journeys <set> [--journeys 1,3] [--widths 390,320] [--label r2] [--seed]");
    process.exit(1);
  }
  const mod = (await import(`./${args.set}.journeys.ts`)) as { default: JourneySet };
  const set = mod.default;

  // Demo accounts on the local app only.
  const host = new URL(args.base).hostname;
  if (!LOCAL_HOSTS.has(host)) throw new Error(`Refusing to run against "${host}": localhost only`);
  for (const [k, a] of Object.entries(set.accounts)) {
    if (!a.email.endsWith("@demo.local")) throw new Error(`Refusing account ${k} (${a.email}): @demo.local accounts only`);
  }
  if (args.widths.some((w) => !Number.isInteger(w) || w < 200)) throw new Error("--widths takes pixel widths, like 390,320");

  const setDir = path.join(".journeys", set.name);
  const stateDir = path.join(setDir, ".state");
  const date = new Date().toISOString().slice(0, 10);
  const outDir = args.out ?? path.join(setDir, args.label ? `${date}-${args.label}` : date);
  fs.mkdirSync(path.join(outDir, "shots"), { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });

  if (args.seed) {
    if (!set.seed) throw new Error(`Set ${set.name} has no seed command`);
    console.log(`seed: ${set.seed.join(" ")}`);
    execFileSync(set.seed[0], set.seed.slice(1), { stdio: "inherit" });
    // The seed makes new users, so the cached sign-ins are dead.
    for (const f of fs.readdirSync(stateDir)) fs.rmSync(path.join(stateDir, f));
  }

  // A rerun into the same folder keeps what the reviewer wrote for shots it takes again.
  const manifestPath = path.join(outDir, "manifest.json");
  const old: ManifestEntry[] = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : [];
  const byFile = new Map(old.map((m) => [m.file, m]));
  const failures: string[] = [];
  const allErrors: string[] = [];
  const mainWidth = args.widths[0];
  const accountNames = Object.keys(set.accounts);

  async function context(browser: Browser, account: string): Promise<BrowserContext> {
    const a = set.accounts[account];
    if (!a) throw new Error(`Unknown account ${account}`);
    const state = path.join(stateDir, `${account}.json`);
    const opts = {
      viewport: { width: mainWidth, height: heightFor(mainWidth) },
      deviceScaleFactor: 2,
      colorScheme: "dark" as const,
      // One address per account keeps each under the sign-in limit (10 per 15 minutes per address).
      extraHTTPHeaders: { "x-forwarded-for": `10.77.0.${accountNames.indexOf(account) + 1}` },
    };
    const hideDevOverlay = (c: BrowserContext) =>
      c.addInitScript(() => {
        const st = document.createElement("style");
        st.textContent = "nextjs-portal{display:none!important}";
        document.addEventListener("DOMContentLoaded", () => document.head.appendChild(st));
      });
    if (fs.existsSync(state)) {
      const ctx = await browser.newContext({ ...opts, storageState: state });
      const p = await ctx.newPage();
      await p.goto(`${args.base}${set.homePath}`);
      const ok = new URL(p.url()).pathname === set.homePath;
      await p.close();
      if (ok) {
        await hideDevOverlay(ctx);
        return ctx;
      }
      await ctx.close();
    }
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    await page.goto(`${args.base}/login`);
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Email").fill(a.email);
    await page.getByLabel("Password").fill(a.password);
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await page.waitForURL((u) => u.pathname !== "/login", { timeout: 30000 });
    await ctx.storageState({ path: state });
    await page.close();
    await hideDevOverlay(ctx);
    return ctx;
  }

  const browser = await chromium.launch();
  const flows = set.flows.filter((f) => !args.journeys || f.journeys.some((j) => args.journeys!.includes(j)));
  for (const flow of flows) {
    const ctx = await context(browser, flow.account);
    const page: Page = await ctx.newPage();
    const email = set.accounts[flow.account].email;
    let stepErrors: string[] = [];
    const record = (msg: string) => {
      const line = `${flow.name} ${new URL(page.url()).pathname} :: ${msg}`;
      stepErrors.push(line);
      allErrors.push(line);
    };
    page.on("console", (m) => {
      if (m.type() === "error") record(m.text().slice(0, 400));
    });
    page.on("pageerror", (e) => record(`pageerror ${e.message.slice(0, 300)}`));

    const settle = async (ms = 700) => {
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(ms);
    };
    const go = async (p: string) => {
      await page.goto(`${args.base}${p}`);
      await settle();
    };
    const dialogOpen = async () => (await page.getByRole("dialog").count()) > 0;
    let stepEntries: ManifestEntry[] = [];

    const save = (journey: number, step: number, slug: string, title: string, width: number) => {
      const id = `J${journey}-${String(step).padStart(2, "0")}`;
      const file = `${id}-${slug}-${width}.png`;
      const prev = byFile.get(file);
      const e: ManifestEntry = {
        journey,
        step,
        id,
        title,
        account: email,
        width,
        file,
        path: new URL(page.url()).pathname,
        errors: [],
        note: prev?.note ?? "",
        bug: prev?.bug ?? null,
      };
      byFile.set(file, e);
      stepEntries.push(e);
      console.log(`shot ${file}  ${e.path}`);
      return path.join(outDir, "shots", file);
    };

    const shot = async (journey: number, step: number, slug: string, title: string, opts: ShotOptions = {}) => {
      if (opts.raw) {
        await page.screenshot({ path: save(journey, step, slug, title, mainWidth) });
        return;
      }
      await settle(500);
      const widths = opts.small === false ? [mainWidth] : args.widths;
      for (const w of widths) {
        const baseH = heightFor(w);
        await page.setViewportSize({ width: w, height: baseH });
        await page.waitForTimeout(400);
        // Pages scroll inside a 100dvh container, so a full-page shot misses them: grow the viewport to the content.
        const sheetOpen = await dialogOpen();
        const h = sheetOpen
          ? baseH
          : await page.evaluate(() =>
              Math.max(
                document.documentElement.scrollHeight,
                ...[...document.querySelectorAll("*")]
                  .filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 2)
                  .map((e) => e.scrollHeight - e.clientHeight + window.innerHeight),
              ),
            );
        if (h > baseH) {
          await page.setViewportSize({ width: w, height: Math.min(h, 6000) });
          await page.waitForTimeout(500);
        }
        await page.screenshot({ path: save(journey, step, slug, title, w), fullPage: !sheetOpen });
      }
      await page.setViewportSize({ width: mainWidth, height: heightFor(mainWidth) });
    };

    const step = async (name: string, fn: () => Promise<void>) => {
      const j = Number(/^J(\d+) /.exec(name)?.[1]);
      if (!j) throw new Error(`Step name "${name}" must start with "J<n> "`);
      if (args.journeys && !args.journeys.includes(j)) return;
      stepErrors = [];
      stepEntries = [];
      try {
        await fn();
      } catch (e) {
        const msg = `${flow.name} ${name}: ${(e as Error).message.split("\n")[0]}`;
        failures.push(msg);
        console.log(`FAIL ${msg}`);
        const base = path.join(outDir, "fails", `${flow.name}-${name.replace(/\W+/g, "-")}`);
        fs.mkdirSync(path.dirname(base), { recursive: true });
        await page.screenshot({ path: `${base}.png` }).catch(() => {});
        fs.writeFileSync(`${base}.txt`, await page.locator("body").ariaSnapshot().catch(() => ""));
        await page.keyboard.press("Escape").catch(() => {});
      }
      for (const e of stepEntries) e.errors = [...stepErrors];
    };

    const c: Ctx = {
      page,
      base: args.base,
      account: flow.account,
      go,
      settle,
      step,
      shot,
      sheet: () => page.getByRole("dialog"),
      closeSheet: async () => {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(400);
      },
      dialogOpen,
      hrefOf: async (re) => {
        const all = await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
        return all.find((h) => re.test(h)) ?? null;
      },
      linkByText: (text) => page.getByRole("link", { name: text }).first().getAttribute("href"),
    };

    try {
      await flow.run(c);
    } catch (e) {
      const msg = `${flow.name}: ${(e as Error).message.split("\n")[0]}`;
      failures.push(msg);
      console.log(`FAIL ${msg}`);
    }
    await ctx.close();
  }
  await browser.close();

  const manifest = [...byFile.values()].sort((x, y) => x.journey - y.journey || x.step - y.step || y.width - x.width);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const runPath = path.join(outDir, "run.json");
  const prevRun: Partial<RunInfo> = fs.existsSync(runPath) ? JSON.parse(fs.readFileSync(runPath, "utf8")) : {};
  const run: RunInfo = {
    set: set.name,
    title: set.title,
    intro: set.intro,
    journeys: set.journeys,
    accounts: Object.entries(set.accounts).map(([name, a]) => ({ name, email: a.email, about: a.about })),
    date,
    base: args.base,
    branch: git("rev-parse", "--abbrev-ref", "HEAD"),
    commit: git("rev-parse", "--short", "HEAD"),
    widths: args.widths,
    failures,
    summary: prevRun.summary ?? "",
  };
  fs.writeFileSync(runPath, JSON.stringify(run, null, 2));

  console.log(`\nWrote ${manifest.length} entries to ${manifestPath}`);
  console.log(`FAILURES (${failures.length})${failures.length ? `:\n${failures.join("\n")}` : ""}`);
  console.log(`CONSOLE ERRORS (${allErrors.length})${allErrors.length ? `:\n${allErrors.join("\n")}` : ""}`);
  console.log(`\nNext: fill note and bug in ${manifestPath}, then pnpm journeys:page ${outDir}`);
  if (failures.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
