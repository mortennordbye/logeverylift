# AI Setup: plan

> **Status:** phases 1 and 2 merged 2026-10-21; phase 3 next.
> **Written against:** `main` at `0eeda3a` plus the unmerged branch `feat/ai-structured-generation` (`30f6863`, `fa88295`).

This document is written to be picked up with no conversation history. Read section 0 first, and update it before you finish a session.

---

## 0. Start here

### The goal in one paragraph

AI Setup builds a user's programs and training cycle. Until now it led with a large free-text box that sent everything to a model. The owner can't pay for tokens, so the page is being turned around: **the user picks values, and the app builds the plan itself, with no model call.** AI is kept for editing a plan the app already built, on free models only, with results cached so a repeated request never reaches a model twice. A week after a plan starts, the app asks whether it fits, and a "no" leads straight into a revised plan.

### Build state

| Phase | What | State |
|---|---|---|
| 1 | Land `feat/ai-structured-generation` | merged, PR #69 (CodeQL follow-up: PR #70) |
| 2 | More inputs in the plan builder | merged, branch `ai/2-template-inputs` |
| 3 | Picks-first page, text box removed | not started |
| 4 | AI edit action, cache table, free-model guard | not started |
| 5 | AI edit UI: chips and a short box | not started |
| 6 | One-week check-in and revision | not started |
| 7 | Live check on free models | not started |

Build in order. Each phase is its own branch off `main` and its own PR, merged before the next one starts.

### Decisions already made (2026-10-21)

Build to these, don't re-ask.

- **D-1 Inputs.** Add four picks to the builder: session length, split preference, priority muscles, areas to avoid.
- **D-2 AI edit entry.** Ready-made chips plus a short free-text box (max 200 characters). There is no from-scratch AI generation in the UI any more.
- **D-3 Cache scope.** AI edit results are shared between users. The cached plan is stored without the user's weights, and each user's starting weights are filled in on read.
- **D-4 Models.** Free OpenRouter models (`:free` suffix and `openrouter/free`) plus Gemini on its free tier. Code refuses to call any other OpenRouter model.
- **D-5 Generic profile goes to the model, nothing identifying.** The edit prompt carries the picks, the plan without weights, the edit request, the exercise names allowed by the equipment pick, and a generic profile: age band, gender, goals (the fixed `GOAL_VALUES` list) and experience. No name, email, PRs, body weight or height. Age is sent as a band (under 25, 25–34, 35–44, 45–54, 55–64, 65+), never the birth year, so the profile stays coarse enough to share cache rows. The profile fields are part of the cache key.
- **D-10 One-week check-in.** Seven days after a cycle built by AI Setup starts, the home page asks whether the plan fits. "No" asks what's wrong and leads to a revised plan, using the same build and AI edit paths. Answers are stored.

### Decided by default (change if the owner objects)

- **D-6 Picks are fixed during an edit.** An AI edit cannot change days per week or cycle length. Those are picks; the user changes the pick and rebuilds. The validator enforces this, as it does today.
- **D-7 Days stay 2 to 6.** A 7-day plan is not offered. Logged in BACKLOG when phase 3 ships.
- **D-8 Power-user options stay.** Copy-prompt-to-clipboard, paste JSON, and the MCP connect card cost nothing and stay under "Power-user options".
- **D-9 Usage counts only on a model call.** A cache hit is free and doesn't count toward the daily limit (5 per day, admins exempt). A model call counts only when it returns a valid plan, as today.

---

## 1. What exists after phase 1

All on `feat/ai-structured-generation`:

- `src/lib/utils/plan-templates.ts`: `buildTemplatePlan(params, athlete)` builds a full plan from goal, level, days, equipment and weeks. A split is a list of sessions; a session is a list of `[slot, role]` pairs; each slot lists candidate exercises best first, and the first one the equipment allows wins. `prescribe` sets sets/reps/rest/progression from goal and role, and starting weight from the athlete's estimated 1RM or a body-weight ratio. Deterministic.
- `src/lib/utils/ai-plan.ts`: the `AiPlan` Zod contract, `aiPlanJsonSchema`, `parsePlanText`, `validatePlan` / `checkPlan`, `matchLibraryNames`, `uniqueProgramNames`, `toImportPayload`.
- `src/lib/llm.ts`: `capabilitiesFor` and `callModel`, picking the best structured-output mode per model.
- `src/lib/actions/ai-generate.ts`: `generateWorkoutPlan`, with `generateWithModel` doing one call plus one repair turn per model.
- `src/components/features/AiSetupClient.tsx`: chips for goal and experience, "Build my plan", "Customize with AI".
- `src/__tests__/plan-templates.test.ts`: every one of the 300 base combinations validates and imports.

