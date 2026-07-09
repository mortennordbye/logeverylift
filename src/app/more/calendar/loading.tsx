import { Skeleton } from "@/components/ui/Skeleton";

export default function CalendarLoading() {
  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0" />
      <div className="px-4 pt-2 pb-4 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">Calendar</h1>
      </div>
      <div className="flex-1 overflow-y-auto px-4">
        <div className="space-y-4">
          {/* Month header */}
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-32" />
            <div className="flex gap-2">
              <Skeleton className="h-9 w-9 rounded-full" />
              <Skeleton className="h-9 w-9 rounded-full" />
            </div>
          </div>
          {/* 6 calendar weeks (7 cells each) */}
          {[0, 1, 2, 3, 4, 5].map((week) => (
            <div key={week} className="grid grid-cols-7 gap-1">
              {[0, 1, 2, 3, 4, 5, 6].map((day) => (
                <Skeleton key={day} className="aspect-square rounded-md" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
