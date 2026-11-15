import { ListPageSkeleton } from "@/components/ui/PageSkeletons";

export default function AssistantsLoading() {
  return <ListPageSkeleton title="Connection" rows={2} back={{ href: "/more/ai-coach", label: "AI coach" }} />;
}
