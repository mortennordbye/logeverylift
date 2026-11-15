import { ListPageSkeleton } from "@/components/ui/PageSkeletons";

export default function AccountSubPageLoading() {
  return <ListPageSkeleton title="" rows={5} back={{ href: "/more/account", label: "Account" }} />;
}
