import { ListPageSkeleton } from "@/components/ui/PageSkeletons";

export default function SeasonLoading() {
  return <ListPageSkeleton title="Season" rows={4} back={{ href: "/cycles", label: "Cycles" }} />;
}
