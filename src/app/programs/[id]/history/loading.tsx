import { ListPageSkeleton } from "@/components/ui/PageSkeletons";

export default function ProgramHistoryLoading() {
  return <ListPageSkeleton title="History" rows={4} back={{ href: "", label: "Program" }} />;
}
