import { db } from "@/db";
import { programs } from "@/db/schema";
import { WorkoutSessionInitializer } from "@/components/features/WorkoutSessionInitializer";
import { livePrograms } from "@/lib/plan-live";
import { getUserSettings } from "@/lib/user-settings";
import { requireSession } from "@/lib/utils/session";
import { and, eq } from "drizzle-orm";
import { Suspense } from "react";

type Props = {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
};

/**
 * The initializer dates a new session in the user's own time zone, so the
 * session's date and the server's "today" agree (src/lib/utils/user-date.ts).
 * It also keeps the program's version as the workout starts: the finish flush
 * sends it, so a plan changed in the meantime is not overwritten silently
 * (docs/plans/revisions.md, 2.7).
 */
async function SessionInitializer({ programId }: { programId: number }) {
  const session = await requireSession();
  const [{ timeZone }, [program]] = await Promise.all([
    getUserSettings(session.user.id),
    db
      .select({ version: programs.version })
      .from(programs)
      .where(and(eq(programs.id, programId), eq(programs.userId, session.user.id), livePrograms)),
  ]);
  return <WorkoutSessionInitializer programId={programId} timeZone={timeZone} planVersion={program?.version ?? null} />;
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
