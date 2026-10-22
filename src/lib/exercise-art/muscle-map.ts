/**
 * Front and back anatomy for the muscle map: a body silhouette with the
 * muscle groups laid over it as smooth shapes. Shapes are given for the
 * screen-left half of each figure (x < 100) and mirrored; each figure is
 * 200 x 400, the back figure sits 220 to the right.
 */

import { capsule, smoothClosed } from "./scene";
import type { Muscle } from "./skeleton";

type Pt = [number, number];
export type MapShape = { d: string; muscle: Muscle | null };

export const MAP_VIEWBOX = "0 0 420 400";

const mirror = (pts: Pt[]): Pt[] => pts.map(([x, y]) => [200 - x, y]);
/** A shape and its mirror image. */
const pair = (muscle: Muscle | null, pts: Pt[]): MapShape[] => [
  { d: smoothClosed(pts), muscle },
  { d: smoothClosed(mirror(pts)), muscle },
];
/** A shape across the centre line, from its left half (top to bottom along the edge). */
const across = (muscle: Muscle | null, half: Pt[]): MapShape => ({ d: smoothClosed([...half, ...mirror(half).reverse()]), muscle });
const ellipse = ([x, y]: Pt, rx: number, ry: number) => `M${x - rx} ${y}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`;
const limb = (a: Pt, b: Pt, ra: number, rb: number): MapShape[] => [
  { d: capsule(a, b, ra, rb), muscle: null },
  { d: capsule([200 - a[0], a[1]], [200 - b[0], b[1]], ra, rb), muscle: null },
];

/** The body under the muscles, shared by both views. */
const SILHOUETTE: MapShape[] = [
  { d: ellipse([100, 30], 16, 21), muscle: null },
  { d: capsule([100, 50], [100, 70], 10, 11), muscle: null },
  across(null, [[100, 62], [82, 66], [64, 71], [52, 80], [49, 96], [56, 112], [66, 120], [71, 142], [72, 166], [69, 188], [70, 206], [86, 214], [100, 212]]),
  ...limb([58, 90], [54, 160], 10, 8),
  ...limb([54, 160], [51, 226], 8, 5.5),
  { d: ellipse([50, 240], 6, 12), muscle: null },
  { d: ellipse([150, 240], 6, 12), muscle: null },
  ...limb([84, 206], [82, 284], 17, 10),
  ...limb([82, 284], [79, 366], 10, 6),
  { d: ellipse([77, 377], 9, 6), muscle: null },
  { d: ellipse([123, 377], 9, 6), muscle: null },
];

const FRONT: MapShape[] = [
  ...SILHOUETTE,
  ...pair("back", [[91, 60], [80, 66], [68, 72], [80, 73], [92, 69]]),
  ...pair("shoulders", [[66, 72], [55, 77], [49, 90], [50, 106], [55, 116], [61, 106], [66, 92], [72, 80]]),
  ...pair("chest", [[98, 76], [84, 74], [72, 80], [67, 94], [71, 108], [82, 116], [98, 113]]),
  ...pair("biceps", [[59, 114], [53, 124], [51, 140], [53, 154], [58, 158], [63, 148], [64, 130], [63, 117]]),
  ...pair("forearms", [[52, 166], [47, 180], [46, 200], [49, 220], [53, 222], [57, 204], [60, 184], [60, 168]]),
  ...pair("abs", [[98, 121], [88, 123], [87, 142], [88, 166], [90, 188], [98, 196]]),
  ...pair("abs", [[84, 126], [76, 134], [74, 154], [77, 176], [84, 190], [86, 166], [86, 140]]),
  ...pair("quads", [[78, 208], [71, 226], [69, 250], [72, 270], [80, 280], [89, 276], [94, 256], [96, 232], [94, 212], [87, 206]]),
  ...pair("calves", [[75, 294], [70, 310], [70, 330], [73, 350], [78, 360], [83, 348], [86, 326], [85, 302]]),
];

/** A line and its mirror image (quadratic curve through `c`). */
const lines = (a: Pt, c: Pt, b: Pt): string[] => [
  `M${a[0]} ${a[1]}Q${c[0]} ${c[1]} ${b[0]} ${b[1]}`,
  `M${200 - a[0]} ${a[1]}Q${200 - c[0]} ${c[1]} ${200 - b[0]} ${b[1]}`,
];

/** Separations drawn in the card colour: ab blocks, the split of the quads. */
const FRONT_LINES: string[] = [
  "M88 143L112 143", "M88.5 165L111.5 165", "M100 121L100 194",
  ...lines([84, 212], [80, 244], [84, 276]),
  ...lines([92, 236], [90, 258], [88, 276]),
];
/** Spine, the split of the hamstrings and of the calves. */
const BACK_LINES: string[] = [
  "M100 52L100 132", "M100 150L100 198",
  ...lines([86, 248], [83, 268], [84, 288]),
  ...lines([80, 302], [78, 320], [79, 340]),
];

const BACK: MapShape[] = [
  ...SILHOUETTE,
  across("back", [[100, 54], [88, 62], [70, 72], [80, 82], [90, 100], [96, 120], [100, 132]]),
  ...pair("shoulders", [[68, 72], [56, 77], [49, 90], [50, 106], [55, 116], [61, 106], [67, 92], [74, 82]]),
  ...pair("back", [[74, 88], [70, 100], [80, 108], [91, 104], [88, 92], [80, 86]]),
  ...pair("back", [[70, 106], [67, 124], [72, 148], [82, 168], [95, 174], [96, 150], [89, 126], [80, 110]]),
  ...pair("triceps", [[58, 112], [52, 124], [51, 142], [53, 156], [59, 158], [64, 146], [65, 128], [63, 114]]),
  ...pair("forearms", [[52, 166], [47, 180], [46, 200], [49, 220], [53, 222], [57, 204], [60, 184], [60, 168]]),
  ...pair("lower_back", [[98, 150], [91, 154], [89, 176], [91, 194], [98, 198]]),
  ...pair("glutes", [[98, 200], [85, 198], [74, 205], [71, 224], [78, 238], [91, 240], [99, 232]]),
  ...pair("hamstrings", [[77, 244], [72, 262], [73, 282], [80, 290], [88, 286], [93, 266], [95, 248]]),
  ...pair("calves", [[75, 298], [69, 314], [70, 334], [76, 346], [84, 342], [88, 320], [86, 300]]),
];

export const MAP_FIGURES = [
  { label: "Front", x: 0, shapes: FRONT, lines: FRONT_LINES },
  { label: "Back", x: 220, shapes: BACK, lines: BACK_LINES },
] as const;
