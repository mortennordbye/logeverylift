/**
 * The twelve body measurement sites: number, name, where the tape goes on the
 * front body figure (MAP_FIGURES[0], 200 x 400, screen left is the person's
 * right), and the measuring guide. Ported from
 * docs/design/body-measurements/gen-reference.mjs (C, G, GL), which drew the
 * agreed pictures.
 */

import type { BodySide, BodySite } from "@/db/schema/body-measurements";

export type Tape = {
  /** Tape line height and its two ends, in figure coordinates. */
  y: number;
  x1: number;
  x2: number;
  /** Which side of the map the label goes on, and its height. */
  label: "L" | "R";
  ly: number;
  /** Figure area shown in the picture crop: x, y, width, height. */
  crop: [number, number, number, number];
};

export type BodyPart = {
  n: number;
  site: BodySite;
  name: string;
  kind: "circumference" | "length";
  /** Parts 6 to 9 have a left and a right value. */
  sides: boolean;
  tape: Tape | null;
  where: string;
  how: [string, string, string];
  tip: string;
};

export const BODY_PARTS: BodyPart[] = [
  {
    n: 1, site: "neck", name: "Neck", kind: "circumference", sides: false,
    tape: { y: 58, x1: 89.6, x2: 110.4, label: "R", ly: 50, crop: [60, 20, 80, 70] },
    where: "Just below the Adam's apple (larynx).",
    how: ["Look straight ahead. Keep the shoulders down.", "Put the tape around the neck. Let it go a little down at the front.", "Do not tighten the neck."],
    tip: "Do not swallow while you read the value.",
  },
  {
    n: 2, site: "shoulders", name: "Shoulders", kind: "circumference", sides: false,
    tape: { y: 92, x1: 47.5, x2: 152.5, label: "L", ly: 88, crop: [30, 50, 140, 90] },
    where: "Around the widest part of the shoulders, over the round shoulder muscle.",
    how: ["Stand with the arms relaxed at the sides.", "Put the tape around both shoulders and the upper back.", "Breathe out normally, then read."],
    tip: "Ask a helper. It is hard to keep the tape level at the back yourself.",
  },
  {
    n: 3, site: "chest", name: "Chest", kind: "circumference", sides: false,
    tape: { y: 104, x1: 67, x2: 133, label: "R", ly: 100, crop: [40, 60, 120, 90] },
    where: "Around the fullest part of the chest, at nipple level, under the armpits.",
    how: ["Lift the arms a little. Put the tape around the chest and over the shoulder blades.", "Lower the arms to the sides.", "Breathe out normally, then read."],
    tip: "Do not fill the lungs and do not tighten the chest.",
  },
  {
    n: 4, site: "waist", name: "Waist", kind: "circumference", sides: false,
    tape: { y: 150, x1: 71.5, x2: 128.5, label: "R", ly: 150, crop: [40, 110, 120, 90] },
    where: "Halfway between the lowest rib and the top of the hip bone. For most people this is the narrowest part, a little above the navel.",
    how: ["Stand with the feet together and the stomach relaxed.", "Put the tape around the waist, level with the floor.", "Breathe out normally, then read at the end of the breath."],
    tip: "Do not pull in the stomach. Use the same point each time.",
  },
  {
    n: 5, site: "hips", name: "Hips", kind: "circumference", sides: false,
    tape: { y: 200, x1: 67.5, x2: 132.5, label: "R", ly: 200, crop: [40, 160, 120, 90] },
    where: "Around the widest part of the buttocks.",
    how: ["Stand with the feet together.", "Put the tape around the hips and buttocks.", "Move the tape up and down to find the widest part. Read there."],
    tip: "Look at the side in a mirror to make sure the tape is level.",
  },
  {
    n: 6, site: "upper-arm", name: "Upper arm", kind: "circumference", sides: true,
    tape: { y: 128, x1: 46.9, x2: 64.7, label: "L", ly: 130, crop: [11, 85, 90, 90] },
    where: "Halfway between the tip of the shoulder and the elbow.",
    how: ["Let the arm hang relaxed. Do not tighten the muscle.", "Put the tape around the arm, at a right angle to it.", "Measure the left arm, then the right arm."],
    tip: "Measure relaxed each time, so the values agree.",
  },
  {
    n: 7, site: "forearm", name: "Forearm", kind: "circumference", sides: true,
    tape: { y: 174, x1: 45.9, x2: 60.9, label: "L", ly: 176, crop: [8, 135, 90, 90] },
    where: "Around the widest part, just below the elbow.",
    how: ["Let the arm hang. Turn the palm to the front. Open the hand.", "Move the tape down from the elbow to find the widest part.", "Measure the left arm, then the right arm."],
    tip: "Do not make a fist.",
  },
  {
    n: 8, site: "thigh", name: "Thigh", kind: "circumference", sides: true,
    tape: { y: 238, x1: 69.1, x2: 97.3, label: "L", ly: 238, crop: [40, 195, 100, 90] },
    where: "Halfway between the groin crease and the top of the kneecap.",
    how: ["Stand with the weight on both feet. Relax the leg.", "Put the tape around the thigh, level with the floor.", "Measure the left leg, then the right leg."],
    tip: "Measure the distance from the kneecap once. Then use the same distance each time.",
  },
  {
    n: 9, site: "calf", name: "Calf", kind: "circumference", sides: true,
    tape: { y: 322, x1: 72.4, x2: 88.7, label: "L", ly: 322, crop: [36, 280, 90, 85] },
    where: "Around the widest part of the calf.",
    how: ["Stand with the weight on both feet.", "Move the tape up and down to find the widest part.", "Measure the left leg, then the right leg."],
    tip: "Do not stand on the toes.",
  },
  {
    n: 10, site: "arm-length", name: "Arm length", kind: "length", sides: false, tape: null,
    where: "From the tip of the shoulder (the bony point at the top) to the wrist bone.",
    how: ["Let the arm hang with a small bend at the elbow.", "Hold the tape on the tip of the shoulder.", "Go along the outside of the arm, over the elbow, to the wrist bone."],
    tip: "A helper must do this one.",
  },
  {
    n: 11, site: "leg-length", name: "Leg length", kind: "length", sides: false, tape: null,
    where: "From the waist at the side of the body down to the floor.",
    how: ["Stand barefoot with the feet a little apart.", "Hold the tape at the side of the waist.", "Let it go straight down the outside of the leg to the floor."],
    tip: "Use the same waist point as for measurement 4.",
  },
  {
    n: 12, site: "inseam", name: "Inseam", kind: "length", sides: false, tape: null,
    where: "From the crotch down to the floor, on the inside of the leg.",
    how: ["Stand barefoot against a wall, with the feet 15 cm apart.", "Push a book up between the legs, level with the floor. Mark the wall at the top of the book.", "Measure from the mark to the floor."],
    tip: "The book method is more accurate than holding the tape in the crotch.",
  },
];

