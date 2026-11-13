// @vitest-environment jsdom
import type { ResolvedItem } from "@/lib/home/layout";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import Link from "next/link";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * C2 in docs/home-widgets-audit.md, section 7: home edit mode, the iPhone way
 * (decision 17): the real grid, long-press or the pencil to enter, a sheet per
 * widget, a hide badge. Drag itself is covered in e2e/home-layout.spec.ts.
 */

const save = vi.fn();
vi.mock("@/lib/actions/home-layout", () => ({ saveHomeLayout: (d: unknown) => save(d) }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

// jsdom has no PointerEvent; without one, fireEvent.pointer* drops clientX and button.
if (typeof window.PointerEvent === "undefined") {
  (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = class extends MouseEvent {};
}

const { HomeGrid } = await import("@/components/features/home/HomeGrid");

const ITEMS: ResolvedItem[] = [
  { id: "title", size: "m", hidden: false },
  { id: "today", size: "l", hidden: false },
  { id: "week", size: "l", hidden: false },
  { id: "cycle", size: "m", hidden: false },
  { id: "recentPrs", size: "m", hidden: true },
];

function setup(items = ITEMS) {
  return render(
    <div>
      <HomeGrid
        items={items}
        defaultItems={ITEMS}
        baseUpdatedAt={null}
        title={<h1>LogEveryLift</h1>}
        slots={{
          title: <h1>LogEveryLift</h1>,
          today: <Link href="/programs/1/workout">Start Today&apos;s Workout</Link>,
          week: <p>Week content</p>,
          cycle: <p>Cycle content</p>,
        }}
        previews={{ today: { s: <p>Today preview S</p> }, recentPrs: { m: <p>PRs preview</p> } }}
        topNotices={<p>Policy notice</p>}
        afterTraining={null}
        endNotices={null}
        startBar={<p>Start bar</p>}
      />
    </div>,
  );
}

const edit = () => fireEvent.click(screen.getByRole("button", { name: "Edit home" }));
const done = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
  });
};
const announced = () => screen.getByTestId("home-announce").textContent;
const tiles = () => screen.getAllByTestId("edit-tile").map((t) => t.getAttribute("data-edit-tile"));
const tile = (id: string) => document.querySelector<HTMLElement>(`[data-edit-tile="${id}"] [data-control="tile"]`)!;
const sheet = () => screen.getByTestId("widget-sheet");

