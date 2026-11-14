import { ListPageSkeleton } from "@/components/ui/PageSkeletons";

export default function NutritionLoading() {
  return <ListPageSkeleton title="Nutrition" rows={4} back={{ href: "/more", label: "More" }} />;
}
