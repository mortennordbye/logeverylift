import { ListPageSkeleton } from "@/components/ui/PageSkeletons";

export default function CoachMemoryLoading() {
  return <ListPageSkeleton title="Memory" rows={3} back={{ href: "/more/ai-coach", label: "AI coach" }} />;
}
