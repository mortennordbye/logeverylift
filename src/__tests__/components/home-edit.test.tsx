// @vitest-environment jsdom
import type { ResolvedItem } from "@/lib/home/layout";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import Link from "next/link";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** C2 in docs/home-widgets-audit.md, section 7: home edit mode. */

const save = vi.fn();
vi.mock("@/lib/actions/home-layout", () => ({ saveHomeLayout: (d: unknown) => save(d) }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { HomeGrid } = await import("@/components/features/home/HomeGrid");

const ITEMS: ResolvedItem[] = [
  { id: "title", size: "m", hidden: false },
  { id: "today", size: "l", hidden: false },
  { id: "week", size: "l", hidden: false },
  { id: "cycle", size: "m", hidden: true },
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
        slots={{ title: <h1>LogEveryLift</h1>, today: <Link href="/programs/1/workout">Start Today&apos;s Workout</Link>, week: <p>Week content</p> }}
        previews={{}}
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

beforeEach(() => {
  save.mockReset();
  refresh.mockReset();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("home edit mode (C2)", () => {
  it("mounts no DndContext before Edit", () => {
    setup();
    expect(document.querySelector('[aria-roledescription="sortable"]')).toBeNull();
    expect(screen.queryByTestId("home-edit-list")).toBeNull();
    edit();
    // The handle's description comes from the DndContext with the fixed id.
    const handle = screen.getByRole("button", { name: "Drag Today" });
    expect(handle.getAttribute("aria-roledescription")).toBe("sortable");
    expect(handle.getAttribute("aria-describedby")).toContain("home-edit");
  });

  it("shows the list and no widget content, notices or start bar", () => {
    setup();
    edit();
    expect(screen.getByTestId("home-edit-list")).toBeTruthy();
    expect(screen.queryByText("Week content")).toBeNull();
    expect(screen.queryByRole("link", { name: "Start Today's Workout" })).toBeNull();
    expect(screen.queryByText("Policy notice")).toBeNull();
    expect(screen.queryByText("Start bar")).toBeNull();
    expect(screen.getByTestId("home-edit-bar")).toBeTruthy();
    expect(screen.getByText("Can't be hidden")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Hide Today" })).toBeNull();
  });

  it("announces edit mode and focuses the first row's handle", () => {
    setup();
    edit();
    expect(announced()).toBe("Editing home. Drag or use Move up and Move down to reorder.");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Drag Today" }));
  });

  it("Move up from the keyboard reorders, announces the place, and keeps focus on the button", () => {
    setup();
    edit();
    const up = screen.getByRole("button", { name: "Move Week up" });
    up.focus();
    fireEvent.click(up);
    const rows = screen.getAllByTestId("edit-row").map((r) => r.getAttribute("data-edit-row"));
    expect(rows).toEqual(["title", "week", "today"]);
    expect(announced()).toBe("Week moved to position 1 of 2");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move Week up" }));
  });

  it("after hide, focus moves to the next row's handle; the row goes to Hidden", () => {
    setup([...ITEMS.slice(0, 3), { id: "cycle", size: "m", hidden: false }, ITEMS[4]]);
    edit();
    fireEvent.click(screen.getByRole("button", { name: "Hide Week" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Drag Cycle progress" }));
    expect(within(screen.getByRole("region", { name: "Hidden" })).getByText("Week")).toBeTruthy();
  });

  it("Cancel drops the draft", () => {
    setup();
    edit();
    fireEvent.click(screen.getByRole("button", { name: "Move Week up" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(window.confirm).toHaveBeenCalledWith("Discard changes?");
    expect(screen.getByText("Week content")).toBeTruthy();
    edit();
    expect(screen.getAllByTestId("edit-row").map((r) => r.getAttribute("data-edit-row"))).toEqual(["title", "today", "week"]);
    expect(save).not.toHaveBeenCalled();
  });

  it("Done saves once, through the action, and returns focus to Edit", async () => {
    save.mockResolvedValue({ success: true, data: { updatedAt: "2026-11-13T10:00:00.000Z" } });
    setup();
    edit();
    fireEvent.click(screen.getByRole("button", { name: "Move Week up" }));
    await done();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toEqual({
      items: [
        { id: "title", size: "m", hidden: false },
        { id: "week", size: "l", hidden: false },
        { id: "today", size: "l", hidden: false },
        { id: "cycle", size: "m", hidden: true },
        { id: "recentPrs", size: "m", hidden: true },
      ],
      baseUpdatedAt: null,
      force: false,
    });
    expect(screen.queryByTestId("home-edit-list")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit home" }));
  });

  it("a failed save stays in edit mode with the draft", async () => {
    save.mockResolvedValue({ success: false, error: "Couldn't save your home layout" });
    setup();
    edit();
    fireEvent.click(screen.getByRole("button", { name: "Move Week up" }));
    await done();
    expect(screen.getByTestId("home-save-error").textContent).toBe("Couldn't save your home layout");
    expect(screen.getAllByTestId("edit-row").map((r) => r.getAttribute("data-edit-row"))).toEqual(["title", "week", "today"]);
  });

  it("offline: a rejected call says so and keeps the draft", async () => {
    save.mockRejectedValue(new TypeError("Failed to fetch"));
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    setup();
    edit();
    fireEvent.click(screen.getByRole("button", { name: "Move Week up" }));
    await done();
    expect(screen.getByTestId("home-save-error").textContent).toBe("You're offline. Try again when connected.");
    expect(screen.getByTestId("home-edit-list")).toBeTruthy();
    online.mockRestore();
  });

  it("a conflict offers Reload and Save mine, which forces", async () => {
    save.mockResolvedValueOnce({ success: false, error: "conflict" }).mockResolvedValueOnce({ success: true, data: { updatedAt: null } });
    setup();
    edit();
    fireEvent.click(screen.getByRole("button", { name: "Move Week up" }));
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

  it("the Edit home pencil sits in the title row, and only there", () => {
    setup();
    const pencils = screen.getAllByRole("button", { name: "Edit home" });
    expect(pencils).toHaveLength(1);
    expect(pencils[0].closest("[data-testid=home-content]")).toBeNull();
    expect(pencils[0].className).toMatch(/\bh-11\b/);
    expect(pencils[0].className).toMatch(/\bw-11\b/);
  });

  it("with the title hidden, the pencil moves to the end of the list and still opens edit mode", () => {
    setup([{ id: "title", size: "m", hidden: true }, ...ITEMS.slice(1)]);
    const pencils = screen.getAllByRole("button", { name: "Edit home" });
    expect(pencils).toHaveLength(1);
    const content = screen.getByTestId("home-content");
    expect(content.lastElementChild).toBe(pencils[0]);
    expect(screen.getByTestId("home-title").className).toContain("sr-only");
    fireEvent.click(pencils[0]);
    expect(screen.getByTestId("home-edit-list")).toBeTruthy();
  });

  it("every edit-mode control is at least 44 px and has a name", () => {
    setup();
    edit();
    for (const b of screen.getByTestId("home-edit-list").querySelectorAll("button, select")) {
      expect(b.getAttribute("aria-label") ?? b.textContent?.trim()).toBeTruthy();
      expect(b.className).toMatch(/\b(h-11|min-h-11)\b/);
    }
  });
});
