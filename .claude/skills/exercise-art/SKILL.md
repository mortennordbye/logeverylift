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
   equipment), not from scratch. References: `barbell-curl.json` (standing,
   free arm swing), `squat.json` (standing, hips and knees moving, bar racked
   on the shoulders) and `bench-press.json` (lying on a bench, top camera,
   held hands on a pressed bar).
3. **Pose it**: keyframe 0 is where the lifter sets up before the first rep
   (lockout for a bench press or squat, arms hanging for a curl, bar on the
   floor for a deadlift); the last keyframe is the other end of the range.
   `phases[0]` names the move from keyframe 0, `phases[1]` the way back.
4. **Run `pnpm art check <slug>`** (add `--zoom` for a 2x preview, which you
   need to judge contact: body on a pad, hands on a bar; add `--joints` to
   print where every joint ends up once bone lengths are applied). It rejects
   missing joints, a joint far off its bone, joints below the floor or out of
   frame, hands sliding along a barbell or coming off a racked bar mid-rep,
   and feet sinking mid-rep, then renders `.art-preview/<slug>.png`: both
   views at t = 0, 0.5 and 1, a dark-theme row and a light-theme row.
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

**Camera.** `"camera": "top"` replaces the front view with a view from above,
showing (x, 166 + z). Use it for anything done lying down (bench press, floor
press, skull crusher, crunch): seen from the feet, a lying body is end-on and
the worked muscles hide behind the thighs.

Joints: `head` (centre of a radius-15 head), `neck` (base of the neck),
`chest` (mid spine), `pelvis`, and `lShoulder rShoulder lElbow rElbow lWrist
rWrist lHip rHip lKnee rKnee lAnkle rAnkle lToe rToe`.

**Bone lengths are fixed**, and applied for you: each keyframe is rebuilt
outward from the anchor, every joint placed at its exact bone length in the
direction you gave it from its parent. So a joint only has to point the right
way; `check` flags one that sits more than 15% of its bone off (a typo or the
wrong joint). The lengths, for working out positions:

| bone | length |
|---|---|
| pelvis→chest / chest→neck / neck→head | 40 / 38 / 24 |
| neck→shoulder | 23 |
| shoulder→elbow / elbow→wrist | 46 / 42 |
| pelvis→hip | 12 |
| hip→knee / knee→ankle / ankle→toe | 60 / 56 / 21 |

A joint left out of a later keyframe keeps its direction from its parent, so
moving an elbow carries the wrist along. Feet are the exception: an ankle or
toe left out stays planted where it was, and a foot that does not move
between two keyframes stays put through the motion too. So a squat only lists
the joints that move (hips, knees, torso, arms), never the feet. Standing upright, the reference pose
in `barbell-curl.json` is a good start; turn limbs rather than nudging single
coordinates.

**Lying down** (see `bench-press.json`): the body lies along z with the **head
toward -z** (the side view then shows the head on the left, feet on the right;
the renderer works out where the lifter's back is from the hips and spine, so
either way is drawn right, but stick to one so specs match). The side-view
torso is a capsule 15–18 thick round the spine and the head has radius 15, so
to rest on a bench pad whose top is at y, put the spine joints (`pelvis`,
`chest`, `neck`) at about y − 15 and the head centre at about y − 15 too. The
bench reference: pad `y: 230, z1: -95, z2: 40, width: 44`, spine at y ≈ 213–216.
Feet go on the floor either side of the bench (ankle y ≈ 279).

**Zoom.** A body lying flat from head to heels (plank, push-up) is about 245
long, more than the 200 the side view fits. Do not turn the body diagonally to
squeeze it in: that tilts it in the top view. Set `"zoom"` (0.6 to 1, default
1) instead. It draws the whole figure smaller round the middle of the floor
(x 125, y 290), or of the top view (x 125, y 166), and `check` applies it to
the frame. With `zoom` 0.8 the side view fits z within about ±125. Keep the
spine on x = 125.

**Hanging** (pull-up, chin-up, hanging leg raise): the legs hang straight down
under the body, at most a slight knee bend, feet together. Do not tuck the
shins back as if kneeling. Make the bar readable in the side view.

**Anchor.** `anchor` names the joint that stays put while the body moves round
it: `lAnkle` for anything standing, a wrist for a hang (pull-up), `pelvis` for
seated or lying work. Pick the joint that does not move in real life, or the
feet will skate.

**Held hands and feet (`hold`).** Between keyframes each bone turns round its
joint on its own. That is right for a free swing (a curl's forearm arcs round
the elbow), but hands on a bar that is pressed, pulled or rowed travel in a
straight line, and planted feet do not move at all. List those joints in
`hold` (`lWrist`, `rWrist`, `lAnkle`, `rAnkle`): they then move in a straight
line between keyframes and the elbow or knee is solved to fit, bending the
way it already bends. Typical: both wrists for a bar or handle held in the
hands that is pressed, pulled or rowed (bench press, overhead press, row,
pulldown, deadlift). **Not** for a bar racked on the body (back or front
squat, hip thrust): there the hands ride along with the shoulders or hips,
so leave the wrists free and pose them on the bar in each keyframe; `check`
tells you if they drift off it.

**Keyframes.** The first keyframe lists every joint. Later keyframes list only
the joints that move; the rest carry over. Two is the norm. Each free bone
turns along the shortest arc between its two directions, so one that turns
close to 180° (an arm going from straight down to straight overhead) can take
the wrong side: add a middle keyframe there, or for a path that is not one
swing (a clean, a get-up). Keyframes are evenly spaced in time; the animation
goes start → middle → end and back.

**Elbows and knees.** Pose them where a coach would want them: on a bench
press the elbows sit a little below the bench at the bottom, tucked about 45°
from the body, not flared straight out; on a squat the knees track over the
toes. From above or the front, an elbow tucked right under the wrist hides
the arm behind the body, so a slight flare reads better. A parallel squat
(see `squat.json`): shins about 35° forward, thighs level with or just below
the knees, torso leaning about 40°, bar over mid-foot.

## Equipment (`props`)

| type | fields | drawn as |
|---|---|---|
| `barbell` | `at` (default both wrists) | bar along x through the joints' midpoint: plates at the ends (front), a plate (side) |
| `dumbbell` | `at` (default both wrists), `along` `x` (overhand, default) or `z` (neutral grip) | one dumbbell per joint |
| `kettlebell` | `at` | one bell hanging below the joints' midpoint |
| `bench` | `y, z1, z2, width` | pad with its top at y, from z1 to z2, `width` across and always centred on x = 125; legs to the floor |
| `box` | `y, z1, z2, width` | solid box or step from y down to the floor |
| `bar` | `y, z` | fixed bar along x (pull-up bar, rack) |
| `cable` | `anchor: [x, y, z], at` | line from a pulley to a joint |

Held weights sort by depth with the body; the near plate of a barbell in the
side view sits just behind the near arm, so the grip stays readable.
Benches, boxes, bars and cables sit behind the figure. Any prop takes `layer`:
`auto`, `back` or `front` to override. A barbell racked on the body (`at`
anything but the wrists) is drawn behind the figure in the side view, so a
back squat's plate never covers the face: put it `at: ["lShoulder",
"rShoulder"]` with the shoulders at z ≈ -10.

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
