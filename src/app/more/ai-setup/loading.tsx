import { ListPageSkeleton } from "@/components/ui/PageSkeletons";

export default function AiSetupLoading() {
  return <ListPageSkeleton title="AI setup" rows={3} back={{ href: "/more", label: "More" }} />;
}
