---
name: exercise-art
description: Draw the animated front and side illustration (and primary/secondary muscles) for an exercise, as a pose spec in src/lib/exercise-art/specs/. Use when asked to illustrate, draw or animate an exercise, add exercise images, fill in missing exercise art, or run the exercise-art batch workflow. Not for the muscle-map shapes or the renderer itself.
---

# Drawing an exercise

An illustration is **data, not a picture**: a 3D pose of a fixed skeleton at
the start and the end of a rep, plus the equipment and the muscles worked. The
renderer (`src/lib/exercise-art/scene.ts`) owns the look: it projects the one
3D pose into a front view and a side view, draws tapered limbs, colours worked
muscles with the user's accent and the rest with theme colours, and animates
between the poses by turning each bone round its joint. You never pick
colours, sizes or styles. You pose a fixed figure, the way an animator poses a
rig.

One exercise is one file: `src/lib/exercise-art/specs/<slug>.json`, where the
slug is the exercise name in kebab case (`Barbell Curl` → `barbell-curl`).

## Procedure

1. **Look the exercise up** in `scripts/seed.ts` and copy its exact `name`,
   `muscleGroup` and `equipment`. `pnpm art todo` lists the ones not drawn yet.
2. **Start from the closest existing spec** in `specs/` (same stance, same
   equipment), not from scratch. `barbell-curl.json` is the standing reference.
3. **Pose it**: keyframe 0 = the start of the rep, the last keyframe = the
   other end of the range (rules below).
4. **Run `pnpm art check <slug>`.** It rejects bones of the wrong length,
   missing joints, joints below the floor or out of frame, then renders
   `.art-preview/<slug>.png`: front and side at t = 0, 0.5 and 1, in the dark
   and the light theme.
5. **Read the PNG and look at it.** Go through the checklist below. Fix and
   re-run until every row holds. A spec that passes `check` but looks wrong is
   not done; t = 0.5 is where a bad path shows.
6. Do not edit `specs/index.ts` by hand. When you are drawing one exercise on
   your own, finish with `pnpm art index` and `pnpm test src/__tests__/exercise-art.test.ts`.
   In the batch workflow the last stage does it once for everyone.

## The skeleton (3D)

Axes: **x** across the body (the front view's screen x; `l*` joints have the
smaller x), **y** down (floor at **y = 290**), **z** forward, the way the
lifter faces. The body's centre line is x = 125, z = 0. The front view shows
(x, y); the side view looks from the `r*` side with the lifter facing right and
shows (125 + z, y). Both must fit x 25–225, y 36–296, so keep z within ±100.

Joints: `head` (centre of a radius-15 head), `neck` (base of the neck),
`chest` (mid spine), `pelvis`, and `lShoulder rShoulder lElbow rElbow lWrist
rWrist lHip rHip lKnee rKnee lAnkle rAnkle lToe rToe`.

**Bone lengths are fixed** and `check` holds every keyframe to them within 3%:

| bone | length |
|---|---|
| pelvis→chest / chest→neck / neck→head | 40 / 38 / 24 |
| neck→shoulder | 23 |
| shoulder→elbow / elbow→wrist | 46 / 42 |
| pelvis→hip | 12 |
| hip→knee / knee→ankle / ankle→toe | 60 / 56 / 21 |

Work out a joint from its parent: parent + length × a unit direction. Standing
upright, the reference pose in `barbell-curl.json` already has every length
right; move limbs by rotating them, not by nudging single coordinates.

**Anchor.** `anchor` names the joint that stays put while the body moves round
it: `lAnkle` for anything standing, a wrist for a hang (pull-up), `pelvis` for
seated or lying work. Pick the joint that does not move in real life, or the
feet will skate.

**Keyframes.** The first keyframe lists every joint. Later keyframes list only
the joints that move; the rest carry over. Use two. Each bone turns along the
shortest arc between its two directions, so a bone that turns close to 180°
(an arm going from straight down to straight overhead) can take the wrong
side: add a middle keyframe there, which also suits paths that are not one
swing (a clean, a get-up). The animation goes start → middle → end and back.

## Equipment (`props`)

| type | fields | drawn as |
|---|---|---|
| `barbell` | `at` (default both wrists) | bar along x through the joints' midpoint: plates at the ends (front), a plate (side) |
| `dumbbell` | `at` (default both wrists), `along` `x` (overhand, default) or `z` (neutral grip) | one dumbbell per joint |
| `kettlebell` | `at` | one bell hanging below the joints' midpoint |
| `bench` | `y, z1, z2, width` | pad with its top at y, from z1 to z2, `width` across; legs to the floor |
| `box` | `y, z1, z2, width` | solid box or step from y down to the floor |
| `bar` | `y, z` | fixed bar along x (pull-up bar, rack) |
| `cable` | `anchor: [x, y, z], at` | line from a pulley to a joint |

Held weights sort by depth with the body (the near hand stays over the bar).
Benches, boxes, bars and cables sit behind the figure. Any prop takes `layer`:
`auto`, `back` or `front` to override. A back squat puts the barbell
`at: ["lShoulder", "rShoulder"]` with the shoulders' z a little behind 0.

## Muscles

- `primary`: one muscle, normally the exercise's `muscleGroup` in the seed. If
  the seed is clearly wrong, use the right one and say so in your result.
- `secondary`: zero to three muscles that do real work. Not every stabiliser.
- Allowed: chest, back, shoulders, biceps, triceps, forearms, quads,
  hamstrings, glutes, calves, abs, lower_back.

The renderer lights a limb when one of its muscles is primary (accent) or
secondary (dimmed accent). Upper arm: biceps, triceps, shoulders. Forearm:
forearms. Thigh: quads, hamstrings, glutes. Shin: calves. Side torso: chest and
back (upper), abs and lower_back (lower), glutes (seat). Front torso: chest
plate, abs, lats (back) and the shoulder caps. The muscle map next to the
figure (`muscle-map.ts`, preview with `pnpm art map`) uses the same muscles.

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
- [ ] Front and side agree: each limb is where the other view says it is.
- [ ] No limb bends the wrong way (knees and elbows bend forward/back correctly
      for the view).
- [ ] Hands are on the bar, handle or bell; the body sits on the bench, not
      through it.
- [ ] The front view is symmetric (unless the movement is one-sided), and no
      limb swings through the body on its way between poses.
- [ ] The t = 0.5 frame looks like a real mid-rep position, not a limb passing
      through the body.
- [ ] The accent lands on the right muscles in both views and both themes.
- [ ] Everything is inside the frame, including plates and the head.
