"use client";

import { MoonIcon, SunIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "./button";
import { useTheme } from "./theme-provider";

/**
 * Dark-mode toggle. Derives everything from ThemeProvider — it must not hold
 * its own copy of the theme.
 *
 * It used to seed `useState` from `localStorage`/`prefers-color-scheme` and
 * write the `dark` class itself. Three initialisation sources (the boot script,
 * this component, ThemeProvider) then disagreed, so the first tap flipped the
 * icon without changing the page and the accent-color variables were never
 * re-applied.
 *
 * The `mounted` gate is for hydration, not for the theme. The real theme is
 * only known on the client, so the server always renders the neutral default;
 * the gate makes the first client render agree with it. It has to live in this
 * component rather than be read from the provider: this subtree sits inside a
 * Suspense boundary, and React may hydrate it *after* an ancestor's effects
 * have already run — so provider state alone would differ from the server HTML.
 * A component's own effect cannot run before its own hydration, so this holds
 * whatever the boundary does.
 */
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one re-render after hydration is the mechanism itself, so the first client render can match the server HTML
    setMounted(true);
  }, []);

  const dark = theme === "dark";

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={toggleTheme}
      aria-label="Toggle dark mode"
    >
      {/* Same-size blank before mount so the button never changes size. */}
      {!mounted ? (
        <span className="h-5 w-5" aria-hidden="true" />
      ) : dark ? (
        <SunIcon className="h-5 w-5" />
      ) : (
        <MoonIcon className="h-5 w-5" />
      )}
    </Button>
  );
}
