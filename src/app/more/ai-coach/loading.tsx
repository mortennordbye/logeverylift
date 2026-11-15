import { ListPageSkeleton } from "@/components/ui/PageSkeletons";

export default function AiCoachLoading() {
  return <ListPageSkeleton title="AI coach" rows={3} back={{ href: "/more", label: "More" }} />;
}
