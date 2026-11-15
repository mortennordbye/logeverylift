import { McpConnectCard } from "@/components/features/McpConnectCard";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/utils/session";

import { BackLink } from "@/components/ui/BackLink";

/** "Connect an assistant" under the AI coach hub (docs/plans/ai-coach-hub.md). */
export default async function ConnectAssistantPage() {
  await requireSession();
  const mcpEndpoint = `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/api/mcp`;
  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <BackLink fallback={{ href: "/more/ai-coach", label: "AI coach" }} />
      </div>
      <div className="px-4 pt-2 pb-4 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">Connect an assistant</h1>
      </div>
      <div className="flex-1 overflow-y-auto flex flex-col gap-5 px-4 pb-8">
        <p className="text-sm text-muted-foreground">
          Your own assistant can then read your training, plan with you, change your programs and training days, and
          read your notes. You see every change in the AI coach, and you can undo it.
        </p>
        <ol className="flex flex-col gap-2 text-sm">
          <li>1 · In your assistant&apos;s settings, add a connector with the address below.</li>
          <li>2 · Sign in to LogEveryLift when it asks.</li>
          <li>3 · Pick Read only, or Read and change.</li>
        </ol>
        <McpConnectCard endpoint={mcpEndpoint} />
      </div>
    </div>
  );
}
