// Terapkan tema sebelum paint agar tidak flicker (default: dark).
// Diekstrak dari inline <script> agar CSP script-src 'self' tidak dilanggar.
try {
  var t = localStorage.getItem('cbt-theme') || 'dark';
  if (t === 'dark') document.documentElement.classList.add('dark');
  else document.documentElement.classList.remove('dark');
} catch { /* abaikan */ }
