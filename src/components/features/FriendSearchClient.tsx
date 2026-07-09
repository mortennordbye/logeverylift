"use client";

import { removeFriend, respondToFriendRequest, searchUsers, sendFriendRequest } from "@/lib/actions/friends";
import type { UserSearchResult } from "@/types/workout";
import { Check, Loader2, Search, UserCheck, UserPlus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

function Avatar({ name, image }: { name: string; image: string | null }) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0">
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element -- avatar URL from auth provider; not worth wiring next/image loader
        <img src={image} alt={name} className="w-full h-full object-cover" />
      ) : (
        <span className="text-sm font-semibold text-muted-foreground">{initials}</span>
      )}
    </div>
  );
}

function ActionButton({
  user,
  onAction,
  loading,
}: {
  user: UserSearchResult;
  onAction: (user: UserSearchResult) => void;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="w-9 h-9 flex items-center justify-center shrink-0">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (user.friendshipStatus === "accepted") {
    return (
      <div className="flex items-center gap-1 text-sm text-muted-foreground shrink-0">
        <UserCheck className="w-4 h-4" />
        <span>Friends</span>
      </div>
    );
  }

  if (user.friendshipStatus === "pending_sent") {
    return (
      <button
        onClick={() => onAction(user)}
        className="flex items-center gap-1 text-sm text-muted-foreground border border-border rounded-lg px-3 h-8 active:opacity-70 shrink-0"
      >
        <X className="w-3.5 h-3.5" />
        Cancel
      </button>
    );
  }

  if (user.friendshipStatus === "pending_received") {
    return (
      <button
        onClick={() => onAction(user)}
        className="flex items-center gap-1 text-sm bg-primary text-primary-foreground rounded-lg px-3 h-8 active:opacity-80 shrink-0"
      >
        <Check className="w-3.5 h-3.5" />
        Accept
      </button>
    );
  }

  return (
    <button
      onClick={() => onAction(user)}
      className="flex items-center gap-1 text-sm bg-primary text-primary-foreground rounded-lg px-3 h-8 active:opacity-80 shrink-0"
    >
      <UserPlus className="w-3.5 h-3.5" />
      Add
    </button>
  );
}

export function FriendSearchClient() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.trim().length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing debounced search results when query is empty
      setResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      const result = await searchUsers({ query: query.trim() });
      if (result.success) setResults(result.data);
      setLoading(false);
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  async function handleAction(user: UserSearchResult) {
    setActionLoading(user.id);

    if (user.friendshipStatus === "none") {
      await sendFriendRequest({ addresseeId: user.id });
    } else if (user.friendshipStatus === "pending_sent" && user.friendshipId) {
      await removeFriend({ friendshipId: user.friendshipId });
    } else if (user.friendshipStatus === "pending_received" && user.friendshipId) {
      await respondToFriendRequest({ friendshipId: user.friendshipId, action: "accepted" });
    }

    // Re-fetch results to update status
    const result = await searchUsers({ query: query.trim() });
    if (result.success) setResults(result.data);
    setActionLoading(null);
    router.refresh();
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Search input */}
      <div className="px-4 pb-3 shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by name or email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            className="w-full h-11 pl-9 pr-4 rounded-xl border border-border bg-muted/40 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          {loading && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {results.length > 0 && (
          <div className="divide-y divide-border border-y border-border">
            {results.map((user) => (
              <div key={user.id} className="flex items-center gap-3 px-4 py-3">
                <Avatar name={user.name} image={user.image} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{user.name}</p>
                  <p className="text-sm text-muted-foreground truncate">{user.email}</p>
                </div>
                <ActionButton
                  user={user}
                  onAction={handleAction}
                  loading={actionLoading === user.id}
                />
              </div>
            ))}
          </div>
        )}

        {!loading && query.trim().length > 0 && results.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-center px-8">
            <p className="font-medium">No users found</p>
            <p className="text-sm text-muted-foreground">Try a different name or email address.</p>
          </div>
        )}

        {query.trim().length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-center px-8">
            <Search className="w-10 h-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">Search for people by name or email to send them a friend request.</p>
          </div>
        )}
      </div>
    </div>
  );
}
