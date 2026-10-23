import { ConsentForm } from "@/components/features/ConsentForm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { needsTermsConsent } from "@/lib/consent";
import { requireSession } from "@/lib/utils/session";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

export default async function ConsentPage() {
  const session = await requireSession();
  if (!(await needsTermsConsent(session))) redirect("/");
  const [row] = await db
    .select({ termsAcceptedAt: users.termsAcceptedAt })
    .from(users)
    .where(eq(users.id, session.user.id));

  return (
    <div className="h-[100dvh] overflow-y-auto bg-background">
      <div className="mx-auto max-w-md px-6 pt-16 pb-16 flex flex-col gap-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {row?.termsAcceptedAt ? "Updated terms" : "Before you start"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {row?.termsAcceptedAt
              ? "The privacy policy or terms of use have changed. Please read and accept them to keep using LogEveryLift."
              : "LogEveryLift stores your training and body data to work. Please read and accept how that is handled."}
          </p>
        </div>
        <ConsentForm />
      </div>
    </div>
  );
}
