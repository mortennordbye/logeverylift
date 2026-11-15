import { ListPageSkeleton } from "@/components/ui/PageSkeletons";

export default function OwnAiChatLoading() {
  return <ListPageSkeleton title="Your own AI chat" rows={3} back={{ href: "/more/ai-coach", label: "AI coach" }} />;
}
