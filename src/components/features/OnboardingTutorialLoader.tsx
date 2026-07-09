import { db } from "@/db";
import { users } from "@/db/schema";
import { getOptionalSession } from "@/lib/utils/session";
import { eq } from "drizzle-orm";
import { OnboardingTutorial } from "./OnboardingTutorial";

export async function OnboardingTutorialLoader() {
  const session = await getOptionalSession();
  if (!session) return null;

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { createdAt: true, tutorialDismissedAt: true },
  });
  if (!user) return null;

  const defaultShow = !user.tutorialDismissedAt;

  return <OnboardingTutorial defaultShow={defaultShow} />;
}
