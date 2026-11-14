import { ListPageSkeleton } from "@/components/ui/PageSkeletons";

export default function SeasonHistoryLoading() {
  return <ListPageSkeleton title="History" rows={4} back={{ href: "", label: "Season" }} />;
}
