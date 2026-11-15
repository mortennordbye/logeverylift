# AI coach hub

Status: built on `feat/ai-coach-hub`. Screens: `docs/design/ai-coach/ai-coach-hub.html`.

## 1. Why

The AI parts of the app were on three More rows in two groups (AI Setup, Connected assistants,
Coach memory), and two more parts hid inside AI Setup ("Power-user options"). A normal lifter
saw AI words they did not need. A power user hunted for the pages.

## 2. Decisions (owner, 2026-11-15)

1. One More row, **AI coach**, opens one page that grows with the user. No mode switch: a part
   draws when the user has the data for it (`docs/plans/simple-and-power-users.md`, section 2).
2. **The built-in AI is free and gives saved answers only.** The plan builder is rules. A change
   to a new plan comes from the shared edit cache (`aiPlanCache`). A user's request with no saved
   answer gets `OWN_AI_NEEDED` and is never sent out. Only an admin's miss calls a free model,
   which fills the cache for everyone.
3. **A running plan changes only through the user's own AI.** A connected assistant already
   changes programs and weekdays over MCP, with revisions, limits and undo. The app adds no
   new AI code for it.
4. **Memory is for every user.** Every user can read and write notes. Only the user's own
   connected AI reads them. The in-app AI never does (`docs/plans/ai-coach.md`, 2.5, holds).
5. A short "Building your plan" screen (about 3 seconds) shows while the rules finish at once.

## 3. What changed

| Part | Before | After |
|---|---|---|
| More rows | AI Setup, Connected assistants, Coach memory | One row, AI coach |
| Hub `/more/ai-coach` | none | Plan card or "Get a plan", check-in, a card to change the plan with your own AI, "What your coach knows" (not connected), "Your assistant" card with Changes, Memory and Connection (connected), More options |
| Builder `/more/ai-setup` | "AI Setup", every pick shown | "Your plan", four picks, the rest under More options (open by itself when set), the building screen, "Start this plan" |
| AI change of a new plan | Model call for every user, 5 a day, consent sheet | Saved answers for users, no limit, no consent sheet. Admins as before |
| Own AI chat | Inside "Power-user options" | `/more/ai-coach/own-chat` |
| Connect an assistant | Inside "Power-user options" | `/more/ai-coach/connect` |
| Connected assistants `/more/assistants` | More, App group | "Connection", Back to AI coach |
| Assistant changes `/more/assistants/changes` | Link on Connected assistants | "Changes", Back to AI coach |
| Coach memory `/more/coach-memory` | More, App group | "Memory", Back to AI coach, for every user |

The three existing pages keep their routes, so old links still work.

## 4. What did not change

- The rule-based plan builder and its output. The check-in and its revise flow.
- The MCP server, its tools and the consent page (only its menu path text).
- Memory, changes and undo logic.
- The AI consent switch in Account. It shows only to a user who gave the consent.
- Athlete profile, the triathlon plan, the readiness card.

## 5. Privacy

Users' requests no longer go to OpenRouter. The policy, `docs/privacy/data-inventory.md` and
`LEGAL_VERSION` changed in the same PR.

## 6. How to check it

- `e2e/ai-coach.spec.ts`: one AI row, the hub, More options, own AI chat, connect.
- `e2e/ai-setup.spec.ts`: picks with More options, the building screen, a miss with no consent.
- `e2e/mcp-oauth.spec.ts`: the assistant card after a connection.
- `src/__tests__/ai-edit.test.ts`: a user's miss calls no model.
- Journey review: `pnpm journeys coach --seed` with `scripts/seed-coach-demo.ts`.
