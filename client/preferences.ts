import { initialTheme } from './theme.js';

// Apply preferences before first paint.
document.documentElement.dataset.theme = initialTheme();
try {
  const width = Number(localStorage.getItem('nopainmd.sidebarWidth'));
  if (Number.isFinite(width) && width > 0) document.documentElement.style.setProperty('--sidebar-width', `${Math.min(1000, Math.max(50, width))}px`);
} catch {}
