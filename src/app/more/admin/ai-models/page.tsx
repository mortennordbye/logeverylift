import { AdminAiModelsClient } from "@/components/features/AdminAiModelsClient";
import { listAiModelConfigs } from "@/lib/actions/ai-model-configs";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AdminAiModelsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "admin") redirect("/");

  const result = await listAiModelConfigs();
  const models = result.success ? result.data : [];

  return <AdminAiModelsClient initialModels={models} />;
}