The plan builder runs in the browser. That stays.

---

## 2. Phase 1: land the branch

1. Rebase `feat/ai-structured-generation` onto `main`. The only conflict is `BACKLOG.md`: keep both sides.
2. Commit this document on the branch.
3. `pnpm verify`.
4. Rebuild the dev container on the branch and run "Build my plan" → Import. Don't press "Customize with AI".
5. Push, PR, CI, squash-merge, check the deploy.
6. After deploy: Admin → AI Models → "Test" each row, remove the ones no longer listed.
7. Delete `docs/merge-handover-2026-10-21.md` (untracked).

## 3. Phase 2: more inputs

All in `src/lib/utils/plan-templates.ts`, pure functions, no UI. `TemplateParams` gains four fields, each with a default that reproduces today's output exactly, so the existing tests pass unchanged.

**Session length** (`30 | 45 | 60 | 90` minutes; absent means no limit).
`estimateSessionMinutes`: per set, 45 seconds of work (or the hold time) plus its rest, plus a minute per exercise to set up. Sessions of 30 and 45 minutes cap rest (main lifts 120/150 s, everything else 60/90 s). If a session still runs over, `fitToTime` cuts in this order until it fits: drop the last non-priority `core`, `isolation`, then `accessory` slot; take a working set off `secondary`, then `main` (never below 2); take extra sets off priority slots (never below 2); drop a `secondary` slot. A main lift is never dropped. With 90 minutes, add one set to `accessory` and `isolation` roles, capped at the existing 4-set limit. Every combination fits its limit and keeps at least 3 exercises per session at 30 and 45 minutes, 4 from 60.

**Split preference** (`auto | full_body | upper_lower | ppl`, default `auto`).
`auto` is today's `splitFor`. The others work for these day counts, and the UI disables any other combination:

| Split | Days |
|---|---|
| full_body | 2, 3, 4 (A/B alternating) |
| upper_lower | 2, 4, 6 |
| ppl | 3, 6 |

**Priority muscles** (zero to two of `chest, back, shoulders, arms, glutes, quads, hamstrings`, default none).
For each session that already trains the muscle, add one isolation slot for it after the last isolation slot, or one extra set on the existing slot if the muscle already has an isolation slot. Session length trimming runs after this, so a priority can push out a lower-role slot, but never a priority slot.

**Areas to avoid** (any of `knees, shoulders, lower_back`, default none).
Each candidate gets an optional `stress` list (for example `Squat` stresses `knees` and `lower_back`; `Overhead Press` stresses `shoulders`). `pick` skips a candidate whose stress overlaps the avoid set. Where that empties a slot, add joint-friendly candidates to the slot list (for example `Leg Press` or `Hip Thrust` for lower back) rather than dropping the slot. Every candidate name must exist in the seeded library in `scripts/seed.ts`.

**Template version.** Export a `TEMPLATE_VERSION` number from `plan-templates.ts` and bump it whenever any change alters output for any picks. Phase 4 puts it in the cache key.

**Tests** (extend `plan-templates.test.ts`):
- Every combination of goal, level, days, equipment, session length, a valid split and every avoid subset validates and imports. That's on the order of 40,000 builds, so loop inside one test rather than `it.each`.
- Priority muscles: every single muscle and every pair, against a fixed sample of the other picks.
- Each session still has at least 3 exercises at 30 minutes and at least 4 at 60.
- With an avoid area, no exercise in the plan stresses it.
- The estimate for each session is within the chosen length.
- Default picks produce byte-identical output to the phase 1 builder (snapshot one plan before changing anything).

## 4. Phase 3: picks-first page

`src/components/features/AiSetupClient.tsx` and `src/app/more/ai-setup/page.tsx`.

