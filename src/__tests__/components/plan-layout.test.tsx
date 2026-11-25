// @vitest-environment jsdom
import { CycleCompletionBanner } from "@/components/features/CycleCompletionBanner";
import { StartCycleButton } from "@/components/features/CycleDetailClient";
import { CyclesListClient } from "@/components/features/CyclesListClient";
import { PlanItemDeleted } from "@/components/features/PlanItemDeleted";
import { PlanSheetPanel } from "@/components/features/PlanSheetPanel";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { restorePlanRevision } from "@/lib/actions/plan-revisions";
import type { PlanListData } from "@/lib/plan-list";
import type { TrainingCycle } from "@/types/workout";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The fixed 2026 dates here read without a year only while the clock is in
// 2026 (yearSuffix in src/lib/utils/date-label.ts). Pinned at load, before any
// fixture below is built.
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date("2026-11-25T12:00:00Z"));
afterAll(() => vi.useRealTimers());

/**
 * Layout rules of the Plan screens at 320 px (round 6 capture): sheets scroll
 * as a whole with one Close style, labels and dates break between words that
 * belong apart, and a deleted item's page names it and offers Restore.
 * e2e/plan-narrow.spec.ts measures the same in a real browser.
 */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh, back: vi.fn() }) }));
vi.mock("@/lib/actions/plan-revisions", () => ({ restorePlanRevision: vi.fn() }));
vi.mock("@/lib/actions/training-cycles", () => ({ startTrainingCycle: vi.fn(), deleteManyTrainingCycles: vi.fn() }));

beforeEach(() => {
  refresh.mockReset();
  vi.mocked(restorePlanRevision).mockReset();
});
afterEach(cleanup);

describe("a Plan sheet", () => {
  it("scrolls as a whole: no part of it shrinks into its own scroll", () => {
    render(
      <BottomSheet open onClose={() => {}}>
        <PlanSheetPanel label="Session" title="Session" testId="panel">
          <ul data-testid="list" className="overflow-hidden">
            <li>Squat</li>
          </ul>
        </PlanSheetPanel>
      </BottomSheet>,
    );
    const panel = screen.getByTestId("panel");
    expect(panel.className).toContain("overflow-y-auto");
    expect(panel.className).toContain("[&>*]:shrink-0");
  });

  it("pins its footer at the bottom while the rest scrolls under it", () => {
    render(
      <BottomSheet open onClose={() => {}}>
        <PlanSheetPanel label="Phase" title="Base" testId="panel" footer={<button type="button">Save phase</button>}>
          <p>Body</p>
        </PlanSheetPanel>
      </BottomSheet>,
    );
    const footer = screen.getByTestId("sheet-footer");
    expect(footer.parentElement).toBe(screen.getByTestId("panel"));
    expect(footer.className).toContain("sticky");
    expect(footer.className).toContain("bottom-0");
    expect(within(footer).getByRole("button", { name: "Save phase" })).toBeTruthy();
  });

  it("has the one round 44 px Close button, which closes it", () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open onClose={onClose}>
        <PlanSheetPanel label="Session" title="Upper A" kicker={<span>Today</span>}>
          <p>Body</p>
        </PlanSheetPanel>
      </BottomSheet>,
    );
    const close = screen.getByRole("button", { name: "Close" });
    // One header for every Plan sheet: the title and Close on one row (J2-11).
    const header = screen.getByTestId("sheet-header");
    expect(within(header).getByRole("heading", { name: "Upper A" })).toBeTruthy();
    expect(header.contains(close)).toBe(true);
    for (const c of ["h-11", "w-11", "rounded-full", "bg-widget-2"]) expect(close.className).toContain(c);
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalled();
  });
});

const list: PlanListData = {
  empty: false,
  hero: { kind: "week", id: 1, name: "Base block", label: "Week 2 of 6 · Same days each week", ends: "Ends 13 Dec", days: [], summary: "7 sessions" },
  seasons: [],
  upNext: [],
  past: [],
  pastSeasons: [],
  select: { current: [], upNext: [], past: [] },
};

describe("the Plan list", () => {
  it("breaks the hero label only between its parts", () => {
    render(<CyclesListClient data={list} deletedCount={0} />);
    const parts = [...screen.getByTestId("hero-label").children];
    expect(parts.map((p) => p.textContent!.replace(/\u00a0/g, " "))).toEqual(["Week 2 of 6 · ", "Same days each week"]);
    for (const p of parts) expect(p.className).toContain("whitespace-nowrap");
  });

  it("the + menu has the same Close as every Plan sheet", () => {
    render(<CyclesListClient data={list} deletedCount={0} />);
    fireEvent.click(screen.getByRole("button", { name: "New cycle or season" }));
    const sheet = screen.getByRole("region", { name: "New" });
    expect(within(sheet).getByRole("button", { name: "Close" }).className).toContain("rounded-full");
  });
});

describe("cycle detail at 320 px", () => {
  const draft = { id: 4, status: "draft", name: "Strength upkeep" } as unknown as TrainingCycle;

  it("the scheduled card wraps the button under a date that stays on one line", () => {
    render(<StartCycleButton cycle={draft} scheduledFor="2026-12-14" />);
    const date = screen.getByText("Starts Mon 14 Dec");
    expect(date.className).toContain("whitespace-nowrap");
    expect(date.parentElement!.parentElement!.className).toContain("flex-wrap");
  });

  it("the Next link keeps its chevron with the last word", () => {
    const done = { id: 5, name: "Strength 5x5", status: "completed", endAction: "none", endMessage: null } as unknown as TrainingCycle;
    render(<CycleCompletionBanner cycle={done} lengthLabel="8 weeks" endedLabel="ended 30 Oct" next={{ id: 8, name: "Strength peak", startsLabel: "Sat 12 Dec", startsTomorrow: false }} />);
    const line = screen.getByRole("link", { name: /Strength peak/ }).lastElementChild!;
    expect(line.textContent).toBe("Strength peak starts Sat 12 Dec ›");
  });
});

describe("a deleted cycle's page", () => {
  const item = { what: "cycle" as const, name: "Upper / Lower hypertrophy", revisionId: 41 };

  it("has the Plan header with Back, names the cycle and links Recently deleted", () => {
    render(<PlanItemDeleted item={item} />);
    expect(screen.getByTestId("back-link").getAttribute("href")).toBe("/cycles");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Upper / Lower hypertrophy was deleted.");
    expect(screen.getByRole("link", { name: "Recently deleted" }).getAttribute("href")).toBe("/cycles/deleted");
  });

  it("Restore brings back the delete revision and shows the cycle again", async () => {
    vi.mocked(restorePlanRevision).mockResolvedValue({ success: true, data: { objectType: "cycle", objectId: 7, skipped: [] } });
    render(<PlanItemDeleted item={item} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    });
    expect(restorePlanRevision).toHaveBeenCalledWith({ revisionId: 41 });
    expect(refresh).toHaveBeenCalled();
  });

  it("says why when the restore is refused, and offers no Restore without a revision", async () => {
    vi.mocked(restorePlanRevision).mockResolvedValue({ success: false, error: "Revision not found" });
    const { unmount } = render(<PlanItemDeleted item={item} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    });
    expect(screen.getByRole("alert").textContent).toBe("Revision not found");
    expect(refresh).not.toHaveBeenCalled();
    unmount();
    render(<PlanItemDeleted item={{ ...item, revisionId: null }} />);
    expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
  });
});
