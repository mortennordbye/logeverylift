import { ListPageSkeleton } from "@/components/ui/PageSkeletons";

export default function AssistantsLoading() {
  return <ListPageSkeleton title="Connected assistants" rows={2} back={{ href: "/more", label: "More" }} />;
}
