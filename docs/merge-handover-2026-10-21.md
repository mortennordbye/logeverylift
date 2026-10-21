<!-- doc-claims: skip -->
# Merge handover: landing page + AI Setup (2026-10-21)

**Update 2026-10-21:** `feat/public-landing-self-signup` is merged (PR #68,
squash `0eeda3a`) and deployed. It also gained a new app icon, a Norwegian
welcome page and tighter signup limits. Only `feat/ai-structured-generation`
is left. Its base is now one commit behind `main`, so rebase it first.

Two local branches, both off `main` at `ce45737`, neither pushed. This file is
untracked on purpose: delete it once both are merged.

| Branch | Commits | Size | Schema change |
|---|---|---|---|
| `feat/ai-structured-generation` | `30f6863`, `fa88295` | 14 files, +2357 / -301 | none |
| `feat/public-landing-self-signup` | `f5165a6` | 27 files, +3456 / -117 | `drizzle/0055_invited_by.sql` |

State checked before writing this:

- `origin/main` is still `ce45737`, so neither branch needs a rebase yet.
- The branches touch no common files. A test merge of both is clean, and the
  merged tree passes `tsc`, `eslint`, `check:docs` and all 948 tests.

## What each branch does

**`feat/ai-structured-generation`: AI Setup**

- **Pre-built plans first.** Goal, experience, days (2–6), equipment and cycle
  length build a plan in the browser with no AI call
  (`src/lib/utils/plan-templates.ts`). All 300 combinations are tested to
  validate and import.
- **AI only on request.** "Customize with AI" runs AI generation, rebuilt in
  three parts:
  - one Zod plan contract exported as JSON Schema (`src/lib/utils/ai-plan.ts`)
  - a client that picks the best output mode per model from OpenRouter's
    catalog (`src/lib/llm.ts`)
  - structured JSON input plus two worked examples (`src/lib/utils/ai-examples.ts`)
- **Validation and repair.** Every AI plan is validated, and a failure gets
  one repair turn listing the exact problems before the next model is tried.
  Usage is only counted for valid plans.
- **Model list fixes.** Default and seeded models are updated: four of the old
  free model IDs no longer exist. The admin "Test" button now reports which
  output mode worked.

**`feat/public-landing-self-signup`: public site and signup**

- **Landing page.** Logged-out visitors to `/` are redirected to `/welcome`, a
  showcase page with a sign-in card (concept 1). Deep links still go to
  `/login?from=`.
- **Open signup.** Better Auth email signup is enabled, rate limited to 5 per
  hour per IP. Invite links (`/signup?token=`) still go through
  `registerWithToken`.
- **Invited by founder badge.** `user.invited_by_id` records the admin who let
  someone in, through an invite token or admin "create user". The badge shows
  on the account page, public profile, friends list, friend search and admin
  user list.
- **Badge field is protected.** It is `input: false`, so public signup can't
  set it or `role` (tested: both are rejected).
- **Backfill.** Migration 0055 credits all existing non-admin accounts to the
  earliest admin, skipping `demo@logeverylift.app`.

## Decide before merging

1. **Open signup has no email verification.** Anyone can register with any
   address. The only brake is the in-memory per-IP rate limit, which resets on
   restart.
2. **The backfill gives every current non-admin user the badge**, test
   accounts included.
3. **AI Setup pickers.** The days and cycle-length pickers no longer have an
   "any" option, and 7 days a week now needs the AI text box.

## Merge steps

Do them one branch at a time. Order doesn't matter. AI Setup first is lower
risk: no migration and no auth change.

1. `git checkout <branch>` and `pnpm verify`.
2. Smoke test (CLAUDE.md, "Pre-deploy smoke pass"):
   - **Landing branch:** the full 9-step pass is required, since it touches
     login. Only the steps below were done so far.
     - Done: logged-out redirect, login from the welcome card, open signup,
       invite signup, and the badge on account, profile, friends and search.
     - Not done: the 9-step workout/history/metrics pass, and the badge in the
       admin user list (needs an admin login).
   - **AI branch:** "Build my plan" → Import was run in a browser. A quick
     re-check is enough. Avoid "Customize with AI" unless you want model calls.
3. Push and open a PR.
   - **Body:** Why / What / Verification. No session link and no AI trailer
     (global CLAUDE.md, memory `no-claude-trace-in-git`).
   - **Hooks:** the pre-push hook runs `pnpm verify` and the schema-migration
     check. The landing branch includes its migration, so the check passes.
4. Wait for CI (`CI` workflow), then squash-merge without `--admin`.
5. If `main` moved, rebase the second branch onto it and repeat steps 1–4. No
   conflicts are expected.

## After each deploy

**Landing branch**

- Check the migration ran. On prod, this should return the expected
  non-admin count:

  ```sql
  select count(*) from "user" where invited_by_id is not null;
  ```

- Logged out, `https://logeverylift.com/` should land on `/welcome`.
- Sign in from the welcome card.
- Create one throwaway account through `/signup` and confirm it has no badge.
  Delete it afterwards.

**AI branch**

- Open More → Admin → AI Models and press "Test" on each row.
- Remove models that report "Not listed by OpenRouter any more". The likely
  ones are `openai/gpt-oss-120b:free`, `qwen/qwen3-coder:free`,
  `nousresearch/hermes-3-llama-3.1-405b:free` and
  `meta-llama/llama-3.3-70b-instruct:free`.
- Generation already skips dead models, so removing them is cleanup, not a
  blocker.
- Run "Build my plan" once and import it. This costs nothing.

## Rollback

- **AI Setup:** revert the squash commit.
- **Landing:** revert the squash commit. The `invited_by_id` column is
  nullable with `ON DELETE SET NULL`, so it can stay in the database after a
  code revert. There's no need to write a down-migration in a hurry.

## Known gaps (logged in BACKLOG on the AI branch)

- AI tool-call and JSON-mode outputs and the repair turn have not completed
  against a real model. Free models were rate-limited or timing out, and live
  calls were stopped to avoid spend. Only the `json_schema` path (via
  `openrouter/free`) and the text-parse path were confirmed live.

## Local environment notes

- Port 5432 on this Mac is held by another project's Postgres and an SSH
  tunnel. The local stack was started with a scratchpad compose override that
  maps Postgres to 5433 (`ports: !override ["5433:5432"]`). `make dev` fails
  until that is resolved.
- The local database already has migration 0055 applied, from testing the
  landing branch.
