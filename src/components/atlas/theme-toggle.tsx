"use client";

import { useSyncExternalStore } from "react";

import { MoonIcon, SunIcon } from "./icons";

type Theme = "light" | "dark";

const THEME_STORAGE_KEY = "atlas-theme";
const THEME_CHANGE_EVENT = "atlas-theme-change";
const IS_DEVELOPMENT = process.env.NODE_ENV === "development";

function subscribeToTheme(onStoreChange: () => void) {
  window.addEventListener(THEME_CHANGE_EVENT, onStoreChange);

  return () => window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange);
}

function getThemeSnapshot(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function getServerThemeSnapshot(): Theme {
  return "light";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;

  root.dataset.theme = theme;
  root.style.colorScheme = theme;

  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Safari pode restringir o armazenamento; a troca visual deve continuar.
  }

  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    getServerThemeSnapshot,
  );

  function toggleTheme() {
    const currentTheme = getThemeSnapshot();
    const nextTheme = currentTheme === "dark" ? "light" : "dark";

    if (IS_DEVELOPMENT) {
      console.info("Theme toggle pressed");
      console.info("Current theme:", currentTheme);
      console.info("Next theme:", nextTheme);
    }

    applyTheme(nextTheme);
  }

  const label = theme === "dark" ? "Ativar tema claro" : "Ativar tema escuro";

  return (
    <button suppressHydrationWarning type="button" onClick={toggleTheme} title={label} aria-label={label} className="atlas-theme-toggle grid size-11 place-items-center rounded-full border border-[var(--atlas-border)] bg-[var(--atlas-surface)] text-[var(--atlas-muted)] shadow-sm backdrop-blur-md transition hover:text-[var(--atlas-text)]">
      {theme === "dark" ? <SunIcon className="size-[19px]" /> : <MoonIcon className="size-[19px]" />}
    </button>
  );
}
