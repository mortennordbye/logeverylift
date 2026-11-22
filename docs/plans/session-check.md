# Session check

Build brief, agreed with the owner on 2026-11-22. Pictures:
[`docs/design/session-check/plan.html`](../design/session-check/plan.html) (open it in a browser).
Build to the pictures.

## What

After each bike or run session the user sees which Garmin activity the app matched it to, and each
target of each step against what they did: power, heart rate, cadence, pace and time. A home widget
shows the last day with sessions; a step page shows every step of any done session, for good; the
planned session and the program's exercise page show the match, with Pick when nothing is matched.

## Decisions (settled, do not re-ask)

1. **One judging rule** for every metric, in a pure util: `in`, `over`, `under`, or `none` (no target
   or not judged).
   - In when the step's average is inside the range; over or under only past a margin: 3 W, 2 bpm,
     2 rpm or spm, 5 s per km.
   - A cap (only a high end, "HR under 162") passes when the average is under it.
   - Heart rate is not judged on steps under 3 min.
   - Time: in within 10 % of the planned length (the Plan colours' idea, per step).
   - Pace outside is shown, not judged (heart rate leads outside, see docs/plans/strict-targets.md).
   - Warm-up, recovery, rest and cool-down show time only.
   - A whole session's verdict (widget) uses the work steps only.
2. **Marks** are words and arrows: "✓ in", "↑ over", "↓ under". Only over and under are highlighted
   (the accent colour); everything else neutral. No green or red.
3. The existing ride and run summaries (`rideSummary`, `runSummary`) use the same rule, so they also
   show "over" and judge HR and cadence.
4. **The match is shown** on the planned session page (`/planned/[id]`), and on the program's exercise
   page after the session: a block with Program ›, Logged (in the app · ride mode / run mode, or on the
   watch), Garmin (activity name · start time · duration ›, linking to the Garmin activity page), the
   fill line ("Numbers filled from Garmin · split by laps / by time") and "See every step ›".
5. **No match yet:** "Not matched · N <sport> that day" with **Pick**, listing that day's Garmin
   activities of the sport; picking stores it (the existing `pick` operation the MCP tool uses).
   Garmin parts show only where `garminAllowedFor` is true.
6. **The match is kept:** for a session the app logged and Garmin filled, the activity comes from the
   ride's fill (`ride_garmin_fills`); for an app workout that took a Garmin activity of the day, the
   `takenByApp` activity in `sessionCompliance` is returned, not dropped; for pick and garmin matches,
   as today.
7. **Step page** for any done bike or run session, kept for good (not the 12 h window): reached from the
   widget, the planned session, and History. One card per step with each target the plan had.
8. **Watch-only sessions:** split the Garmin activity into the planned steps by laps when the lap count
   equals the step count, else by the planned step times (reuse `splitRide` in
   `src/lib/utils/ride-stream.ts`).
9. **Home widget "Last session"**: the last day with done bike or run sessions, one card per session
   (a Sunday ride and brick run are two). On by default for endurance users. Each card: name and day,
   the match line, power, heart rate, cadence (bike) or heart rate, cadence, pace (run), and time, each
   with its mark, judged over the work steps; "See every step ›".

## Work, in order

1. **Judging and the step page** (one PR): the judging util with unit tests; `rideSummary` and
   `runSummary` use it; the step page route and its data (from `rideReport` / `runReport` where a ride
   exists, else the watch-only split); links from History.
2. **The match** (one PR, in parallel with 1): keep the activity per decision 6; a server function that
   returns a session's match (planned session id → logged how, Garmin activity id, name, start, duration,
   fill method); the block on the planned session page and the program's exercise page; Pick.
3. **The widget** (after 1 and 2): def, load, View, sample, tests, following
   `docs/home-widgets-audit.md` (recipe) and the `garmin-readiness` / `training-load` widgets.

## Tests

Unit for the judging rule (each margin, cap, short step, time, pace outside, work-only verdict) and the
split; integration for the match (each matchedBy path, the takenByApp activity, own rows only, Pick);
component for the block, the step page and the widget; e2e: a done ride shows the match and the step
page. Journey review at 390 and 320 px.

## Out of scope

Live sensors, swim, changing the matching rules or the Plan colours.
