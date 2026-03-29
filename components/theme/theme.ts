"use client";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "sportsdeck.theme";
export const THEME_CHANGED_EVENT = "sportsdeck-theme-changed";

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function getStoredThemePreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
  return isThemePreference(raw) ? raw : "system";
}

export function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? getSystemTheme() : preference;
}

export function applyTheme(preference: ThemePreference): ResolvedTheme {
  if (typeof window === "undefined") return "dark";

  const resolved = resolveTheme(preference);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  return resolved;
}

export function setThemePreference(preference: ThemePreference): ResolvedTheme {
  if (typeof window === "undefined") return "dark";

  window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  const resolved = applyTheme(preference);
  window.dispatchEvent(new Event(THEME_CHANGED_EVENT));
  return resolved;
}

export function initThemeFromStorage(): {
  preference: ThemePreference;
  resolved: ResolvedTheme;
} {
  const preference = getStoredThemePreference();
  const resolved = applyTheme(preference);
  return { preference, resolved };
}
