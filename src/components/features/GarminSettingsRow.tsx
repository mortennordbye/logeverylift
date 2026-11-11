"use client";

import { connectGarmin, disconnectGarmin } from "@/lib/actions/garmin";
import { formatDateShort } from "@/lib/utils/format";
import { callAction } from "@/lib/utils/stale-bundle";
import { Watch } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

const KEY_PAGE = "https://connect.garmin.com/app/settings/personalApiToken";

export function GarminSettingsRow({
  connected: initialConnected,
  lastSyncedAt,
}: {
  connected: boolean;
  lastSyncedAt: string | null;
}) {
  const [connected, setConnected] = useState(initialConnected);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);

  async function connect() {
    setBusy(true);
    setMessage(null);
    const result = await callAction(connectGarmin({ apiKey }));
    setBusy(false);
    if (!result.success) {
      setMessage({ tone: "error", text: result.error });
      return;
    }
    setApiKey("");
    setConnected(true);
    setMessage(
      result.data.syncError
        ? { tone: "error", text: `Connected, but the first sync failed (${result.data.syncError}).` }
        : { tone: "info", text: "Connected. Your Garmin data is in Insights. Older days import in the background." },
    );
  }

  async function disconnect(deleteData: boolean) {
    if (deleteData && !window.confirm("Delete all Garmin data stored in LogEveryLift? This can't be undone.")) return;
    setBusy(true);
    setMessage(null);
    const result = await callAction(disconnectGarmin({ deleteData }));
    setBusy(false);
    if (!result.success) {
      setMessage({ tone: "error", text: result.error });
      return;
    }
    setConnected(false);
    setMessage({ tone: "info", text: deleteData ? "Disconnected. Stored Garmin data deleted." : "Disconnected. Stored data is kept." });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Watch className="w-5 h-5 text-muted-foreground flex-none" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Garmin Connect</p>
          <p className="text-xs text-muted-foreground">
            {connected
              ? `Connected${lastSyncedAt ? ` · last sync ${formatDateShort(lastSyncedAt.slice(0, 10))}` : ""}`
              : "Show HRV, sleep, body battery and activities from your Garmin"}
          </p>
        </div>
        {connected && <span className="text-xs font-semibold text-green-500 flex-none">On</span>}
      </div>

      {connected ? (
        <div className="flex flex-col gap-2">
          <Link
            href="/insights"
            className="h-11 rounded-xl bg-background text-sm font-semibold flex items-center justify-center active:opacity-70"
          >
            Open Insights
          </Link>
          <button
            onClick={() => disconnect(false)}
            disabled={busy}
            className="h-11 rounded-xl bg-background text-sm font-semibold active:opacity-70 disabled:opacity-50"
          >
            Disconnect
          </button>
          <button
            onClick={() => disconnect(true)}
            disabled={busy}
            className="h-11 rounded-xl bg-background text-sm font-semibold text-destructive active:opacity-70 disabled:opacity-50"
          >
            Disconnect and delete Garmin data
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            Make a Personal API key on{" "}
            <a href={KEY_PAGE} target="_blank" rel="noreferrer" className="text-primary underline">
              Garmin Connect
            </a>{" "}
            and paste it here. LogEveryLift stores it encrypted and only reads from Garmin.
          </p>
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            aria-label="Garmin Personal API key"
            placeholder="Personal API key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="h-11 rounded-xl bg-background px-3 text-sm"
          />
          <button
            onClick={connect}
            disabled={busy || apiKey.trim().length < 20}
            className="h-11 rounded-xl bg-primary text-primary-foreground text-sm font-semibold active:opacity-70 disabled:opacity-50"
          >
            {busy ? "Connecting…" : "Connect"}
          </button>
        </div>
      )}

      {message && (
        <p role="status" className={`text-xs ${message.tone === "error" ? "text-destructive" : "text-muted-foreground"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
