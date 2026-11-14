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
import { Fragment, useEffect, useReducer, useRef, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HomeEditGrid, type Previews } from "./HomeEditGrid";
import { HOME_UI } from "./fonts";
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
 * when its def says so (none does since the redesign). The content scrolls when
 * it is taller than the screen.
 *
 * Edit mode starts from the pencil or a long-press on a widget, and shows the
 * same grid with the widgets jiggling (HomeEditGrid). Notices and the start
 * bar are not shown, and a bar covers the bottom nav until Done or Cancel, so
 * a navigation cannot drop the draft. The page keys this component on the
 * saved layout, so a save resets it to the new layout. Until the refreshed
 * page arrives, the draft stays on screen with "Saving…", so the old layout
 * never flashes back.
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
  /** Static previews per widget and size, for edit mode. */
  previews: Previews;
  /** Each hidden widget with made-up sample data, for the gallery only. */
  samples: Partial<Record<WidgetId, ReactNode>>;
  topNotices: ReactNode;
  afterTraining: ReactNode;
  endNotices: ReactNode;
  /** The pinned start bar, or null when the user has a cycle. */
  startBar: ReactNode;
};

/** The "Edit home" pencil: 44x44, theme tokens, a visible focus ring, tap feedback. */
const PENCIL =
  "h-11 w-11 shrink-0 inline-flex items-center justify-center rounded-full bg-widget-2 transition-transform active:scale-[0.94] active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";

/** The header pills of the locked design: 44 px, round, on the inner surface. */
const BAR_BTN =
  "min-h-11 min-w-11 inline-flex items-center justify-center gap-1.5 rounded-full px-4 text-[15px] font-semibold transition-transform active:scale-[0.94] active:opacity-80 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";
const SMALL_BTN =
  "min-h-11 inline-flex items-center justify-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-muted-foreground active:opacity-60 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";

const ENTER_TEXT = "Editing home. Drag a widget to move it, or tap it for its size, Move up and Move down.";

/** Focus "Edit home" on the next mount: a save remounts this component with the new layout. */
let focusEditOnMount = false;

type Status = { kind: "error"; text: string } | { kind: "conflict" } | null;
type Focus = { id: WidgetId; control: "tile" | "hide" } | null;

function toStored(items: ResolvedItem[]): StoredHomeItem[] {
  return items.map(({ id, size, hidden, settings }) => (settings ? { id, size, hidden, settings } : { id, size, hidden }));
}

