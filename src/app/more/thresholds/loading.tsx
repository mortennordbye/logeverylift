import { ListPageSkeleton } from "@/components/ui/PageSkeletons";

export default function ThresholdsLoading() {
  return <ListPageSkeleton title="Thresholds" rows={6} back={{ href: "/more", label: "More" }} />;
}
