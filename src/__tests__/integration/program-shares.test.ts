import { db } from "@/db";
import { friendships } from "@/db/schema";
import { copySharedProgram, getIncomingShares, shareProgram } from "@/lib/actions/program-shares";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createExercise, createProgram, createUser } from "./factories";
import { asUser } from "./setup";

let ownerId: string;
let friendId: string;
let shareId: number;

beforeEach(async () => {
  ownerId = (await createUser()).id;
  friendId = (await createUser()).id;
  const exercise = await createExercise();
  const { program } = await createProgram(ownerId, [{ exerciseId: exercise.id, sets: [{}] }]);
  await db.insert(friendships).values({ requesterId: ownerId, addresseeId: friendId, status: "accepted" });
  asUser(ownerId);
  expect((await shareProgram({ programId: program.id, friendUserId: friendId })).success).toBe(true);
  asUser(friendId);
  const incoming = await getIncomingShares();
  if (!incoming.success) throw new Error(incoming.error);
  shareId = incoming.data[0].shareId;
});

async function incomingIds() {
  const result = await getIncomingShares();
  if (!result.success) throw new Error(result.error);
  return result.data.map((s) => s.shareId);
}

describe("a program share after the friendship ends", () => {
  beforeEach(async () => {
    await db.delete(friendships).where(eq(friendships.requesterId, ownerId));
  });

  it("is not listed and cannot be copied", async () => {
    expect(await incomingIds()).toEqual([]);
    expect((await copySharedProgram({ shareId })).success).toBe(false);
  });

  it("comes back when the two are friends again", async () => {
    await db.insert(friendships).values({ requesterId: friendId, addresseeId: ownerId, status: "accepted" });
    expect(await incomingIds()).toEqual([shareId]);
    expect((await copySharedProgram({ shareId })).success).toBe(true);
  });

  it("stays hidden while a new request is only pending", async () => {
    await db.insert(friendships).values({ requesterId: friendId, addresseeId: ownerId, status: "pending" });
    expect(await incomingIds()).toEqual([]);
    expect((await copySharedProgram({ shareId })).success).toBe(false);
  });
});
