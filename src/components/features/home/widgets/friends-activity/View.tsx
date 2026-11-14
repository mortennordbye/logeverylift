import { defineWidget } from "@/components/features/home/define-widget";
import { Card, Cap, Label, PreviewBox, WidgetSkeleton } from "@/components/features/home/widget-ui";
import { dayMonth } from "@/lib/home/labels";
import { Plus, Users } from "lucide-react";
import Link from "next/link";
import { loadFriendsActivity, type FriendWorkout } from "./load";

/** Friends' activity: S the newest friend workout, M the last 3, L the last 6. The card opens Friends. */

const COUNT = { s: 1, m: 3, l: 6 } as const;
const HREF = "/more/friends";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase();
}

function Avatar({ name, image }: { name: string; image: string | null }) {
  return image ? (
    // eslint-disable-next-line @next/next/no-img-element -- avatars come from the auth provider's host, as on the Friends page
    <img src={image} alt="" className="h-[38px] w-[38px] rounded-full object-cover shrink-0" />
  ) : (
    <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full bg-widget-2 text-[13px] font-bold" aria-hidden>
      {initials(name)}
    </span>
  );
}

const what = (w: FriendWorkout) => `${w.programName ?? "Workout"} · ${w.setCount} ${w.setCount === 1 ? "set" : "sets"}`;

export const friendsActivityWidget = defineWidget<FriendWorkout[]>({
  load: loadFriendsActivity,
  View: ({ data, size }) => {
    if (size === "s") {
      const w = data[0];
      return (
        <Card href={HREF} testId="friends-activity">
          <Label icon={<Users />}>Friends</Label>
          <div className="mt-auto min-w-0">
            <Avatar name={w.name} image={w.image} />
            <p className="mt-2 truncate text-sm font-bold">{w.name}</p>
            <Cap className="truncate">
              {what(w)} · {dayMonth(w.date)}
            </Cap>
          </div>
        </Card>
      );
    }
    return (
      <Card href={HREF} testId="friends-activity">
        <Label icon={<Users />} more="See all">
          Friends
        </Label>
        <ul className="mt-1 flex flex-col">
          {data.slice(0, COUNT[size]).map((w) => (
            <li key={w.sessionId} className="flex items-center gap-2.5 border-t border-hairline py-1.5 first:border-t-0" data-testid="friend-workout">
              <Avatar name={w.name} image={w.image} />
              <span className="min-w-0 flex-1 text-sm leading-[1.3]">
                <span className="block truncate font-bold">{w.name}</span>
                <Cap className="truncate">{what(w)}</Cap>
              </span>
              <Cap className="shrink-0">{dayMonth(w.date)}</Cap>
            </li>
          ))}
        </ul>
      </Card>
    );
  },
  Empty: () => (
    <Card testId="friends-activity">
      <Label icon={<Users />}>Friends</Label>
      <div className="flex flex-1 items-center gap-3.5">
        <div className="flex shrink-0" aria-hidden>
          <span className="grid h-[42px] w-[42px] place-items-center rounded-full border-[3px] border-widget bg-brand-fill text-[11px] font-bold text-white">You</span>
          {[0, 1].map((i) => (
            <span key={i} className="-ml-2.5 grid h-[42px] w-[42px] place-items-center rounded-full border-[3px] border-dashed border-muted-foreground/50 bg-widget-2 text-muted-foreground">
              <Plus className="h-[18px] w-[18px]" />
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Train together</p>
          <Cap className="mt-0.5 mb-2">See each other&apos;s sessions.</Cap>
          <Link href={HREF} className="inline-flex min-h-11 items-center rounded-2xl bg-widget-2 px-4 text-[15px] font-semibold active:scale-[0.97] transition-transform">
            Add friends to see their workouts
          </Link>
        </div>
      </div>
    </Card>
  ),
  Skeleton: WidgetSkeleton,
  Preview: ({ size }) => <PreviewBox title="Friends' activity" size={size} lines={3} />,
});
