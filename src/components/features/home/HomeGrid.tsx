"use client";

import { saveHomeLayout } from "@/lib/actions/home-layout";
import { afterTrainingRow, toRows, type ResolvedItem } from "@/lib/home/layout";
import { editReducer, initEdit, movableItems, type EditAction } from "@/lib/home/layout-reducer";
import type { StoredHomeItem } from "@/lib/home/stored-layout";
import { widgetDef, type WidgetId } from "@/lib/home/widgets";
import { callAction } from "@/lib/utils/stale-bundle";
import { Pencil, Plus, RotateCcw, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { HomeEditList, type Previews, type RowControl } from "./HomeEditList";
import { WidgetGallerySheet } from "./WidgetGallerySheet";

/**
 * The home screen's layout and its edit mode (docs/home-widgets-audit.md, 6.9).
 *
 * Outside edit mode widget content arrives rendered from the server in
 * `slots`, and this only places it: two consecutive S widgets share a row, M
 * and L take a full row, and the last widget stretches to fill the screen
 * when its def says so (Week), as the old page did. The content scrolls when
 * it is taller than the screen.
 *
 * In edit mode the page shows the edit list instead; notices, the start bar
 * and widget content are not rendered, and the edit bar covers the bottom nav
 * until Done or Cancel, so a navigation cannot drop the draft. The page keys
 * this component on the saved layout, so a save resets it to the new layout.
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

const ENTER_TEXT = "Editing home. Drag or use Move up and Move down to reorder.";

/** Focus "Edit home" on the next mount: a save remounts this component with the new layout. */
let focusEditOnMount = false;

type Status = { kind: "error"; text: string } | { kind: "conflict" } | null;
type Focus = { id: WidgetId; control: RowControl } | null;

function toStored(items: ResolvedItem[]): StoredHomeItem[] {
  return items.map(({ id, size, hidden, settings }) => (settings ? { id, size, hidden, settings } : { id, size, hidden }));
}

export function HomeGrid(props: HomeGridProps) {
  const { items, defaultItems, baseUpdatedAt, title, slots, previews, topNotices, afterTraining, endNotices, startBar } = props;
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [state, dispatch] = useReducer(editReducer, items, initEdit);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [saving, setSaving] = useState(false);
  const [say, setSay] = useState("");
  const pendingFocus = useRef<Focus>(null);
  const openedFrom = useRef<"title" | "end">("title");
  const editTitleRef = useRef<HTMLButtonElement>(null);
  const editEndRef = useRef<HTMLButtonElement>(null);
  const focusEdit = useRef(false);
  const dirty = state.past.length > 0;

  // Focus after a change: the moved row's control, the next row after a hide.
  useEffect(() => {
    const f = pendingFocus.current;
    if (!f) return;
    pendingFocus.current = null;
    document.querySelector<HTMLElement>(`[data-edit-row="${f.id}"] [data-control="${f.control}"]`)?.focus();
  });

  // Back on the button that opened edit mode, after Done or Cancel.
  useEffect(() => {
    if (focusEditOnMount) {
      focusEditOnMount = false;
      (editTitleRef.current ?? editEndRef.current)?.focus();
    }
  }, []);
  useEffect(() => {
    if (!focusEdit.current) return;
    focusEdit.current = false;
    ((openedFrom.current === "title" ? editTitleRef.current : editEndRef.current) ?? editEndRef.current)?.focus();
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

  function enter(from: "title" | "end") {
    openedFrom.current = from;
    dispatch({ type: "load", items });
    setStatus(null);
    setEditing(true);
    setSay(ENTER_TEXT);
    const first = movableItems(items)[0];
    pendingFocus.current = first ? { id: first.id, control: "handle" } : null;
  }

  function leave() {
    setEditing(false);
    setGalleryOpen(false);
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

  const liveRegion = (
    <p className="sr-only" aria-live="polite" data-testid="home-announce">
      {say}
    </p>
  );

  if (editing) {
    const hidden = state.items.filter((i) => i.hidden && widgetDef(i.id).kind === "widget");
    return (
      <>
        {liveRegion}
        <div className="px-4 pt-4 pb-2 shrink-0 flex items-center justify-between gap-2">
          <button type="button" onClick={cancel} className="min-h-11 min-w-11 px-2 text-base text-muted-foreground active:opacity-60">
            Cancel
          </button>
          <h1 className="text-lg font-semibold">Edit home</h1>
          <button
            type="button"
            onClick={done}
            disabled={saving}
            className="min-h-11 min-w-11 px-2 text-base font-semibold text-primary active:opacity-60 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Done"}
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 space-y-3">
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
          <HomeEditList items={state.items} previews={previews} act={act} />
        </div>

        {/* Covers the bottom nav: same height, above it. */}
        <div
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
          data-testid="home-edit-bar"
        >
          <div className="flex items-center justify-around h-16 max-w-lg mx-auto">
            <button
              type="button"
              onClick={() => setGalleryOpen(true)}
              disabled={hidden.length === 0}
              className="min-h-11 min-w-11 inline-flex items-center gap-1.5 px-3 text-sm font-medium text-primary active:opacity-60 disabled:opacity-40"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Add widget
            </button>
            <button
              type="button"
              onClick={() => act({ type: "undo" }, null, "Undone")}
              disabled={!dirty}
              className="min-h-11 min-w-11 inline-flex items-center gap-1.5 px-3 text-sm font-medium active:opacity-60 disabled:opacity-40"
            >
              <Undo2 className="h-4 w-4" aria-hidden />
              Undo
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={saving}
              className="min-h-11 min-w-11 inline-flex items-center gap-1.5 px-3 text-sm font-medium text-destructive active:opacity-60 disabled:opacity-40"
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
              Reset
            </button>
          </div>
        </div>

        <WidgetGallerySheet
          open={galleryOpen}
          onClose={() => setGalleryOpen(false)}
          hidden={hidden}
          previews={previews}
          onAdd={(id) => {
            setGalleryOpen(false);
            act({ type: "add", id }, { id, control: "handle" }, `${widgetDef(id).title} added`);
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
        <div className="relative px-6 pt-6 pb-3 shrink-0">
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

      <div className="flex-1 flex flex-col gap-3 px-6 min-h-0 overflow-y-auto pb-4" data-testid="home-content">
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