beforeEach(() => {
  save.mockReset();
  refresh.mockReset();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("entering edit mode", () => {
  it("mounts no DndContext before edit mode", () => {
    setup();
    expect(document.querySelector('[aria-roledescription="sortable"]')).toBeNull();
    edit();
    expect(tile("today").getAttribute("aria-roledescription")).toBe("sortable");
    expect(tile("today").getAttribute("aria-describedby")).toContain("home-edit");
  });

  it("the pencil sits in the title row only; with the title hidden it moves to the end of the list", () => {
    const { unmount } = setup();
    let pencils = screen.getAllByRole("button", { name: "Edit home" });
    expect(pencils).toHaveLength(1);
    expect(pencils[0].closest("[data-testid=home-content]")).toBeNull();
    expect(pencils[0].className).toMatch(/\bh-11\b.*\bw-11\b/);
    unmount();

    setup([{ id: "title", size: "m", hidden: true }, ...ITEMS.slice(1)]);
    pencils = screen.getAllByRole("button", { name: "Edit home" });
    expect(pencils).toHaveLength(1);
    expect(screen.getByTestId("home-content").lastElementChild).toBe(pencils[0]);
    fireEvent.click(pencils[0]);
    expect(screen.getByTestId("home-edit-grid")).toBeTruthy();
  });

  it("a long press on a widget enters edit mode, and its release opens nothing", () => {
    vi.useFakeTimers();
    setup();
    const week = screen.getByText("Week content");
    fireEvent.pointerDown(week, { button: 0, clientX: 10, clientY: 10 });
    act(() => vi.advanceTimersByTime(499));
    expect(screen.queryByTestId("home-edit-grid")).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId("home-edit-grid")).toBeTruthy();
    fireEvent.click(tile("week"));
    expect(screen.queryByTestId("widget-sheet")).toBeNull();
  });

  it("moving more than 8 px (a scroll) or letting go early is not a long press, and a tap still follows the link", () => {
    vi.useFakeTimers();
    setup();
    const week = screen.getByText("Week content");
    fireEvent.pointerDown(week, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(week, { clientX: 10, clientY: 22 });
    act(() => vi.advanceTimersByTime(800));
    expect(screen.queryByTestId("home-edit-grid")).toBeNull();

    fireEvent.pointerDown(week, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(week);
    act(() => vi.advanceTimersByTime(800));
    expect(screen.queryByTestId("home-edit-grid")).toBeNull();

    const link = screen.getByRole("link", { name: "Start Today's Workout" });
    fireEvent.pointerDown(link, { button: 0, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(link);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
  });

  it("announces edit mode and focuses the first widget", () => {
    setup();
    edit();
    expect(announced()).toBe("Editing home. Drag a widget to move it, or tap it for its size, Move up and Move down.");
    expect(document.activeElement).toBe(tile("today"));
  });
});

describe("the edit grid", () => {
  it("shows the real widgets, inert, and no notices or start bar", () => {
    setup();
    edit();
    expect(tiles()).toEqual(["title", "today", "week", "cycle"]);
    expect(screen.getByText("Week content").closest("[inert]")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Start Today's Workout", hidden: true }).closest("[inert]")).not.toBeNull();
    expect(screen.queryByText("Policy notice")).toBeNull();
    expect(screen.queryByText("Start bar")).toBeNull();
    expect(screen.getByTestId("home-edit-bar")).toBeTruthy();
  });

  it("widgets jiggle", () => {
    setup();
    edit();
    expect(document.querySelector('[data-edit-tile="week"] .home-jiggle')).not.toBeNull();
  });

  it("a hide badge on hideable widgets only; hiding moves focus to the next widget", () => {
    setup();
    edit();
    expect(screen.queryByRole("button", { name: "Hide Today" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Hide Week" }));
    expect(tiles()).toEqual(["title", "today", "cycle"]);
    expect(announced()).toBe("Week hidden");
    expect(document.activeElement).toBe(tile("cycle"));
  });

  it("a tap opens the widget's sheet: resize shows at once, Move up and down announce, Hide hides", () => {
    setup();
    edit();
    fireEvent.click(tile("today"));
    expect(within(sheet()).getByText("Can't be hidden: it holds the start buttons.")).toBeTruthy();
    fireEvent.click(within(sheet()).getByRole("button", { name: "Small" }));
    expect(within(sheet()).getByRole("button", { name: "Small" }).getAttribute("aria-pressed")).toBe("true");
    // Not the saved size: the static preview stands in until Done.
    expect(screen.getByText("Today preview S")).toBeTruthy();
    expect(announced()).toBe("Today is now small");
    fireEvent.click(within(sheet()).getByRole("button", { name: "Move down" }));
    expect(tiles()).toEqual(["title", "week", "today", "cycle"]);
    expect(announced()).toBe("Today moved to position 2 of 3");
    fireEvent.click(within(sheet()).getByRole("button", { name: "Close" }));

    fireEvent.click(tile("cycle"));
    expect(within(sheet()).getByRole("button", { name: "Move down" })).toHaveProperty("disabled", true);
    fireEvent.click(within(sheet()).getByRole("button", { name: "Hide" }));
    expect(tiles()).toEqual(["title", "week", "today"]);
  });

  it("Enter opens the sheet from the keyboard", () => {
    setup();
    edit();
    fireEvent.keyDown(tile("week"), { key: "Enter" });
    expect(within(sheet()).getByRole("heading", { name: "Week" })).toBeTruthy();
  });

  it("the gallery adds a hidden widget last", () => {
    setup();
    edit();
    fireEvent.click(screen.getByRole("button", { name: "Add widget" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Recent PRs" }));
    expect(tiles()).toEqual(["title", "today", "week", "cycle", "recentPrs"]);
    expect(within(screen.getByTestId("home-edit-grid")).getByText("PRs preview")).toBeTruthy();
  });
});

describe("saving", () => {
  it("Cancel drops the draft", () => {
    setup();
    edit();
    fireEvent.click(screen.getByRole("button", { name: "Hide Week" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(window.confirm).toHaveBeenCalledWith("Discard changes?");
    expect(screen.getByText("Week content")).toBeTruthy();
    edit();
    expect(tiles()).toEqual(["title", "today", "week", "cycle"]);
    expect(save).not.toHaveBeenCalled();
  });

  it("Done saves once, through the action, and returns focus to the pencil", async () => {
    save.mockResolvedValue({ success: true, data: { updatedAt: "2026-11-13T10:00:00.000Z" } });
    setup();
    edit();
    fireEvent.click(tile("week"));
    fireEvent.click(within(sheet()).getByRole("button", { name: "Move up" }));
    await done();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toEqual({
      items: [
        { id: "title", size: "m", hidden: false },
        { id: "week", size: "l", hidden: false },
        { id: "today", size: "l", hidden: false },
        { id: "cycle", size: "m", hidden: false },
        { id: "recentPrs", size: "m", hidden: true },
      ],
      baseUpdatedAt: null,
      force: false,
    });
    expect(screen.queryByTestId("home-edit-grid")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit home" }));
  });

  it("a failed save stays in edit mode with the draft", async () => {
    save.mockResolvedValue({ success: false, error: "Couldn't save your home layout" });
    setup();
    edit();
    fireEvent.click(screen.getByRole("button", { name: "Hide Week" }));
    await done();
    expect(screen.getByTestId("home-save-error").textContent).toBe("Couldn't save your home layout");
    expect(tiles()).toEqual(["title", "today", "cycle"]);
  });

  it("offline: a rejected call says so and keeps the draft", async () => {
    save.mockRejectedValue(new TypeError("Failed to fetch"));
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    setup();
    edit();
    fireEvent.click(screen.getByRole("button", { name: "Hide Week" }));
    await done();
    expect(screen.getByTestId("home-save-error").textContent).toBe("You're offline. Try again when connected.");
    expect(screen.getByTestId("home-edit-grid")).toBeTruthy();
    online.mockRestore();
  });

  it("a conflict offers Reload and Save mine, which forces", async () => {
    save.mockResolvedValueOnce({ success: false, error: "conflict" }).mockResolvedValueOnce({ success: true, data: { updatedAt: null } });
    setup();
    edit();
    fireEvent.click(screen.getByRole("button", { name: "Hide Week" }));
    await done();
    expect(screen.getByText("Your home was changed on another device.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save mine" }));
    });
    expect(save.mock.calls[1][0].force).toBe(true);
  });

  it("Done without changes saves nothing", async () => {
    setup();
    edit();
    await done();
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText("Week content")).toBeTruthy();
  });

  it("Reset asks, then saves null", async () => {
    save.mockResolvedValue({ success: true, data: { updatedAt: null } });
    setup();
    edit();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    });
    expect(window.confirm).toHaveBeenCalledWith("Reset home to the default layout?");
    expect(save.mock.calls[0][0]).toEqual({ items: null, baseUpdatedAt: null, force: false });
  });

  it("every edit-mode control is at least 44 px and has a name", () => {
    setup();
    edit();
    fireEvent.click(tile("week"));
    const controls = [
      ...screen.getByTestId("home-edit-grid").querySelectorAll<HTMLElement>("button"),
      ...sheet().querySelectorAll<HTMLElement>("button"),
      ...Array.from(document.querySelectorAll<HTMLElement>("button")).filter((b) => ["Cancel", "Done", "Add widget", "Undo", "Reset"].includes(b.textContent?.trim() ?? "")),
    ];
    expect(controls.length).toBeGreaterThan(8);
    for (const b of controls) {
      expect(b.getAttribute("aria-label") ?? b.textContent?.trim()).toBeTruthy();
      expect(b.className).toMatch(/\b(h-11|min-h-11)\b/);
    }
  });
});
