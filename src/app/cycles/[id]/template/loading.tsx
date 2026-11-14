import { ListPageSkeleton } from "@/components/ui/PageSkeletons";

export default function CycleTemplateLoading() {
  return <ListPageSkeleton title="Weekly template" rows={7} back={{ href: "/cycles", label: "Plan" }} />;
}
