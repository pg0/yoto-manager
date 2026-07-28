// Three themes, cycled by the topbar button:
//   'day'   - full white (rail/topbar/player white too)
//   'mixed' - white file-manager panes, dark chrome (the original look; default)
//   'dark'  - full dark (panes/table/drawers dark too)
// Applied as data-theme on <html>; 'mixed' uses no attribute.
export const THEME_KEY = 'yoto-manager:theme';
export type Theme = 'day' | 'mixed' | 'dark';

export const THEME_ORDER: Theme[] = ['day', 'mixed', 'dark'];

export function getTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'day' || v === 'dark' || v === 'mixed') return v;
  } catch {
    /* ignore */
  }
  return 'mixed';
}

export function applyTheme(t: Theme) {
  if (t === 'mixed') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    /* ignore */
  }
}

export function nextTheme(t: Theme): Theme {
  return THEME_ORDER[(THEME_ORDER.indexOf(t) + 1) % THEME_ORDER.length];
}
