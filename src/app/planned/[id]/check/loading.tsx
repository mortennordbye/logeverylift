import { ListPageSkeleton } from "@/components/ui/PageSkeletons";

export default function PlannedCheckLoading() {
  return <ListPageSkeleton title="Every step" rows={4} back={{ href: "", label: "Session" }} />;
}
