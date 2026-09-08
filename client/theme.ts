import type { Theme } from './types.js';

export function initialTheme(storageKey: string | false = 'nopainmd', override?: Theme): Theme {
  if (override) return override;
  try {
    const saved = storageKey === false ? null : localStorage.getItem(`${storageKey}.theme`);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {}
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
  catch { return 'light'; }
}
