import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

// Deduplicate getSession() calls within a single server render.
// If multiple server functions call requireSession() in the same request,
// the DB lookup only happens once.
const getSessionCached = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

/**
 * Thrown by `requireAdmin()` and `assertOwner()`. Server Actions that use
 * those helpers should catch this and convert it to an ActionResult error,
 * e.g.:
 *   if (e instanceof ForbiddenError) return { success: false, error: e.message };
 */
export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Verifies the current request has a valid session.
 * Redirects to /login if unauthenticated.
 * Use this in Server Components and Server Actions.
 */
export async function requireSession() {
  const session = await getSessionCached();
  if (!session) redirect("/login");
  return session;
}

/**
 * Verifies the current request has an admin session. Throws ForbiddenError
 * for non-admin users. Use this in Server Actions that should be admin-only;
 * wrap the action body in try/catch and convert ForbiddenError to an
 * ActionResult error (see ForbiddenError docstring).
 */
export async function requireAdmin() {
  const session = await requireSession();
  if (session.user.role !== "admin") {
    throw new ForbiddenError("Admin access required");
  }
  return session;
}

/**
 * Asserts the resource exists AND is owned by `authUserId`. Throws
 * ForbiddenError if missing or not owned. Narrows the type to non-null.
 *
 * Use this whenever a Server Action acts on a resource by id — it makes
 * the ownership check impossible to forget. The `userId` field on the
 * resource is compared against the calling user's id.
 */
export function assertOwner<T extends { userId: string }>(
  resource: T | null | undefined,
  authUserId: string,
): asserts resource is T {
  if (!resource) throw new ForbiddenError("Not found");
  if (resource.userId !== authUserId) throw new ForbiddenError();
}

/**
 * Returns the session if present, null otherwise.
 * Use this when you need to conditionally render based on auth state
 * without triggering a redirect.
 */
export async function getOptionalSession() {
  return auth.api.getSession({ headers: await headers() });
}
