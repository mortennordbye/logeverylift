import { ListPageSkeleton } from "@/components/ui/PageSkeletons";

export default function AddPhaseLoading() {
  return <ListPageSkeleton title="Add a phase" rows={4} back={{ href: "", label: "Season" }} />;
}