export function HomeGrid(props: HomeGridProps) {
  const { items, defaultItems, baseUpdatedAt, title, slots, previews, samples, topNotices, afterTraining, endNotices, startBar } = props;
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [state, dispatch] = useReducer(editReducer, items, initEdit);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [sheetId, setSheetId] = useState<WidgetId | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [saving, setSaving] = useState(false);
  // Saved; waiting for router.refresh() to bring the new layout.
  const [saved, setSaved] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [say, setSay] = useState("");
  const pendingFocus = useRef<Focus>(null);
  // What the last failed save sent (null is Reset), so a retry sends the same.
  // Any edit after it drops it: the draft is what is sent then.
  const retry = useRef<{ items: StoredHomeItem[] | null } | null>(null);
  const editTitleRef = useRef<HTMLButtonElement>(null);
  const editEndRef = useRef<HTMLButtonElement>(null);
  const focusEdit = useRef(false);
  const blockClicksUntil = useRef(0);
  const dirty = state.past.length > 0;
  // A save that kept the layout (Reset from the default) does not remount
  // this component: edit mode ends when the refresh has landed.
  const inEdit = editing && !(saved && !refreshing);
  const busy = saving || saved;

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
    const pencil = editTitleRef.current ?? editEndRef.current;
    if (!focusEdit.current || !pencil) return;
    focusEdit.current = false;
    focusEditOnMount = false;
    pencil.focus();
  });

  // A reload or a closed tab would drop the draft: ask first.
  useEffect(() => {
    if (!inEdit || !dirty || saved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [inEdit, dirty, saved]);

  function act(action: EditAction, focus?: Focus, text?: string) {
    dispatch(action);
    retry.current = null;
    pendingFocus.current = focus ?? null;
    if (text) setSay(text);
  }

  function enter(from: "title" | "end" | "press") {
    // The release of a long-press must not open a widget's sheet.
    if (from === "press") blockClicksUntil.current = performance.now() + 600;
    dispatch({ type: "load", items });
    setStatus(null);
    setSaved(false);
    retry.current = null;
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
    retry.current = { items: next };
    setSaving(true);
    const result = await callAction(saveHomeLayout({ items: next, baseUpdatedAt, force }));
    setSaving(false);
    if (result.success) {
      retry.current = null;
      focusEditOnMount = true;
      setSaved(true);
      setGalleryOpen(false);
      setSheetId(null);
      setStatus(null);
      focusEdit.current = true;
      startRefresh(() => router.refresh());
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
    void save(retry.current ? retry.current.items : toStored(state.items), false);
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

  if (inEdit) {
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
        <div className="px-4 pt-4 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={cancel} disabled={busy} className={`${BAR_BTN} bg-widget-2 text-muted-foreground`}>
              Cancel
            </button>
            <h1 className="home-display text-[24px] uppercase">Edit home</h1>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setGalleryOpen(true)}
                disabled={hidden.length === 0}
                aria-label="Add widget"
                className={`${BAR_BTN} bg-widget-2 w-11 px-0`}
              >
                <Plus className="h-5 w-5" aria-hidden />
              </button>
              <button type="button" onClick={done} disabled={busy} className={`${BAR_BTN} bg-brand-fill text-white`}>
                {busy ? "Saving…" : "Done"}
              </button>
            </div>
          </div>
          <div className="flex items-center justify-center gap-1 pt-1">
            <button type="button" onClick={() => act({ type: "undo" }, null, "Undone")} disabled={!dirty} className={SMALL_BTN}>
              <Undo2 className="h-4 w-4" aria-hidden />
              Undo
            </button>
            <button type="button" onClick={reset} disabled={busy} className={SMALL_BTN}>
              <RotateCcw className="h-4 w-4" aria-hidden />
              Reset
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 space-y-3">
          {status?.kind === "error" && (
            <p role="alert" className="rounded-[14px] bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="home-save-error">
              {status.text}
            </p>
          )}
          {status?.kind === "conflict" && (
            <div role="alert" className="rounded-[14px] bg-widget ring-1 ring-inset ring-hairline px-3 py-2 space-y-2" data-testid="home-conflict">
              <p className="text-sm">Your home was changed on another device.</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => window.location.reload()} className="min-h-11 rounded-full bg-widget-2 px-4 text-sm font-semibold active:opacity-70">
                  Reload
                </button>
                <button
                  type="button"
                  onClick={() => void save(retry.current ? retry.current.items : toStored(state.items), true)}
                  disabled={busy}
                  className="min-h-11 rounded-full bg-brand-fill px-4 text-sm font-semibold text-white active:opacity-80 disabled:opacity-40"
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

        {/* Covers the bottom nav, so a navigation cannot drop the draft. In a
            portal: the page layer animates with a transform, which would pin a
            fixed bar to the layer instead of the screen, under the nav. */}
        {createPortal(
          <div
            className={`${HOME_UI} fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-home`}
            style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
            data-testid="home-edit-bar"
          >
            <p className="flex items-center justify-center h-16 max-w-lg mx-auto px-4 text-center text-[13px] text-muted-foreground">
              Drag to reorder. Tap a widget for its size and more.
            </p>
          </div>,
          document.body,
        )}

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
          samples={samples}
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
        <div className="flex items-end justify-between gap-3 pl-5 pr-4 pt-5 pb-2.5 shrink-0" data-widget="title" {...longPress}>
          <div className="min-w-0">{title}</div>
          <button type="button" ref={editTitleRef} onClick={() => enter("title")} aria-label="Edit home" className={PENCIL}>
            <Pencil className="h-[18px] w-[18px]" aria-hidden />
          </button>
        </div>
      ) : (
        <div className="pt-6 shrink-0">
          <h1 className="sr-only" data-testid="home-title">
            LogEveryLift
          </h1>
        </div>
      )}

      <div className="flex-1 flex flex-col gap-3 px-4 pt-1 min-h-0 overflow-y-auto pb-4" data-testid="home-content" {...longPress}>
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
            <Pencil className="h-[18px] w-[18px]" aria-hidden />
          </button>
        )}
      </div>

      {startBar}
      {endNotices}
    </>
  );
}
