import { ListPageSkeleton } from "@/components/ui/PageSkeletons";

export default function MeasureLogLoading() {
  return <ListPageSkeleton title="" rows={3} back={{ href: "/more/account/measurements", label: "Measurements" }} />;
}
