"use server";

import { db } from "@/db";
import { inviteTokens } from "@/db/schema";
import { auth } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { ForbiddenError, requireAdmin } from "@/lib/utils/session";
import type { ActionResult } from "@/types/workout";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { randomBytes } from "crypto";
import { z } from "zod";

const registerWithTokenSchema = z.object({
  token: z.string().trim().min(1),
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200),
});

const TOKEN_VALIDATE_LIMIT = { windowMs: 15 * 60_000, max: 30 };
const TOKEN_REGISTER_LIMIT = { windowMs: 60 * 60_000, max: 5 };

async function callerIp(): Promise<string> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "unknown";
  return h.get("x-real-ip") ?? h.get("cf-connecting-ip") ?? "unknown";
}

type InviteToken = typeof inviteTokens.$inferSelect;

// ─── Public (no session required) ────────────────────────────────────────────

export async function validateInviteToken(
  token: string,
): Promise<ActionResult<{ id: string }>> {
  const ip = await callerIp();
  const blocked = checkRateLimit(`invite-validate:${ip}`, TOKEN_VALIDATE_LIMIT);
  if (blocked) {
    return { success: false, error: "Too many attempts. Please try again later." };
  }

  try {
    const row = await db.query.inviteTokens.findFirst({
      where: (t, { eq }) => eq(t.token, token.trim()),
    });

    if (!row) return { success: false, error: "Invalid invite token" };

    if (row.expiresAt && row.expiresAt < new Date()) {
      return { success: false, error: "This invite token has expired" };
    }

    if (row.maxUses !== null && row.usedCount >= row.maxUses) {
      return { success: false, error: "This invite token has already been used" };
    }

    return { success: true, data: { id: row.id } };
  } catch (error) {
    console.error("[validateInviteToken] failed", error);
    return { success: false, error: "Failed to validate token" };
  }
}

export async function registerWithToken(
  token: string,
  name: string,
  email: string,
  password: string,
): Promise<ActionResult> {
  const ip = await callerIp();
  const blocked = checkRateLimit(`invite-register:${ip}`, TOKEN_REGISTER_LIMIT);
  if (blocked) {
    return { success: false, error: "Too many attempts. Please try again later." };
  }

  const parsed = registerWithTokenSchema.safeParse({ token, name, email, password });
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    // Re-validate token under a transaction to prevent double-use
    const row = await db.query.inviteTokens.findFirst({
      where: (t, { eq }) => eq(t.token, parsed.data.token),
    });

    if (!row) return { success: false, error: "Invalid invite token" };

    if (row.expiresAt && row.expiresAt < new Date()) {
      return { success: false, error: "This invite token has expired" };
    }

    if (row.maxUses !== null && row.usedCount >= row.maxUses) {
      return { success: false, error: "This invite token has already been used" };
    }

    // Create the user via better-auth's public sign-up endpoint
    const result = await auth.api.signUpEmail({
      body: {
        name: parsed.data.name,
        email: parsed.data.email,
        password: parsed.data.password,
      },
    });

    if (!result?.user) {
      return { success: false, error: "Failed to create account" };
    }

    // Increment token usage after successful account creation
    await db
      .update(inviteTokens)
      .set({ usedCount: row.usedCount + 1 })
      .where(eq(inviteTokens.id, row.id));

    return { success: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("email") || message.includes("user already exists")) {
      return { success: false, error: "An account with this email already exists" };
    }
    console.error("[registerWithToken] failed", error);
    return { success: false, error: "Failed to create account. Please try again." };
  }
}

// ─── Admin only ───────────────────────────────────────────────────────────────

export async function listInviteTokens(): Promise<ActionResult<InviteToken[]>> {
  try {
    await requireAdmin();
    const rows = await db.query.inviteTokens.findMany({
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    });
    return { success: true, data: rows };
  } catch (e) {
    if (e instanceof ForbiddenError) return { success: false, error: e.message };
    console.error("[listInviteTokens] failed", e);
    return { success: false, error: "Failed to load invite tokens" };
  }
}

export async function createInviteToken(data: {
  label: string;
  token: string | null;
  maxUses: number | null;
  expiresAt: Date | null;
}): Promise<ActionResult<InviteToken>> {
  try {
    const session = await requireAdmin();
    const token = data.token ?? randomBytes(12).toString("base64url");
    const id = randomBytes(8).toString("hex");

    // Check for token collision
    const existing = await db.query.inviteTokens.findFirst({
      where: (t, { eq }) => eq(t.token, token),
    });
    if (existing) {
      return { success: false, error: "A token with that value already exists" };
    }

    const [row] = await db
      .insert(inviteTokens)
      .values({
        id,
        token,
        label: data.label.trim() || null,
        createdBy: session.user.id,
        maxUses: data.maxUses,
        expiresAt: data.expiresAt,
      })
      .returning();

    return { success: true, data: row };
  } catch (e) {
    if (e instanceof ForbiddenError) return { success: false, error: e.message };
    console.error("[createInviteToken] failed", e);
    return { success: false, error: "Failed to create invite token" };
  }
}

export async function revokeInviteToken(id: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    await db.delete(inviteTokens).where(eq(inviteTokens.id, id));
    return { success: true, data: undefined };
  } catch (e) {
    if (e instanceof ForbiddenError) return { success: false, error: e.message };
    console.error("[revokeInviteToken] failed", e);
    return { success: false, error: "Failed to revoke invite token" };
  }
}
