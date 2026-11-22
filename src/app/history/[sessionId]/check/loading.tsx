import { ListPageSkeleton } from "@/components/ui/PageSkeletons";

export default function HistoryCheckLoading() {
  return <ListPageSkeleton title="Every step" rows={4} back={{ href: "", label: "Workout" }} />;
}
