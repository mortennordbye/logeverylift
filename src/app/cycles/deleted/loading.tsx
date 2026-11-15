import { ListPageSkeleton } from "@/components/ui/PageSkeletons";

export default function RecentlyDeletedLoading() {
  return <ListPageSkeleton title="Recently deleted" rows={3} back={{ href: "/cycles", label: "Plan" }} />;
}
