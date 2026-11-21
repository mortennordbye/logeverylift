import { ListPageSkeleton } from "@/components/ui/PageSkeletons";

export default function MeasurementsLoading() {
  return <ListPageSkeleton title="Measurements" rows={6} back={{ href: "/more/account/body-and-health", label: "Body and health" }} />;
}
