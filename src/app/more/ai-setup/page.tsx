import { AiSetupClient } from "@/components/features/AiSetupClient";
import { env } from "@/lib/env";
import { getAllExercises } from "@/lib/actions/exercises";
import { getAiRateLimitStatus } from "@/lib/actions/ai-generate";
import { parseUserGoals } from "@/lib/utils/goals";
import { requireSession } from "@/lib/utils/session";
import { db } from "@/db";
import { exercisePrs } from "@/db/schema/exercise-prs";
import { exercises } from "@/db/schema/exercises";
import { programs } from "@/db/schema/programs";
import { users } from "@/db/schema/users";
import { type PrData } from "@/lib/utils/ai-prompt";
import { and, eq, isNull } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AiSetupPage() {
  const session = await requireSession();
  const userId = session.user.id;

  const [exerciseResult, user, rateLimitResult, rawPrs, userPrograms] = await Promise.all([
    getAllExercises(),
    db.query.users.findFirst({ where: eq(users.id, userId) }),
    getAiRateLimitStatus(),
    db
      .select({ exerciseName: exercises.name, prType: exercisePrs.prType, value: exercisePrs.value })
      .from(exercisePrs)
      .innerJoin(exercises, eq(exercisePrs.exerciseId, exercises.id))
      .where(and(eq(exercisePrs.userId, userId), isNull(exercisePrs.supersededAt))),
    db.select({ name: programs.name }).from(programs).where(eq(programs.userId, userId)),
  ]);

  const exerciseList = exerciseResult.success ? exerciseResult.data : [];
  const userProfile = {
    gender: user?.gender ?? null,
    birthYear: user?.birthYear ?? null,
    heightCm: user?.heightCm ?? null,
    weightKg: user?.weightKg ?? null,
    goals: parseUserGoals(user?.goals),
    experienceLevel: user?.experienceLevel ?? null,
  };

  const { generationsToday, dailyLimit } = rateLimitResult.success
    ? rateLimitResult.data
    : { generationsToday: 0, dailyLimit: 5 };

  // Deduplicate: one entry per exercise, preferring estimated_1rm over weight
  const prMap = new Map<string, PrData>();
  for (const pr of rawPrs) {
    const entry = prMap.get(pr.exerciseName) ?? { exerciseName: pr.exerciseName };
    if (pr.prType === "estimated_1rm") entry.estimated1rm = Math.round(Number(pr.value));
    else if (pr.prType === "weight" && !entry.estimated1rm) entry.maxWeight = Math.round(Number(pr.value));
    prMap.set(pr.exerciseName, entry);
  }
  const prs = Array.from(prMap.values());
  const existingProgramNames = userPrograms.map((p) => p.name);

  const mcpEndpoint = `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/api/mcp`;

  return (
    <div className="h-[100dvh] bg-background overflow-y-auto">
      <div
        className="flex flex-col"
        style={{ minHeight: "calc(100dvh + var(--kb-height, 0px))", paddingBottom: "calc(4rem + env(safe-area-inset-bottom, 0px) + var(--kb-height, 0px))" }}
      >
        <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
          <Link href="/more" className="flex items-center gap-0.5 text-primary active:opacity-70 -ml-1 min-h-[44px]">
            <ChevronLeft className="w-5 h-5" />
            <span className="text-sm font-medium">More</span>
          </Link>
        </div>
        <div className="px-4 pt-2 pb-4 shrink-0">
          <h1 className="text-3xl font-bold tracking-tight">AI Setup</h1>
          <p className="text-sm text-muted-foreground mt-1">Generate your programs and training schedule in seconds.</p>
        </div>
        <AiSetupClient
          exercises={exerciseList}
          userProfile={userProfile}
          generationsToday={generationsToday}
          dailyLimit={dailyLimit}
          prs={prs}
          existingProgramNames={existingProgramNames}
          mcpEndpoint={mcpEndpoint}
        />
      </div>
    </div>
  );
}
