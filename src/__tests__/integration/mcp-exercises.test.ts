import { db } from "@/db";
import { exercises } from "@/db/schema";
import { registerExerciseTools } from "@/lib/mcp/tools/exercises";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createExercise, createUser } from "./factories";
import { mcpTools } from "./mcp-call";

let me: string;
let other: string;

beforeEach(async () => {
  me = (await createUser()).id;
  other = (await createUser()).id;
});

describe("search_exercises", () => {
  it("finds built-in and own custom exercises, never another user's", async () => {
    await createExercise({ name: "Easy Run", category: "cardio", discipline: "run" });
    await createExercise({ name: "Bench Press" });
    await createExercise({ name: "My Hill Run", category: "cardio", userId: me, isCustom: true });
    await createExercise({ name: "Their Hill Run", category: "cardio", userId: other, isCustom: true });

    const { data } = await mcpTools(registerExerciseTools, me)("search_exercises", { query: "run" });
    const names = data.exercises.map((e: { name: string }) => e.name);
    expect(names.sort()).toEqual(["Easy Run", "My Hill Run"]);
    expect(data.exercises.find((e: { name: string }) => e.name === "My Hill Run").custom).toBe(true);
  });

  it("filters by discipline and category, and puts an exact name first", async () => {
    await createExercise({ name: "Run Intervals", category: "cardio", discipline: "run" });
    await createExercise({ name: "Run", category: "cardio", discipline: "run" });
    await createExercise({ name: "Ride", category: "cardio", discipline: "bike" });

    const call = mcpTools(registerExerciseTools, me);
    const runs = (await call("search_exercises", { query: "run", discipline: "run" })).data.exercises;
    expect(runs[0].name).toBe("Run");
    expect(runs).toHaveLength(2);
    const bikes = (await call("search_exercises", { discipline: "bike", category: "cardio" })).data.exercises;
    expect(bikes.map((e: { name: string }) => e.name)).toEqual(["Ride"]);
  });
});

describe("create_exercise", () => {
  it("creates a custom exercise with discipline and timed", async () => {
    const result = await mcpTools(registerExerciseTools, me)("create_exercise", {
      name: "Trail run",
      category: "cardio",
      discipline: "run",
      isTimed: true,
    });
    expect(result.isError).toBe(false);
    const [row] = await db.select().from(exercises).where(eq(exercises.id, result.data.id));
    expect(row).toMatchObject({ name: "Trail run", userId: me, isCustom: true, discipline: "run", isTimed: true });
  });

  it("allows a name another user has, and refuses a built-in or own name", async () => {
    await createExercise({ name: "Trail run", category: "cardio", userId: other, isCustom: true });
    await createExercise({ name: "Back Squat" });
    const call = mcpTools(registerExerciseTools, me);

    expect((await call("create_exercise", { name: "Trail run", category: "cardio" })).isError).toBe(false);
    const again = await call("create_exercise", { name: "Trail run", category: "cardio" });
    expect(again).toMatchObject({ isError: true, raw: "Error: An exercise with this name already exists" });
    const builtIn = await call("create_exercise", { name: "Back Squat", category: "strength" });
    expect(builtIn.isError).toBe(true);
    const mine = await db.select().from(exercises).where(eq(exercises.userId, me));
    expect(mine).toHaveLength(1);
  });

  it("refuses an unknown discipline", async () => {
    const result = await mcpTools(registerExerciseTools, me)("create_exercise", { name: "X", category: "cardio", discipline: "row" });
    expect(result.isError).toBe(true);
    expect(await db.select().from(exercises).where(eq(exercises.userId, me))).toEqual([]);
  });
});
