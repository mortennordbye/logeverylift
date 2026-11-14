import { ListPageSkeleton } from "@/components/ui/PageSkeletons";

export default function FeedbackLoading() {
  return <ListPageSkeleton title="Feedback" rows={3} back={{ href: "/more", label: "More" }} />;
}
