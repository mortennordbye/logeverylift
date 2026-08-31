# UI audit — in-workout feel, inputs, and layout shift

<!-- doc-claims: skip — a point-in-time audit; its file:line refs describe the code as measured, not as it is now. -->

Working document. Each finding is independently actionable: **what**, **where**
(file:line), **evidence**, **proposed fix**.

**Part 1 is the in-workout deep dive** — every control you touch between starting and
finishing a workout, how it moves, and what it moves around it. Part 2 covers the rest
of the app.

> **Status: all 15 Part 1 findings are fixed and verified** (marked `[x]`). The 12
> Part 2 findings are still open. See `docs/ui-polish-handover.md` for what changed,
> how to see each fix with your own eyes, and the before/after numbers.
>
> Each fixed finding below still records the **original** measurement and the fix as
> proposed — that is the evidence trail. Where the shipped fix differs from the
> proposal, a "**Shipped:**" note says so.

Severity:
- **P0** — blocks the user from completing the action.
- **P1** — the screen moves under the finger during a core flow.
- **P2** — visible pop, wrong-looking output, or motion with no purpose.
- **P3** — inconsistency or ergonomics.

Status: `[ ]` open · `[x]` done · `[~]` partial

Everything marked **measured** was verified in a real browser via
`getBoundingClientRect` / `elementFromPoint`, at 390×844 (iPhone 14) unless a
different viewport is named. Screenshots are in `.playwright-mcp/` (gitignored).

---

## Part 1 — In-workout: every input, and what it moves

### The short version

Logging a set is the app's core loop, and almost every control in it changes the
height or position of something else the moment you touch it. One tap can move the
next row 86px. Two adjacent pickers with identical visual design behave in opposite
ways. On a 667px-tall phone the Save button cannot be tapped at all.

Three controls are built correctly and should be the template for the rest: the **RIR
chip row**, the **notes field**, and the **duration picker** — all measured at zero
shift.

---

### [x] W0 · **P0** · Save is unreachable on iPhone SE and smaller — **measured**

`src/app/programs/[id]/workout/exercises/[programExerciseId]/sets/[setId]/page.tsx:41`
+ `src/components/features/SetEditView.tsx:281`

The route is `h-[100dvh] … flex flex-col overflow-hidden` and `SetEditView`'s content
is `flex-1 px-4` — **with no `overflow-y-auto` anywhere in the chain**. When the
content is taller than the viewport it is simply clipped, and nothing scrolls.

The workout strength set-edit screen (Reps, Weight, Type, RIR block, Mark-as-failed,
Note) needs **706px**. Measured at 375×667 (iPhone SE 2/3, iPhone 8):

- Save button: `top 634, bottom 690` → **23px below the fold**
- the sliver that is on screen sits *under* the fixed bottom nav (nav top 575)
- `elementFromPoint` at every y across that sliver returns the nav's `<a>`,
  never the button — `anyProbeHitsSave: false`
- no scrollable ancestor (`scrollableAncestorOfSave: null`),
  `document.scrollHeight === innerHeight`

**There is no gesture that reaches the button.** The user's only exit is the "Sets"
back link, which discards the edit.

| viewport | device | verdict |
| --- | --- | --- |
| 844 / 812 / 780 / 736 | iPhone 14, X–12 mini, 8 Plus | Save reachable |
| **667** | **iPhone SE 2/3, iPhone 8** | **39px short — unreachable** |
| **640** | **common small Android** | **66px short — unreachable** |

The note field is also clipped by the nav at these sizes (note bottom 593 vs nav top
575). Screenshots: `.playwright-mcp/audit-26-setedit-iphone-se-save-unreachable.png`,
`audit-25-setedit-360x640.png`.

**Fix:** make the content region scroll — `overflow-y-auto min-h-0` on the `flex-1`
wrapper in `SetEditView.tsx:281` — and keep the Save block pinned outside it (it is
already a separate sibling at `:688`). `min-h-0` is required: a flex child defaults to
`min-height: auto` and won't shrink below its content, which is what defeats the
scroll today.