- Remove the large text box and the from-scratch "Customize with AI" button.
- The page is the picks, then "Build my plan", then a preview. The new picks are chips, matching the existing `Chips` component. Split chips that don't work for the chosen days are disabled, with the reason shown.
- The preview lists each program with its exercises and set/rep summary, not just counts, so the user can see what an edit would change. Reuse `buildSetSummary` from `src/lib/utils/format.ts` if it fits the plan shape; if not, a small local formatter.
- Import stays as it is.
- `generateWorkoutPlan` and its prompt builders lose their last UI caller. Remove them in this phase, along with anything that becomes unused, except `buildManualClipboardPrompt` (power-user clipboard, D-8).
- Add the 7-day BACKLOG entry (D-7).

Smoke: build and import a plan for a few combinations in the browser. Not a critical flow in `CLAUDE.md` terms, but the import creates programs and a cycle.

## 5. Phase 4: AI edit backend

**Cache table** `ai_plan_cache` (new file in `src/db/schema/`, migration via `pnpm db:generate`):

| Column | Type | Notes |
|---|---|---|
| `key` | text, PK | sha256 of the normalized key below |
| `template_version` | integer | for clearing old rows |
| `picks` | jsonb | picks plus the generic profile, for debugging and stats |
| `edit` | jsonb | chips and normalized text |
| `plan` | jsonb | the edited plan, weights stripped |
| `model_used` | text | |
| `hits` | integer, default 0 | |
| `created_at`, `last_hit_at` | timestamp | |

Not user-owned, so no `user_id`. Insert with `ON CONFLICT DO NOTHING`: two identical misses at once both call a model, and the second insert is dropped. That's acceptable.

**Key.** `TEMPLATE_VERSION`, the generic profile (D-5: age band, gender or "unspecified", goals sorted, experience), the picks in a fixed field order (priority muscles and avoid areas sorted), chip ids sorted, and the text normalized (lowercase, trimmed, whitespace collapsed, trailing punctuation removed). Text only hits on an exact normalized match. Chip-only requests are where most hits will come from.

**Action** `editPlanWithAi(input)` in a new file `src/lib/actions/ai-edit.ts`, following the server action template in `CLAUDE.md`:
1. `requireSession()`, Zod-parse picks, chip ids and text (≤200). Read the generic profile from the user row on the server, never from the client.
2. Rebuild the base plan on the server from the picks with a fixed reference athlete. Never trust a plan from the client.
3. Look up the key. On a hit: bump `hits` and `last_hit_at`, go to step 6.
4. On a miss: check the daily limit, then call models through `generateWithModel` (moved or shared from `ai-generate.ts`) with the edit prompt (D-5). Constraints for `validatePlan` are the picked days and weeks (D-6).
5. On a valid plan: strip weights, insert the cache row, record an `ai_generations` row.
6. Fill in this user's starting weights (below), run `matchLibraryNames` and `uniqueProgramNames`, return the plan.

**Weights.** The cache holds a plan with `kg` set to null on loaded sets. A new exported function in `plan-templates.ts` fills them for a user: an exercise the user has an estimated 1RM for gets 1RM times the existing `intensity` for its reps; an exercise in the template candidate lists gets the existing body-weight ratio; any other loaded exercise (one the model introduced) gets the equipment floor from `FLOOR` and the user corrects it after the first session. Bodyweight and band exercises stay at 0. `buildTemplatePlan` should use the same function, so the two paths can't drift.

**Edit prompt** (in `src/lib/utils/ai-prompt.ts`): a system prompt stating the job is to edit, not rewrite, and to keep everything the request doesn't touch; the progression rules already in that file; the generic profile (D-5); the plan as JSON; the request; the allowed exercise names. One short worked example of an edit, in the style of `src/lib/utils/ai-examples.ts`.

**Free-model guard.** In `getEnabledModels` (`src/lib/actions/ai-generate.ts`), drop any `openrouter` row whose id isn't `openrouter/free` and doesn't end in `:free`, with a `console.warn`. Gemini rows pass; whether Gemini is free depends on the key's billing setup, which goes in `docs/OPERATIONS.md`. The admin AI Models page shows a "not free, will be skipped" note on such rows.

**Tests:** key normalization; age band boundaries; the prompt contains no birth year, body weight or PR values; cache hit skips the model call and the usage count (mock `callModel`); weight fill for each of the three cases; the free-model guard; a plan that changes the days per week is rejected.

## 6. Phase 5: AI edit UI

Under the preview: a row of chips and a short text box (200 character counter), and an "Edit with AI" button. The result replaces the preview, with "Undo edit" back to the built plan. Show whether the result came from the cache ("instant") or a model ("took 40 s"), and the remaining edits for today. The existing pending-result handling (`AI_PENDING_KEY`) covers a user leaving the page during a model call.

