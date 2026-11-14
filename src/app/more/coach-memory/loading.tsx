import { ListPageSkeleton } from "@/components/ui/PageSkeletons";

export default function CoachMemoryLoading() {
  return <ListPageSkeleton title="Coach memory" rows={3} back={{ href: "/more/assistants", label: "Connected assistants" }} />;
}
