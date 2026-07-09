import { MoreClient } from "@/components/features/MoreClient";
import { requireSession } from "@/lib/utils/session";

export const dynamic = "force-dynamic";

export default async function MorePage() {
  const session = await requireSession();
  const role = (session.user as { role?: string }).role ?? "user";
  return <MoreClient role={role} />;
}
