import { TEMPO_WORKOUT, GARMIN_CYCLING_ZONES } from "@/__tests__/fixtures/bike-sessions";
import {
  addStep,
  deleteNode,
  duplicateNode,
  endKey,
  errorsOf,
  flatten,
  formsText,
  headKey,
  insertNodes,
  moveBy,
  moveNode,
  nodePath,
  profileBlocks,
  scaleWorkout,
  setRepeatCount,
  targetFromFields,
  fieldsFromTarget,
  typedNumber,
  ungroup,
  type EditNumbers,
} from "@/lib/utils/workout-edit";
import { FTP_TEST_STEP_ID, FTP_TEST_TEMPLATE_ID, WORKOUT_TEMPLATES, ftpTestHref, ftpTestWorkout, templateById } from "@/lib/utils/workout-templates";
import { estimateWorkout, parseWorkout, type Workout, type WorkoutStep } from "@/lib/utils/workout-steps";
import { describe, expect, it } from "vitest";

function parse(json: unknown): Workout {
  const r = parseWorkout(json);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.workout;
}

const step = (id: string, seconds = 300): WorkoutStep => ({ id, type: "work", end: { type: "time", seconds } });

/** a, [b, c] x2, d */
const tree = (): Workout =>
  parse({ v: 1, sport: "bike", name: "T", steps: [step("a"), { id: "r", type: "repeat", count: 2, steps: [step("b"), step("c")] }, step("d")] });

/** The tree as text: "a (b c)x2 d". */
function shape(w: Workout): string {
  return w.steps.map((n) => (n.type === "repeat" ? `(${n.steps.map((s) => s.id).join(" ")})x${n.count}` : n.id)).join(" ");
}

const numbers: EditNumbers = { ftp: 180, lthrBike: 175, zones: GARMIN_CYCLING_ZONES };

describe("the flat list", () => {
  it("puts a repeat's steps between its head and its end", () => {
    expect(flatten(tree()).map((i) => i.key)).toEqual(["a", "h:r", "b", "c", "e:r", "d"]);
  });
});

describe("moving a step", () => {
  it("into a repeat when dropped between its head and end", () => {
    expect(shape(moveNode(tree(), "a", "b"))).toBe("(b a c)x2 d");
    expect(shape(moveNode(tree(), "d", "c"))).toBe("a (b d c)x2");
    expect(shape(moveNode(tree(), "d", endKey("r")))).toBe("a (b c d)x2");
  });

  it("out of a repeat when dropped past its head or end", () => {
    expect(shape(moveNode(tree(), "b", headKey("r")))).toBe("a b (c)x2 d");
    expect(shape(moveNode(tree(), "c", endKey("r")))).toBe("a (b)x2 c d");
    expect(shape(moveNode(tree(), "c", "d"))).toBe("a (b)x2 d c");
  });

  it("drops a repeat whose last step moves out", () => {
    const one = moveNode(tree(), "b", "a");
    expect(shape(one)).toBe("b a (c)x2 d");
    expect(shape(moveNode(one, "c", "d"))).toBe("b a d c");
  });

  it("with Move up and Move down, one row at a time, across the repeat edge", () => {
    expect(shape(moveBy(tree(), "a", 1))).toBe("(a b c)x2 d");
    expect(shape(moveBy(tree(), "b", -1))).toBe("a b (c)x2 d");
    expect(shape(moveBy(tree(), "c", 1))).toBe("a (b)x2 c d");
    expect(shape(moveBy(tree(), "d", -1))).toBe("a (b c d)x2");
    expect(shape(moveBy(tree(), "a", -1))).toBe("a (b c)x2 d");
  });
});

describe("moving a repeat", () => {
  it("moves as a block and never lands inside another repeat", () => {
    expect(shape(moveNode(tree(), headKey("r"), "a"))).toBe("(b c)x2 a d");
    expect(shape(moveNode(tree(), headKey("r"), "d"))).toBe("a d (b c)x2");
    expect(shape(moveBy(tree(), headKey("r"), 1))).toBe("a d (b c)x2");
    expect(shape(moveBy(tree(), headKey("r"), -1))).toBe("(b c)x2 a d");
    const two = parse({ v: 1, sport: "bike", name: "T", steps: [{ id: "p", type: "repeat", count: 2, steps: [step("x")] }, { id: "r", type: "repeat", count: 3, steps: [step("y")] }] });
    expect(shape(moveNode(two, headKey("p"), "y"))).toBe("(y)x3 (x)x2");
    expect(shape(moveNode(two, headKey("r"), "x"))).toBe("(y)x3 (x)x2");
  });
});

