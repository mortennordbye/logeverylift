import { db } from "@/db";
import { programs } from "@/db/schema";
import { WorkoutSessionInitializer } from "@/components/features/WorkoutSessionInitializer";
import { livePrograms } from "@/lib/plan-live";
import { getUserSettings } from "@/lib/user-settings";
import { requireSession } from "@/lib/utils/session";
import { and, eq } from "drizzle-orm";
import { Suspense } from "react";

/**
 * The initializer dates a new session in the user's own time zone, so the
 * session's date and the server's "today" agree (src/lib/utils/user-date.ts).
 * It also keeps the program's version as the workout starts: the finish flush
 * sends it, so a plan changed in the meantime is not overwritten silently
 * (docs/plans/revisions.md, 2.7).
 */
async function SessionInitializer({ programId, startNew }: { programId: number; startNew: boolean }) {
  const session = await requireSession();
  const [{ timeZone }, [program]] = await Promise.all([
    getUserSettings(session.user.id),
    db
      .select({ version: programs.version })
      .from(programs)
      .where(and(eq(programs.id, programId), eq(programs.userId, session.user.id), livePrograms)),
  ]);
  return <WorkoutSessionInitializer programId={programId} timeZone={timeZone} planVersion={program?.version ?? null} startNew={startNew} />;
}

/**
 * Rendered by each page under /programs/[id]/workout, not by a layout: only
 * the page knows whether it shows a finished ride or run, where no workout
 * may start (`startNew` false).
 */
export function WorkoutSessionStart({ programId, startNew = true }: { programId: number; startNew?: boolean }) {
  if (Number.isNaN(programId)) return null;
  return (
    <Suspense fallback={null}>
      <SessionInitializer programId={programId} startNew={startNew} />
    </Suspense>
  );
}

/**
 * The layout of the pages that always keep the workout going (add exercise,
 * a set's pages, finish), so each of their returns need not render the start.
 */
export async function WorkoutStartLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <WorkoutSessionStart programId={Number(id)} />
      {children}
    </>
  );
}