> Worth checking the same pattern on the other full-height `overflow-hidden` routes
> before shipping — `NewSetView`, the finish screen, and the running/triathlon variant
> of `SetEditView` (which adds distance, incline and HR-zone blocks and is therefore
> *taller* than the strength one).

---

### [x] W1 · **P1** · Exercise summaries flip after hydration, and React discards the list — **measured**

`src/components/features/WorkoutExerciseList.tsx:172-186`

The exercise-row summary is built from `workoutSession?.overrides`, which lives in
localStorage. The server has no access to it, so the server renders the *program*
numbers and the client renders the *adjusted* ones. React logs a hydration error and
**regenerates the whole exercise-list subtree on the client**:

```
+  8x85kg; 01:30; 8x85kg; 01:30; 8x80kg; ...   (client — applied suggestion)
-  8x80kg; 01:30; 8x80kg; 01:30; 8x80kg; ...   (server HTML)
```

User-visible: every time you open the workout screen with any applied override, the
numbers on each exercise row **change after load**. It is the literal "text shifts by
itself" symptom, and it costs a full re-render of the list on the most-visited screen
in a workout. It is also the only console error in the whole app — every other route
was clean.

**Fix:** render the server's program values, then apply overrides after mount (a
`mounted` flag, `useEffect`, or `useSyncExternalStore` with a server snapshot that
returns the program value). That makes the first paint match the HTML and turns the
flip into a deliberate post-mount update.

---

### [x] W2 · **P1** · Progression sheet grows upward — the row you tapped moves 141px — **measured**

