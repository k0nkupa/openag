export type Theme = "system" | "light" | "dark";
const KEY = "openag.theme";

export function getTheme(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch { return "system"; }
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme === "system"
    ? matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
    : theme;
}

export function setTheme(theme: Theme) {
  try { localStorage.setItem(KEY, theme); } catch { /* Theme still works without storage. */ }
  applyTheme(theme);
}

export function initializeTheme() {
  applyTheme(getTheme());
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme(getTheme()));
  window.addEventListener("storage", (event) => { if (event.key === KEY || event.key === null) applyTheme(getTheme()); });
}
