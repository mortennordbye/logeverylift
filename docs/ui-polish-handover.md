# Handover — in-workout layout-shift fixes

Companion to `docs/ui-polish-audit.md`. That file is the evidence: 22 measured
findings. This file is the handover: **what changed, how to see it yourself, what I
deliberately left, and where the traps are.**

Branch: `ui/workout-layout-shift`. 8 files, ~337 insertions / 161 deletions. No schema
changes, no migrations, no new dependencies.

---

## TL;DR

The brief was "the main feel during a workout — all the different inputs, how they move
and how they shift the screen." I measured every control between starting and finishing
a workout, then fixed the whole in-workout cluster: **15 findings, all verified with
before/after numbers.**

The headline is not a polish item. **On iPhone SE / iPhone 8 (667px tall) you could not
save a set edit at all** — the Save button was below the fold with no scroll container,
and hit-testing proved every pixel of it was covered by the bottom nav.

---

## Run it on your laptop

The standard path works on a normal machine — this sandbox needed workarounds that you
won't:

```bash
make dev            # or: make dev SKIP_BUILD=1
```

Then log in and go to a program's workout screen. If you need seeded data:
`pnpm db:seed && pnpm db:seed-fake` (the fake seed builds two programs, a 12-week cycle
and 4 weeks of history, which is what all the numbers below were measured against).

> **You will hit one snag creating a login on a fresh DB.** `pnpm create-admin` and
> `scripts/create-e2e-user.ts` are both broken — they call `auth.api.signUpEmail`, which
> `src/lib/auth.ts` disables via `disableSignUp: true`. Pre-existing, unrelated to this
> work, written up in `BACKLOG.md`. I worked around it with
> `auth.$context.internalAdapter`.

---

## See each fix with your own eyes

Ordered by how convincing they are to look at. Screenshots referenced are in
`.playwright-mcp/` (gitignored, so they're not in the branch — regenerate by repeating
the steps).

### 1. The Save button you couldn't reach (W0) — the important one

**Where:** any workout set → tap a set row → the Edit Set screen.
**How to see the bug:** in devtools set the viewport to **375×667** (iPhone SE) and load
that screen on `main`. The Save button is gone, the note field is sliced by the bottom
nav, and nothing scrolls. On the branch, the content scrolls and Save sits above the nav.

Measured at 375×667: Save was at `top 634 / bottom 690` in a 667px viewport, with
`elementFromPoint` returning the nav link at every y across its visible sliver
(`anyProbeHitsSave: false`). After: `top 531 / bottom 587`, all probes hit the button,
103px of content scrolls. At 390×844 nothing moved (Save still at 708) — the fix is
inert on tall phones.

**The subtle part:** `min-h-0` on the flex child is load-bearing. A flex item defaults to
`min-height: auto` and refuses to shrink below its content, so `overflow-y-auto` alone
does nothing. Don't "tidy" it away.

### 2. Your original complaint — the progression sheet (W2)

**Where:** set list → tap the progression badge (`↑ +2.5kg` / `Manual`) → pick **Weight**.

Before, selecting a mode mounted the "Weight increment" block into a bottom-anchored
sheet, which could only grow *upward*: the row you had just tapped travelled **141px**
up the screen (top 396 → 255) and your finger ended up over "Smart weight". After:
switching weight → manual → reps → weight, the sheet holds `top 73 / height 675` and
every row stays put. **Zero movement.**

**Read this before touching it again:** the obvious fix (`h-[80vh]` instead of
`max-h-[80vh]`) is wrong and I backed it out. It's fine for a strength exercise, whose
sheet is already at the cap, but a timed or running exercise only has two modes, so it
produced a mostly-empty 675px card. The shipped fix stacks the increment sections into
one CSS grid cell, filtered to the sections that exercise can reach
(`incrementSections` in `WorkoutSetsClient.tsx`). The area is then as tall as the
tallest section it could ever show, so swapping modes changes only which one is
visible. Strength sheet 675px, timed sheet 259px, both constant.

