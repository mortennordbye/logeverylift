import { AdminUsersClient } from "@/components/features/AdminUsersClient";
import { db } from "@/db";
import { users as usersTable } from "@/db/schema";
import { auth } from "@/lib/auth";
import { inArray } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function AdminUsersPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "admin") redirect("/");

  const result = await auth.api.listUsers({
    headers: await headers(),
    query: { limit: 200, sortBy: "createdAt", sortDirection: "desc" },
  });

  // The endurance switch is not a Better Auth field, so it is read here.
  const ids = result.users.map((u) => u.id);
  const flags = ids.length
    ? await db
        .select({ id: usersTable.id, on: usersTable.enduranceEnabled })
        .from(usersTable)
        .where(inArray(usersTable.id, ids))
    : [];
  const enduranceById = new Map(flags.map((f) => [f.id, f.on]));

  const users = result.users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    createdAt: u.createdAt,
    enduranceEnabled: enduranceById.get(u.id) ?? false,
  }));

  return <AdminUsersClient users={users} />;
}
