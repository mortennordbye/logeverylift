import { WorkoutSessionInitializer } from "@/components/features/WorkoutSessionInitializer";
import { getUserSettings } from "@/lib/user-settings";
import { requireSession } from "@/lib/utils/session";
import { Suspense } from "react";

type Props = {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
};

/**
 * The initializer dates a new session in the user's own time zone, so the
 * session's date and the server's "today" agree (src/lib/utils/user-date.ts).
 */
async function SessionInitializer({ programId }: { programId: number }) {
  const session = await requireSession();
  const { timeZone } = await getUserSettings(session.user.id);
  return <WorkoutSessionInitializer programId={programId} timeZone={timeZone} />;
}

export default async function WorkoutLayout({ children, params }: Props) {
  const { id } = await params;
  const programId = Number(id);
  return (
    <>
      {!Number.isNaN(programId) && (
        <Suspense fallback={null}>
          <SessionInitializer programId={programId} />
        </Suspense>
      )}
      {children}
    </>
  );
}
