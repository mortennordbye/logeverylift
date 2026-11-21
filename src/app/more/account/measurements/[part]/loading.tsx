import { ListPageSkeleton } from "@/components/ui/PageSkeletons";

export default function MeasurementPartLoading() {
  return <ListPageSkeleton title="" rows={4} back={{ href: "/more/account/measurements", label: "Measurements" }} />;
}
