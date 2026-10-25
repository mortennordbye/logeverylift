"use client";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { searchGyms, setPrimaryGym } from "@/lib/actions/gyms";
import type { GymResult } from "@/lib/utils/osm-gyms";
import { callAction } from "@/lib/utils/stale-bundle";
import { Loader2, LocateFixed, MapPin, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type CurrentGym = { name: string; address: string | null } | null;

export function GymPickerClient({ current }: { current: CurrentGym }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GymResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<GymResult | null>(null);
  const [saving, setSaving] = useState(false);

  async function runSearch(input: { query: string } | { lat: number; lng: number }) {
    setSearching(true);
    setError("");
    const result = await callAction(searchGyms(input));
    setSearching(false);
    if (result.success) setResults(result.data);
    else setError(result.error);
  }

  // Searches on submit only: Nominatim's usage policy rules out search-as-you-type.
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim().length >= 2) void runSearch({ query: query.trim() });
  }

  function handleNearMe() {
    if (!("geolocation" in navigator)) {
      setError("Location isn't available on this device");
      return;
    }
    setSearching(true);
    setError("");
    navigator.geolocation.getCurrentPosition(
      (pos) => void runSearch({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {
        setSearching(false);
        setError("Couldn't get your location. Search by name instead.");
      },
      { maximumAge: 600_000, timeout: 10_000 },
    );
  }

  async function save(gym: GymResult | null) {
    setSaving(true);
    const result = await callAction(setPrimaryGym({ gym }));
    setSaving(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setPicked(null);
    router.push(gym ? "/more/gyms" : "/more/account");
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 pb-nav-safe space-y-6">
      {current && (
        <div className="rounded-2xl bg-card px-4 py-3.5 flex items-center gap-3">
          <MapPin className="w-5 h-5 text-orange-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{current.name}</p>
            {current.address && <p className="text-xs text-muted-foreground truncate">{current.address}</p>}
          </div>
          <button
            onClick={() => save(null)}
            disabled={saving}
            className="h-11 px-2 text-sm font-medium text-destructive active:opacity-70 disabled:opacity-50 shrink-0"
          >
            Remove my gym
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Gym name, e.g. SATS Majorstuen"
          aria-label="Gym name"
          className="flex-1 min-w-0 rounded-xl border border-border bg-muted px-4 py-3 text-base outline-none focus:ring-2 focus:ring-primary"
        />
        <button
          type="submit"
          disabled={searching || query.trim().length < 2}
          aria-label="Search"
          className="w-12 rounded-xl bg-primary text-primary-foreground flex items-center justify-center active:opacity-80 disabled:opacity-50"
        >
          <Search className="w-5 h-5" />
        </button>
      </form>
      <button
        onClick={handleNearMe}
        disabled={searching}
        className="w-full h-11 rounded-xl border border-border flex items-center justify-center gap-2 text-sm font-medium active:opacity-70 disabled:opacity-50"
      >
        <LocateFixed className="w-4 h-4" />
        Gyms near me
      </button>

      {error && <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}

      {searching ? (
        <div className="flex justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : results !== null && (
        results.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No gyms found. Try another name.</p>
        ) : (
          <div className="rounded-2xl bg-card divide-y divide-border overflow-hidden">
            {results.map((gym) => (
              <button
                key={gym.osmRef}
                onClick={() => setPicked(gym)}
                className="w-full text-left px-4 py-3 min-h-[56px] active:bg-muted/50"
              >
                <p className="font-medium">{gym.name}</p>
                {gym.address && <p className="text-xs text-muted-foreground">{gym.address}</p>}
              </button>
            ))}
          </div>
        )
      )}

      <p className="text-xs text-muted-foreground">
        Gym data © OpenStreetMap contributors. Searches go through our server; a location is rounded to about a
        kilometre and never stored.
      </p>

      <BottomSheet open={picked !== null} onClose={() => setPicked(null)}>
        <div className="bg-background rounded-t-2xl pb-safe px-4 pt-5 pb-4 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Train at {picked?.name}?</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Your name and photo will be shown under this gym on the gym map, to everyone on LogEveryLift. Only the
              gym is shared, never when you train. You can remove it any time.
            </p>
          </div>
          <button
            onClick={() => picked && save(picked)}
            disabled={saving}
            className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 active:opacity-80 disabled:opacity-50"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Show me at this gym
          </button>
          <button
            onClick={() => setPicked(null)}
            className="w-full h-11 text-sm font-medium text-muted-foreground active:opacity-70"
          >
            Cancel
          </button>
        </div>
      </BottomSheet>
    </div>
  );
}
