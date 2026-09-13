"use client";

import { useEffect, useState } from "react";
import { IconButton } from "./Button";
import { Moon, Sun } from "./Icons";

type Theme = "light" | "dark" | "system";

/**
 * Cycles light → dark → follow-system, persisting the choice.
 *
 * The icon is driven by state rather than read from the DOM during render: the
 * server has no way to know the reader's stored theme, so reading it while
 * rendering produces a hydration mismatch. The inline script in the layout has
 * already set the right colours before first paint; this catches up on mount.
 */
export function ThemeToggle() {
  // Matches the pre-paint default in the layout; anything else would flip the
  // icon on mount for a reader who has never chosen a theme.
  const [theme, setTheme] = useState<Theme>("light");
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setTheme((localStorage.getItem("folio-theme") as Theme) ?? "light");
  }, []);

  useEffect(() => {
    const apply = () => {
      const isDark =
        theme === "dark" ||
        (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
      setDark(isDark);
    };
    apply();

    if (theme !== "system") return;
    const media = matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  function cycle() {
    const next: Theme = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
    setTheme(next);
    localStorage.setItem("folio-theme", next);
  }

  return (
    <IconButton
      onClick={cycle}
      label={theme === "system" ? "Theme: following system" : `Theme: ${theme}`}
    >
      {dark ? <Moon /> : <Sun />}
      {theme === "system" && (
        <span className="absolute bottom-1 h-[3px] w-[3px] rounded-full bg-gold" aria-hidden />
      )}
    </IconButton>
  );
}
