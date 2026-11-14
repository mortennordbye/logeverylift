import { ListPageSkeleton } from "@/components/ui/PageSkeletons";

export default function AthleteLoading() {
  return <ListPageSkeleton title="Athlete profile" rows={4} back={{ href: "/more", label: "More" }} />;
}
