"use client";

import { authClient } from "@/lib/auth-client";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { ChevronLeft, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type User = {
  id: string;
  name: string;
  email: string;
  role: string | null | undefined;
  createdAt: Date;
};

export function AdminUsersClient({ users }: { users: User[] }) {
  const router = useRouter();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", password: "" });

  async function handleImpersonate(userId: string) {
    setLoadingId(userId);
    await authClient.admin.impersonateUser({ userId });
    router.push("/programs");
    router.refresh();
  }

  async function handleDelete(userId: string) {
    setLoadingId(userId);
    setConfirmDeleteId(null);
    await authClient.admin.removeUser({ userId });
    router.refresh();
    setLoadingId(null);
  }

  function openCreate() {
    setForm({ name: "", email: "", password: "" });
    setCreateError(null);
    setCreateOpen(true);
  }

  async function handleCreate() {
    if (!form.name.trim() || !form.email.trim() || !form.password.trim()) {
      setCreateError("All fields are required.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const result = await authClient.admin.createUser({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        role: "user",
      });
      if (result.error) {
        setCreateError(result.error.message ?? "Failed to create user.");
      } else {
        setCreateOpen(false);
        router.refresh();
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create user.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-6 pb-2 shrink-0">
        <Link href="/more/admin" className="flex items-center gap-0.5 text-primary active:opacity-70 -ml-1">
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
        <h1 className="text-3xl font-bold tracking-tight">Users</h1>
        <p className="text-sm text-muted-foreground mt-1">{users.length} accounts</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-nav-safe">
        <div className="rounded-xl border border-border divide-y divide-border overflow-hidden">
          {users.map((user) => (
            <div key={user.id}>
              {confirmDeleteId === user.id ? (
                <div className="flex items-center gap-3 px-4 min-h-[64px]">
                  <Trash2 className="w-5 h-5 text-destructive flex-none" />
                  <span className="flex-1 text-sm text-destructive font-medium truncate">
                    Delete {user.name}?
                  </span>
                  <button
                    onClick={() => setConfirmDeleteId(null)}
                    className="px-3 py-1.5 text-sm rounded-lg border border-border active:bg-muted/50 shrink-0"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleDelete(user.id)}
                    className="px-3 py-1.5 text-sm rounded-lg bg-destructive text-destructive-foreground active:opacity-70 shrink-0"
                  >
                    Delete
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3 px-4 py-3.5 min-h-[64px]">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{user.name}</p>
                    <p className="text-sm text-muted-foreground truncate">{user.email}</p>
                  </div>
                  {user.role === "admin" && (
                    <span className="text-xs text-primary bg-primary/10 px-2 py-0.5 rounded shrink-0">
                      Admin
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => handleImpersonate(user.id)}
                    disabled={loadingId !== null}
                    className="shrink-0 rounded-lg bg-muted px-3 py-1.5 text-sm font-medium active:opacity-70 disabled:opacity-40"
                  >
                    {loadingId === user.id ? "Loading…" : "View as"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(user.id)}
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
      </div>

      <BottomSheet open={createOpen} onClose={() => setCreateOpen(false)} blur>
        <div className="bg-background rounded-t-2xl px-4 pt-5 pb-8 space-y-4">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-semibold">New User</h2>
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
              <label className="text-xs text-muted-foreground mb-1 block">Name</label>
              <input
                type="text"
                autoComplete="off"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Full name"
                className="w-full rounded-xl bg-muted px-4 py-3 text-base outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Email</label>
              <input
                type="email"
                autoComplete="off"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="user@example.com"
                className="w-full rounded-xl bg-muted px-4 py-3 text-base outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Password</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="Temporary password"
                className="w-full rounded-xl bg-muted px-4 py-3 text-base outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <button
            onClick={handleCreate}
            disabled={creating}
            className="w-full rounded-xl bg-primary text-primary-foreground py-3.5 text-sm font-semibold active:opacity-80 disabled:opacity-50"
          >
            {creating ? "Creating…" : "Create User"}
          </button>
        </div>
      </BottomSheet>
    </div>
  );
}
