import { ListPageSkeleton } from "@/components/ui/PageSkeletons";

export default function AiSetupLoading() {
  return <ListPageSkeleton title="Your plan" rows={3} back={{ href: "/more/ai-coach", label: "AI coach" }} />;
}
