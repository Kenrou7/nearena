"use client";

import { useEffect, useState } from "react";

type ThemeId = "grim-arena" | "clean-spire" | "blood-gold";

const THEME_STORAGE_KEY = "nearena-dev-theme";
const THEME_OPTIONS: Array<{ id: ThemeId; label: string }> = [
  { id: "grim-arena", label: "Grim Arena" },
  { id: "clean-spire", label: "Clean Spire" },
  { id: "blood-gold", label: "Blood & Gold" },
];

export function ThemeSwitcher() {
  const [themeId, setThemeId] = useState<ThemeId>("blood-gold");

  useEffect(() => {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY) as ThemeId | null;
    const nextTheme = saved ?? "blood-gold";
    setThemeId(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
  }, []);

  function applyTheme(nextTheme: ThemeId) {
    setThemeId(nextTheme);
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    document.documentElement.dataset.theme = nextTheme;
  }

  if (process.env.NODE_ENV !== "development") {
    return null;
  }

  return (
    <div className="theme-switcher" aria-label="Theme selector (dev only)">
      <strong>Theme (dev):</strong>
      <div className="row">
        {THEME_OPTIONS.map((theme) => (
          <button
            key={theme.id}
            className={theme.id === themeId ? "primary" : undefined}
            onClick={() => applyTheme(theme.id)}
          >
            {theme.label}
          </button>
        ))}
      </div>
    </div>
  );
}
