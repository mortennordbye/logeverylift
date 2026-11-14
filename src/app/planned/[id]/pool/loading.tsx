import { ListPageSkeleton } from "@/components/ui/PageSkeletons";

export default function PoolLoading() {
  return <ListPageSkeleton title="Pool view" rows={4} back={null} />;
}
