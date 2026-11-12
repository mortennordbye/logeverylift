import { Skeleton } from "@/components/ui/Skeleton";

export default function SettingsLoading() {
  return (
    <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0" />
      <h1 className="text-3xl font-bold tracking-tight px-4 pt-2 pb-0 shrink-0">Settings</h1>
      <div className="flex-1 overflow-y-auto px-4 pt-6 space-y-6">
        {[180, 140, 80, 80].map((h, i) => (
          <Skeleton key={i} className="w-full rounded-2xl" style={{ height: h }} />
        ))}
      </div>
    </div>
  );
}
