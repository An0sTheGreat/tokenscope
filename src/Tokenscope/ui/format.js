// Display formatters. Pure; no DOM.

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function money(n) {
  return n > 0 && n < 0.01 ? '<$0.01' : usd.format(n);
}

export function tokens(n) {
  if (Math.abs(n) < 999.5) return String(Math.round(n));
  for (const [div, unit] of [[1e3, 'k'], [1e6, 'M'], [1e9, 'B']]) {
    const s = (n / div).toFixed(1);
    if (Math.abs(+s) < 1000 || unit === 'B') return s + unit;
  }
}

export function duration(min) {
  const m = Math.round(min);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

// 'yesterday' means 24-48 h ago, not the previous calendar day.
export function relative(iso, nowMs) {
  if (!iso || Number.isNaN(Date.parse(iso))) return '—';
  const sec = (nowMs - Date.parse(iso)) / 1000;
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 172800) return 'yesterday';
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function pct(share) {
  return `${Math.round(share * 100)}%`;
}
