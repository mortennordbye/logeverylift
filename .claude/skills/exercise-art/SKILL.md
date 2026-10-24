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
   held hands on a pressed bar). Also: `deadlift.json` and `barbell-row.json`
   (hip hinge, bar in the hands), `pull-up.json` (hang, wrist anchor, legs
   straight down), `lat-pulldown.json` and `overhead-press.json` (seated),
   `plank.json` and `push-up.json` (face down full length, top camera,
   `zoom`), `hip-thrust.json` (back on a bench edge, top camera), `lunge.json`
   (split stance), `dumbbell-curl.json` (dumbbells), `leg-extension.json`
   (machine seat with a backrest, `roller` on the shins with a knee pivot).
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
rWrist lHip rHip lKnee rKnee lAnkle rAnkle lToe rToe`, plus the optional
`lHand rHand`.

**Hands** are optional. Most drawings end the arm at the wrist, where the bar
or handle sits, and leave them out. Pose them only when the hand itself moves
against the forearm (wrist curl, reverse wrist curl): list `lHand` and `rHand`
in keyframe 0 (14 past the wrist) and in each keyframe where they turn, and put
the bar `at: ["lHand", "rHand"]`. A spec that lists them gets them drawn and
checked; one that does not never shows them. A held wrist carries its hand along.

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
| wrist→hand (optional) | 14 |

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
spine on x = 125. `"frontZoom"` (0.6 to 2) overrides `zoom` for the front (or
top) view alone; above 1 it enlarges a figure that is small from the front.

**Hanging** (pull-up, chin-up, hanging leg raise): the legs hang straight down
under the body, at most a slight knee bend, feet together. Do not tuck the
shins back as if kneeling. Make the bar readable in the side view.

**Hip hinge** (deadlift, Romanian deadlift, row, good morning): the hips sit
clearly above the knees, the back is flat at about 30 to 45 degrees above
horizontal, and the shins are close to vertical. Hips level with the knees
and a flat back read as a squat; agents got this wrong three times on the
deadlift. Check the angles with `--joints`, not by eye. A bar on the back
(good morning) cannot sit over mid-foot at the bottom with soft knees: the
skeleton's torso puts it near the toes. Keep the knee at about 140° and accept
that; chasing mid-foot bent the knees into a half squat in batch 3.

**Swinging the arms through** (jump squat, any arm swing from behind the
hips to in front): the arm turns close to 180 degrees between the backswing
and the forward swing, so the shortest arc goes out sideways and the front
view flares into an A. Add a keyframe between them with the arms hanging.

**Inverted V** (pike push-up): from the feet the legs hide everything, and
from above the steep torso is end-on. Face the lifter toward the front
camera (head toward +z) so the front view shows the head dropping between
the hands with the hips up behind.

**Legs switching under a plank** (mountain climbers): a thigh swinging from
tucked to extended passes through vertical, and with the hips about 70 off
the floor the knee and toe go through it. Put the ankles in `hold` so the
feet travel in straight lines and the knees are solved to fit, and lift the
hips a little at the switch.

**Hands under the chest** (close-grip and diamond push-up): the `top` camera
hides them behind the torso. Use the front camera with the lifter facing it
(head toward +z, feet toward -z, so the head and arms are nearest the camera)
and `frontZoom` about 1.6 to 1.8, so the narrow hands, the elbows tucked along
the ribs and the chest dropping between them fill the front view; keep `zoom`
about 0.8 for the side view. Check the side view still shows the body facing
right as usual; it does when the head is toward +z.

**Balanced on bent arms** (crow, tuck planche): the hips are the highest
point and the spine falls from them to the shoulders; a chest above the
pelvis draws a hump. Bend the elbows to about 100 to 120 degrees so the
upper arm is a shelf, and rest each knee just outside and on top of it.
A knee cannot close past about 25 degrees: put the ankles behind and a
little below the hips, not inside them. Going up from the squat, add a
middle keyframe with the knees already on the arms and the feet just off
the floor, or the legs sweep out straight behind.

**Front rack** (power clean, front squat, clean and press): the skeleton
has no hand, so the bar sits at the wrist joint and a fully folded arm
cannot put the elbow up and forward. Put the wrists about 15 above and 15
in front of the shoulder joints, tilt the head back a little so the chin
clears the bar, and accept elbows a bit below horizontal. Do not let the
bar rise past rack height in the turnover and drop back onto it.

**A foot swept along the floor** (get-up leg sweep): a held ankle travels
in a straight line, so a line passing close to the hip makes the knee
solver bend the knee up toward the chest. Add keyframes that carry the
foot round on the floor (in front, out to the side, behind) and sample
`poseAt` to confirm the knee stays below the hip.

**Supported on the hands** (dip, and the top of anything pressed up on
bars): at lockout the shoulders sit over the hands and the torso is close to
upright, with only a slight lean; the lean grows on the way down. A body that
is one straight diagonal with the shoulders well ahead of the hands reads as
falling forward. Bend the knees and let the feet hang a little behind.

**On a step** (calf raise): the foot is one straight bone, so a heel dropped
below the step top touches the step only at its edge. Put the box's back
edge (`z1`) where the foot line crosses the step top at t = 0, not at the
heel or the toe, and set the box `layer: "front"` so the front view hides the
dropped heels behind the step.

**Onto a box** (step-up): the trail foot must rise behind the box and then
cross above its top, not drag across it or go through the back edge. Two
keyframes cannot do that: add one with the knee driven forward and the foot
lifted behind the box (toe pointing back), then one with the foot over the
box, then the planted end. A shin swept back near horizontal with the knee
under the hip reads as a donkey kick. `check` does not catch a foot passing
through a prop mid-rep, so sample `poseAt` from `scene.ts` at small steps of t
(run the spec through `artSpecSchema` first) and confirm the toe stays above
the box top wherever its z is over the box.

**Hyperextension bench** (hyperextension, back extension): there is no prop of its own. Use an `incline` as the hip pad under the front of the thighs, sloped at about 45 degrees for a back extension or flat and high for a hyperextension (a glute-ham style bench), and a fixed `roller` behind the ankles. The hips sit just past the pad edge so the torso can fold down over it. Reverse hyper: chest on a high `bench`, hips just off its end, legs swinging up behind, `roller` on the ankles.

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

**Keyframes.** The first keyframe lists every joint (the hands only if the spec poses them). Later keyframes list only
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
the knees, torso leaning about 40°, bar over mid-foot. At the bottom of any
press (bench, incline, overhead) the forearm stays close to vertical under
the weight in the side view; a forearm leaning toward the feet reads as a
cocked wrist.

## Equipment (`props`)

| type | fields | drawn as |
|---|---|---|
| `barbell` | `at` (default both wrists), `cambered` (EZ bar) | bar along x through the joints' midpoint: plates at the ends (front), a plate (side); `cambered` bends the middle into a W with the hands on the angled stretches about 18 either side of centre |
| `dumbbell` | `at` (default both wrists), `along` `x` (overhand, default), `z` (neutral grip) or `forearm` (neutral grip that stays at right angles to the forearm as it swings: hammer curl) | one dumbbell per joint |
| `kettlebell` | `at`, `along` `hang` (default) or `forearm` | one bell at the joints' midpoint, hanging straight down or carried on in line with the forearms (a swing's float, where the bell extends the arms) |
| `bench` | `y, z1, z2, width` | pad with its top at y, from z1 to z2, `width` across and always centred on x = 125; legs to the floor |
| `incline` | `from`, `to` (each `[y, z]`), `width` | sloped pad whose top surface runs from `from` to `to` (incline bench back, upright seat back); one post to the floor. Pair it with a `bench` for the seat |
| `bars` | `y, z1, z2, width` | parallel bars along z at height y, `width` apart (dip station) |
| `box` | `y, z1, z2, width` | solid box or step from y down to the floor |
| `bar` | `y, z` | fixed bar along x (pull-up bar, rack) |
| `cable` | `anchor: [x, y, z], at` | line from a pulley to a joint |
| `roller` | `y, z` (fixed) or `at` + `offset: [along, across]` (riding on joints), `pivot: [y, z]`, `width` | padded cylinder along x: a decline bench's leg hook or a seated curl's thigh pad (fixed), or a machine's shin pad (`at` both ankles). `offset` is in the shin's own frame, so the pad stays on the same spot as the knee bends: `along` past the ankle (negative moves it up the shin), `across` positive toward the side a shin pointing +z has on top (a hanging shin's front, a prone shin's calf). Leg extension `[-6, 9]`, seated curl `[-6, -9]`. `pivot` at the knee draws the lever arm |
| `rings` | `at` (default both wrists), `y` (strap top, default 36) | one ring per joint on a strap straight up: a full ring from the side, edge-on from the front |
| `landmine` | `pivot: [y, z]` (on the centre line, near the floor) or `[x, y, z]` (off to one side, for a lifter standing side-on; it may lie outside the frame and the bar runs out of it), `at` (default both wrists), `plate` `below` (default) or `past` | bar from the floor pivot to the hands, which hold the end of the sleeve, with a plate 18 below them toward the pivot; `past` puts it 14 past them instead, for a T-bar row's handle under the bar (landmine press, T-bar row) |
| `plate` | `at` (default both wrists), `facing` `x`, `y` or `z` (default, face to the front camera), `radius` (22), `hang` | weight plate at the joints' midpoint; `hang` puts it below them, pinched by its top edge (plate pinch: one prop per hand) |
| `ball` | `at` (default both wrists), `radius` (14) | medicine ball at the joints' midpoint |
| `wheel` | `at` (default both wrists) | ab wheel with its hub at the hands: put the wrists 13 above the floor (y 277) so it rolls on it |
| `wall` | `z` | wall along x at depth z, floor to ceiling. From the front it is a backdrop when behind the lifter (z < 0) and left out when in front |
| `pole` | `x, z` | vertical pole from the floor to the top of the frame (human flag) |
| `band` | `at` (two or more joints) | resistance band stretched through the joints in order: a loop round both knees or ankles (lateral band walk) |
| `footplate` | `facing: [y, z]` (from the plate toward the lifter), `at` (default both toes and ankles), `rail: [y, z]`, `width` (60), `length` (56) | flat plate just behind the soles, turned to face the lifter, on a rail to the `rail` point: a leg press sled that moves with the feet, or a hack squat platform where the feet stay planted |
| `sled` | `at` (default both wrists) | push sled: an upright post down from each hand to a weighted sled on the floor in front of them; it moves with the hands |
| `pad` | `at: [a, b]`, `offset` (16), `rail: [y, z]`, `width` (40) | pad that rides along the body from joint a to b, moved `offset` across that line (positive behind an upright back, like `roller`): a hack squat back pad from `pelvis` to `neck`, sliding on a rail |
| `handles` | `at` (default both wrists), `along` `x`, `y` or `z`, `size` `grip` or `pad`, `out`, `pivot` (`[y, z]` at the joint's own x, or `[x, y, z]` for the l side, mirrored for r) | a machine handle (`grip`) or padded arm (`pad`) at each joint on a lever from the pivot: machine shoulder press grips, pec deck arm pads at the forearms, hip abduction pads `out` 12 outside the knees |

**If the equipment is not in this table, do not fake it with another prop.**
Batch 2 tried: a vertical `box` as an incline backrest (the back hung in the
air), a `bench` shrunk to 8 wide as a dip bar (it read as a pole), and a
fixed-axis dumbbell for a hammer curl (the handle ran along the forearm).
Each failed review twice and cost a full fix round. Stop, write no spec, and
say in your result which prop is missing and what it should look like; a
renderer change in `src/lib/exercise-art/scene.ts` and `schema.ts` comes
first.

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
forearms. Thigh: quads, hamstrings, glutes. Shin: calves. Front torso from above (`top` camera): the lower panel lights for abs or lower_back, as in the side view. Side torso: chest and
back (upper), abs and lower_back (lower), glutes (seat). Front torso: chest
plate, abs, lats and upper traps (back) and the shoulder caps. The muscle map next to the
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

## Running a batch (lessons from the first two)

- Run the saved workflow (`.claude/workflows/exercise-art.js`) with about 10
  exact seed names. Batch 1: ten took 60 agents and about 3.6M tokens over
  three rounds. Batch 2: 37 agents and about 2M tokens, five of ten right.
- Before launching, go through the list against the equipment table. An
  exercise whose machine or station the renderer cannot draw (a sled, a
  backrest at an angle, a pec deck) needs the prop first; agents cannot pose
  their way round it and the review loop only burns tokens finding that out.
- Agents passing `check` and their own review is not enough. The person
  running the batch reads every `.art-preview/<slug>.png`, then opens them
  for the user (`open .art-preview/<slug>.png ...`) and commits only what the
  user approves. Send the rest back with concrete problems (view, frame,
  joint, what is wrong).
- If the same fault comes back after two fixes, the cause is usually
  something no pose can fix (the frame, the renderer), not the pose. Find it
  in `--joints` before sending more agents. That is how `zoom` came about:
  agents rotated full-length bodies diagonally to fit the side view, and
  `incline`, `bars` and the `forearm` dumbbell grip came the same way in
  batch 2.
- Small pose faults the last review names precisely (a step edge a few
  units off, a wrist z to move) are quicker to fix by hand with `--joints`
  than with another agent round.
- Poses that fail in a new way go into this skill, so the next batch gets
  them right the first time.
