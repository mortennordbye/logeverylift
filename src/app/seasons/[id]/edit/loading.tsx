import { ListPageSkeleton } from "@/components/ui/PageSkeletons";

export default function EditSeasonLoading() {
  return <ListPageSkeleton title="Edit season" rows={4} back={{ href: "", label: "Season" }} />;
}