Cost to be aware of: on a strength exercise in "Manual" mode there is now reserved
space where the increment block will appear. It sits inside the sheet's scroll area at
the cap, so you don't see dead space — but if you ever add a much taller increment
section, check it again.

### 3. Tapping a suggestion no longer collapses the row (W3, W4)

**Where:** set list for an exercise with progression on. Tap `↑ 85kg`, then tick a set.

- **Applying:** the chip used to unmount on the very tap that applied it — and because
  the suggestion propagates to sibling sets, two rows collapsed at once and everything
  below rose **40px**. Now the chip stays in place and becomes **`✓ 85kg`**, dimmed.
  All four rows measured at **zero delta**.
- **Ticking a set:** used to unmount the whole suggestion block (the `Last: 81.77kg
  (OK, RPE 7)` line and the chips), shrinking the row 104 → 62px. Ticking set 3
  catch-up-logs sets 1–2, so three rows collapsed at once and row 4 jumped **86px**.
  Now: **zero movement**, and completed sets keep their "last time" context instead of
  throwing it away exactly when you'd compare against it.

Compare `.playwright-mcp/audit-11-setlist-after-tick.png` (before) with
`fix-05-setlist-after-tick.png` (after) if you regenerate them.

**Design call you may want to overrule:** I chose "chip stays, turns into ✓" over the
cheaper "reserve a min-height for the chip row". The settled chip preserves height
*and* gives the tap the only confirmation it has ever had — previously the sole feedback
was the summary number changing. If you'd rather completed sets showed no chips at all,
the gate is one condition in `WorkoutSetsList.tsx`, but you'd get the 86px jump back
unless you also reserve the height.

### 4. "Mark set as failed" no longer runs away from your finger (W5)

**Where:** Edit Set on a strength set in a workout → tap *Mark set as failed*.

The toggle sat *below* the "Reps in reserve" block and unmounted it, so the button threw
itself **113px** up the screen — an immediate second tap to undo landed on whatever slid
into its place. It now sits *above* that block, so the reflow happens entirely below the
control being tapped. Measured: top 295 before, during and after toggling. **Zero.**

I moved the control rather than keeping RIR mounted-but-disabled: a greyed RIR row for a
failed set is meaningless (failure implies RIR 0), and reordering is the smaller change.

### 5. The two number pickers now agree (W7)

**Where:** Edit Set → tap **Reps**, type. Then tap **Weight**, type.

They used to fail in opposite directions, because their auto-scroll effects had
different dependency arrays:

| | before | after |
| --- | --- | --- |
| Reps | row lurched `scrollLeft` 0 → 1162 → 0 on a single keystroke | still while typing |
| Weight | row never moved; selected circle ended up **off-screen** | still while typing |

Both now centre the selection **on commit** (picker open, or blur) and stay still while
you type. Verified: reps `scrollLeft` held at 369 through typing, then smooth-scrolled
to 1162 on blur with the selected `25` on screen; weight held at 2689 while typing
`100`, then moved to 3258 with `100kg` on screen.

### 6. Clearing a number field no longer commits a zero (W8)

**Where:** Edit Set → Reps → select-all and delete.

Every keystroke wrote straight through, so clearing the field to type a new number left
the set at **`Reps 0`** — and it stuck if you dismissed the sheet there. I watched it
happen. Now an empty field is treated as mid-edit; `onBlur` still normalises. Same fix
on the duration minutes/seconds fields.

The weight field already guarded this (`if (!isNaN(n))`), which is why it never had the
bug — worth knowing if you wonder why it looks inconsistent in the diff.

### 7. Smaller ones you'll notice once you know

- **W1 — exercise summaries stopped flipping after load.** With any applied override,
  opening the workout screen used to render program numbers, then swap to your adjusted
  numbers a beat later, because React hit a hydration mismatch and *discarded and
  re-rendered the entire exercise list*. It was the only console error in the app. Now
  clean, and the overrides still apply — check the console on the workout screen.
- **W11 — the "Workout" title is actually centred.** It sat 4px off in both states and
  slid 8px every time you toggled Edit. Now exactly at viewport centre, zero slide. Same
  fix on the "Edit Set" header, whose right spacer was a fixed `w-16` against a
  variable-width back link.
