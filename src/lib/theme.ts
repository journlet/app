// Theme preference (remediation item 12). Device-local, like sticky capture
// prefs — theme is naturally per-device, so it lives in localStorage, not the
// synced journal. Three choices: follow the OS ("system", default), or pin
// light/dark.
//
// "system" is handled by a prefers-color-scheme rule in index.css: we simply
// remove the data-theme attribute and let CSS decide, so an OS switch needs no
// JS and there's no flash on load. Explicit light/dark set the attribute.

export type ThemePref = "system" | "light" | "dark";

const KEY = "journlet-theme-v1";

export const loadTheme = (): ThemePref => {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" || v === "system" ? v : "system";
  } catch {
    return "system";
  }
};

export const saveTheme = (t: ThemePref): void => {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // storage unavailable (private mode etc.) — theme resets to default next
    // launch, which is acceptable
  }
};

const prefersDark = (): boolean =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-color-scheme: dark)").matches;

/** The concrete light/dark a preference resolves to right now. */
export const resolvedTheme = (t: ThemePref): "light" | "dark" =>
  t === "system" ? (prefersDark() ? "dark" : "light") : t;

/** Apply a preference to the document: set/clear data-theme and keep the
 *  browser/PWA chrome colour (theme-color meta) in step. */
export const applyTheme = (t: ThemePref): void => {
  const root = document.documentElement;
  if (t === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta)
    meta.setAttribute(
      "content",
      resolvedTheme(t) === "dark" ? "#191d23" : "#f5f4ef"
    );
};

/** While in "system" mode CSS switches automatically, but the theme-color
 *  meta won't — call the callback on OS scheme changes so a caller can
 *  re-apply. Returns an unsubscribe. */
export const onSystemThemeChange = (cb: () => void): (() => void) => {
  const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
  if (!mq) return () => {};
  const handler = () => cb();
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
};
