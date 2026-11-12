import { db } from "@/db";
import { exercises } from "@/db/schema";
import { createCustomExercise } from "@/lib/actions/exercises";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createExercise, createUser } from "./factories";
import { asUser } from "./setup";

let me: string;
let other: string;

beforeEach(async () => {
  me = (await createUser()).id;
  other = (await createUser()).id;
});

describe("createCustomExercise names", () => {
  it("lets two users each have a custom exercise with the same name", async () => {
    asUser(other);
    expect((await createCustomExercise({ name: "Trail run", category: "cardio" })).success).toBe(true);

    asUser(me);
    const mine = await createCustomExercise({ name: "Trail run", category: "cardio" });
    expect(mine.success).toBe(true);
    const rows = await db.select().from(exercises).where(eq(exercises.name, "Trail run"));
    expect(rows.map((r) => r.userId).sort()).toEqual([me, other].sort());
  });

  it("refuses a name the user already has, or a system exercise's name", async () => {
    await createExercise({ name: "Front Squat" });
    asUser(me);
    expect((await createCustomExercise({ name: "Trail run", category: "cardio" })).success).toBe(true);

    const again = await createCustomExercise({ name: "Trail run", category: "cardio" });
    expect(again).toMatchObject({ success: false, error: "An exercise with this name already exists" });
    const system = await createCustomExercise({ name: "Front Squat", category: "strength" });
    expect(system).toMatchObject({ success: false, error: "An exercise with this name already exists" });
  });

  it("stores discipline and timed", async () => {
    asUser(me);
    const result = await createCustomExercise({ name: "Hill repeats", category: "cardio", discipline: "run", isTimed: true });
    expect(result).toMatchObject({ success: true, data: { discipline: "run", isTimed: true, userId: me } });
  });
});
