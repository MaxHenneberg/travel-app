export const THEME_STORAGE_KEY = 'trailbook.theme';
export const DEFAULT_THEME_ID = 'sakura';

export const themes = Object.freeze([
  Object.freeze({ id: 'sakura', name: 'Sakura', colorScheme: 'light', themeColor: '#fff8f3' }),
  Object.freeze({ id: 'neon-japan', name: 'Neon Japan', colorScheme: 'dark', themeColor: '#090d1b' }),
]);

const themeById = new Map(themes.map((theme) => [theme.id, theme]));

export function resolveThemeId(candidate) {
  return typeof candidate === 'string' && themeById.has(candidate) ? candidate : DEFAULT_THEME_ID;
}

export function readStoredTheme(storage = globalThis.localStorage) {
  try { return resolveThemeId(storage?.getItem(THEME_STORAGE_KEY)); }
  catch { return DEFAULT_THEME_ID; }
}

export function applyTheme(candidate, { root = document.documentElement, storage = globalThis.localStorage } = {}) {
  const id = resolveThemeId(candidate);
  const theme = themeById.get(id);
  root.dataset.theme = id;
  root.style.colorScheme = theme.colorScheme;
  const meta = root.ownerDocument?.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme.themeColor;
  try { storage?.setItem(THEME_STORAGE_KEY, id); } catch { /* Theme still works if storage is unavailable. */ }
  return theme;
}
