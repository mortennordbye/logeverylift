import { ListPageSkeleton } from "@/components/ui/PageSkeletons";

export default function AddPhaseWeekLoading() {
  return <ListPageSkeleton title="Build the week" rows={7} back={{ href: "", label: "Season" }} />;
}
