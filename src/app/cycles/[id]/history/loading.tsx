import { ListPageSkeleton } from "@/components/ui/PageSkeletons";

export default function CycleHistoryLoading() {
  return <ListPageSkeleton title="Change history" rows={4} back={{ href: "", label: "Cycle" }} />;
}
