import { ListPageSkeleton } from "@/components/ui/PageSkeletons";

export default function NewSeasonLoading() {
  return <ListPageSkeleton title="New season" rows={4} back={{ href: "/cycles", label: "Cycles" }} />;
}
