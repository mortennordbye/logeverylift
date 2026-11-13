// @vitest-environment jsdom
import { WidgetErrorBoundary } from "@/components/features/home/WidgetErrorBoundary";
import { defineWidget } from "@/components/features/home/define-widget";
import { renderCoreWidget } from "@/components/features/home/render-widget";
import { WidgetError } from "@/components/features/home/widget-ui";
import type { HomeCore } from "@/lib/home/core";
import { safeLoad } from "@/lib/home/safe-load";
import { render, screen } from "@testing-library/react";
import { redirect } from "next/navigation";
import { afterEach, describe, expect, it, vi } from "vitest";

/** T4 in docs/home-widgets-audit.md, section 7: one failing widget stays inside its slot. */

vi.mock("@/components/features/SkipAutoDayButton", () => ({ SkipAutoDayButton: () => null }));
vi.mock("@/components/features/WorkoutInsightBanner", () => ({ WorkoutInsightBanner: () => null }));

afterEach(() => vi.restoreAllMocks());

function Boom(): never {
  throw new Error("view broke");
}

describe("WidgetErrorBoundary", () => {
  it("a throwing view shows \"Couldn't load this.\" and the rest of the list stays", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <div>
        <WidgetErrorBoundary id="recentPrs" fallback={<WidgetError />}>
          <Boom />
        </WidgetErrorBoundary>
        <p>Week is fine</p>
      </div>,
    );
    expect(screen.getByText("Couldn't load this.")).toBeTruthy();
    expect(screen.getByText("Week is fine")).toBeTruthy();
  });
});

describe("renderCoreWidget", () => {
  it("a throwing Today select still shows a link to /new-workout", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { todayWidget } = await import("@/components/features/home/widgets/today/View");
    const broken = {
      ...todayWidget,
      select: () => {
        throw new Error("select broke");
      },
    };
    render(<>{renderCoreWidget("today", broken, {} as HomeCore, "l")}</>);
    expect(screen.getByRole("link", { name: "Start a Workout" }).getAttribute("href")).toBe("/new-workout");
  });

  it("a throwing Today view still shows a link to /new-workout", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { todayWidget } = await import("@/components/features/home/widgets/today/View");
    const broken = { ...todayWidget, select: () => ({}) as never, View: () => <Boom /> };
    render(<>{renderCoreWidget("today", broken, {} as HomeCore, "l")}</>);
    expect(screen.getByRole("link", { name: "Start a Workout" }).getAttribute("href")).toBe("/new-workout");
  });

  it("a widget without its own error state shows the default", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const w = defineWidget<number>({
      select: () => {
        throw new Error("x");
      },
      View: () => null,
      Empty: () => null,
      Skeleton: () => null,
      Preview: () => null,
    });
    render(<>{renderCoreWidget("cycle", w, {} as HomeCore, "m")}</>);
    expect(screen.getByText("Couldn't load this.")).toBeTruthy();
  });
});

describe("safeLoad", () => {
  it("catches a plain error, logging only the id and the error's name", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      await safeLoad("recentPrs", () => {
        throw new TypeError("secret detail");
      }),
    ).toEqual({ ok: false });
    expect(log).toHaveBeenCalledWith("[homeWidget] load_failed", { id: "recentPrs", error: "TypeError" });
  });

  it("rethrows Next's redirect", async () => {
    await expect(safeLoad("recentPrs", () => redirect("/login"))).rejects.toThrow("NEXT_REDIRECT");
  });

  it("passes data through", async () => {
    expect(await safeLoad("x", async () => [1])).toEqual({ ok: true, data: [1] });
  });
});
