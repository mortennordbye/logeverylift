"use client";

import { saveHomeLayout } from "@/lib/actions/home-layout";
import { afterTrainingRow, toRows, type ResolvedItem } from "@/lib/home/layout";
import { editReducer, initEdit, movableItems, type EditAction } from "@/lib/home/layout-reducer";
import type { StoredHomeItem } from "@/lib/home/stored-layout";
import { widgetDef, type WidgetId } from "@/lib/home/widgets";
import { SIZE_LABEL } from "@/lib/home/widgets/types";
import { callAction } from "@/lib/utils/stale-bundle";
import { Pencil, Plus, RotateCcw, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { HomeEditGrid, type Previews } from "./HomeEditGrid";
import { WidgetGallerySheet } from "./WidgetGallerySheet";
import { WidgetSheet } from "./WidgetSheet";
import { useLongPress } from "./use-long-press";

/**
 * The home screen's layout and its edit mode (docs/home-widgets-audit.md, 6.9
 * and decision 17).
 *
 * Outside edit mode widget content arrives rendered from the server in
 * `slots`, and this only places it: two consecutive S widgets share a row, M
 * and L take a full row, and the last widget stretches to fill the screen
 * when its def says so (Week), as the old page did. The content scrolls when
 * it is taller than the screen.
 *
 * Edit mode starts from the pencil or a long-press on a widget, and shows the
 * same grid with the widgets jiggling (HomeEditGrid). Notices and the start
 * bar are not shown, and a bar covers the bottom nav until Done or Cancel, so
 * a navigation cannot drop the draft. The page keys this component on the
 * saved layout, so a save resets it to the new layout.
 */
export type HomeGridProps = {
  items: ResolvedItem[];
  /** The default for this user, for Reset. */
  defaultItems: ResolvedItem[];
  /** The stored layout's `updatedAt`, or null for the default; the base of the conflict check. */
  baseUpdatedAt: string | null;
  /** The title widget, rendered. */
  title: ReactNode;
  slots: Partial<Record<WidgetId, ReactNode>>;
  /** Static previews per widget and size, for edit mode and the gallery. */
  previews: Previews;
  topNotices: ReactNode;
  afterTraining: ReactNode;
  endNotices: ReactNode;
  /** The pinned start bar, or null when the user has a cycle. */
  startBar: ReactNode;
};

/** The "Edit home" pencil: 44x44, theme tokens, a visible focus ring, tap feedback. */
const PENCIL =
  "h-11 w-11 inline-flex items-center justify-center rounded-full text-muted-foreground active:opacity-60 active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

const BAR_BTN =
  "min-h-11 min-w-11 inline-flex items-center justify-center gap-1.5 px-2 text-sm font-medium active:opacity-60 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-xl";

const ENTER_TEXT = "Editing home. Drag a widget to move it, or tap it for its size, Move up and Move down.";

/** Focus "Edit home" on the next mount: a save remounts this component with the new layout. */
let focusEditOnMount = false;

type Status = { kind: "error"; text: string } | { kind: "conflict" } | null;
type Focus = { id: WidgetId; control: "tile" | "hide" } | null;

function toStored(items: ResolvedItem[]): StoredHomeItem[] {
  return items.map(({ id, size, hidden, settings }) => (settings ? { id, size, hidden, settings } : { id, size, hidden }));
}

export function HomeGrid(props: HomeGridProps) {
  const { items, defaultItems, baseUpdatedAt, title, slots, previews, topNotices, afterTraining, endNotices, startBar } = props;
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [state, dispatch] = useReducer(editReducer, items, initEdit);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [sheetId, setSheetId] = useState<WidgetId | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [saving, setSaving] = useState(false);
  const [say, setSay] = useState("");
  const pendingFocus = useRef<Focus>(null);
  const openedFrom = useRef<"title" | "end" | "press">("title");
  const editTitleRef = useRef<HTMLButtonElement>(null);
  const editEndRef = useRef<HTMLButtonElement>(null);
  const focusEdit = useRef(false);
  const blockClicksUntil = useRef(0);
  const dirty = state.past.length > 0;

  // Focus after a change: the moved widget, the next widget after a hide.
  useEffect(() => {
    const f = pendingFocus.current;
    if (!f) return;
    pendingFocus.current = null;
    document.querySelector<HTMLElement>(`[data-edit-tile="${f.id}"] [data-control="${f.control}"]`)?.focus();
  });

  // Back on the pencil after Done or Cancel.
  useEffect(() => {
    if (focusEditOnMount) {
      focusEditOnMount = false;
      (editTitleRef.current ?? editEndRef.current)?.focus();
    }
  }, []);
  useEffect(() => {
    if (!focusEdit.current) return;
    focusEdit.current = false;
    (editTitleRef.current ?? editEndRef.current)?.focus();
  });

  // A reload or a closed tab would drop the draft: ask first.
  useEffect(() => {
    if (!editing || !dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [editing, dirty]);

  function act(action: EditAction, focus?: Focus, text?: string) {
    dispatch(action);
    pendingFocus.current = focus ?? null;
    if (text) setSay(text);
  }

  function enter(from: "title" | "end" | "press") {
    openedFrom.current = from;
    // The release of a long-press must not open a widget's sheet.
    if (from === "press") blockClicksUntil.current = performance.now() + 600;
    dispatch({ type: "load", items });
    setStatus(null);
    setEditing(true);
    setSay(ENTER_TEXT);
    const first = movableItems(items)[0];
    pendingFocus.current = first ? { id: first.id, control: "tile" } : null;
  }

  function leave() {
    setEditing(false);
    setGalleryOpen(false);
    setSheetId(null);
    setStatus(null);
    focusEdit.current = true;
  }

  async function save(next: StoredHomeItem[] | null, force: boolean) {
    setSaving(true);
    setStatus(null);
    const result = await callAction(saveHomeLayout({ items: next, baseUpdatedAt, force }));
    setSaving(false);
    if (result.success) {
      focusEditOnMount = true;
      leave();
      router.refresh();
      return;
    }
    if (result.error === "conflict") return setStatus({ kind: "conflict" });
    setStatus({
      kind: "error",
      text: typeof navigator !== "undefined" && !navigator.onLine ? "You're offline. Try again when connected." : result.error,
    });
  }

  function done() {
    if (!dirty) return leave();
    void save(toStored(state.items), false);
  }

  function cancel() {
    if (dirty && !window.confirm("Discard changes?")) return;
    dispatch({ type: "load", items });
    leave();
  }

  function reset() {
    if (!window.confirm("Reset home to the default layout?")) return;
    dispatch({ type: "reset", items: defaultItems });
    void save(null, false);
  }

  const longPress = useLongPress(() => enter("press"));

  const liveRegion = (
    <p className="sr-only" aria-live="polite" data-testid="home-announce">
      {say}
    </p>
  );

  if (editing) {
    const hidden = state.items.filter((i) => i.hidden);
    const movable = movableItems(state.items);
    const titleOf = (id: WidgetId) => widgetDef(id).title;
    const savedSize = new Map(items.filter((i) => !i.hidden).map((i) => [i.id, i.size]));
    // The real widget at the size it was saved at; its static preview at any other size.
    const content = (item: ResolvedItem): ReactNode => {
      const real = item.id === "title" ? title : slots[item.id];
      return savedSize.get(item.id) === item.size && real != null ? real : previews[item.id]?.[item.size];
    };
    const sheetItem = sheetId ? (state.items.find((i) => i.id === sheetId && !i.hidden) ?? null) : null;
    const nextAfter = (id: WidgetId): Focus => {
      const n = movable.findIndex((i) => i.id === id);
      const next = movable[n + 1] ?? movable[n - 1];
      return next && next.id !== id ? { id: next.id, control: "tile" } : null;
    };
    const hide = (id: WidgetId) => act({ type: "hide", id }, nextAfter(id), `${titleOf(id)} hidden`);

    return (
      <>
        {liveRegion}
        <div className="px-4 pt-4 shrink-0 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={cancel} className={`${BAR_BTN} text-base text-muted-foreground`}>
              Cancel
            </button>
            <h1 className="text-lg font-semibold">Edit home</h1>
            <button type="button" onClick={done} disabled={saving} className={`${BAR_BTN} text-base font-semibold text-primary`}>
              {saving ? "Saving…" : "Done"}
            </button>
          </div>
          <div className="flex items-center justify-center gap-1">
            <button type="button" onClick={() => setGalleryOpen(true)} disabled={hidden.length === 0} className={`${BAR_BTN} text-primary`}>
              <Plus className="h-4 w-4" aria-hidden />
              Add widget
            </button>
            <button type="button" onClick={() => act({ type: "undo" }, null, "Undone")} disabled={!dirty} className={BAR_BTN}>
              <Undo2 className="h-4 w-4" aria-hidden />
              Undo
            </button>
            <button type="button" onClick={reset} disabled={saving} className={`${BAR_BTN} text-destructive`}>
              <RotateCcw className="h-4 w-4" aria-hidden />
              Reset
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-4 space-y-3">
          {status?.kind === "error" && (
            <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="home-save-error">
              {status.text}
            </p>
          )}
          {status?.kind === "conflict" && (
            <div role="alert" className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-2 space-y-2" data-testid="home-conflict">
              <p className="text-sm">Your home was changed on another device.</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => window.location.reload()} className="min-h-11 rounded-xl border border-border px-3 text-sm active:opacity-70">
                  Reload
                </button>
                <button
                  type="button"
                  onClick={() => void save(toStored(state.items), true)}
                  className="min-h-11 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground active:opacity-80"
                >
                  Save mine
                </button>
              </div>
            </div>
          )}
          <HomeEditGrid
            items={state.items}
            content={content}
            onOpen={setSheetId}
            onHide={hide}
            onMoveTo={(id, index) => act({ type: "moveTo", id, index }, { id, control: "tile" })}
            clickBlocked={(now) => now < blockClicksUntil.current}
          />
        </div>

        {/* Covers the bottom nav, so a navigation cannot drop the draft. */}
        <div
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
          data-testid="home-edit-bar"
        >
          <p className="flex items-center justify-center h-16 max-w-lg mx-auto px-4 text-center text-xs text-muted-foreground">
            Drag a widget to move it. Tap it for its size and more.
          </p>
        </div>

        <WidgetSheet
          item={sheetItem}
          index={sheetItem ? movable.findIndex((i) => i.id === sheetItem.id) : -1}
          count={movable.length}
          onClose={() => {
            if (sheetId) pendingFocus.current = { id: sheetId, control: "tile" };
            setSheetId(null);
          }}
          onResize={(id, size) => act({ type: "resize", id, size }, null, `${titleOf(id)} is now ${SIZE_LABEL[size].toLowerCase()}`)}
          onMove={(id, dir) => {
            const n = movable.findIndex((i) => i.id === id) + (dir === "up" ? 0 : 2);
            act({ type: dir === "up" ? "moveUp" : "moveDown", id }, null, `${titleOf(id)} moved to position ${n} of ${movable.length}`);
          }}
          onHide={(id) => {
            setSheetId(null);
            hide(id);
          }}
        />

        <WidgetGallerySheet
          open={galleryOpen}
          onClose={() => setGalleryOpen(false)}
          hidden={hidden}
          previews={previews}
          onAdd={(id) => {
            setGalleryOpen(false);
            act({ type: "add", id }, { id, control: "tile" }, `${titleOf(id)} added`);
          }}
        />
      </>
    );
  }

  const titleShown = items.some((i) => i.id === "title" && !i.hidden);
  // A widget with nothing to show today (Endurance today on a rest day) takes no row.
  const rows = toRows(items.filter((i) => slots[i.id] != null));
  const after = afterTrainingRow(rows);

  return (
    <>
      {liveRegion}
      {titleShown ? (
        <div className="relative px-6 pt-6 pb-3 shrink-0" data-widget="title" {...longPress}>
          {title}
          <button
            type="button"
            ref={editTitleRef}
            onClick={() => enter("title")}
            aria-label="Edit home"
            className={`${PENCIL} absolute right-3 top-5`}
          >
            <Pencil className="h-5 w-5" aria-hidden />
          </button>
        </div>
      ) : (
        <div className="pt-6 shrink-0">
          <h1 className="sr-only" data-testid="home-title">
            LogEveryLift
          </h1>
        </div>
      )}

      <div className="flex-1 flex flex-col gap-3 px-6 min-h-0 overflow-y-auto pb-4" data-testid="home-content" {...longPress}>
        {topNotices}
        {after < 0 && afterTraining}
        {rows.map((row, n) => {
          const last = n === rows.length - 1;
          const stretch = last && !row.half && widgetDef(row.ids[0]).stretch;
          return (
            <Fragment key={row.ids.join("+")}>
              {row.half ? (
                <div className="grid grid-cols-2 gap-3 shrink-0">
                  {row.ids.map((id) => (
                    <div key={id} className="min-w-0" data-widget={id}>
                      {slots[id]}
                    </div>
                  ))}
                </div>
              ) : (
                <div className={stretch ? "grow shrink-0 basis-auto flex flex-col" : "shrink-0 flex flex-col"} data-widget={row.ids[0]}>
                  {slots[row.ids[0]]}
                </div>
              )}
              {n === after && afterTraining}
            </Fragment>
          );
        })}
        {/* With the title hidden, the pencil moves here, so edit mode is always reachable. */}
        {!titleShown && (
          <button
            type="button"
            ref={editEndRef}
            onClick={() => enter("end")}
            aria-label="Edit home"
            className={`${PENCIL} shrink-0 self-center`}
          >
            <Pencil className="h-5 w-5" aria-hidden />
          </button>
        )}
      </div>

      {startBar}
      {endNotices}
    </>
  );
}