export const partOf = (site: string): BodyPart | undefined => BODY_PARTS.find((p) => p.site === site);

/** The sites with a left and a right value; every other site stores side "none". */
export const SIDED_SITES = BODY_PARTS.filter((p) => p.sides).map((p) => p.site);

export type LogStep = { site: BodySite; side: BodySide };

/**
 * The log flow (decision 9): the trunk from the top down, then the right arm,
 * the left arm, the right leg and the left leg, so the tape does not move back
 * and forth. The three lengths come after, only on a first log.
 */
export const CIRCUMFERENCE_STEPS: LogStep[] = [
  { site: "neck", side: "none" },
  { site: "shoulders", side: "none" },
  { site: "chest", side: "none" },
  { site: "waist", side: "none" },
  { site: "hips", side: "none" },
  { site: "upper-arm", side: "right" },
  { site: "forearm", side: "right" },
  { site: "upper-arm", side: "left" },
  { site: "forearm", side: "left" },
  { site: "thigh", side: "right" },
  { site: "calf", side: "right" },
  { site: "thigh", side: "left" },
  { site: "calf", side: "left" },
];

export const LENGTH_STEPS: LogStep[] = [
  { site: "arm-length", side: "none" },
  { site: "leg-length", side: "none" },
  { site: "inseam", side: "none" },
];

/** Mirror a tape to the person's left side (screen right), for a left step's picture. */
export function mirrorTape(t: Tape): Tape {
  return { ...t, x1: 200 - t.x2, x2: 200 - t.x1, crop: [200 - t.crop[0] - t.crop[2], t.crop[1], t.crop[2], t.crop[3]] };
}