Chips must not duplicate a pick. A starting set: "More variety between days", "Add a cardio finisher", "Add mobility warm-ups", "Prefer machines over free weights", "Fewer exercises, more sets". Each chip is a fixed id plus a fixed English instruction sent to the model.

## 7. Phase 6: one-week check-in and revision

**Recording what was imported.** New user-owned table `ai_setup_plans` (migration):

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `user_id` | text, FK users, cascade | every query filters by it |
| `cycle_id` | integer, FK training_cycles, set null | the imported cycle |
| `picks` | jsonb | the picks used |
| `edit` | jsonb, nullable | chips and text of the AI edit, if any |
| `revision_of` | integer, self FK, nullable | set when this plan came from a check-in |
| `checkin_status` | text: `pending`, `fits`, `does_not_fit`, `dismissed` | default `pending` |
| `checkin_issues` | jsonb, nullable | issue ids picked |
| `checkin_note` | text, nullable | max 300 |
| `checkin_answered_at` | timestamp, nullable | |
| `created_at` | timestamp | |

AI Setup writes a row after a successful import. `importCycle` (`src/lib/actions/training-cycles.ts`) returns the cycle name today; extend it to also return the new cycle's id. Plans imported through paste-JSON or the clipboard flow get no row, since there are no picks behind them.

**When to ask.** The cycle is `active`, its `start_date` is 7 or more days ago, and the row is `pending`. Imported cycles start as drafts, so the clock runs from when the user starts the cycle, not from the import. If the cycle is deleted or completed before then, the row is never shown.

**Where.** A card on the home page (`src/app/page.tsx`), next to where `WorkoutInsightBanner` renders: "You've had a week on your new plan. Does it fit?" with "Yes, it fits", "Not really" and "Not now". "Not now" sets `dismissed`; it doesn't come back.

**"Not really"** opens a bottom sheet (`src/components/ui/BottomSheet.tsx`) with issue chips and a short note:

| Issue | Fix |
|---|---|
| Sessions take too long | session length one step down, rebuild (no AI) |
| Too few or too many training days | reopen the days pick, rebuild (no AI) |
| Equipment doesn't match my gym | reopen the equipment pick, rebuild (no AI) |
| Too hard | level one step down, rebuild (no AI) |
| Too easy | level one step up, rebuild (no AI) |
| I don't like some exercises | AI edit |
| Something else (the note) | AI edit with the note as the request |

Pick-based fixes stay free. Only the last two go to a model, through `editPlanWithAi`, with the issue and note as the edit request on top of the original plan's picks and edit. Those requests cache like any other edit.

**The revised plan.** "See a revised plan" opens AI Setup with the picks prefilled and the fix applied, showing the usual preview. Import works as it does today: new programs (names deduplicated) and a draft cycle the user starts from the cycles page. The new row gets `revision_of` set, so it gets its own check-in a week later. No new cycle-switching logic.

**Server actions** (in `src/lib/actions/ai-edit.ts` or a new `ai-checkin.ts`, following the `CLAUDE.md` template): `getPendingCheckin()` and `answerCheckin(input)`. Both read `userId` from the session and filter by it.

**Tests:** the "when to ask" rule (draft cycle, active under 7 days, active 7+ days, completed, deleted); each issue maps to the right fix; another user's row can't be answered.

**Smoke:** start a cycle with `start_date` moved 8 days back in the local database, confirm the card shows, answer "Not really" with one pick-based issue and one AI issue (AI path on a free model, or stubbed).

## 8. Phase 7: live check on free models

Closes the BACKLOG entry "Live-verify AI Setup's tool and JSON-mode paths and the repair turn".

- Add `scripts/ai-smoke.ts`: for one model id, run an edit in each output mode the model supports, plus one request built to fail validation (asking for a 7th day) to force the repair turn. Print mode, time, valid or not.
- Run it against two or three free models. Save the raw responses as test fixtures, so `parsePlanText` and the repair path stay covered without live calls.
- Fix what breaks, delete the BACKLOG entry.

---

## 9. Out of scope

- From-scratch AI generation in the UI.
- Paid models.
- Target effort (RIR) per set in programs. Already a BACKLOG entry ("Prescribe target RIR in programs + AI generation").
