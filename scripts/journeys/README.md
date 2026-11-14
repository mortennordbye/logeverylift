# Journey capture

Screenshots of every step of a feature's user journeys, taken in the real app with demo
accounts, plus a static review page. The practice around it (when, the review loop, the rules)
is in the `journey-review` skill: [`.claude/skills/journey-review/SKILL.md`](../../.claude/skills/journey-review/SKILL.md).

## Files

| File | What it does |
|------|--------------|
| `run.ts` | Runner. Signs in per demo account, runs the flows of one set, saves shots and `manifest.json`. |
| `types.ts` | Types of a journey set, a flow, the step helpers and the manifest. |
| `<feature>.journeys.ts` | One journey set: accounts, journey titles and the flows as step functions. `plan.journeys.ts` is the Plan tab. |
| `review-page.ts` | Turns a capture folder into a static `index.html`. |

## Run

The dev server must run on `http://localhost:3000` (`make dev`) with the set's demo data.

```bash
pnpm journeys plan --seed            # reseed the demo accounts, then capture every journey
pnpm journeys plan --journeys 1,3    # only journeys J1 and J3, no reseed
pnpm journeys plan --label r2        # write to a new folder for a second capture on the same day
pnpm journeys plan --widths 390,320  # widths in px; the first is the main width (default 390,320)
pnpm journeys:page .journeys/plan/2026-11-14
```

Flows write data (they create cycles, restore, move sessions), so reseed with `--seed` before a
full capture. A partial run without `--seed` is fine for read-only journeys.

The runner refuses to start unless the base URL is `localhost` or `127.0.0.1` and every account
ends with `@demo.local`.

## Output

Everything goes to `.journeys/` (gitignored). Never commit it.

```
.journeys/<set>/.state/<account>.json   cached sign-in per account
.journeys/<set>/<date>[-label]/
  shots/J<j>-<step>-<slug>-<width>.png
  manifest.json   one entry per shot
  run.json        set title, journeys, accounts, branch, commit, failed steps, summary
  fails/          screenshot and aria snapshot of each step that threw
  index.html      after pnpm journeys:page
```

A manifest entry:

```json
{ "journey": 1, "step": 2, "id": "J1-02", "title": "The + menu: New cycle, New season",
  "account": "plan-gym@demo.local", "width": 390, "file": "J1-02-add-menu-390.png",
  "path": "/cycles", "errors": [], "note": "", "bug": null }
```

The reviewer (person or agent) looks at each shot and fills `note` (what the screen shows) and
`bug` (what is wrong, or `null`). `errors` holds the console and page errors seen during that
step. `summary` in `run.json` is a free line for the page, for example "Second capture, after
two fix rounds". A rerun into the same folder keeps `note` and `bug` of the shots it takes again.

Each account gets its own `x-forwarded-for` address, so a full run stays under the sign-in limit
of 10 per 15 minutes per address. Sign-ins are cached under `.state/`; `--seed` deletes them,
because the seed makes new users.

The branch and commit in `run.json` are those of the checkout that ran the capture. The app on
port 3000 serves whichever checkout `make dev` started from, so check that they match.

## Add journeys for a feature

1. Write a demo seed for the feature, like `scripts/seed-plan-demo.ts`: local databases only
   (it refuses other hosts and `NODE_ENV=production`), idempotent (it deletes and remakes its
   own accounts and touches no other), accounts named `<feature>-<state>@demo.local`, and dates
   relative to the run day. Give each account the edge cases: empty state, long names, many
   items, past and future data. Add a `db:seed-<feature>-demo` script to `package.json`.
2. Copy `plan.journeys.ts` to `<feature>.journeys.ts`. Fill `accounts`, `journeys` (id, title,
   one line of summary), `homePath` and `seed`, then one flow per account.
3. In a flow, wrap each step in `step("J<n> <name>", fn)` and call
   `shot(journey, step, slug, title)` for each screen. Pass `{ small: false }` when the small
   width adds nothing, and `{ raw: true }` for a loading state that must be taken at once.
4. Keep `journey`, `step` and `slug` the same once a capture is reviewed: they make the file
   names and ids that the next capture is compared with. Add new steps with new numbers.
5. Find elements by role and name, as in the e2e specs.
