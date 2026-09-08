// Apply saved preferences before first paint.
try {
  const saved = localStorage.getItem('nopainmd.theme');
  document.documentElement.dataset.theme = saved === 'dark' ? 'dark' : 'light';
  const width = Number(localStorage.getItem('nopainmd.sidebarWidth'));
  if (Number.isFinite(width) && width > 0) document.documentElement.style.setProperty('--sidebar-width', `${Math.min(1000, Math.max(50, width))}px`);
} catch { document.documentElement.dataset.theme = 'light'; }
