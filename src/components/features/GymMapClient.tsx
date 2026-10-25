"use client";

import "leaflet/dist/leaflet.css";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { getGymMembers, type GymMember, type GymPin } from "@/lib/actions/gyms";
import { sendFriendRequest } from "@/lib/actions/friends";
import { callAction } from "@/lib/utils/stale-bundle";
import { Loader2, MapPin, UserCheck, UserPlus } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

// Southern Norway, for a map with no gyms on it yet.
const DEFAULT_VIEW: [number, number] = [60.5, 9.5];

export function GymMapClient({ pins, myGymId }: { pins: GymPin[]; myGymId: number | null }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<GymPin | null>(null);
  const [members, setMembers] = useState<GymMember[] | null>(null);
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  // The gym whose members the sheet is waiting for: a slower answer for a gym
  // tapped earlier must not fill the sheet of the one tapped since.
  const openGymId = useRef<number | null>(null);

  // Leaflet touches window on import, so it loads in the browser only.
  useEffect(() => {
    let map: import("leaflet").Map | null = null;
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !mapRef.current) return;
      map = L.map(mapRef.current, { zoomControl: false, attributionControl: false });
      L.control.attribution({ prefix: false }).addTo(map);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        // Standard OSM tiles are loud; mute them, and in dark mode invert them
        // to match the app instead of a bright rectangle in a dark page.
        className:
          "saturate-[0.35] brightness-[1.04] dark:invert dark:hue-rotate-180 dark:brightness-[0.8] dark:contrast-[0.9] dark:saturate-[0.3]",
      }).addTo(map);
      // View first: Leaflet only creates marker elements once the map has one.
      const mine = pins.find((p) => p.id === myGymId);
      if (mine) map.setView([mine.lat, mine.lng], 13);
      else if (pins.length > 0) {
        map.fitBounds(L.latLngBounds(pins.map((p) => [p.lat, p.lng])), { padding: [40, 40], maxZoom: 13 });
      } else map.setView(DEFAULT_VIEW, 5);
      for (const pin of pins) {
        const mine = pin.id === myGymId;
        const size = mine ? 34 : 28;
        const color = mine ? "bg-orange-500 text-white" : "bg-primary text-primary-foreground";
        const marker = L.marker([pin.lat, pin.lng], {
          icon: L.divIcon({
            className: "",
            // A pill with the member count, so the map says something before a tap.
            html: `<span class="flex items-center justify-center w-full h-full rounded-full ring-[3px] ring-background shadow-lg text-xs font-bold tabular-nums ${color}">${pin.memberCount}</span>`,
            iconSize: [size, size],
          }),
          zIndexOffset: mine ? 1000 : 0,
        })
          .addTo(map)
          .on("click", () => openGym(pin));
        marker.getElement()?.setAttribute("role", "button");
        marker
          .getElement()
          ?.setAttribute("aria-label", `${pin.name}, ${pin.memberCount} ${pin.memberCount === 1 ? "member" : "members"}`);
      }
    });
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [pins, myGymId]);

  async function openGym(pin: GymPin) {
    openGymId.current = pin.id;
    setSelected(pin);
    setMembers(null);
    const result = await callAction(getGymMembers({ gymId: pin.id }));
    if (openGymId.current === pin.id) setMembers(result.success ? result.data : []);
  }

  async function handleAdd(userId: string) {
    setBusyId(userId);
    const result = await callAction(sendFriendRequest({ addresseeId: userId }));
    if (result.success) setRequested((prev) => new Set([...prev, userId]));
    setBusyId(null);
  }

  return (
    <>
      {/* isolate: Leaflet's panes use z-index 400+, which would otherwise sit over the sheet. */}
      <div className="flex-1 flex mx-4 mb-3 rounded-2xl overflow-hidden border border-border isolate">
        <div ref={mapRef} data-testid="gym-map" className="flex-1" />
      </div>

      {myGymId === null && (
        <Link
          href="/more/account/gym"
          className="mx-4 mb-3 flex items-center justify-center gap-2 h-11 rounded-xl bg-primary text-primary-foreground text-sm font-medium active:opacity-80"
        >
          <MapPin className="w-4 h-4" />
          Add your gym
        </Link>
      )}

      <BottomSheet open={selected !== null} onClose={() => setSelected(null)}>
        <div className="bg-background rounded-t-2xl pb-safe max-h-[70dvh] flex flex-col">
          <div className="px-4 pt-4 pb-3 border-b border-border shrink-0">
            <h2 className="font-semibold">{selected?.name}</h2>
            <p className="text-sm text-muted-foreground">
              {selected?.address ? `${selected.address} · ` : ""}
              {selected?.memberCount} {selected?.memberCount === 1 ? "member" : "members"}
            </p>
          </div>
          <div className="overflow-y-auto divide-y divide-border">
            {members === null ? (
              <div className="flex justify-center py-6">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              members.map((m) => (
                <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0">
                    {m.image ? (
                      // eslint-disable-next-line @next/next/no-img-element -- avatar URL from auth provider; not worth wiring next/image loader
                      <img src={m.image} alt={m.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-xs font-semibold text-muted-foreground">
                        {m.name.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <p className="flex-1 font-medium truncate">{m.isMe ? "You" : m.name}</p>
                  {m.isMe ? null : m.friendshipStatus === "accepted" ? (
                    <span className="text-sm text-muted-foreground shrink-0">Friends</span>
                  ) : m.friendshipStatus === "pending_received" ? (
                    <Link href="/more/friends" className="text-sm text-primary font-medium shrink-0">
                      Sent you a request
                    </Link>
                  ) : m.friendshipStatus === "pending_sent" || requested.has(m.id) ? (
                    <span className="flex items-center gap-1 text-sm text-muted-foreground shrink-0">
                      <UserCheck className="w-4 h-4" />
                      Requested
                    </span>
                  ) : (
                    <button
                      onClick={() => handleAdd(m.id)}
                      disabled={busyId === m.id}
                      aria-label={`Add ${m.name} as a friend`}
                      className="flex items-center gap-1.5 h-11 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium active:opacity-80 disabled:opacity-50 shrink-0"
                    >
                      {busyId === m.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                      Add
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </BottomSheet>
    </>
  );
}
