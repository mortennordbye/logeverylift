import { Skeleton } from "@/components/ui/Skeleton";

export default function GarminActivityLoading() {
  return (
    <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0" />
      <div className="flex-1 overflow-y-auto px-4 space-y-4">
        <Skeleton className="h-16 w-full rounded-2xl" />
        {[120, 260, 420].map((h, i) => (
          <Skeleton key={i} className="w-full rounded-2xl" style={{ height: h }} />
        ))}
      </div>
    </div>
  );
}
