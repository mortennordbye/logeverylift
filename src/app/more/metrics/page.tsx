import { MetricsClient } from "@/components/features/MetricsClient";
import {
  getExerciseProgress,
  getMetricsData,
  getMetricsCycles,
  getSummaryStats,
  getTopProgressingExercises,
  getCardioMetrics,
  getTriathlonMetrics,
  getHeatmapData,
  getMovementPatternBalance,
  getReadinessPerformance,
  getWeeklyMuscleVolume,
  getRecentPRs,
} from "@/lib/actions/metrics";
import { getWeightHistory } from "@/lib/actions/profile";
import { db } from "@/db";
import { exercises } from "@/db/schema/exercises";
import { users } from "@/db/schema/users";
import { loadArtThumbs } from "@/lib/exercise-art/load";
import { requireSession } from "@/lib/utils/session";
import { and, eq, inArray } from "drizzle-orm";

type Props = {
  searchParams: Promise<{ tab?: string }>;
};

export default async function MetricsPage({ searchParams }: Props) {
  const session = await requireSession();
  const userId = session.user.id;

  // Fetch metrics first to discover the top exercise for the progress chart
  const metricsResult = await getMetricsData();
  const metrics = metricsResult.success
    ? metricsResult.data
    : { weekly: [], personalRecords: [], muscleBalance: [], moodDistribution: [] };

  const topExercise = metrics.personalRecords[0] ?? null;

  // Batch remaining queries in parallel, including progress chart now that we know the exercise
  const [
    summaryResult,
    topProgressResult,
    weightHistoryResult,
    userRow,
    progressResult,
    cyclesResult,
    cardioResult,
    triathlonResult,
    heatmapResult,
    movementResult,
    readinessResult,
    weeklyVolumeResult,
    prFeedResult,
  ] = await Promise.all([
    getSummaryStats(),
    getTopProgressingExercises(),
    getWeightHistory(),
    db.query.users.findFirst({ where: eq(users.id, userId) }),
    topExercise ? getExerciseProgress(topExercise.exerciseId) : Promise.resolve(null),
    getMetricsCycles(),
    getCardioMetrics(),
    getTriathlonMetrics(),
    getHeatmapData(),
    getMovementPatternBalance(),
    getReadinessPerformance(),
    getWeeklyMuscleVolume(),
    getRecentPRs(150),
  ]);
  const initialTab = (await searchParams).tab === "records" ? "records" : "alltime";

  // Stills for every exercise the lists show. Built-ins only: a custom
  // exercise that shares a name is not the movement that was drawn.
  const listedIds = [
    ...metrics.personalRecords.map((r) => r.exerciseId),
    ...(topProgressResult.success ? topProgressResult.data.map((r) => r.exerciseId) : []),
    ...(prFeedResult.success ? prFeedResult.data.map((r) => r.exerciseId) : []),
  ];
  const builtIns = listedIds.length
    ? await db
        .select({ id: exercises.id, name: exercises.name })
        .from(exercises)
        .where(and(inArray(exercises.id, [...new Set(listedIds)]), eq(exercises.isCustom, false)))
    : [];
  const artThumbs = await loadArtThumbs(builtIns);

  return (
    <MetricsClient
      weekly={metrics.weekly}
      personalRecords={metrics.personalRecords}
      muscleBalance={metrics.muscleBalance}
      moodDistribution={metrics.moodDistribution}
      summaryStats={summaryResult.success ? summaryResult.data : null}
      topProgressing={topProgressResult.success ? topProgressResult.data : []}
      initialProgress={progressResult?.success ? progressResult.data : []}
      initialExerciseId={topExercise?.exerciseId ?? null}
      weightHistory={weightHistoryResult.success ? weightHistoryResult.data : []}
      profileWeightKg={userRow?.weightKg ?? null}
      cycles={cyclesResult.success ? cyclesResult.data : []}
      cardioMetrics={cardioResult.success ? cardioResult.data : null}
      triathlonMetrics={triathlonResult.success ? triathlonResult.data : null}
      heatmapData={heatmapResult.success ? heatmapResult.data : []}
      movementPatternData={movementResult.success ? movementResult.data : []}
      readinessData={readinessResult.success ? readinessResult.data : []}
      weeklyMuscleVolume={weeklyVolumeResult.success ? weeklyVolumeResult.data : []}
      prFeed={prFeedResult.success ? prFeedResult.data : []}
      artThumbs={artThumbs}
      initialTab={initialTab}
    />
  );
}
