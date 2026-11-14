import { ListPageSkeleton } from "@/components/ui/PageSkeletons";

export default function ResultsLoading() {
  return <ListPageSkeleton title="Step results" rows={4} back={{ href: "", label: "Session" }} />;
}
