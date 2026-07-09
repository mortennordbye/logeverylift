/**
 * New Cycle Page
 *
 * Form to create a new training cycle (name, duration, schedule type, end action).
 */

import { CreateCycleForm } from "@/components/features/CreateCycleForm";
import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";

export default function NewCyclePage() {
  return (
    <div className="h-[100dvh] bg-background flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <Link
          href="/cycles"
          className="flex items-center gap-0.5 text-primary active:opacity-70 -ml-1 min-h-[44px]"
        >
          <ChevronLeftIcon className="w-5 h-5" />
          <span className="text-sm font-medium">Back</span>
        </Link>
      </div>
      <div className="px-4 pt-2 pb-4 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">New Cycle</h1>
      </div>

      <div className="px-4 pb-nav-safe" style={{ minHeight: "calc(100dvh + var(--kb-height, 0px))" }}>
        <CreateCycleForm />
      </div>
    </div>
  );
}