- **W10 — `Last: (OK)` → `Last: OK`.** Timed sets have no `basedOn*` value, so the
  template rendered bare parentheses. Visible on every Plank set.
- **W12 — the rest countdown stopped breathing.** `REST 01:29` re-rendered every second
  without `tabular-nums` while every other live number in the app had it.
- **W13 — the Type row stopped twitching** while its save spinner mounts.
- **W9, W14 — picker scrollbars hidden** (matching `NewSetView`, which already did it)
  and `tap-slop` on two sub-44px workout controls.

---

## Verification I actually ran

- `pnpm verify` — typecheck, lint, **363 unit tests**, all green.
- **Playwright e2e: 5/5 passed** — `log-set`, `rest-picker`, `exercise-timer`,
  `exercise-timer-delay`, plus auth setup. These cover precisely the flows I changed.
- Per-fix before/after geometry measured in-browser with `getBoundingClientRect` and
  `elementFromPoint`; the numbers above are the measurements, not estimates.

**Caveat, please don't skip:** the e2e suite is configured for **WebKit** (iPhone 14
Pro). WebKit can't be installed in this container — it needs `libhyphen`, `libsecret`
and `libwoff2dec`, which need root. I ran the same specs at the same viewport on
**Chromium** via a throwaway config. That is real regression coverage but it is **not**
the WebKit run. Please run `pnpm verify:full` once on your laptop before pushing —
that's the gap I can't close from here.

**Also untested:** the soft keyboard. Headless Chrome doesn't raise one, so none of the
`BottomSheet` / `ViewportFix` keyboard plumbing was exercised. This matters more than
usual now: W0 introduced a scroll container on the set-edit page where there was none,
and `ViewportFix.findScrollableParent` walks up looking for exactly that to scroll a
focused input above the keyboard. Before this change it found nothing, so that
correction could never fire on this screen; now it will. **Tap the note field on a real
phone** and check nothing jumps.

---

## What I deliberately did not do

All written up in `BACKLOG.md`:

- **W6 — auto-carried weight still lands as a delayed text change.** The *shift* half is
  gone (row heights are stable now), leaving a lagging text update. Fixing the lag
  properly means deciding whether the carried weight should persist to the **program**
  (as it does today) or only to the session — a semantics decision, not a UI one, and
  you didn't ask for it.
- **Part 2 of the audit — 12 open findings** outside the workout flow: `/exercises`
  loads a skeleton for a different screen entirely, the dashboard skeleton is a bare
  header, metrics puts its tab bar in the wrong scroll layer, three different volume
  formats coexist (History shows `4,357.66kg`), the activity heatmap opens on the
  oldest, empty weeks. Each has a measurement and a proposed fix.
- **The broken account-creation scripts** (see above).
- **A hydration question I could not verify:** `SetEditView` seeds its fields from
  overrides in `useState` initialisers, which run once. On a *cold load of a set-edit
  URL* those may run before overrides are restored from localStorage. I didn't exercise
  that case and I'm not going to assert it's broken — the backlog entry says how to
  reproduce it in one step.

---

## Where the traps are

Three things in this diff will look wrong to a reviewer who wasn't here:

1. **`min-h-0`** in `SetEditView` / `NewSetView` looks redundant next to
   `overflow-y-auto`. It isn't — without it the flex child won't shrink and nothing
   scrolls. This is the whole W0 fix.
2. **`useRenderedOverrides`** (in `workout-session-context.tsx`) looks like a pointless
   wrapper around `overrides`. It's a `useSyncExternalStore` with a `getServerSnapshot`
   returning `false`, which is what forces the hydration render to match the server
   HTML. Use it for **rendered output only** — anything that writes to the database
   (logging a set, flushing a note) must keep reading `useWorkoutSession().overrides`
   directly, or it will see `{}` and write the wrong numbers. Both call sites are
   commented to that effect. This is the same hazard `bottom-nav.tsx` documents for its
   dots.
3. **The `invisible` increment sections** in the progression sheet look like dead
   render work. They're the height reservation — see fix #2 above.
