"use client";

import { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";
type AccentColor = "blue" | "white" | "green" | "purple" | "orange" | "custom";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  accentColor: AccentColor;
  setAccentColor: (color: AccentColor) => void;
  customAccentHex: string;
  setCustomAccentHex: (hex: string) => void;
  weeklyGoal: number;
  setWeeklyGoal: (n: number) => void;
  defaultIncrementKg: number;
  setDefaultIncrementKg: (n: number) => void;
  defaultIncrementReps: number;
  setDefaultIncrementReps: (n: number) => void;
  uiScale: number;
  setUiScale: (scale: number) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const accentColors: Record<Exclude<AccentColor, "custom">, { light: string; dark: string }> = {
  blue: {
    light: "oklch(0.55 0.22 264.36)",
    dark: "oklch(0.70 0.19 264.36)",
  },
  white: {
    light: "oklch(0.205 0 0)",
    dark: "oklch(0.922 0 0)",
  },
  green: {
    light: "oklch(0.55 0.15 145)",
    dark: "oklch(0.70 0.18 145)",
  },
  purple: {
    light: "oklch(0.55 0.20 300)",
    dark: "oklch(0.70 0.22 300)",
  },
  orange: {
    light: "oklch(0.60 0.18 45)",
    dark: "oklch(0.75 0.20 45)",
  },
};

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Start with server-safe defaults — localStorage is loaded after hydration in useEffect
  const [theme, setTheme] = useState<Theme>("light");
  const [accentColor, setAccentColorState] = useState<AccentColor>("blue");
  const [customAccentHex, setCustomAccentHexState] = useState("#5B8FFF");
  const [weeklyGoal, setWeeklyGoalState] = useState(4);
  const [defaultIncrementKg, setDefaultIncrementKgState] = useState(2.5);
  const [defaultIncrementReps, setDefaultIncrementRepsState] = useState(0);
  const [uiScale, setUiScaleState] = useState(1);

  const applyAccentColor = (color: AccentColor, currentTheme: Theme, hexOverride?: string) => {
    const colorValue =
      color === "custom"
        ? (hexOverride ?? customAccentHex)
        : currentTheme === "dark"
          ? accentColors[color as Exclude<AccentColor, "custom">].dark
          : accentColors[color as Exclude<AccentColor, "custom">].light;
    const foreground =
      currentTheme === "dark" ? "oklch(0.205 0 0)" : "oklch(0.985 0 0)";
    document.documentElement.style.setProperty("--primary", colorValue);
    document.documentElement.style.setProperty("--primary-foreground", foreground);
  };

  // Load persisted preferences and apply to DOM after hydration
  useEffect(() => {
    const storedTheme = (localStorage.getItem("theme") as Theme | null) ?? "dark";
    const storedAccent = (localStorage.getItem("accentColor") as AccentColor | null) ?? "blue";
    const storedCustomHex = localStorage.getItem("customAccentHex") ?? "#5B8FFF";
    const storedGoal = localStorage.getItem("weeklyGoal");
    const storedIncrementKg = localStorage.getItem("defaultIncrementKg");
    const storedIncrementReps = localStorage.getItem("defaultIncrementReps");
    const storedUiScale = localStorage.getItem("uiScale");

    setTheme(storedTheme);
    setAccentColorState(storedAccent);
    setCustomAccentHexState(storedCustomHex);
    setWeeklyGoalState(storedGoal ? Number(storedGoal) : 4);
    setDefaultIncrementKgState(storedIncrementKg ? Number(storedIncrementKg) : 2.5);
    setDefaultIncrementRepsState(storedIncrementReps ? Number(storedIncrementReps) : 0);
    const parsedScale = storedUiScale ? Number(storedUiScale) : 1;
    setUiScaleState(parsedScale);
    document.documentElement.style.zoom = String(parsedScale);

    document.documentElement.classList.toggle("dark", storedTheme === "dark");
    applyAccentColor(storedAccent, storedTheme, storedCustomHex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleTheme = () => {
    setTheme((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      if (typeof window !== "undefined") {
        localStorage.setItem("theme", next);
        document.documentElement.classList.toggle("dark", next === "dark");
        applyAccentColor(accentColor, next);
      }
      return next;
    });
  };

  const setAccentColor = (color: AccentColor) => {
    setAccentColorState(color);
    if (typeof window !== "undefined") {
      localStorage.setItem("accentColor", color);
      applyAccentColor(color, theme);
    }
  };

  const setCustomAccentHex = (hex: string) => {
    setCustomAccentHexState(hex);
    setAccentColorState("custom");
    if (typeof window !== "undefined") {
      localStorage.setItem("customAccentHex", hex);
      localStorage.setItem("accentColor", "custom");
      document.documentElement.style.setProperty("--primary", hex);
      const foreground = theme === "dark" ? "oklch(0.205 0 0)" : "oklch(0.985 0 0)";
      document.documentElement.style.setProperty("--primary-foreground", foreground);
    }
  };

  const setWeeklyGoal = (n: number) => {
    setWeeklyGoalState(n);
    if (typeof window !== "undefined") {
      localStorage.setItem("weeklyGoal", String(n));
    }
  };

  const setDefaultIncrementKg = (n: number) => {
    setDefaultIncrementKgState(n);
    if (typeof window !== "undefined") {
      localStorage.setItem("defaultIncrementKg", String(n));
    }
  };

  const setDefaultIncrementReps = (n: number) => {
    setDefaultIncrementRepsState(n);
    if (typeof window !== "undefined") {
      localStorage.setItem("defaultIncrementReps", String(n));
    }
  };

  const setUiScale = (scale: number) => {
    setUiScaleState(scale);
    if (typeof window !== "undefined") {
      localStorage.setItem("uiScale", String(scale));
      document.documentElement.style.zoom = String(scale);
    }
  };

  return (
    <ThemeContext.Provider
      value={{ theme, toggleTheme, accentColor, setAccentColor, customAccentHex, setCustomAccentHex, weeklyGoal, setWeeklyGoal, defaultIncrementKg, setDefaultIncrementKg, defaultIncrementReps, setDefaultIncrementReps, uiScale, setUiScale }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
