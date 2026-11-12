import { ThresholdsClient } from "@/components/features/ThresholdsClient";
import { getThresholdsData } from "@/lib/actions/athlete-profile";
import { DEFAULT_UNITS } from "@/lib/utils/units";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";

/** Thresholds (docs/plans/athlete-profile.md, 2.9): for every user (D15). */
export default async function ThresholdsPage() {
  const result = await getThresholdsData();
  const data = result.success ? result.data : null;
  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <Link href="/more" className="flex items-center gap-0.5 text-primary active:opacity-70 -ml-1 min-h-[44px]">
          <ChevronLeft className="w-5 h-5" />
          <span className="text-sm font-medium">More</span>
        </Link>
      </div>
      <div className="px-4 pt-2 pb-4 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">Thresholds</h1>
      </div>
      {!result.success && <p className="px-4 text-sm text-destructive">{result.error}</p>}
      <ThresholdsClient
        rows={(data?.thresholds ?? []).map((t) => ({ id: t.id, kind: t.kind, value: t.value, measuredOn: t.measuredOn, source: t.source }))}
        deleted={(data?.deleted ?? []).map((t) => ({
          id: t.id,
          kind: t.kind,
          value: t.value,
          measuredOn: t.measuredOn,
          source: t.source,
          deletedOn: t.deletedAt!.toISOString().slice(0, 10),
        }))}
        suggestions={(data?.suggestions ?? []).map((s) => ({ kind: s.kind, value: s.value, basis: s.basis }))}
        units={data?.units ?? DEFAULT_UNITS}
        today={data?.today ?? new Date().toISOString().slice(0, 10)}
      />
    </div>
  );
}
