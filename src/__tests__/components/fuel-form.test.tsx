// @vitest-environment jsdom
import { FuelForm, type FuelValues } from "@/components/features/nutrition/FuelForm";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/** The fuel log form (docs/plans/nutrition-and-race-day.md, 6). */

const gel = { id: 1, name: "Gel", carbsG: 25, sodiumMg: 50, caffeineMg: null, fluidMl: null };
const drink = { id: 2, name: "Drink", carbsG: 40, sodiumMg: 300, caffeineMg: null, fluidMl: 500 };

describe("FuelForm", () => {
  it("counts products, shows their sum as the hint, and sends items with a GI score", async () => {
    const onSave = vi.fn<(v: FuelValues) => Promise<{ success: true; data: null }>>(async () => ({ success: true, data: null }));
    render(<FuelForm idPrefix="t" initial={null} products={[gel, drink]} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "One more Gel" }));
    fireEvent.click(screen.getByRole("button", { name: "One more Gel" }));
    fireEvent.click(screen.getByRole("button", { name: "One more Drink" }));
    expect((screen.getByLabelText("Carbohydrate") as HTMLInputElement).placeholder).toBe("90");
    expect((screen.getByLabelText("Fluid") as HTMLInputElement).placeholder).toBe("500");
    fireEvent.click(screen.getByRole("button", { name: "3" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(onSave).toHaveBeenCalledWith({
      carbsG: null,
      fluidMl: null,
      sodiumMg: null,
      caffeineMg: null,
      giScore: 3,
      notes: null,
      items: [
        { productId: 1, count: 2 },
        { productId: 2, count: 1 },
      ],
    });
    expect(screen.getByRole("button", { name: "Saved" })).toBeTruthy();
  });

  it("keeps what was typed when the save fails, and shows the error", async () => {
    const onSave = vi.fn(async () => ({ success: false as const, error: "Session not found" }));
    render(<FuelForm idPrefix="t" initial={{ carbsG: 120, giScore: 2 }} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("Sodium"), { target: { value: "700" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(screen.getByRole("alert").textContent).toBe("Session not found");
    expect((screen.getByLabelText("Sodium") as HTMLInputElement).value).toBe("700");
    expect((screen.getByLabelText("Carbohydrate") as HTMLInputElement).value).toBe("120");
    expect(screen.getByRole("button", { name: "2" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps the stored totals when a log's products cannot show (Garmin card, deleted product)", async () => {
    const onSave = vi.fn<(v: FuelValues) => Promise<{ success: true; data: null }>>(async () => ({ success: true, data: null }));
    const initial = { carbsG: 100, sodiumMg: 200, fluidMl: null, items: [{ productId: 9, name: "Old gel", count: 4, carbsG: 25, sodiumMg: 50, caffeineMg: null, fluidMl: null }] };
    const { unmount } = render(<FuelForm idPrefix="t" initial={initial} onSave={onSave} />);
    expect((screen.getByLabelText("Carbohydrate") as HTMLInputElement).value).toBe("100");
    expect((screen.getByLabelText("Sodium") as HTMLInputElement).value).toBe("200");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ carbsG: 100, sodiumMg: 200, items: null }));
    unmount();

    // One product still exists, one was deleted: the totals stay as typed, the known product keeps its count.
    render(<FuelForm idPrefix="u" initial={{ ...initial, items: [...initial.items, { productId: 1, name: "Gel", count: 1, carbsG: 25, sodiumMg: 50, caffeineMg: null, fluidMl: null }] }} products={[gel]} onSave={onSave} />);
    expect((screen.getByLabelText("Carbohydrate") as HTMLInputElement).value).toBe("100");
    expect(screen.getByTestId("count-1").textContent).toBe("1");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ carbsG: 100, items: [{ productId: 1, count: 1 }] }));
  });

  it("does not save a negative number", () => {
    render(<FuelForm idPrefix="t" initial={null} onSave={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Carbohydrate"), { target: { value: "-5" } });
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