describe("the step menu and the repeat block", () => {
  it("duplicates a step after itself, and a repeat with new ids", () => {
    const d = duplicateNode(tree(), "b");
    expect(shape(d).replace(/e\d/g, "N")).toBe("a (b N c)x2 d");
    const r = duplicateNode(tree(), "r");
    expect(r.steps).toHaveLength(4);
    expect(parseWorkout(r).ok).toBe(true);
  });

  it("deletes a step, and the repeat with its last step", () => {
    expect(shape(deleteNode(tree(), "b"))).toBe("a (c)x2 d");
    expect(shape(deleteNode(deleteNode(tree(), "b"), "c"))).toBe("a d");
    expect(shape(deleteNode(tree(), "r"))).toBe("a d");
  });

  it("adds a step at the end or into a repeat, ungroups and sets the count", () => {
    expect(shape(addStep(tree(), step("x"))).startsWith("a (b c)x2 d e")).toBe(true);
    expect(shape(addStep(tree(), step("x"), "r"))).toMatch(/^a \(b c e\d\)x2 d$/);
    expect(shape(ungroup(tree(), "r"))).toBe("a b c d");
    expect(shape(setRepeatCount(tree(), "r", 3))).toBe("a (b c)x3 d");
  });

  it("inserts a template with ids that do not clash", () => {
    const w = insertNodes(tree(), templateById("tempo-2x15")!.nodes);
    expect(parseWorkout(w).ok).toBe(true);
    const twice = insertNodes(insertNodes(tree(), templateById(FTP_TEST_TEMPLATE_ID)!.nodes), templateById(FTP_TEST_TEMPLATE_ID)!.nodes);
    expect(parseWorkout(twice).ok).toBe(true);
  });
});

describe("Easier 5 % and Harder 5 %", () => {
  it("scales the main target of work and steady steps, and nothing else", () => {
    const tempo = parse(TEMPO_WORKOUT);
    const harder = scaleWorkout(tempo, 1.05);
    const nodes = harder.steps as WorkoutStep[];
    expect(nodes[1].target).toEqual({ metric: "power", anchor: "ftp", low: 79, high: 84 });
    expect(nodes[3].target).toEqual({ metric: "power", anchor: "ftp", low: 79, high: 84 });
    // Warm-up, recovery and cool-down keep theirs; the HR cap stays.
    expect(nodes[0].target).toEqual((tempo.steps[0] as WorkoutStep).target);
    expect(nodes[2].target).toEqual((tempo.steps[2] as WorkoutStep).target);
    expect(nodes[1].secondary).toEqual((tempo.steps[1] as WorkoutStep).secondary);
    const easier = scaleWorkout(tempo, 0.95);
    expect((easier.steps[1] as WorkoutStep).target).toEqual({ metric: "power", anchor: "ftp", low: 71, high: 76 });
  });

  it("scales one-sided ranges, steps in repeats, and turns a power zone into % FTP", () => {
    const w = parse({
      v: 1,
      sport: "bike",
      name: "T",
      steps: [
        { type: "repeat", count: 2, steps: [{ type: "work", end: { type: "time", seconds: 60 }, target: { metric: "power", anchor: "absolute", low: 200 } }] },
        { type: "steady", end: { type: "time", seconds: 60 }, target: { metric: "power", anchor: "ftp", zone: 3 } },
        { type: "work", end: { type: "time", seconds: 60 }, target: { metric: "hr", anchor: "lthr", zone: 3 } },
      ],
    });
    const h = scaleWorkout(w, 1.05);
    expect((h.steps[0] as { steps: WorkoutStep[] }).steps[0].target).toEqual({ metric: "power", anchor: "absolute", low: 210 });
    expect((h.steps[1] as WorkoutStep).target).toEqual({ metric: "power", anchor: "ftp", low: 79, high: 93 });
    expect((h.steps[2] as WorkoutStep).target).toEqual({ metric: "hr", anchor: "lthr", zone: 3 });
    expect(parseWorkout(h).ok).toBe(true);
  });
});

describe("every form of a target", () => {
  it("watts give % FTP and the power zone", () => {
    expect(formsText({ metric: "power", anchor: "absolute", low: 140 }, "bike", numbers)).toBe("140 W or more = 78 % FTP or more, power Z3");
    expect(formsText({ metric: "power", anchor: "absolute", low: 140, high: 140 }, "bike", numbers)).toBe("140 W = 78 % FTP, power Z3");
    expect(formsText({ metric: "power", anchor: "absolute", low: 135, high: 144 }, "bike", numbers)).toBe("135-144 W = 75-80 % FTP, power Z3");
    expect(formsText({ metric: "power", anchor: "absolute", high: 110 }, "bike", numbers)).toBe("under 110 W = under 61 % FTP, power Z2");
  });

  it("% FTP and zones give watts", () => {
    expect(formsText({ metric: "power", anchor: "ftp", low: 75, high: 80 }, "bike", numbers)).toBe("75-80 % FTP = 135-144 W, power Z3");
    expect(formsText({ metric: "power", anchor: "ftp", zone: 3 }, "bike", numbers)).toBe("Power Z3 = 75-89 % FTP = 135-160 W");
  });

  it("HR uses the Garmin zones when there are some, else the LTHR estimate", () => {
    expect(formsText({ metric: "hr", anchor: "absolute", high: 140 }, "bike", numbers)).toBe("under 140 bpm = Garmin Z2");
    expect(formsText({ metric: "hr", anchor: "lthr", zone: 3 }, "bike", numbers)).toBe("Garmin Z3 = 141-160 bpm");
    const noZones = { ...numbers, zones: null };
    expect(formsText({ metric: "hr", anchor: "lthr", zone: 3 }, "bike", noZones)).toBe("Z3 (estimate) = 158-163 bpm");
    expect(formsText({ metric: "hr", anchor: "absolute", low: 140, high: 150 }, "bike", noZones)).toBe("140-150 bpm = 80-86 % LTHR");
  });

  it("says which number is missing", () => {
    const none: EditNumbers = { ftp: null, lthrBike: null, zones: null };
    expect(formsText({ metric: "power", anchor: "absolute", low: 140 }, "bike", none)).toBe("140 W or more. Set your FTP to see % FTP.");
    expect(formsText({ metric: "power", anchor: "ftp", low: 75, high: 80 }, "bike", none)).toBe("75-80 % FTP = set your FTP to see watts, power Z3");
    expect(formsText({ metric: "hr", anchor: "lthr", zone: 2 }, "bike", none)).toBe("Z2 HR. Set your LTHR to see bpm.");
  });
});

