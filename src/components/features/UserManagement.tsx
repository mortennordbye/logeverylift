"use client";

import {
  createUser,
  listUsers,
  removeUser,
  setUserRole,
  type UserRow,
} from "@/lib/actions/users";
import { Loader2, Trash2, UserCog } from "lucide-react";
import { useEffect, useState } from "react";

export function UserManagement() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Create form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  async function loadUsers() {
    setLoading(true);
    const result = await listUsers();
    if (result.success) {
      setUsers(result.data);
    } else {
      setError(result.error);
    }
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time data fetch
    loadUsers();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !password) return;
    setCreating(true);
    setCreateError("");

    const result = await createUser({ name: name.trim(), email: email.trim(), password, role });
    setCreating(false);

    if (!result.success) {
      setCreateError(result.error);
      return;
    }

    setName("");
    setEmail("");
    setPassword("");
    setRole("user");
    await loadUsers();
  }

  async function handleRemove(userId: string) {
    const confirmed = window.confirm("Remove this user? All their data will be deleted.");
    if (!confirmed) return;

    const result = await removeUser(userId);
    if (result.success) {
      await loadUsers();
    } else {
      alert(result.error);
    }
  }

  async function handleToggleRole(user: UserRow) {
    const newRole = user.role === "admin" ? "user" : "admin";
    const result = await setUserRole(user.id, newRole);
    if (result.success) {
      await loadUsers();
    } else {
      alert(result.error);
    }
  }

  return (
    <div className="space-y-8">
      {/* Create user form */}
      <div>
        <h2 className="text-base font-semibold mb-4">Create Account</h2>
        <form onSubmit={handleCreate} className="space-y-3">
          <input
            type="text"
            placeholder="Full name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-border bg-muted px-4 py-3 text-base outline-none focus:ring-2 focus:ring-primary"
          />
          <input
            type="email"
            placeholder="Email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-border bg-muted px-4 py-3 text-base outline-none focus:ring-2 focus:ring-primary"
          />
          <input
            type="text"
            placeholder="Temporary password (min 8 characters)"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-border bg-muted px-4 py-3 text-base outline-none focus:ring-2 focus:ring-primary"
          />
          <div className="flex gap-2">
            {(["user", "admin"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={`flex-1 py-3 rounded-xl text-sm font-semibold transition-colors active:opacity-80 ${
                  role === r
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground"
                }`}
              >
                {r === "admin" ? "Admin" : "User"}
              </button>
            ))}
          </div>
          {createError && (
            <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {createError}
            </p>
          )}
          <button
            type="submit"
            disabled={creating}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-4 text-base font-semibold text-primary-foreground disabled:opacity-50 active:opacity-80"
          >
            {creating ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Creating…
              </>
            ) : (
              "Create Account"
            )}
          </button>
        </form>
      </div>

      {/* User list */}
      <div>
        <h2 className="text-base font-semibold mb-4">
          Accounts ({users.length})
        </h2>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        ) : users.length === 0 ? (
          <p className="text-sm text-muted-foreground px-1">No accounts yet.</p>
        ) : (
          <div className="rounded-2xl bg-card overflow-hidden divide-y divide-border/50">
            {users.map((user) => (
              <div key={user.id} className="px-4 py-3.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{user.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                  <span className={`mt-0.5 inline-block text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                    user.role === "admin"
                      ? "bg-primary/15 text-primary"
                      : "bg-border/50 text-muted-foreground"
                  }`}>
                    {user.role ?? "user"}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleToggleRole(user)}
                    title={user.role === "admin" ? "Demote to user" : "Promote to admin"}
                    className="w-10 h-10 flex items-center justify-center rounded-xl bg-background active:opacity-60"
                  >
                    <UserCog className="h-4 w-4 text-muted-foreground" />
                  </button>
                  <button
                    onClick={() => handleRemove(user.id)}
                    title="Remove user"
                    className="w-10 h-10 flex items-center justify-center rounded-xl bg-background active:opacity-60"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
