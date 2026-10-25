import { ExerciseDetailClient } from "@/components/features/ExerciseDetailClient";
import { getExerciseWithNote } from "@/lib/actions/exercises";
import { getExerciseHistory, getExerciseProgress, getExerciseRecords } from "@/lib/actions/metrics";
import { notFound } from "next/navigation";

export default async function ExerciseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [detail, progress, records, history] = await Promise.all([
    getExerciseWithNote(id),
    getExerciseProgress(id),
    getExerciseRecords(id),
    getExerciseHistory(id),
  ]);
  if (!detail.success) notFound();

  return (
    <ExerciseDetailClient
      exercise={detail.data.exercise}
      note={detail.data.note}
      progress={progress.success ? progress.data : []}
      records={records.success ? records.data : []}
      history={history.success ? history.data : []}
    />
  );
}