describe("the profile and the errors", () => {
  it("has one block per step with repeats expanded, height in % FTP", () => {
    const blocks = profileBlocks(parse(TEMPO_WORKOUT), numbers);
    expect(blocks.map((b) => b.seconds)).toEqual([900, 900, 300, 900, 900]);
    expect(blocks.map((b) => b.zone)).toEqual([2, 3, 2, 3, 2]);
    expect(profileBlocks(tree(), numbers)).toHaveLength(6);
  });

  it("finds a step's errors by its path", () => {
    const w = tree();
    const bad = { ...w, steps: w.steps.map((n) => (n.type === "repeat" ? { ...n, steps: [{ ...n.steps[0], target: { metric: "power", anchor: "ftp", low: 300 } }, n.steps[1]] } : n)) };
    const r = parseWorkout(bad);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(errorsOf(r.errors, nodePath(w, "b"))).toEqual([{ field: "target.low", message: "must be 30-200 % FTP" }]);
    expect(errorsOf(r.errors, nodePath(w, "c"))).toEqual([]);
    expect(errorsOf(r.errors, nodePath(w, "r"))).toEqual([]);
  });
});

describe("templates", () => {
  it.each(WORKOUT_TEMPLATES.map((t) => [t.name, t] as const))("%s passes parseWorkout as a bike workout", (_, t) => {
    const r = parseWorkout({ v: 1, sport: "bike", name: t.name, steps: t.nodes });
    expect(r.ok, JSON.stringify(!r.ok && r.errors)).toBe(true);
  });

  it("lists every block of the plan", () => {
    expect(WORKOUT_TEMPLATES.map((t) => t.name)).toEqual([
      "Warm-up 15 min",
      "Tempo 2 x 15 min",
      "Sweet spot 3 x 12 min",
      "Threshold 2 x 20 min",
      "VO2 5 x 4 min",
      "Over-unders 3 x (2 + 1) min",
      "Fuel cue",
      "Cool-down 10 min",
      "FTP test",
    ]);
  });

  it("the FTP test: 20 min warm-up with 2 x 1 min high cadence, then 5, 5, 10, 20 all out, 10 min", () => {
    const w = parse(ftpTestWorkout());
    expect(estimateWorkout(w).durationSeconds).toBe(70 * 60);
    const twenty = w.steps.find((n) => n.id === FTP_TEST_STEP_ID) as WorkoutStep;
    expect(twenty).toMatchObject({ type: "steady", end: { type: "time", seconds: 1200 }, target: { metric: "power", anchor: "ftp", low: 95 } });
    expect(ftpTestHref()).toBe("/more/workouts/new?template=ftp-test");
    expect(ftpTestHref({ cycleId: 4, date: "2026-11-20" })).toBe("/more/workouts/new?template=ftp-test&cycle=4&date=2026-11-20");
  });
});

describe("the step sheet's target fields", () => {
  it("round-trip every form the sheet edits, and keep the others as they are", () => {
    const forms = [
      { metric: "power", anchor: "absolute", low: 135, high: 144 },
      { metric: "power", anchor: "ftp", high: 60 },
      { metric: "power", anchor: "ftp", zone: 3 },
      { metric: "hr", anchor: "absolute", high: 140 },
      { metric: "hr", anchor: "lthr", zone: 2 },
      { metric: "hr", anchor: "max_hr", low: 70, high: 80 },
    ] as const;
    for (const t of forms) expect(targetFromFields(fieldsFromTarget({ ...t }))).toEqual(t);
    expect(targetFromFields(fieldsFromTarget(undefined))).toBeUndefined();
  });

  it("reads a comma as a decimal point and leaves an empty side open", () => {
    expect(typedNumber(" 2,5 ")).toBe(2.5);
    expect(typedNumber("")).toBeUndefined();
    expect(Number.isNaN(typedNumber("abc"))).toBe(true);
    expect(targetFromFields({ metric: "hr", unit: "bpm", low: "", high: "140", zone: 2 })).toEqual({ metric: "hr", anchor: "absolute", high: 140 });
  });
});
