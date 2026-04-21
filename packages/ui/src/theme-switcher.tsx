"use client";

import { startTransition, useEffect, useState } from "react";

const STORAGE_KEY = "speclens-theme";

const THEMES = [
  {
    id: "paper",
    label: "Paper",
    swatch: "theme-switcher__swatch theme-switcher__swatch--paper",
  },
  {
    id: "ember",
    label: "Ember",
    swatch: "theme-switcher__swatch theme-switcher__swatch--ember",
  },
  {
    id: "midnight",
    label: "Midnight",
    swatch: "theme-switcher__swatch theme-switcher__swatch--midnight",
  },
] as const;

type ThemeId = (typeof THEMES)[number]["id"];

function readTheme(): ThemeId {
  if (typeof document === "undefined") {
    return "paper";
  }
  const currentTheme = document.documentElement.dataset.theme;
  if (currentTheme === "paper" || currentTheme === "ember" || currentTheme === "midnight") {
    return currentTheme;
  }
  return "paper";
}

function applyTheme(nextTheme: ThemeId) {
  document.documentElement.dataset.theme = nextTheme;
  window.localStorage.setItem(STORAGE_KEY, nextTheme);
}

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<ThemeId>("paper");

  useEffect(() => {
    setTheme(readTheme());
  }, []);

  return (
    <div className={compact ? "theme-switcher theme-switcher--compact" : "theme-switcher"} role="group" aria-label="Color theme">
      <span className="theme-switcher__label">Theme</span>
      <div className="theme-switcher__options">
        {THEMES.map(option => (
          <button
            aria-pressed={theme === option.id}
            className={theme === option.id ? "theme-switcher__button theme-switcher__button--active" : "theme-switcher__button"}
            key={option.id}
            onClick={() => {
              applyTheme(option.id);
              startTransition(() => {
                setTheme(option.id);
              });
            }}
            type="button"
          >
            <span aria-hidden="true" className={option.swatch} />
            <span>{option.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
