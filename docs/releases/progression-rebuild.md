# Release notes: the progression rebuild

<!-- doc-claims: skip -->

> **Audience:** the people using the app, not the people who built it. Keep it in
> that voice. The engineering record is [`../progression-revamp-plan.md`](../progression-revamp-plan.md).
>
> **These are owed on the day this ships, not after.** Every item below changes a
> number somebody is already looking at. A number that moves with an explanation
> is a fix; the same number moving without one is a bug report.

Progression has been rebuilt. The short version: **the app used to fill in things
you never told it, and it has stopped.** Most of what follows is a consequence of
that, and most of it will look like the app got *stricter* or your numbers got
*worse*. They did not. They got honest.

## Your numbers will move on the first load. Here is why.

### Volume drops

Every volume figure in the app — the charts, the session totals, the friend
leaderboards — was calculated from the reps you were *prescribed*, not the reps
you did. Tapping a set as done wrote the target back as your result, so planned
volume was being shown to you as achieved volume.

Now a set records what you actually did. If you have ever missed a rep, your
volume goes down. Nothing that already happened has been altered — history is
what was recorded at the time, and rewriting it to keep the charts smooth would
be the same problem in a different place.

### Some exercises will stop progressing, and some will start

Three separate changes pull in different directions:

- **The app used to assume how hard every set felt.** A tap recorded "3 reps left
  in the tank" whether or not you said so, and that assumption was good enough to
  count as progress. It is gone. If you have been grinding out sets that the app
  quietly discounted, those now count and you will see bumps you were not getting.
- **Progression is now judged per workout, not per set.** On a 4x12 each set used
  to bank its own progress, so an exercise could creep upward while its last set
  kept falling short — and the four sets could drift to different weights. Now the
  whole exercise moves together, and every working set has to clear. Exercises
  that were about to bump may hold instead. That is the fix working.
- **A workout you marked "Tired" counts again.** It used to be dropped entirely,
  which meant reporting fatigue honestly froze your progression and showed you
  numbers from weeks ago. Now a tired session's *successes* count normally and
  only its shortfalls are set aside.

### Every suggested weight jump changes size

Two corrections, and between them almost everyone's increments move:

- If your profile has an experience level, you were getting a flat number that
  ignored the lift — 5 kg on lateral raises for a beginner, 1.25 kg on a heavy
  deadlift for an advanced lifter. The jump is now sized by the lift first, and
  your experience adjusts it.
- Suggestions now land on weights your equipment can actually make. A 1.25 kg
  jump on a barbell means 0.625 kg a side, which almost nobody owns.

### Rep-only exercises stop dropping the weight

An exercise set to add *reps* used to back the *weight* off when the reps
stalled, which is progressing one thing and regressing another. It holds now.

### Generated triathlon plans start asking for effort

Those plans have always prescribed reps-in-reserve on their strength work. The
app never read it. It does now — so those exercises wait until you log how hard
the set was before they move. There is a one-tap prompt after the last set of any
exercise that asks.

## Things that are new

- **A rep range.** Set an exercise to work 8 to 12 reps: add reps until you reach
  the top, then the app adds weight and drops you back to the bottom.
- **A long press on a set's toggle** records what actually happened — reps and
  effort — instead of a trip through the set editor to find "mark failed".
- **Tap the progress dots** on any exercise to see the last five workouts, one by
  one, and why each did or did not count.
- **Named schemes.** The progression sheet offers them by name, with a plain
  sentence underneath saying exactly what the app will do. If the sentence does
  not describe what you want, the settings under it are all editable.
- **Coming back from a break** no longer opens with a suggestion to add weight to
  a lift you have not touched in three months.

## Personal records

Records for "estimated 1RM" and "reps at weight" were calculated from those
assumed reps too, so some of them are higher than what you actually lifted. They
have been kept, and they are marked *set before reps were logged individually*.
They still count and beating one is still a real record — but if one of them
looks unbeatable, now you can see why.

Estimated-1RM records also now require that you logged the set as a hard one. An
estimate built on a set you stopped four reps short of failure was never a
one-rep max.
