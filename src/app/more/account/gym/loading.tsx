import { ListPageSkeleton } from "@/components/ui/PageSkeletons";

export default function GymPickerLoading() {
  return <ListPageSkeleton title="Your gym" rows={3} back={{ href: "/more/account/privacy-and-security", label: "Privacy and security" }} />;
}
