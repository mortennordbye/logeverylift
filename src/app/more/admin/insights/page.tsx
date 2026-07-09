import { AdminInsightsClient } from "@/components/features/AdminInsightsClient";
import { getAdminInsights } from "@/lib/actions/admin-insights";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AdminInsightsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "admin") redirect("/");

  const result = await getAdminInsights();
  if (!result.success) {
    return <div className="p-8 text-destructive">{result.error}</div>;
  }

  return <AdminInsightsClient data={result.data} />;
}
