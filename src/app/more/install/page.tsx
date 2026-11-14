import { InstallGuideClient } from "@/components/features/InstallGuideClient";

import { BackLink } from "@/components/ui/BackLink";

export default function InstallGuidePage() {
  return (
    <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <BackLink fallback={{ href: "/settings", label: "Settings" }} />
      </div>
      <div className="px-4 pt-2 pb-4 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">Add to iPhone</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-nav-safe pt-2">
        <InstallGuideClient />
      </div>
    </div>
  );
}
