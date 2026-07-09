import { AdminFeedbackClient } from "@/components/features/AdminFeedbackClient";
import { listFeedback } from "@/lib/actions/feedback";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AdminFeedbackPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "admin") redirect("/");

  const result = await listFeedback();
  const items = result.success ? result.data : [];

  return <AdminFeedbackClient initial={items} />;
}
