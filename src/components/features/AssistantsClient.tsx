"use client";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { disconnectAssistant } from "@/lib/actions/assistants";
import type { McpAccess } from "@/lib/mcp/scopes";
import { callAction } from "@/lib/utils/stale-bundle";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { dateLabel } from "@/lib/utils/date-label";

type Assistant = { id: string; name: string | null; access: McpAccess | null; connectedAt: string };

const ACCESS_LABEL: Record<McpAccess, string> = { read: "Read only", write: "Read and change" };

function formatDate(iso: string) {
  return dateLabel(new Date(iso), "d MMM yyyy", { utc: true });
}

/** The list on More → Connected assistants, with a confirm sheet for disconnect. */
export function AssistantsClient({ assistants }: { assistants: Assistant[] }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<Assistant | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function disconnect() {
    if (!confirming) return;
    setSaving(true);
    setError(null);
    const result = await callAction(disconnectAssistant({ id: confirming.id }));
    setSaving(false);
    if (!result.success) {
      setError(result.error ?? "Couldn't disconnect");
      return;
    }
    setConfirming(null);
    router.refresh();
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 pb-8">
      <p className="text-sm text-muted-foreground mb-4">
        AI assistants you connected to LogEveryLift over MCP. Disconnecting one stops its access at once.
      </p>
      {assistants.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="assistants-empty">
          No assistants connected. To connect one, add LogEveryLift&apos;s MCP server in your assistant&apos;s settings.
        </p>
      ) : (
        <div className="rounded-xl bg-card divide-y divide-border">
          {assistants.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-3 px-4 py-3 min-h-[44px]">
              <div className="min-w-0">
                <p className="font-medium truncate">{a.name ?? "Unnamed assistant"}</p>
                <p className="text-xs text-muted-foreground">
                  {a.access ? ACCESS_LABEL[a.access] : "No access"} · Connected {formatDate(a.connectedAt)}
                </p>
              </div>
              <button
                onClick={() => {
                  setError(null);
                  setConfirming(a);
                }}
                className="shrink-0 min-h-[44px] px-3 text-sm font-medium text-destructive active:opacity-60"
              >
                Disconnect
              </button>
            </div>
          ))}
        </div>
      )}

      <Link
        href="/more/assistants/changes"
        className="mt-4 flex items-center justify-between rounded-xl bg-card px-4 min-h-[44px] text-sm font-medium active:opacity-60"
      >
        Assistant changes
        <span className="text-muted-foreground">›</span>
      </Link>
      <Link
        href="/more/coach-memory"
        className="mt-2 flex items-center justify-between rounded-xl bg-card px-4 min-h-[44px] text-sm font-medium active:opacity-60"
      >
        Coach memory
        <span className="text-muted-foreground">›</span>
      </Link>

      <BottomSheet open={confirming !== null} onClose={() => setConfirming(null)} blur>
        <div className="bg-background rounded-t-2xl px-4 pt-5 pb-8 space-y-4">
          <h2 className="text-lg font-semibold">Disconnect {confirming?.name ?? "this assistant"}?</h2>
          <p className="text-sm text-muted-foreground">
            It loses access to LogEveryLift at once. To use it again, connect it again from the assistant.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button
            onClick={disconnect}
            disabled={saving}
            className="w-full rounded-xl bg-destructive py-4 text-sm font-semibold text-white disabled:opacity-50 active:opacity-80"
          >
            Disconnect
          </button>
          <button
            onClick={() => setConfirming(null)}
            disabled={saving}
            className="w-full rounded-xl bg-muted py-4 text-sm font-semibold disabled:opacity-50 active:opacity-80"
          >
            Cancel
          </button>
        </div>
      </BottomSheet>
    </div>
  );
}
