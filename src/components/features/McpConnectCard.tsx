"use client";

/**
 * In-app help for connecting an MCP client (e.g. Claude) to the user's account.
 * Shown on the AI Setup page. The endpoint is computed server-side from env and
 * passed in; copy buttons mirror the app's existing clipboard pattern.
 */

import { Check, Copy } from "lucide-react";
import { useState } from "react";

function CopyRow({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={`Copy ${label}`}
      className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-left active:opacity-70 min-h-[44px]"
    >
      <code className="flex-1 min-w-0 text-xs font-mono break-all">{value}</code>
      {copied ? (
        <Check className="w-4 h-4 text-primary flex-none" />
      ) : (
        <Copy className="w-4 h-4 text-muted-foreground flex-none" />
      )}
    </button>
  );
}

export function McpConnectCard({ endpoint }: { endpoint: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const cli = `claude mcp add --transport http logeverylift ${endpoint}`;

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      // Clipboard blocked — the text is still selectable.
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Connect an AI assistant (MCP)
      </p>
      <div className="bg-card rounded-2xl px-4 py-4 flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Connect an MCP client (like Claude Desktop or Claude Code) to manage
          your programs, training cycles, and profile by chatting with an AI.
          Point the client at this endpoint:
        </p>

        <CopyRow
          label="MCP endpoint"
          value={endpoint}
          copied={copied === "endpoint"}
          onCopy={() => copy("endpoint", endpoint)}
        />

        <p className="text-sm text-muted-foreground">
          Or add it to the Claude Code CLI:
        </p>
        <CopyRow
          label="CLI command"
          value={cli}
          copied={copied === "cli"}
          onCopy={() => copy("cli", cli)}
        />

        <div className="bg-primary/10 rounded-xl px-3 py-2.5">
          <p className="text-sm text-primary">
            <span className="font-semibold">Sign-in required.</span> The client
            opens a one-time login in your browser and connects to your account
            over OAuth. It can only read and change your own data — never anyone
            else&apos;s.
          </p>
        </div>
      </div>
    </div>
  );
}
