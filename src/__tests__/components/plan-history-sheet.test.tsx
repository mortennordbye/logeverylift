// @vitest-environment jsdom
import { PlanHistoryClient, type HistoryRow } from "@/components/features/PlanHistoryClient";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/** The restore confirm is a Plan sheet like the others: title and Close on one row, Restore over a plain Cancel (J2-11). */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/plan-revisions", () => ({ restorePlanRevision: vi.fn(), applyRejectedChange: vi.fn() }));

const row = (id: number): HistoryRow => ({ id, action: "update", writer: "user", clientName: null, reason: null, when: `1${id} Nov 10:00`, changes: [] });

describe("the restore confirm", () => {
  it("has the one Plan sheet header and button layout", () => {
    render(<PlanHistoryClient kind="cycle" rows={[row(2), row(1)]} />);
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    const header = screen.getByTestId("sheet-header");
    expect(within(header).getByRole("heading", { name: "Restore this version?" })).toBeTruthy();
    expect(within(header).getByRole("button", { name: "Close" })).toBeTruthy();
    const sheet = screen.getByRole("region", { name: "Restore this version?" });
    const buttons = within(sheet).getAllByRole("button").map((b) => b.textContent);
    expect(buttons.slice(-2)).toEqual(["Restore", "Cancel"]);
  });
});
