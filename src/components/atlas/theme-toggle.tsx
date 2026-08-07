"use client";

import { useEffect } from "react";
import { MoonIcon, SunIcon } from "./icons";

type Theme = "light" | "dark";

const THEME_STORAGE_KEY = "atlas-theme";

function getCurrentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;

  root.dataset.theme = theme;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;

  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Safari pode restringir o armazenamento; a troca visual deve continuar.
  }
}

export function ThemeInitializer() {
  useEffect(() => {
    try {
      const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
      const theme = storedTheme === "dark" || storedTheme === "light"
        ? storedTheme
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
      applyTheme(theme);
    } catch {
      // O tema padrão do CSS continua disponível quando o armazenamento falha.
    }
  }, []);
  return null;
}

export function ThemeToggle() {
  function toggleTheme() {
    const currentTheme = getCurrentTheme();
    applyTheme(currentTheme === "dark" ? "light" : "dark");
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title="Alternar tema"
      aria-label="Alternar entre tema claro e escuro"
      className="atlas-theme-toggle grid size-11 place-items-center rounded-full border border-[var(--atlas-border)] bg-[var(--atlas-surface)] text-[var(--atlas-muted)] shadow-sm backdrop-blur-md transition hover:text-[var(--atlas-text)]"
    >
      <span className="atlas-theme-icon atlas-theme-icon-light"><MoonIcon className="size-[19px]" /></span>
      <span className="atlas-theme-icon atlas-theme-icon-dark"><SunIcon className="size-[19px]" /></span>
    </button>
  );
}
