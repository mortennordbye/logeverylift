# Plan tab: final design spec (hub decisions, 2026-11-14)

The look every Plan screen follows. The mockups in this folder (J*.dc.html) are drawn to it.

## Tokens (only these)
- bg #0b0b0c · card #161618 · inner/chip #222225 · line rgba(244,244,245,0.08)
- text #f4f4f5 · secondary #c4c4c9 · muted #8d8d93 (passes 4.5:1 on all three surfaces)
- accent var(--brand): primary button fill (dark text #0b0b0c), "now/next" marks, selected state. Nothing else.
- accent tint for selected chips: `color-mix(in oklab, var(--brand) 18%, transparent)` (the mockups draw it as blue rgba(107,149,255,0.18))
- bar segments: done = accent, next = accent, future = #707076 (≥3:1 on card). Current week = accent with 2px outline, never half opacity.
- destructive fill #c23a2e with white text (5.33:1). Destructive text-only buttons: #ff6b5a.
- No other colours. No badges that say "Endurance".

## Type
- Screen title: Big Shoulders Display 800, 40px, uppercase.
- Section label: 12px 600, letter-spacing 1px, uppercase, muted.
- Row title 15–16px 500/600; sub 13px muted.
- Big numbers (countdown, week): Big Shoulders 800.

## Shared parts (identical everywhere)
- Header: title left; right side = text button "Select" (only on the Plan list) and a 44px round accent + button.
- Detail header: BackLink "‹ Plan" left (44px), 44px "⋯" button right.
- Tab bar: 84px, #111113, top line; tabs Workout · Plan · Programs · More; Plan active in accent.
- Pinned bottom bar (forms/builders): #111113, top line, 16px padding, one full-width 52px primary button (accent, dark text). Tab bar is hidden on form screens.
- Step progress (2-step setup): "Step 1 of 2" muted label + 2-segment bar, on both steps.
- Bottom sheet: #161618, radius 20 top, grab handle, title row, content; screen behind dimmed rgba(0,0,0,0.6).
- Every tap target ≥44px high (chips included). Radio cards show a radio mark, not just a border.
- Real <button>/<a>/<input>/<label>; aria-label on icon buttons; inline stroke SVG icons.

## Words (use exactly)
- Tab and list title: "Plan". Program = one session template. Cycle = block of weeks. Season = long goal.
- Season prompt, everywhere: "Training for a race or a goal? Add a season".
- Schedule types: "Same days each week" / "Rotation".
- End options: "Just stop" / "Deload week" / "Start a new cycle" / "Rest period".
- Rotation length: "Repeats every 5 days" (rest days count as days).
- Phase types: General, Base, Build, Peak, Taper, Transition. Phase names have no type prefix
  (Jevnaker: "Aerobic base + strength" General 8 wk 16 Nov–10 Jan; "Longer ride and run" Base 12 wk 11 Jan–4 Apr;
  "Swim, intervals, bricks" Build 12 wk 5 Apr–27 Jun; "Race pace + open water" Build 53 days 28 Jun–19 Aug;
  "Taper" Taper 10 days 20–29 Aug). Race: A race "Jevnaker Halv Full Distanse", 29 Aug 2027, 288 days.
- Jevnaker General week 1: Mon Strength A · Tue Bike tempo 60 min · Wed Run aerobic 65 min · Thu Strength B ·
  Fri Rest · Sat Rest · Sun Long ride 2 h 15 (key) + Run off bike 20 min (brick).
- Gym example: rotation "Upper / Lower hypertrophy", 6 weeks, week 3, order Upper A, Lower A, Rest, Upper B, Lower B,
  last done Upper A, next Lower A; next cycle draft "Strength peak" 4 weeks starts 21 Dec; past "Strength 5×5" 8 weeks
  ended 8 Nov, "Intro" 4 weeks ended 13 Sep.
- Dates: "16 Nov", "Mon 16 Nov", "16 Nov 2026" when a year is needed. Never "Nov 16".
- No idioms, no designer notes inside the UI. No em dashes in UI copy.

## Plan list (final = A structure + C hero)
1. Hero card = the running (or next) cycle: label "Week 3 of 6 · Rotation" / "Starts Mon 16 Nov · Week 1 of 8";
   cycle name; weekday cycle → 7-day strip of the block week that holds today, from the block's start weekday
   (the same 7 days as the cycle detail; day, dot, short label, key day outlined in accent);
   rotation cycle → rotation chips from the detail's order (Done / Next / Skipped, a swapped session shows its program).
   Footer: "Lower A is next" and "Ends 20 Dec" (inclusive last day).
2. Season card (only when a season exists): name, race countdown "Race in 288 days" (goal season: "Goal by 1 Jun"),
   phase bar, then the phase rows inline (dot, name, "Base · 12 wk · 11 Jan – 4 Apr", "Starts Mon" on the next one),
   last row = the A race with a flag icon.
3. "Up next" (drafts not in a season), "Past cycles", then one quiet link "Recently deleted (1)".
4. No season: no season section; one dismissible line with the season prompt at the end.

## Endurance-only controls
Shown on endurance boards, absent on gym boards: Triathlon plan, Race section, + Add race, Key session, Brick link,
Use a workout, Did you do it? (unconfirmed), Complete automatically.

## Decisions after the final review
- Selected tint comes from the accent: `color-mix(in oklab, var(--brand) 18%, transparent)`, never a fixed blue.
- Missed key session: a move is suggested only inside the same Monday to Sunday week (`suggestMoveDay`); otherwise "No free day this week" and the plan goes on.
- "Did you do it?" opens as a sheet from a past unconfirmed row on cycle detail, and stays as the Home notice card.
- Cycle complete: no "Start now instead" when the next cycle starts the next day or another cycle is running; show "Next: <cycle> starts <day>" with a link to it.
- A start that ends the running cycle asks first in a confirm sheet that names it ("This ends Upper / Lower hypertrophy at week 3 of 6."), and names a scheduled start it drops ("Strength peak no longer starts Mon 23 Nov.").
- A missed key session's sheet on the cycle detail offers the same suggested day as home.
- Every Plan sheet closes on Escape and has a 44px Close button.
- Detail screens (cycle and season) all keep the tab bar, put Restart/Delete in the ⋯ menu with a confirm sheet, and use a 34px title.
- "After current cycle" start chip is shown only when a cycle is running.
