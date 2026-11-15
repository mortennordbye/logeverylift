import { ListPageSkeleton } from "@/components/ui/PageSkeletons";

export default function AssistantChangesLoading() {
  return <ListPageSkeleton title="Changes" rows={3} back={{ href: "/more/ai-coach", label: "AI coach" }} />;
}
