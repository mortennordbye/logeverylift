// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const back = vi.fn();
const replace = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ back, replace, refresh, push: vi.fn(), prefetch: vi.fn() }) }));
const markProgrammaticBack = vi.fn();
vi.mock("@/lib/utils/nav-intent", () => ({ markProgrammaticBack: () => markProgrammaticBack() }));

const MORE = { href: "/more", label: "More" };

/** Puts the browser on `path`, tagged as pushed from `prev` (see nav-history.ts). */
function at(path: string, prev: string | null) {
  window.history.replaceState(prev === null ? null : { __lelPrev: prev }, "", path);
}

/**
 * Clicks `link` and reports whether the app cancelled the browser's own
 * navigation. jsdom cannot navigate, so the default is cancelled afterwards,
 * once the answer is read.
 */
function click(link: HTMLElement): boolean {
  let prevented = false;
  const after = (e: Event) => {
    prevented = e.defaultPrevented;
    e.preventDefault();
  };
  window.addEventListener("click", after, { once: true });
  act(() => {
    fireEvent.click(link);
  });
  return prevented;
}

async function load() {
  return import("@/components/ui/BackLink");
}

beforeEach(() => {
  back.mockClear();
  replace.mockClear();
  refresh.mockClear();
  markProgrammaticBack.mockClear();
});

describe("BackLink", () => {
  it("renders the fallback on the server, so hydration matches", async () => {
    const { BackLink } = await load();
    at("/more/metrics", "/");
    const html = renderToString(<BackLink fallback={MORE} />);
    expect(html).toContain('href="/more"');
    expect(html).toContain(">More<");
  });

  it("names the previous in-app page and pops to it", async () => {
    const { BackLink } = await load();
    at("/more/metrics", "/");
    render(<BackLink fallback={MORE} />);
    const link = screen.getByRole("link", { name: "Back to Home" });
    expect(link.getAttribute("href")).toBe("/more");
    expect(click(link)).toBe(true);
    expect(markProgrammaticBack).toHaveBeenCalledTimes(1);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("tells a screen reader where Back goes", async () => {
    const { BackLink } = await load();
    at("/more/metrics", "/");
    render(<BackLink fallback={MORE} />);
    expect(screen.getByRole("link", { name: "Back to Home" }).textContent).toBe("Home");
  });

  it("links to the fallback when there is no previous page", async () => {
    const { BackLink } = await load();
    at("/more/metrics", null);
    render(<BackLink fallback={MORE} />);
    const link = screen.getByRole("link", { name: "Back to More" });
    expect(click(link)).toBe(false);
    expect(back).not.toHaveBeenCalled();
    expect(markProgrammaticBack).not.toHaveBeenCalled();
  });

  it("does not go back into a form it came from", async () => {
    const { BackLink } = await load();
    at("/seasons/2", "/seasons/new");
    render(<BackLink fallback={{ href: "/cycles", label: "Cycles" }} />);
    expect(click(screen.getByRole("link", { name: "Back to Cycles" }))).toBe(false);
    expect(back).not.toHaveBeenCalled();
  });
});

describe("useBack", () => {
  it("go() pops when the previous page is in the app", async () => {
    const { useBack } = await load();
    at("/history/4", "/exercises/7");
    const { result } = renderHook(() => useBack({ href: "/history", label: "History" }));
    expect(result.current.label).toBe("Exercise");
    act(() => result.current.go());
    expect(back).toHaveBeenCalledTimes(1);
    expect(markProgrammaticBack).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });

  it("go() replaces with the fallback otherwise, so the page does not stay in history", async () => {
    const { useBack } = await load();
    at("/history/4", null);
    const { result } = renderHook(() => useBack({ href: "/history", label: "History" }));
    act(() => result.current.go());
    expect(replace).toHaveBeenCalledWith("/history");
    expect(back).not.toHaveBeenCalled();
  });
});

describe("useReturnTo", () => {
  it("pops back to the target when it is the page before", async () => {
    const { useReturnTo } = await load();
    at("/seasons/2/edit", "/seasons/2");
    const { result } = renderHook(() => useReturnTo());
    act(() => result.current("/seasons/2"));
    expect(markProgrammaticBack).toHaveBeenCalledTimes(1);
    expect(back).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
    // No refresh: it would race the pop and refetch the page being left.
    expect(refresh).not.toHaveBeenCalled();
  });

  it("replaces with the target otherwise", async () => {
    const { useReturnTo } = await load();
    at("/seasons/new", "/cycles");
    const { result } = renderHook(() => useReturnTo());
    act(() => result.current("/seasons/9"));
    expect(replace).toHaveBeenCalledWith("/seasons/9");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
  });
});
