import { defineWidget } from "@/components/features/home/define-widget";
import { PreviewBox, WidgetCard, WidgetSkeleton } from "@/components/features/home/widget-ui";
import { dayMonth } from "@/lib/home/labels";
import Link from "next/link";
import { loadFriendsActivity, type FriendWorkout } from "./load";

/** Friends' activity: S the newest friend workout, M the last 3, L the last 6. */

const COUNT = { s: 1, m: 3, l: 6 } as const;
const HREF = "/more/friends";

function Avatar({ name, image }: { name: string; image: string | null }) {
  return image ? (
    // eslint-disable-next-line @next/next/no-img-element -- avatars come from the auth provider's host, as on the Friends page
    <img src={image} alt="" className="h-8 w-8 rounded-full object-cover shrink-0" />
  ) : (
    <span className="h-8 w-8 rounded-full bg-background flex items-center justify-center text-xs font-semibold shrink-0" aria-hidden>
      {name.slice(0, 1).toUpperCase()}
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
        <Link href={HREF} className="rounded-2xl bg-muted p-3 h-full flex flex-col justify-between gap-1 active:opacity-70" data-testid="friends-activity">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Friends</span>
          <span className="flex items-center gap-2 min-w-0">
            <Avatar name={w.name} image={w.image} />
            <span className="text-sm font-semibold truncate">{w.name}</span>
          </span>
          <span className="text-xs text-muted-foreground truncate">
            {what(w)} · {dayMonth(w.date)}
          </span>
        </Link>
      );
    }
    return (
      <WidgetCard title="Friends' activity" href={HREF} linkLabel="Friends →" testId="friends-activity">
        <ul className="flex flex-col divide-y divide-border/40">
          {data.slice(0, COUNT[size]).map((w) => (
            <li key={w.sessionId} className="flex items-center gap-2 py-2" data-testid="friend-workout">
              <Avatar name={w.name} image={w.image} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium truncate">{w.name}</span>
                <span className="block text-xs text-muted-foreground truncate">{what(w)}</span>
              </span>
              <span className="text-xs text-muted-foreground shrink-0">{dayMonth(w.date)}</span>
            </li>
          ))}
        </ul>
      </WidgetCard>
    );
  },
  Empty: () => (
    <WidgetCard title="Friends' activity" testId="friends-activity">
      <Link href={HREF} className="min-h-11 inline-flex items-center text-sm text-primary active:opacity-70">
        Add friends to see their workouts
      </Link>
    </WidgetCard>
  ),
  Skeleton: WidgetSkeleton,
  Preview: ({ size }) => <PreviewBox title="Friends' activity" size={size} lines={3} />,
});
