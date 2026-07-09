"use server";

import { db } from "@/db";
import { friendships, programExercises, programSets, programShares, programs } from "@/db/schema";
import {
  copySharedProgramSchema,
  shareProgramSchema,
} from "@/lib/validators/friends";
import { requireSession } from "@/lib/utils/session";
import type { ActionResult, IncomingShare, OutgoingShare } from "@/types/workout";
import { and, eq, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";

// ─── Share a Program ───────────────────────────────────────────────────────

export async function shareProgram(data: unknown): Promise<ActionResult<void>> {
  const session = await requireSession();
  const parsed = shareProgramSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: "Invalid request" };
  }

  const me = session.user.id;
  const { programId, friendUserId } = parsed.data;

  try {
    // Verify the program belongs to the current user
    const program = await db.query.programs.findFirst({
      where: eq(programs.id, programId),
    });
    if (!program) {
      return { success: false, error: "Program not found" };
    }
    if (program.userId !== me) {
      return { success: false, error: "You do not own this program" };
    }

    // Verify the target is an accepted friend
    const friendship = await db.query.friendships.findFirst({
      where: and(
        or(
          and(eq(friendships.requesterId, me), eq(friendships.addresseeId, friendUserId)),
          and(eq(friendships.requesterId, friendUserId), eq(friendships.addresseeId, me)),
        ),
        eq(friendships.status, "accepted"),
      ),
    });
    if (!friendship) {
      return { success: false, error: "You can only share programs with friends" };
    }

    // Check for an existing uncopied share of this program with this user
    const existing = await db.query.programShares.findFirst({
      where: and(
        eq(programShares.programId, programId),
        eq(programShares.sharedWithUserId, friendUserId),
        eq(programShares.sharedByUserId, me),
      ),
    });
    if (existing && existing.copiedProgramId === null) {
      return { success: false, error: "You already shared this program with that friend" };
    }

    await db.insert(programShares).values({
      programId,
      sharedByUserId: me,
      sharedWithUserId: friendUserId,
    });

    return { success: true, data: undefined };
  } catch {
    return { success: false, error: "Failed to share program" };
  }
}

// ─── Incoming Shares ───────────────────────────────────────────────────────

export async function getIncomingShares(): Promise<ActionResult<IncomingShare[]>> {
  const session = await requireSession();
  const me = session.user.id;

  try {
    const rows = await db.query.programShares.findMany({
      where: eq(programShares.sharedWithUserId, me),
      with: {
        program: true,
        sharedBy: true,
      },
      orderBy: (s, { desc }) => [desc(s.createdAt)],
    });

    return {
      success: true,
      data: rows.map((row) => ({
        shareId: row.id,
        programId: row.programId,
        programName: row.program.name,
        sharedByUserId: row.sharedByUserId,
        sharedByName: row.sharedBy.name,
        sharedByImage: row.sharedBy.image,
        sharedAt: row.createdAt,
        alreadyCopied: row.copiedProgramId !== null,
      })),
    };
  } catch {
    return { success: false, error: "Failed to load shared programs" };
  }
}

// ─── Outgoing Shares ───────────────────────────────────────────────────────

export async function getOutgoingShares(programId: number): Promise<ActionResult<OutgoingShare[]>> {
  const session = await requireSession();
  const me = session.user.id;

  try {
    const rows = await db.query.programShares.findMany({
      where: and(
        eq(programShares.programId, programId),
        eq(programShares.sharedByUserId, me),
      ),
      with: { sharedWith: true },
      orderBy: (s, { desc }) => [desc(s.createdAt)],
    });

    return {
      success: true,
      data: rows.map((row) => ({
        shareId: row.id,
        sharedWithUserId: row.sharedWithUserId,
        sharedWithName: row.sharedWith.name,
        sharedWithImage: row.sharedWith.image,
        copiedProgramId: row.copiedProgramId,
        sharedAt: row.createdAt,
      })),
    };
  } catch {
    return { success: false, error: "Failed to load shares" };
  }
}

// ─── Copy Shared Program ───────────────────────────────────────────────────

export async function copySharedProgram(
  data: unknown,
): Promise<ActionResult<{ programId: number }>> {
  const session = await requireSession();
  const parsed = copySharedProgramSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: "Invalid request" };
  }

  const me = session.user.id;
  const { shareId } = parsed.data;

  try {
    const share = await db.query.programShares.findFirst({
      where: eq(programShares.id, shareId),
      with: {
        program: {
          with: {
            programExercises: {
              orderBy: (pe, { asc }) => [asc(pe.orderIndex)],
              with: {
                programSets: {
                  orderBy: (ps, { asc }) => [asc(ps.setNumber)],
                },
              },
            },
          },
        },
      },
    });

    if (!share) {
      return { success: false, error: "Share not found" };
    }
    if (share.sharedWithUserId !== me) {
      return { success: false, error: "Not authorised" };
    }

    let newProgramId: number;

    await db.transaction(async (tx) => {
      // Copy the program
      const [newProgram] = await tx
        .insert(programs)
        .values({
          name: share.program.name,
          userId: me,
        })
        .returning({ id: programs.id });

      newProgramId = newProgram.id;

      // Copy each exercise slot
      for (const pe of share.program.programExercises) {
        const [newPe] = await tx
          .insert(programExercises)
          .values({
            programId: newProgramId,
            exerciseId: pe.exerciseId,
            orderIndex: pe.orderIndex,
            notes: pe.notes ?? undefined,
            overloadIncrementKg: pe.overloadIncrementKg ?? undefined,
            overloadIncrementReps: pe.overloadIncrementReps ?? 0,
            progressionMode: pe.progressionMode ?? "manual",
          })
          .returning({ id: programExercises.id });

        // Copy each set blueprint
        if (pe.programSets.length > 0) {
          await tx.insert(programSets).values(
            pe.programSets.map((ps) => ({
              programExerciseId: newPe.id,
              setNumber: ps.setNumber,
              targetReps: ps.targetReps ?? undefined,
              weightKg: ps.weightKg ?? undefined,
              durationSeconds: ps.durationSeconds ?? undefined,
              distanceMeters: ps.distanceMeters ?? undefined,
              inclinePercent: ps.inclinePercent ?? undefined,
              targetHeartRateZone: ps.targetHeartRateZone ?? undefined,
              restTimeSeconds: ps.restTimeSeconds,
              setType: ps.setType,
            })),
          );
        }
      }

      // Mark share as copied
      await tx
        .update(programShares)
        .set({ copiedProgramId: newProgramId })
        .where(eq(programShares.id, shareId));
    });

    revalidatePath("/programs");
    return { success: true, data: { programId: newProgramId! } };
  } catch {
    return { success: false, error: "Failed to copy program" };
  }
}

// ─── Revoke Share ──────────────────────────────────────────────────────────

export async function revokeShare(shareId: number): Promise<ActionResult<void>> {
  const session = await requireSession();
  const me = session.user.id;

  try {
    const share = await db.query.programShares.findFirst({
      where: eq(programShares.id, shareId),
    });

    if (!share) {
      return { success: false, error: "Share not found" };
    }
    if (share.sharedByUserId !== me) {
      return { success: false, error: "Not authorised" };
    }

    await db.delete(programShares).where(eq(programShares.id, shareId));

    return { success: true, data: undefined };
  } catch {
    return { success: false, error: "Failed to revoke share" };
  }
}
