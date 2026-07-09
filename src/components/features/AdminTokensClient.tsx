"use client";

import { createInviteToken, revokeInviteToken } from "@/lib/actions/invite-tokens";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { ChevronLeft, Key, Plus, Share2, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type InviteToken = {
  id: string;
  token: string;
  label: string | null;
  maxUses: number | null;
  usedCount: number;
  expiresAt: Date | null;
  createdAt: Date;
};

export function AdminTokensClient({ tokens }: { tokens: InviteToken[] }) {
  const router = useRouter();
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [form, setForm] = useState({ label: "", token: "", maxUses: "", expiresAt: "" });

  async function handleRevoke(id: string) {
    setLoadingId(id);
    setConfirmRevokeId(null);
    await revokeInviteToken(id);
    router.refresh();
    setLoadingId(null);
  }

  function openCreate() {
    setForm({ label: "", token: "", maxUses: "", expiresAt: "" });
    setCreateError(null);
    setCreateOpen(true);
  }

  async function handleCreate() {
    setCreating(true);
    setCreateError(null);
    try {
      const maxUses = form.maxUses.trim() ? parseInt(form.maxUses, 10) : null;
      if (form.maxUses.trim() && (isNaN(maxUses!) || maxUses! < 1)) {
        setCreateError("Max uses must be a positive number, or leave blank for unlimited.");
        setCreating(false);
        return;
      }

      const expiresAt = form.expiresAt ? new Date(form.expiresAt) : null;

      const result = await createInviteToken({
        label: form.label,
        token: form.token.trim() || null,
        maxUses,
        expiresAt,
      });

      if (!result.success) {
        setCreateError(result.error);
      } else {
        setCreateOpen(false);
        router.refresh();
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create token.");
    } finally {
      setCreating(false);
    }
  }

  function usageBadge(token: InviteToken) {
    if (token.maxUses === null) return `${token.usedCount} uses`;
    return `${token.usedCount} / ${token.maxUses}`;
  }

  function isExhausted(token: InviteToken) {
    return token.maxUses !== null && token.usedCount >= token.maxUses;
  }

  function isExpired(token: InviteToken) {
    return token.expiresAt !== null && token.expiresAt < new Date();
  }

  function handleShare(token: InviteToken) {
    const url = `${window.location.origin}/signup?token=${encodeURIComponent(token.token)}`;
    const text = `Hey! I'd like to invite you to try LogEveryLift — a workout tracking app I use.\n\nSign up here: ${url}`;
    if (navigator.share) {
      navigator.share({ text });
    } else {
      navigator.clipboard.writeText(text);
    }
  }

  return (
    <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-6 pb-2 shrink-0">
        <Link
          href="/more/admin"
          className="flex items-center gap-0.5 text-primary active:opacity-70 -ml-1"
        >
          <ChevronLeft className="w-5 h-5" />
          <span className="text-sm font-medium">Admin</span>
        </Link>
        <button
          onClick={openCreate}
          className="w-9 h-9 flex items-center justify-center rounded-full active:bg-muted/50"
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>
      <div className="px-4 pt-2 pb-4 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">Invite Tokens</h1>
        <p className="text-sm text-muted-foreground mt-1">{tokens.length} tokens</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-nav-safe">
        {tokens.length === 0 ? (
          <div className="flex flex-col items-center gap-3 pt-16 text-center">
            <Key className="w-10 h-10 text-muted-foreground/40" />
            <p className="text-muted-foreground text-sm">
              No invite tokens yet. Tap + to create one.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-border divide-y divide-border overflow-hidden">
            {tokens.map((token) => (
              <div key={token.id}>
                {confirmRevokeId === token.id ? (
                  <div className="flex items-center gap-3 px-4 min-h-[64px]">
                    <Trash2 className="w-5 h-5 text-destructive flex-none" />
                    <span className="flex-1 text-sm text-destructive font-medium truncate">
                      Revoke this token?
                    </span>
                    <button
                      onClick={() => setConfirmRevokeId(null)}
                      className="px-3 py-1.5 text-sm rounded-lg border border-border active:bg-muted/50 shrink-0"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleRevoke(token.id)}
                      className="px-3 py-1.5 text-sm rounded-lg bg-destructive text-destructive-foreground active:opacity-70 shrink-0"
                    >
                      Revoke
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 px-4 py-3.5 min-h-[64px]">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">
                        {token.label ?? (
                          <span className="font-mono text-sm text-muted-foreground">
                            {token.token}
                          </span>
                        )}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="font-mono text-xs text-muted-foreground truncate max-w-[160px]">
                          {token.token}
                        </span>
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded ${
                            isExhausted(token)
                              ? "bg-destructive/10 text-destructive"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {usageBadge(token)}
                        </span>
                        {isExpired(token) && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">
                            Expired
                          </span>
                        )}
                        {token.expiresAt && !isExpired(token) && (
                          <span className="text-xs text-muted-foreground">
                            Expires {token.expiresAt.toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleShare(token)}
                      className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg active:bg-muted/50"
                    >
                      <Share2 className="w-4 h-4 text-muted-foreground" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRevokeId(token.id)}
                      disabled={loadingId !== null}
                      className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg active:bg-destructive/10 disabled:opacity-40"
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <BottomSheet open={createOpen} onClose={() => setCreateOpen(false)} blur>
        <div className="bg-background rounded-t-2xl px-4 pt-5 pb-8 space-y-4">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-semibold">New Invite Token</h2>
            <button
              onClick={() => setCreateOpen(false)}
              className="text-sm text-muted-foreground active:opacity-60"
            >
              Cancel
            </button>
          </div>

          {createError && (
            <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg">
              {createError}
            </p>
          )}

          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Label <span className="text-muted-foreground/60">(optional)</span>
              </label>
              <input
                type="text"
                autoComplete="off"
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="e.g. Friend invite"
                className="w-full rounded-xl bg-muted px-4 py-3 text-base outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Token <span className="text-muted-foreground/60">(blank = auto-generated)</span>
              </label>
              <input
                type="text"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                value={form.token}
                onChange={(e) => setForm((f) => ({ ...f, token: e.target.value }))}
                placeholder="e.g. welcome2025"
                className="w-full rounded-xl bg-muted px-4 py-3 text-base font-mono outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Max uses <span className="text-muted-foreground/60">(blank = unlimited)</span>
              </label>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                value={form.maxUses}
                onChange={(e) => setForm((f) => ({ ...f, maxUses: e.target.value }))}
                placeholder="e.g. 1"
                className="w-full rounded-xl bg-muted px-4 py-3 text-base outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Expires <span className="text-muted-foreground/60">(optional)</span>
              </label>
              <div className="relative">
                <input
                  type="date"
                  value={form.expiresAt}
                  onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))}
                  className="w-full rounded-xl bg-muted px-4 py-3 text-base outline-none focus:ring-2 focus:ring-primary pr-10"
                />
                {form.expiresAt && (
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, expiresAt: "" }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full bg-muted-foreground/20 active:opacity-70"
                  >
                    <X className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={handleCreate}
            disabled={creating}
            className="w-full rounded-xl bg-primary text-primary-foreground py-3.5 text-sm font-semibold active:opacity-80 disabled:opacity-50"
          >
            {creating ? "Creating…" : "Create Token"}
          </button>
        </div>
      </BottomSheet>
    </div>
  );
}
