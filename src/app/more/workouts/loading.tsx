import { ListPageSkeleton } from "@/components/ui/PageSkeletons";

export default function WorkoutsLoading() {
  return <ListPageSkeleton title="Workouts" rows={4} back={{ href: "/more", label: "More" }} />;
}
