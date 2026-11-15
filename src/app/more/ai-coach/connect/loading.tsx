import { ListPageSkeleton } from "@/components/ui/PageSkeletons";

export default function ConnectAssistantLoading() {
  return <ListPageSkeleton title="Connect an assistant" rows={3} back={{ href: "/more/ai-coach", label: "AI coach" }} />;
}
