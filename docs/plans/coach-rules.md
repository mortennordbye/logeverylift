# Coach rules in the MCP instructions

Status: approved 2026-11-23, built on `feat/coach-rules`. The text is now 3,668 characters (write access).

## Why

In a coaching chat on 2026-11-23 the coach:

- said it could not see sleep data, but `get_garmin_status` has sleep, HRV and resting HR. It
  did not read that tool before it gave advice.
- agreed with the athlete's own cause ("Monday is too heavy") before it looked for data against
  it.

The cause is in how the instructions reach the model. `serverInstructions()`
(`src/lib/mcp/instructions.ts:63`) returns 14,086 characters. Claude Code shows only the first
4,096 and adds "[truncated]". The cut falls inside the "Planned vs done" line of the app
section. So the model never sees the training limits, revisions, access level, the weekly
review (which says "read get_garmin_status") or the resources line.

| Section | Characters | Seen in Claude Code |
|---|---|---|
| app (data model) | 9,382 | first 4,096 only |
| owners | 564 | no |
| limits | 2,041 | no |
| revisions | 699 | no |
| missing | 140 | no |
| access | 77 | no |
| weekly review | 867 | no |
| resources | 302 | no |

## What changes

1. A new **Coach rules** section comes first. The wording to settle:

   > Coach rules (these come first: some clients show only the start of these instructions).
   > 1. Read before you advise. Before your first advice in a conversation, read
   >    get_coach_memory, get_athlete_profile and, if Garmin tools are listed, get_garmin_status
   >    (sleep, HRV, resting HR, readiness). Never say the app has no data on something before you
   >    read the tool that holds it.
   > 2. Name the gaps. Say which data you did not read or the app does not have (for example no
   >    RIR logged), and how sure that makes you.
   > 3. Test the athlete's cause. When the athlete names a cause or a fix ("Monday is too heavy",
   >    "the run made me sick"), look for data against it first. Then give a verdict: supported,
   >    not supported or unknown, with the numbers.
   > 4. Hold a verdict that the data supports. Change it on new data, not because the athlete
   >    pushes back, and say what changed it.
   > 5. Advice is not a change. Change the plan only when the user asks.

2. The whole text gets shorter than 4,096 characters, so every client sees all of it. The long
   app section becomes a short map: one line per area with its main tools, and a pointer to
   `logeverylift://docs/app-rules` for the details. The limits and revisions sections get
   shorter in the same way.
3. Each detail that leaves the instructions must already be in `docs/mcp/app-rules.md` or in the
   tool's own description. If it is in neither, it goes into `docs/mcp/app-rules.md`. Nothing is
   lost, it only moves.
4. A unit test in `src/__tests__/mcp-resources.test.ts` checks:
   - the text is at most 4,096 characters for read and write access
   - it starts with the coach rules
   - the names it checks today are still there (weekly review, expectedVersion,
     restore_revision, get_athlete_profile, manage_thresholds, intake_interview)

## Before and after

Before (what Claude Code shows the model):

```
LogEveryLift is a training log ...            <- 4,096 characters of data model
- Planned vs done: ... a past on… [truncated]
(limits, revisions, access, weekly review, resources: not seen)
```

After:

```
Coach rules ... (5 rules)                      about 1,100 characters
LogEveryLift in short: one line per area       about 1,500 characters
Limits, revisions, access: short               about 800 characters
Weekly review, resources                       about 600 characters
                                               total under 4,096, nothing cut
```

## What does not change

- No tool, schema, database or app screen changes. Only the instruction text, the app-rules
  doc and one test.
- The training limits stay in code. They refuse writes as they do today.
- The tool descriptions stay as they are.

## Steps

1. Write the coach rules section and put it first. Check: the test for "starts with the coach
   rules" passes.
2. Shorten the app, limits and revisions sections. For each line that leaves, confirm it is in
   `docs/mcp/app-rules.md` or the tool description, or add it there. Check: the length test
   passes.
3. Run `pnpm verify`.
4. PR, CI, merge, deploy check. This is a text change in the MCP route only. It is not a
   critical flow, so there is no smoke pass or journey review.

## How the owner checks the result

1. Start a new Claude Code session after the deploy. The logeverylift instructions show in full,
   with no "[truncated]".
2. Ask the coach: "Monday's strength is too heavy, right?" Expected: it reads memory, profile and
   Garmin status first, gives a verdict (supported, not supported or unknown) with numbers, and
   says that RIR is not logged.

## Not in this change

RIR prompt on the last working set, illness history with the 7 days before each period, and
coach test conversations. These go to the backlog if the owner wants them.
