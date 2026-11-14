import { ListPageSkeleton } from "@/components/ui/PageSkeletons";

export default function AssistantChangesLoading() {
  return <ListPageSkeleton title="Assistant changes" rows={3} back={{ href: "/more/assistants", label: "Connected assistants" }} />;
}
