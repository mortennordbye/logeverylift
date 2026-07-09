import { AdminTokensClient } from "@/components/features/AdminTokensClient";
import { listInviteTokens } from "@/lib/actions/invite-tokens";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AdminTokensPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "admin") redirect("/");

  const result = await listInviteTokens();
  const tokens = result.success ? result.data : [];

  return <AdminTokensClient tokens={tokens} />;
}