> This is the case originally reported ("shift for weight increase with auto
> incremental data — that shifts the screen"). It is the largest single shift found.

`src/components/features/WorkoutSetsClient.tsx:316-551` — sheet root is
`fixed inset-0 … flex items-end`; the increment block at `:401-443` mounts
conditionally on `mode === "weight" || mode === "smart"`.

Selecting **Weight** inserts the "Weight increment" block into a sheet anchored to the
*bottom* of the screen, so it can only grow upward:

| | before | after | delta |
| --- | --- | --- | --- |
| Sheet height | 534px | 675px | **+141px** |
| Sheet top edge | 214px | 73px | **−141px** |
| The "Weight" row you just tapped | top 396 | top 255 | **−141px** |

Your finger ends up over "Smart weight". Same for *Reps*, *Duration* and *Distance*
(`:446`, `:491`, `:515`), and again in reverse when switching back to a mode with no
increment section.

Screenshots: `audit-08-progression-sheet.png` → `audit-09-progression-weight-grown.png`.

**Fix:** stop the outer box resizing — `h-[80vh]` instead of `max-h-[80vh]` on `:325`.
Revealing a section then only changes what's inside the existing scroll area.

**Shipped: not that.** `h-[80vh]` was tried first and is wrong — a timed or running
exercise only has two modes, so forcing every sheet to full height left a mostly-empty
675px card (`.playwright-mcp/fix-02-progression-timed-80vh.png`). Instead the four
increment sections now render into a single CSS grid cell, filtered to the ones the
exercise can actually reach (`incrementSections`), so the area is permanently as tall
as the tallest one it could show and picking a mode only swaps which is visible. The
sheet is then constant *per exercise* rather than constant *at max*: strength stays
675px, timed is 259px.

### [x] W2b · **P2** · The revealed increment row is clipped — **measured**

Direct consequence of W2. Once the section appears the sheet hits its cap and the
custom-kg input is cut in half: sheet bottom 748, custom row `top 737 / bottom 769` →
21px of a 32px control visible, **33px below the fold**, with nothing signalling more
content exists. Falls out of the W2 fix plus scrolling the new section into view.

---

### [x] W3 · **P1** · Applying a suggestion collapses the row you tapped — **measured**

`src/components/features/WorkoutSetsList.tsx:1327` (chip row), chips `:1328-1406`

`weightPending` (`:1254`) is `currentWeight !== suggestion.suggestedWeightKg` — so the
tap that applies the suggestion is exactly what unmounts the chip. `siblingsForApply`
(`:649`) propagates to every set sharing the suggestion, so several rows collapse at
once.

Tapping `↑ 85kg` on set 1 of Bench Press:

| row | height | top |
| --- | --- | --- |
| set 1 | 104 → 84 | 180 → 180 |
| set 2 (propagated) | 104 → 84 | 317 → 297 |
| set 3 | 104 → 104 | 454 → **414** |
| set 4 | 104 → 104 | 591 → **551** |

One tap and the list below rises **40px**. The chip vanishes, so the only confirmation
the tap registered is the summary text changing.

**Fix (preferred):** keep the chip mounted and swap it to a settled state of the same
size — `↑ 85kg` → `✓ 85kg`, non-interactive, lower contrast. Height preserved
*and* the user gets explicit confirmation.
**Fix (cheaper):** `min-h-[22px]` on the chip row — but that adds ~18px to every set
row that never has a chip.

### [x] W4 · **P1** · Ticking a set deletes two lines from its row — **measured**

`src/components/features/WorkoutSetsList.tsx:1250` — gate `isWorkout && suggestion && !isCompleted`

Completing a set unmounts the whole suggestion block: the `Last: 80.44kg (OK, RPE 6)`
line, the progress dots and the chip row.

- Manual mode, no chip: row 84 → 62px, rows below rise **22px**
- With a chip: row 104 → 62px
- **Worst case:** ticking set 3 catch-up-logs sets 1 and 2 (`:257-274`), collapsing
  three rows at once — **row 4 rose 86px** (551 → 465) from one tap

Second problem inside the first: once logged, a set shows only `8 × 85kg`. The "what
did I do last time" context disappears exactly when you'd compare against it.
Screenshot: `audit-11-setlist-after-tick.png`.

**Fix:** drop `!isCompleted` from the gate and keep the info line — the row already
carries `opacity-50` when completed (`:1146`), so it reads as history for free. Gate
only the *interactive* chips, and let W3's settled state hold their height.

### [x] W5 · **P1** · "Mark set as failed" moves itself 113px — **measured**

`src/components/features/SetEditView.tsx:561` (gate `isWorkout && !failed`), toggle `:594-611`

The toggle sits *below* the RIR block and unmounts it:

| | before | after |
| --- | --- | --- |
| "Mark set as failed" | top 408 | **top 295** |
| Note textarea | top 505 | top 392 |
| Save (pinned) | 708 | 708 |

The control you just pressed travels 113px, so an immediate second tap to undo lands
on whatever slid into its place. The Reps label also swaps `Reps` ⇄ `Reps done`
(`:532`).

**Fix:** keep the RIR block mounted but disabled when failed (RIR is 0 by definition —
show it pinned to 0, greyed), or move the failed toggle *above* RIR so the collapse
happens below the tap point.

### [ ] W6 · **P1** · Auto-carry weight lands as a second, delayed jump

`src/components/features/WorkoutSetsList.tsx:368-383`

After logging a set, if the next set has no weight, the code `await`s
`updateProgramSet(...)` then `router.refresh()`. A few hundred ms after the tap the
*next* row's text changes from `8 reps` to `8 x 80kg` and the server tree re-renders —
so the list moves once on tap (W4) and again on the round-trip.

**Fix:** apply the carry optimistically via `workoutSession.setOverride` in the same
frame — the pattern `applySuggestion` (`WorkoutSetsClient.tsx:131`) already uses — and
let the server write settle behind it. The `router.refresh()` can go.

---

### [x] W7 · **P2** · Reps and weight pickers move in opposite, equally wrong ways — **measured**

Two controls with identical visual design, adjacent in the same screen, whose
auto-scroll effects have different dependency arrays:

| | code | on typing |
| --- | --- | --- |
| Reps | `SetEditView.tsx:174-184`, deps `[showRepsPicker, reps]` | row whips across |
| Weight | `SetEditView.tsx:186-196`, deps `[showWeightPicker]` | row never moves |

**Reps — too much motion.** Typing `2` → `25` → backspace, per keystroke:

| typed | circles | scrollLeft |
| --- | --- | --- |
| `2` | 20 | 0 |
| `25` | 21 (a `25` circle is appended) | **1162** |
| `2` | 20 (it vanishes) | **0** |

The row lurches 1162px right and back on a single keypress, and an option appears and
disappears under your hand.

**Weight — no feedback at all.** `scrollLeft` stays pinned at 2685 whatever you type,
while the highlighted circle moves to index 0 → 4 → 40. Measured
`selectedOnScreen: false` for every typed value: the selection is invisible, off past
the edge of the row.

**Fix:** one shared behaviour. Scroll the selected option into view on *commit*
(blur / preset tap / sheet open), not on every keystroke — smooth, and only when the
value settles. Both pickers should use the same effect.

### [x] W8 · **P2** · Clearing a numeric field silently commits zero — **measured**

`SetEditView.tsx:746-751` (reps), `:815-820` / `:832-837` (duration min/sec)

Every keystroke writes straight through to the set, including transient states. With
`repsMin = 0` in workout mode (`:142`), clearing the reps field to type a new number
leaves the row behind reading **`Reps 0`** — observed directly: after clearing the
field, the underlying screen showed `Reps 0` and kept it. Duration behaves the same
way: clearing the seconds field takes the row to `00:00`.

The user's mental model is "select-all, type the new number". The intermediate empty
state is a real, committed value, and if the sheet is dismissed at that instant (tap
outside, back gesture) the set keeps it.

**Fix:** keep the draft string as the only live state while the field is focused, and
commit the parsed number on blur / Done — which the components already half-do via
`repsStr` / `durationSecStr`. Don't call `setReps`/`setDuration` from `onChange`.

### [x] W9 · **P3** · Picker rows show scrollbars that sibling rows hide — **measured**

`SetEditView.tsx:721` (reps), `:772` (duration), `:863` (weight),
`WorkoutSetsList.tsx:948` (rest) are all `flex gap-2 overflow-x-auto pb-4` with **no
`no-scrollbar`** — measured `hasNoScrollbar: false`. Meanwhile the preset rows in the
*same file* (`SetEditView.tsx:324`, `:384`, `:419`) do use it. A visible track renders
across every number picker. Screenshot: `audit-20-reps-picker.png`.

### [x] W10 · **P3** · `Last: (OK)` — empty value leaves stray parentheses — **measured**

`src/components/features/WorkoutSetsList.tsx:1289`

```ts
`Last: ${lastValue ? lastValue + " " : ""}(${suggestion.basedOnFeeling}…)`
```

When `lastValue` is empty — routine for timed sets, where `basedOnDurationSeconds` is
null — the row renders literally **`Last: (OK)`**, which reads as a rendering bug.
Seen on every Plank set. Screenshot: `audit-21-plank-sets.png`.

**Fix:** drop the whole `Last:` line when there is no value to report, or fall back to
the feeling alone without the parentheses.

### [x] W11 · **P2** · Two workout headers are never actually centred — **measured**

Both use `justify-between` with variable-width side content around a centred title.

**Workout screen** (`WorkoutSessionClient.tsx:138-175`) — left is `Finished` ⇄ `Done`,
right is `Edit` + `＋` ⇄ `＋`:

| state | title left | title centre | viewport centre |
| --- | --- | --- | --- |
| normal | 130 | 191 | 195 |
| editing | 138 | 199 | 195 |

Off-centre by 4px in *both* directions, and it slides **8px** on every Edit toggle.

**Edit Set screen** (`sets/[setId]/page.tsx:45-56`) — a fixed `w-16` spacer on the
right against a variable-width `‹ Sets` link on the left, so "Edit Set" is off-centre
by however wide the back label happens to be.

**Fix:** `WorkoutSetsClient.tsx:204-248` already solves this — fixed `w-20 shrink-0`
side slots with a `flex-1` spacer. Copy it to both.

### [x] W12 · **P3** · Rest countdown digits jitter

`src/components/features/WorkoutSetsList.tsx:1501-1506` — `REST 01:29` re-renders every
second without `tabular-nums`, so its width wobbles as digits change. Every other live
number in the app has it: session elapsed (`WorkoutSessionClient.tsx:179`), the
exercise timer (`:872`), the note counter (`SetEditView.tsx:679`). Also worth adding to
the set summary (`:1230`, `:1239`), which re-renders at a new width when a suggestion
is applied.

### [x] W13 · **P3** · Type-row spinner pushes the label sideways

`SetEditView.tsx:552-555` — `{savingType && <Loader2 className="h-4 w-4" />}` is
inserted into a right-aligned flex row, so the type label shifts 16px + gap while
saving, then back. Reserve the slot (`<span className="w-4 h-4">`), fill it only while
saving.

### [x] W14 · **P3** · Small tap targets on the workout path

`tap-slop` / `tap-44` exist in `globals.css` (`:181`, `:258`) precisely for this and
are used at only 4 call sites. On the workout path:

| Control | Location | Size |
| --- | --- | --- |
| Add-exercise `＋` (workout header) | `WorkoutSessionClient.tsx:170` | 28px |
| Delete-rest `−` (set list edit) | `WorkoutSetsList.tsx:1476` | 28px |
| Delete-set `−` (program edit) | `ProgramDetailClient.tsx:110` | 28px |

`tap-slop` is a visual and layout no-op. Drag handles (`WorkoutSetsList.tsx:1422`,
`:1494`) are deliberately excluded — they carry `touch-none` for @dnd-kit.

---

### Workout controls that are built correctly — **measured, zero shift**

Use these as the template for the fixes above:

- **RIR chip row** (`SetEditView.tsx:574-588`) — `flex-1` equal-width chips, `h-11`
  (44px), and the state label is right-aligned so `Not logged` → `2 left` pushes
  nothing. Tapping a chip produced an **empty diff** across every element on screen.
- **Note field** (`SetEditView.tsx:663-683`) — fixed `rows={3}`, counter is
  `tabular-nums` and right-aligned in a full-width block. From 0 → 500 characters:
  textarea height constant at 88px, counter x/width constant, Save constant. *(Minor:
  at 500 chars `scrollHeight` is 352 vs 88 visible, so you read a long note through a
  quarter-height window — deliberate given the fixed layout, but worth knowing.)*
- **Duration picker** (`SetEditView.tsx:809-843`) — fixed `w-24` fields either side of
  a fixed colon; sheet height constant at 284px while typing. Only W8 applies.
- **Exercise timer** (`WorkoutSetsList.tsx:803-907`) — counts to `00:00` and **holds it
  ~600ms** before dismissing, exactly as the comment at `:505-514` intends. Traced:
  `00:03 → 00:02 → 00:01 → 00:00` (held) → overlay dismissed. Digits clear the ring by
  4px each side; the format never exceeds 5 characters so it can't overflow.
- **No horizontal overflow** on any workout screen (`scrollWidth === innerWidth`).

### Not testable headlessly

Soft-keyboard behaviour. `BottomSheet.tsx:19-63` and `ViewportFix.tsx` implement
careful keyboard handling (visualViewport tracking, `--kb-height`, focus scroll
correction, zoom reset). Headless Chrome raises no soft keyboard, so **none of it was
exercised**. Given W0, the interaction between the keyboard and the non-scrolling
set-edit page is worth a real-device check: focusing the note field on a short phone
with no scroll container is the exact scenario that plumbing is meant to rescue.

---

## Part 2 — Rest of the app

### [ ] B1 · **P2** · `/exercises` loads a skeleton for a different screen

`src/app/exercises/loading.tsx` → `ExercisePickerSkeleton` (`PageSkeletons.tsx:92`)

The picker skeleton draws a centred bold **"Add Exercise"** title over a card-less list
of two-line rows. The real `/exercises` (`ExercisesClient.tsx:649-668`) is a back-only
header, an `Exercises` h1 beside a circular `+`, a search bar, then a
`bg-card rounded-2xl` card of **7 icon rows**. Wrong title, header, list shape and row
count. Screenshot: `audit-13-exercises.png`.

**Fix:** give `/exercises` its own `loading.tsx`; leave `ExercisePickerSkeleton` to the
two `add-exercise` routes it was written for.

### [ ] B2 · **P2** · Dashboard skeleton is a bare header

`src/app/loading.tsx` renders the title and nothing else; the real `/`
(`src/app/page.tsx:112-390`) fills the viewport. The most-visited route pops from empty
to full. Mirror the today card and the week-strip card — both have data-independent
geometry. Same issue, lower traffic: `src/app/new-workout/loading.tsx`.

### [ ] B3 · **P2** · Metrics skeleton puts the tab bar in the wrong layer

`src/app/more/metrics/loading.tsx` vs `MetricsClient.tsx:1625-1653`

1. Skeleton renders the tab bar as the first child *inside* the scroll container; the
   real one sits in the fixed header **above** it, so it jumps out of the scroll area.
2. Height: skeleton `h-10` (40px) vs real ≈44px.
3. Skeleton's back row is an empty `<div>` (`:6`); the real page has `‹ More`.

### [ ] B4 · **P3** · `ListPageSkeleton` doesn't match `/more/prs`

`PageSkeletons.tsx:123-157` vs `more/prs/page.tsx:85-115` — skeleton row `p-4` +
`w-8 h-8` circle and `space-y-3`; real row `px-4 py-3` + `w-10 h-10` circle and
`space-y-2`. The real page also has a subtitle under the h1 the skeleton doesn't
reserve, so the list starts ~24px lower. `/more/friends` and `/more/account` share this
skeleton and should each be checked against their own row.

### [ ] B5 · **P3** · Missing back chevrons in three skeletons

`history/loading.tsx:7`, `more/metrics/loading.tsx:6`, `more/calendar/loading.tsx:6`
render an empty spacer where the real page puts `‹ Back`. `ListPageSkeleton` and
`BackEditHeader` both draw it — these three are the odd ones out.

### [ ] B6 · **P3** · History skeleton shows a search bar the empty state lacks

`history/loading.tsx:10-12` always renders the filter; `HistoryClient.tsx:37` renders it
only when `sessions.length > 0`. A new user watches it appear and vanish.

### [ ] C1 · **P2** · Activity heatmap opens on the oldest, empty weeks — **measured**

`MetricsClient.tsx:1120`. The 12-month heatmap is 673px wide in a 311px viewport and
starts at `scrollLeft: 0`, so **362px is hidden to the right** — including every recent
week. The header reads "12 sessions / 12 active days" while the visible grid is blank.
It looks broken. Screenshot: `audit-15-metrics.png`.

**Fix:** set `scrollLeft = scrollWidth` on mount so it opens on today. (It also lacks
`no-scrollbar`, same as W9.)

### [ ] C2 · **P2** · History shows raw float volumes; three formats coexist — **measured**

`HistoryClient.tsx:104` — `{session.totalVolumeKg.toLocaleString()}kg`, no rounding, so
rows read **`4,310.4kg`**, **`4,357.66kg`**, **`4,252.65kg`**.

| where | code | output |
| --- | --- | --- |
| Metrics | `MetricsClient.tsx:71` `formatVolume` | `48.2t` / `450 kg` |
| Friends | `FriendsClient.tsx:203,254` `Math.round` | `4,310kg` |
| History | `HistoryClient.tsx:104` raw | `4,310.4kg` |

**Fix:** `formatVolume` is currently private to `MetricsClient.tsx`. Move it to
`src/lib/utils/format.ts` and use it in all three — the "reuse before adding" rule in
`CLAUDE.md`. Same pass should settle `kg` spacing, which is `85 kg` on `/more/prs` and
in `formatVolume` but `85kg` in the set list and on the suggestion chips.

### [ ] C3 · **P3** · PR rows change height with subtitle wrap — **measured**

`more/prs/page.tsx:85-115` — the value column is content-sized, so a longer value
squeezes the subtitle onto a second line:

| row | value | value col | lines | height |
| --- | --- | --- | --- | --- |
| Reps at weight | `8 reps @ 80 kg` | 117px | 2 | **80px** |
| Estimated 1RM | `~108 kg 1RM` | 104px | 2 | **80px** |
| Heaviest set | `85 kg` | 44px | 1 | **64px** |

**Fix:** drop the year (`Thu, Jul 30` is enough on a phone), or fix `min-h` and
truncate.

### [ ] C4 · **P3** · Dashboard "Missed this week" rows are ragged — **measured**

`src/app/page.tsx:192-220` — `Mon — Push Pull Legs A` wraps → **57px**;
`Wed — Upper Body` fits → **44px**. Adjacent rows in one card disagree by 13px and the
buttons don't line up. `Make up` is 73×**28**px and `Decline` 67×**28**px — both under
the minimum, side by side, one destructive.

**Fix:** `tap-slop` on both; `truncate` the program name so every row is one line.

### [ ] C5 · **P3** · Other sub-44px targets

`ExercisesClient.tsx:577-582` `+` is 40×40 (*measured*). Also below minimum with no
slop: `CyclesListClient.tsx:214`, `ProgramListClient.tsx:295`,
`CycleScheduleBuilder.tsx:64` & `:233`, `FriendsClient.tsx:130`,
`DeleteProgramButton.tsx:29`, `AdminTokensClient.tsx:286` (24px).

---

## Non-findings

Verified good; don't re-audit:

- **Page transitions** (`PageTransition.tsx`) — frozen router context, parallax,
  `transformTemplate` clearing to `none` so fixed sheets aren't trapped,
  `reducedMotion="user"`.
- **iOS auto-zoom prevention** — `globals.css:56-77`, fixed body plus
  `font-size: max(16px, 1em)` on all form controls.
- **Bottom-nav dots** rendered-then-hidden rather than conditionally mounted, to keep
  the hydration tree stable (`bottom-nav.tsx:100-110`). Intentional — and notably the
  right pattern for fixing W1.
- **Rest progress bar** animates `scaleX`, not `width` (`WorkoutSetsList.tsx:1508-1513`).
- Full-width submit buttons swapping `Save` → `Saving…` shift nothing.
- **No console errors anywhere except W1.**

---

## Reproducing this environment

`make dev` does not work in this pod: Docker is a **dind sidecar**
(`DOCKER_HOST=tcp://localhost:2375`), the Makefile calls the v1 `docker-compose` binary
while only the v2 `docker compose` plugin exists, and `pnpm` isn't on PATH.

```bash
corepack prepare pnpm@10.18.0 --activate       # lockfileVersion 9.0 wants pnpm 10
docker compose -f docker-compose.yml up -d postgres
# .env.local -> DATABASE_URL=postgresql://postgres:postgres@localhost:5432/logeverylift_db
pnpm install --frozen-lockfile
pnpm db:migrate && pnpm db:seed && pnpm db:seed-fake
npx next dev -H 0.0.0.0 -p 3000                # `pnpm dev` is deliberately blocked
/opt/ms-playwright/chromium-1228/chrome-linux64/chrome --headless=new \
  --remote-debugging-port=9235                 # for the browser MCP to attach
```

> **Side finding (not UI): account-creation scripts are broken.**
> `scripts/create-admin.ts:20` and `scripts/create-e2e-user.ts:30` both call
> `auth.api.signUpEmail`, which `src/lib/auth.ts:34` disables via
> `disableSignUp: true`. Both fail with *"Email and password sign up is not enabled"*,
> so a fresh database can't be bootstrapped with a login by the documented route — this
> blocks the `verify:full` / smoke-pass prerequisites on any new environment. The test
> account here was created via `auth.$context.internalAdapter`.

---

## Suggested order of work

1. **W0** — one `overflow-y-auto min-h-0`. Unblocks saving a set on iPhone SE.
2. **W1** — hydration mismatch; removes the only console error and a full list re-render.
3. **W2 + W2b** — one stable-height change, removes the 141px sheet jump.
4. **W3 + W4** — one coherent change to the suggestion block; kills the 40px and 86px
   jumps and restores "last time" context on completed sets.
5. **W5** — reorder or disable-in-place; 113px removed.
6. **W7 + W8** — make the two pickers agree, and stop committing on every keystroke.
7. **C2** — one volume formatter, used everywhere.
8. **C1, W9, W10, W11, W12, W13** — small, independent, batchable.
9. **B1–B6, C3–C5** — skeletons and ergonomics.
