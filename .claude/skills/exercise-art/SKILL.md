---
name: exercise-art
description: Draw the animated front and side illustration (and primary/secondary muscles) for an exercise, as a pose spec in src/lib/exercise-art/specs/. Use when asked to illustrate, draw or animate an exercise, add exercise images, fill in missing exercise art, or run the exercise-art batch workflow. Not for the muscle-map shapes or the renderer itself.
---

# Drawing an exercise

An illustration is **data, not a picture**: joint positions for a start and an
end pose, in two views, plus the equipment and the muscles worked. The renderer
(`src/lib/exercise-art/scene.ts`) owns the look: tapered limbs, shading, the
user's accent colour for worked muscles, theme colours for the rest, and the
animation between poses. You never pick colours, sizes or styles. You pose a
fixed figure, the way an animator poses a rig.

One exercise is one file: `src/lib/exercise-art/specs/<slug>.json`, where the
slug is the exercise name in kebab case (`Barbell Curl` → `barbell-curl`).

## Procedure

1. **Look the exercise up** in `scripts/seed.ts` and copy its exact `name`,
   `muscleGroup` and `equipment`. `pnpm art todo` lists the ones not drawn yet.
2. **Start from the closest existing spec** in `specs/` (same stance, same
   equipment), not from scratch. `barbell-curl.json` is the standing reference.
3. **Pose both views**, keyframe 0 = the start of the rep, last keyframe = the
   other end of the range (see the rules below).
4. **Run `pnpm art check <slug>`.** It rejects stretched limbs, unknown or
   missing joints, joints below the floor or out of frame, then renders
   `.art-preview/<slug>.png`: front and side at t = 0, 0.5 and 1, in the dark
   and the light theme.
5. **Read the PNG and look at it.** Go through the checklist below. Fix and
   re-run until every row of it holds. A spec that passes `check` but looks
   wrong is not done.
6. Do not edit `specs/index.ts` by hand. When you are drawing one exercise on
   your own, finish with `pnpm art index` and `pnpm test src/__tests__/exercise-art.test.ts`.
   In the batch workflow the last stage does it once for everyone.

## The figure

The view box shows x 25–225, y 36–296. The floor is **y = 290**; standing feet
sit on it (ankle y ≈ 280, toe y ≈ 286). The head joint is the centre of a
radius-15 head. Bigger y is lower.

**Side view** faces **right** (the lifter looks toward +x). Joints:
`head, neck, shoulder, chest, hip, elbow, wrist, knee, ankle, toe`, plus the
far side `farElbow, farWrist, farKnee, farAnkle, farToe`. The far joints are
optional: left out, each one sits a few px behind its near twin, which is right
for any symmetric movement. Pose them yourself when the two sides differ
(a split squat, a one-arm row, a lunge).

**Front view** faces the viewer. `l*` is the limb on the **left of the screen**.
Joints: `head, neck, pelvis, lShoulder, rShoulder, lElbow, rElbow, lWrist,
rWrist, lHip, rHip, lKnee, rKnee, lAnkle, rAnkle, lToe, rToe`. Keep it mirror
symmetric around x = 125 unless the movement is one-sided.

**Bone lengths.** `check` fails any bone longer than its maximum. Shorter is
allowed, and expected when a limb points toward the viewer (the forearm in the
front view of a curl shrinks to about 28 at the top). Standing reference
lengths, which keep every exercise the same size:

| bone | side | front |
|---|---|---|
| upper arm (shoulder→elbow) | 46 | 46 |
| forearm (elbow→wrist) | 42 | 42 |
| thigh (hip→knee) | 60 | 60 |
| shin (knee→ankle) | 56 | 56 |
| hip→chest / chest→neck | 40 / 38 | pelvis→neck 76 |
| neck→head | 24 | 24 |
| foot (ankle→toe) | 21 | 9 (seen end-on) |

Keep each bone the **same length in every keyframe of a view** unless it turns
toward or away from the viewer. The animation swings bones round their joints,
so a length change reads as a limb growing.

**Anchor.** `anchor` names the joint that stays put while the body moves round
it: `ankle` / `lAnkle` for anything standing, a wrist for a hang (pull-up),
`hip` / `pelvis` for seated or lying work. Pick the joint that does not move in
real life, or the feet will skate.

**Keyframes.** The first keyframe lists every required joint. Later keyframes
list only the joints that move; the rest carry over. Use two keyframes. Add a
middle one only when the path between start and end is not a simple swing
(a clean, a get-up), since the animation goes start → middle → end and back.

## Equipment (`props`)

| type | fields | drawn as |
|---|---|---|
| `barbell` | `at` (default both wrists) | bar and plates across the joints (front), a plate at them (side) |
| `dumbbell` | `at` (default both wrists) | one dumbbell per joint |
| `kettlebell` | `at` | one bell hanging below the midpoint of the joints |
| `bench` | `x, y, w` | pad with its top-left at x, y; legs to the floor |
| `bar` | `x1, x2, y` | fixed bar; x1 = x2 draws it end-on (side view of a pull-up bar) |
| `cable` | `anchor: [x, y], at` | line from a pulley to a joint |
| `box` | `x, y, w, h` | box or platform |

Each prop takes an optional `layer`: `back` (behind the figure, the default for
benches, bars, cables and boxes), `mid` (behind the near arm, the default for
held weights, so the hands sit over the bar) or `front`. A back squat puts the
barbell `at: ["neck"]` in the side view and `at: ["lShoulder", "rShoulder"]` in
the front view.

## Muscles

- `primary`: one muscle, normally the exercise's `muscleGroup` in the seed. If
  the seed is clearly wrong, use the right one and say so in your result.
- `secondary`: zero to three muscles that do real work. Not every stabiliser.
- Allowed: chest, back, shoulders, biceps, triceps, forearms, quads,
  hamstrings, glutes, calves, abs, lower_back.

The renderer lights a limb when one of its muscles is primary (accent) or
secondary (dimmed accent). Upper arm: biceps, triceps, shoulders. Forearm:
forearms. Thigh: quads, hamstrings, glutes. Shin: calves. Side torso: chest and
back (upper), abs and lower_back (lower). Front torso: chest plate, abs, lats
(back) and the shoulder caps.

## Words

- `cue`: one or two short sentences on the thing people get wrong. Plain
  words, no em dashes, no hype. "Keep your elbows pinned to your sides." beats
  "Engage your core for maximum gains!".
- `phases`: two labels for the way out and the way back, verbs: ["Curl",
  "Lower"], ["Press", "Lower"], ["Pull", "Return"], ["Stand", "Squat"].

## Checklist (read the PNG)

- [ ] The pose is recognisable as this exercise from either view alone.
- [ ] Start and end match the real range of motion (depth, lockout, bar path).
- [ ] Feet stay planted and on the floor; nothing floats or sinks.
- [ ] No limb bends the wrong way (knees and elbows bend forward/back correctly
      for the view).
- [ ] Hands are on the bar, handle or bell; the body sits on the bench, not
      through it.
- [ ] The front view is symmetric (unless the movement is one-sided).
- [ ] The t = 0.5 frame looks like a real mid-rep position, not a limb passing
      through the body.
- [ ] The accent lands on the right muscles in both views and both themes.
- [ ] Everything is inside the frame, including plates and the head.
