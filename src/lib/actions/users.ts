"use server";

import { db } from "@/db";
import { users } from "@/db/schema";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/utils/session";
import type { ActionResult } from "@/types/workout";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { z } from "zod";

const createUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.email(),
  password: z.string().min(8).max(128),
  role: z.enum(["user", "admin"]).default("user"),
});

export type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string | null;
  createdAt: Date;
  invitedById: string | null;
};

export async function listUsers(): Promise<ActionResult<UserRow[]>> {
  const session = await requireSession();
  if (session.user.role !== "admin") {
    return { success: false, error: "Admin access required" };
  }

  try {
    const result = await auth.api.listUsers({
      query: { limit: 100 },
      headers: await headers(),
    });
    const users = (result?.users ?? []).map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: (u as { role?: string }).role ?? "user",
      createdAt: u.createdAt,
      invitedById: (u as { invitedById?: string | null }).invitedById ?? null,
    }));
    return { success: true, data: users };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function createUser(data: unknown): Promise<ActionResult<UserRow>> {
  const session = await requireSession();
  if (session.user.role !== "admin") {
    return { success: false, error: "Admin access required" };
  }

  const validation = createUserSchema.safeParse(data);
  if (!validation.success) {
    return { success: false, error: "Invalid input", fieldErrors: validation.error.flatten().fieldErrors };
  }

  const { name, email, password, role } = validation.data;

  try {
    const result = await auth.api.createUser({
      body: { name, email, password, role },
      headers: await headers(),
    });
    const u = result.user as { id: string; name: string; email: string; role?: string; createdAt: Date };
    // An admin adding someone directly is an invite too. Admin accounts are
    // not credited, matching the backfill in drizzle/0055_invited_by.sql.
    const invitedById = role === "user" ? session.user.id : null;
    if (invitedById) {
      await db.update(users).set({ invitedById }).where(eq(users.id, u.id));
    }
    return {
      success: true,
      data: {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role ?? "user",
        createdAt: u.createdAt,
        invitedById,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Surface duplicate email error clearly
    if (message.toLowerCase().includes("unique") || message.toLowerCase().includes("duplicate")) {
      return { success: false, error: "A user with that email already exists" };
    }
    return { success: false, error: message };
  }
}

export async function removeUser(userId: string): Promise<ActionResult<void>> {
  const session = await requireSession();
  if (session.user.role !== "admin") {
    return { success: false, error: "Admin access required" };
  }
  if (userId === session.user.id) {
    return { success: false, error: "You cannot delete your own account" };
  }

  const idValidation = z.string().min(1).safeParse(userId);
  if (!idValidation.success) {
    return { success: false, error: "Invalid user ID" };
  }

  try {
    await auth.api.removeUser({
      body: { userId },
      headers: await headers(),
    });
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function setUserRole(
  userId: string,
  role: "user" | "admin",
): Promise<ActionResult<void>> {
  const session = await requireSession();
  if (session.user.role !== "admin") {
    return { success: false, error: "Admin access required" };
  }

  try {
    await auth.api.setRole({
      body: { userId, role },
      headers: await headers(),
    });
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
