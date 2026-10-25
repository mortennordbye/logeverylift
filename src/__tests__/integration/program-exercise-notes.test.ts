import { db } from "@/db";
import { friendships, programExercises, programShares } from "@/db/schema";
import { copySharedProgram, shareProgram } from "@/lib/actions/program-shares";
import { updateProgramExerciseNotes } from "@/lib/actions/programs";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createExercise, createProgram, createUser } from "./factories";
import { asUser } from "./setup";

let userId: string;
let programExerciseId: number;

beforeEach(async () => {
  userId = (await createUser()).id;
  asUser(userId);
  const exerciseId = (await createExercise({ name: "Leg Press" })).id;
  const { slots } = await createProgram(userId, [{ exerciseId, sets: [{ weightKg: "100" }] }]);
  programExerciseId = slots[0].programExerciseId;
});

async function storedNotes() {
  const [row] = await db
    .select({ notes: programExercises.notes })
    .from(programExercises)
    .where(eq(programExercises.id, programExerciseId));
  return row.notes;
}

describe("updateProgramExerciseNotes", () => {
  it("saves trimmed notes", async () => {
    const result = await updateProgramExerciseNotes({ programExerciseId, notes: "  Seat 4, feet high  " });
    expect(result.success).toBe(true);
    expect(await storedNotes()).toBe("Seat 4, feet high");
  });

  it("stores null when cleared", async () => {
    await updateProgramExerciseNotes({ programExerciseId, notes: "Seat 4" });
    const result = await updateProgramExerciseNotes({ programExerciseId, notes: "   " });
    expect(result.success).toBe(true);
    expect(await storedNotes()).toBeNull();
  });

  it("rejects notes over 500 characters", async () => {
    const result = await updateProgramExerciseNotes({ programExerciseId, notes: "x".repeat(501) });
    expect(result.success).toBe(false);
    expect(await storedNotes()).toBeNull();
  });

  it("refuses another user's program exercise", async () => {
    asUser((await createUser()).id);
    const result = await updateProgramExerciseNotes({ programExerciseId, notes: "mine now" });
    expect(result).toEqual({ success: false, error: "Not found" });
    expect(await storedNotes()).toBeNull();
  });
});

describe("a shared program", () => {
  it("reaches the friend without the owner's exercise notes", async () => {
    await updateProgramExerciseNotes({ programExerciseId, notes: "Bad left knee, go light" });
    const [{ programId }] = await db
      .select({ programId: programExercises.programId })
      .from(programExercises)
      .where(eq(programExercises.id, programExerciseId));
    const friendId = (await createUser()).id;
    await db.insert(friendships).values({ requesterId: userId, addresseeId: friendId, status: "accepted" });
    expect((await shareProgram({ programId, friendUserId: friendId })).success).toBe(true);
    const [share] = await db.select({ id: programShares.id }).from(programShares);

    asUser(friendId);
    const copied = await copySharedProgram({ shareId: share.id });
    if (!copied.success) throw new Error(copied.error);
    const rows = await db
      .select({ notes: programExercises.notes })
      .from(programExercises)
      .where(eq(programExercises.programId, copied.data.programId));
    expect(rows).toEqual([{ notes: null }]);
  });
});
