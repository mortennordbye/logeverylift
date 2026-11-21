# Body measurements

Build brief, agreed with the owner on 2026-11-21. The pictures are in
[`docs/design/body-measurements/plan.html`](../design/body-measurements/plan.html) (open it in a
browser). Build to the pictures. The guide text, the tape-line coordinates on the body figure and
the step order are in [`docs/design/body-measurements/gen-reference.mjs`](../design/body-measurements/gen-reference.mjs)
(arrays `C`, `G`, `GL`): it is the script that drew the plan, not app code. Port the data, do not
import the file.

## What

A place under Account › Body and health where a user logs body measurements in cm, with a date,
and sees a history and a trend per body part.

- **Circumference** (history and trend): 1 neck, 2 shoulders, 3 chest, 4 waist, 5 hips,
  6 upper arm, 7 forearm, 8 thigh, 9 calf. Parts 6 to 9 have a left and a right value.
- **Length** (latest value only shown): 10 arm length, 11 leg length, 12 inseam.
- Height stays where it is (`user.heightCm`). Body weight does not change.

## Decisions (settled, do not re-ask)

1. One table, one row per value. Lengths are stored in the same table; the UI shows the latest.
2. Values 1 to 300 cm, one decimal.
3. A second log on the same date replaces that date's value for that part and side (upsert).
4. Change colours are neutral (arrow and number, muted). No green or red.
5. A left and right difference of 1 cm or more shows a note on the row ("Right is 1.1 cm bigger").
6. "Change since" picker at the top: First log, 3 months, Last log (the log before the latest).
7. Body ratios, calculated on read and never stored: waist to height, waist to hips (WHO limit 0.90
   men, 0.85 women), shoulders to waist, body fat estimate by the US Navy method (needs `gender`
   male or female, `heightCm`, neck, waist, and hips for women; hide the row when an input is
   missing). Show "about ± 3 %" under body fat.
8. "Next log from <date>" line: the latest log date plus 14 days. No notification.
9. Logging is a step flow, one part per screen, in this order (13 steps): neck, shoulders, chest,
   waist, hips, right upper arm, right forearm, left upper arm, left forearm, right thigh, right
   calf, left thigh, left calf. Lengths (3 more steps) only when the user has no length values yet.
10. Each step: picture crop with the tape line, one line of where, "How to measure" opens the full
    guide, decimal keypad opens at once (`inputMode="decimal"`), field prefilled with the last value
    and selected, buttons − 0.5, Same, + 0.5, Skip, Next. Next on the keypad goes to the next step.
11. Each step saves when the user goes on (server upsert). Nothing in browser storage.
12. Date is today in the user's time zone; the first step has a date control to log an old date.
13. Done screen: today's values with change against the previous log; tap a value to correct it.
14. cm only. Inches and the AI coach (MCP) reading measurements are later changes (BACKLOG).
15. Body measurements are a new kind of health data: add them to the record of processing and the
    privacy policy, bump `LEGAL_VERSION` and raise `CONSENT_VERSION` to the same new value.

## Where it goes

- Row: a new `href` row "Measurements" in the `body-and-health` section of
  `src/components/features/account/sections.tsx`, after Body weight. Value: last log date, or "Not set".
- Pages (new): `/more/account/measurements` (summary), `/more/account/measurements/[part]` (guide,
  chart, history with delete), `/more/account/measurements/log` (the step flow). A static segment
  wins over `src/app/more/account/[section]`. Each page has `loading.tsx` like its neighbours.
- Body map: reuse the front figure from `src/lib/exercise-art/muscle-map.ts` (`MAP_FIGURES[0]`),
  the same one `src/components/features/MuscleMap.tsx` draws, and draw tape lines over it.
- Back controls use `BackLink` with the parent as fallback.
- After the first log, a length is changed on its part page: a length's part page has a value field
  that saves for today (the log flow asks for lengths only on a first log). The bottom nav is hidden
  on the log flow, as on the guided player (`src/components/ui/bottom-nav.tsx`).
- Weight history UI for chart style reference: `WeightHistorySection` in
  `src/components/features/MetricsClient.tsx`. Weight actions for pattern reference:
  `src/lib/actions/profile.ts`.

## Data

- Table *new* `body_measurement`: `id`, `user_id` (FK `user.id`, `onDelete: "cascade"`), `site`
  (text, one of the 12 site ids), `side` (`none`, `left`, `right`, not null), `value_cm` (real),
  `measured_on` (date), `created_at`. Unique on (`user_id`, `site`, `side`, `measured_on`).
- Migration via `pnpm db:generate` (a new table only, no rename prompts). Commit the SQL and the
  `drizzle/meta` snapshot with the schema.
- Server Actions *new* in `src/lib/actions/body-measurements.ts`, from the canonical template in
  CLAUDE.md: save one value (upsert), delete one value, read all. Zod first, `requireSession()`,
  `userId` from the session only. Client calls go through `callAction()`.
- Add the table to `collectUserData` in `src/lib/account-data.ts`.

## Privacy

Use the `privacy-compliance` skill. Inventory row in `docs/privacy/data-inventory.md` (Profile row
and the health-data list), `src/app/privacy/page.tsx`, versions in `src/lib/constants/legal.ts`.

## Tests

- Unit: ratios, US Navy body fat, change-since and left/right note logic as pure functions in
  `src/lib/utils/`.
- Integration (`pnpm test:int`): save (upsert on same date), delete, read only own rows, export
  includes the table.
- e2e *new* `e2e/body-measurements.spec.ts`: open from Account, run the step flow with a few values
  and a Skip, check rows via `testDb()`, check the summary, delete one value.
- Journey review (`journey-review` skill) at 390 and 320 px.

## Out of scope

Home widget, Progress page chart, Garmin sync, notifications, progress photos, inches, MCP tools.
