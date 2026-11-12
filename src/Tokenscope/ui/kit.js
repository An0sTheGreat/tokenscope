// View kit: the small builders every screen shares, so screens stay declarative and consistent.
// Everything here emits design-system markup only (docs/DESIGN.md); strings become text nodes.

import { h, svg, countUp, chunked } from './dom.js';
import { money, tokens, pct } from './format.js';

// ---- icons: our own 24 px stroke glyphs ----

const ICONS = {
  overview: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
  reports: 'M5 20V11 M12 20V4 M19 20v-6',
  sessions: 'M4 5h16v11H10l-5 4v-4H4z',
  blocks: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z M12 7v5l3 2',
  projects: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  settings: 'M4 7h9 M17 7h3 M4 17h3 M11 17h9 M15 5v4 M9 15v4',
  refresh: 'M20 12a8 8 0 1 1-2.4-5.7 M20 4v4h-4',
  chevron: 'M9 6l6 6-6 6',
  caret: 'M7 10l5 5 5-5',
  search: 'M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14z M20 20l-3.6-3.6',
  warning: 'M12 4l9 16H3z M12 10v4 M12 17v.5',
  calendar: 'M5 6h14v14H5z M5 10h14 M9 3v4 M15 3v4',
  download: 'M12 4v11 M7 11l5 5 5-5 M5 20h14',
  bolt: 'M13 3L5 14h6l-1 7 8-11h-6z',
  external: 'M14 5h5v5 M19 5l-8 8 M11 7H6v11h11v-5',
  empty: 'M4 19h16 M7 16v-4 M12 16V8 M17 16v-7',
};

export function icon(name, cls) {
  return svg('svg', {
    class: cls, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8',
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
  }, svg('path', { d: ICONS[name] ?? ICONS.empty }));
}

// ---- agents ----

const AGENT_NAMES = {
  claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode', amp: 'Amp', droid: 'Droid', codebuff: 'Codebuff',
  cline: 'Cline', hermes: 'Hermes', pi: 'pi', goose: 'Goose', openclaw: 'OpenClaw', kilo: 'Kilo', kimi: 'Kimi',
  qwen: 'Qwen', copilot: 'Copilot CLI', gemini: 'Gemini CLI', antigravity: 'Antigravity', grok: 'Grok', zcode: 'ZCode',
};
export const agentLabel = a => AGENT_NAMES[a] ?? (a ? a.charAt(0).toUpperCase() + a.slice(1) : '');

// Stable colour per agent: claude and codex are fixed, the rest take the palette in alphabetical order.
export function agentColor(agent, agents = []) {
  const fixed = { claude: 1, codex: 2 };
  if (fixed[agent]) return `var(--cat-${fixed[agent]})`;
  const rest = agents.filter(a => !fixed[a]).sort();
  return `var(--cat-${3 + (Math.max(0, rest.indexOf(agent)) % 6)})`;
}
export const seriesColor = i => `var(--cat-${(i % 8) + 1})`;

// ---- dates (ISO 'YYYY-MM-DD' strings; arithmetic in UTC so the PC timezone cannot shift a day) ----

export const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const utc = iso => new Date(`${iso.length === 7 ? `${iso}-01` : iso}T00:00:00Z`);
const fmt = opts => new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', ...opts });
const DAY = fmt({ day: 'numeric', month: 'short', year: 'numeric' });
const MONTH = fmt({ month: 'long', year: 'numeric' });
const STAMP = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const CLOCK = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
export const dayLabel = iso => DAY.format(utc(iso));
export const monthLabel = iso => MONTH.format(utc(iso));
export const stamp = iso => (iso ? STAMP.format(new Date(iso)) : '—');   // local date + time of an instant
export const clock = iso => (iso ? CLOCK.format(new Date(iso)) : '—');

const MAX_DAYS = 800;

// Rows for every day from `since` (or the first row) to `until`, zero-filled, so time charts keep a true axis.
export function fillDays(rows, since, until) {
  if (!rows.length) return [];
  const by = new Map(rows.map(r => [r.period, r]));
  const end = until ?? rows.at(-1).period;
  const oldest = addDays(end, -(MAX_DAYS - 1));
  const start = since ?? rows[0].period;
  const out = [];
  // ponytail: at most MAX_DAYS points, keeping the most recent; bin by week if longer ranges matter.
  for (let d = start < oldest ? oldest : start; d <= end; d = addDays(d, 1)) {
    out.push(by.get(d) ?? { period: d, agents: [], models: [], input: 0, output: 0, cacheWrite: 0, cacheRead: 0, tokens: 0, cost: 0 });
  }
  return out;
}

export const RANGES = [
  { value: '7d', label: '7 d', long: 'Last 7 days' },
  { value: '30d', label: '30 d', long: 'Last 30 days' },
  { value: '90d', label: '90 d', long: 'Last 90 days' },
  { value: 'month', label: 'Month', long: 'This month' },
  { value: 'all', label: 'All', long: 'All time' },
];
export const rangeLabel = f => RANGES.find(r => r.value === f.preset)?.long
  ?? (f.since && f.until ? `${dayLabel(f.since)} – ${dayLabel(f.until)}` : 'Custom range');

// ---- building blocks ----

// article.ts-card with an optional header: { title, action: {label, onClick}, enter, tag, attrs }
export function card({ title, action, enter, tag = 'article', attrs, cls = '' } = {}, ...children) {
  return h(tag, { class: `ts-card${cls ? ` ${cls}` : ''}${enter ? ' ts-enter' : ''}`, attrs },
    title && h('div', { class: 'ts-card-header' },
      h('h3', { class: 'ts-card-title' }, title),
      action && h('button', { class: 'ts-button ts-button--plain', attrs: { type: 'button' }, onclick: action.onClick }, action.label)),
    children);
}

// Spend going up is the "negative" colour; null/zero shows a neutral badge.
export function deltaBadge(delta) {
  if (delta == null) return null;
  const flat = Math.abs(delta) < 0.005;
  const cls = flat ? '' : delta > 0 ? ' ts-badge--negative' : ' ts-badge--positive';
  return h('span', { class: `ts-badge${cls}` }, `${flat ? '' : delta > 0 ? '▲ ' : '▼ '}${pct(Math.abs(delta))}`);
}

export function stat({ label, value, format = money, delta, meta, animate }) {
  const figure = h('span', { class: 'ts-stat-value' });
  if (animate) countUp(figure, value, format);
  else { figure._countValue = value; figure.textContent = format(value); }
  return h('article', { class: `ts-card ts-stat${animate ? ' ts-enter' : ''}` },
    h('span', { class: 'ts-stat-label' }, label),
    figure,
    h('span', { class: 'ts-stat-meta' }, deltaBadge(delta), delta != null && meta ? ' ' : null, meta));
}

export function empty({ glyph = 'empty', title, text, action }) {
  return h('div', { class: 'ts-empty' },
    h('div', { class: 'ts-empty-glyph' }, icon(glyph)),
    h('h3', { class: 'ts-empty-title' }, title),
    text && h('p', { class: 'ts-empty-text' }, text),
    action && h('button', { class: 'ts-button', attrs: { type: 'button' }, onclick: action.onClick }, action.label));
}

// li > (button|div).ts-row. Pressable when onClick is given.
export function row({ tile, glyph, title, subtitle, trailing, onClick }) {
  const body = [
    glyph && h('span', { class: 'ts-row-leading' }, h('span', { class: 'ts-nav-icon', attrs: { style: `--tile: ${tile ?? 'var(--color-tint-fill)'}` } }, icon(glyph))),
    h('span', { class: 'ts-row-content' },
      h('span', { class: 'ts-row-title' }, title),
      subtitle && h('span', { class: 'ts-row-subtitle' }, subtitle)),
    trailing != null && h('span', { class: 'ts-row-trailing' }, trailing),
    onClick && icon('chevron', 'ts-row-chevron'),
  ];
  return h('li', null, onClick
    ? h('button', { class: 'ts-row', attrs: { type: 'button' }, onclick: onClick }, body)
    : h('div', { class: 'ts-row' }, body));
}

export function list(header, rows, footer) {
  return [
    header && h('p', { class: 'ts-list-header' }, header),
    h('ul', { class: 'ts-list' }, rows),
    footer && h('p', { class: 'ts-list-footer' }, footer),
  ];
}

// Radio-backed segmented control; keeps its own --index so the thumb slides before any re-render.
export function segmented({ name, label, options, value, onChange }) {
  const index = options.findIndex(o => o.value === value);
  const el = h('div', { class: 'ts-segmented', attrs: { role: 'radiogroup', 'aria-label': label, style: `--index: ${Math.max(0, index)}` } },
    h('span', { class: 'ts-segmented-thumb' }),
    options.map((o, i) => h('label', { class: 'ts-segmented-item' },
      h('input', {
        attrs: { type: 'radio', name, value: o.value, checked: i === index },
        onchange: () => { el.style.setProperty('--index', String(i)); onChange(o.value); },
      }),
      h('span', null, o.label))));
  return el;
}

export function switchInput({ label, checked, onChange }) {
  return h('input', {
    class: 'ts-switch', attrs: { type: 'checkbox', role: 'switch', 'aria-label': label, checked },
    onchange: e => onChange(e.target.checked),
  });
}

export function chip({ label, dot, pressed, onClick }) {
  return h('button', { class: 'ts-chip', attrs: { type: 'button', 'aria-pressed': String(!!pressed) }, onclick: onClick },
    dot && h('span', { class: 'ts-chip-dot', attrs: { style: `--dot: ${dot}` } }), label);
}

// Per-model breakdown as a list (used in table detail rows and sheets).
export function modelList(models) {
  if (!models.length) return h('p', { class: 'ts-list-footer' }, 'No model detail.');
  return h('ul', { class: 'ts-list' }, models.map((m, i) => row({
    glyph: 'bolt',
    tile: seriesColor(i),
    title: [m.name, m.unpriced && ' ', m.unpriced && h('span', { class: 'ts-badge ts-badge--warning' }, 'Unpriced')],
    subtitle: `in ${tokens(m.input)} · out ${tokens(m.output)} · cache write ${tokens(m.cacheWrite)} · cache read ${tokens(m.cacheRead)}`,
    trailing: money(m.cost),
  })));
}

/* Sortable table that owns its sort state.
   columns: [{ key, label, num, clip, value(row) -> sortable, render(row) -> node|string }]
   (clip: a long text column that takes the leftover width and truncates)
   options: { sort: {key, dir} (mutated on header clicks: keep it in the view to remember the sort), detail(row) -> element (expandable rows), onRow(row) (pressable rows),
              footer: [cells], empty: element } */
export function dataTable(columns, rows, { sort = null, detail, onRow, footer, empty: emptyEl } = {}) {
  if (!rows.length && emptyEl) return emptyEl;
  const state = sort ?? { key: columns[0].key, dir: 'desc' };   // the caller's object is updated in place, so a view can keep it
  const cellClass = c => (c.num ? 'ts-table-num' : c.clip ? 'ts-table-clip' : null);
  const tbody = h('tbody');
  const valueOf = (col, r) => (col.value ? col.value(r) : r[col.key]);
  const cell = (col, r) => (col.render ? col.render(r) : String(valueOf(col, r) ?? ''));

  const renderBody = () => {
    const col = columns.find(c => c.key === state.key) ?? columns[0];
    const sign = state.dir === 'asc' ? 1 : -1;
    const sorted = [...rows].sort((a, b) => {
      const x = valueOf(col, a), y = valueOf(col, b);
      return (x == null) - (y == null) || sign * (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y)));
    });
    chunked(tbody, sorted, r => {
      const tr = h('tr', { class: 'ts-table-row', attrs: { 'aria-expanded': detail ? 'false' : null, role: onRow ? 'button' : null, tabindex: detail || onRow ? '0' : null } },
        columns.map((c, i) => h('td', { class: cellClass(c) }, i === 0 && detail ? icon('caret', 'ts-table-caret') : null, cell(c, r))));
      if (!detail && !onRow) return tr;
      const frag = document.createDocumentFragment();
      frag.appendChild(tr);
      let detailRow = null;
      const activate = () => {
        if (onRow) return onRow(r);
        if (!detailRow) {
          detailRow = h('tr', { class: 'ts-table-detail', attrs: { hidden: true } },
            h('td', { attrs: { colspan: String(columns.length) } }, h('div', { class: 'ts-table-detail-body' }, detail(r))));
          tr.after(detailRow);
        }
        const open = tr.getAttribute('aria-expanded') !== 'true';
        tr.setAttribute('aria-expanded', String(open));
        detailRow.hidden = !open;
      };
      tr.addEventListener('click', activate);
      tr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
      return frag;
    }, 80);
  };

  const ths = columns.map(c => {
    const th = h('th', { class: cellClass(c), attrs: { 'aria-sort': c.key === state.key ? `${state.dir}ending` : null } },
      h('button', {
        class: 'ts-table-sort', attrs: { type: 'button' },
        onclick: () => {
          state.dir = state.key === c.key && state.dir === 'desc' ? 'asc' : 'desc';
          state.key = c.key;
          ths.forEach(t => t.removeAttribute('aria-sort'));
          th.setAttribute('aria-sort', `${state.dir}ending`);
          renderBody();
        },
      }, c.label, icon('caret', 'ts-table-caret')));
    return th;
  });
  renderBody();
  return h('table', { class: 'ts-table' },
    h('thead', null, h('tr', null, ths)),
    tbody,
    footer && h('tfoot', null, h('tr', null, footer.map((f, i) => h('td', { class: columns[i]?.num ? 'ts-table-num' : null }, f)))));
}

// A row of controls: leading group left, trailing group right; wraps when narrow.
export function toolbar(leading, trailing) {
  return h('div', { class: 'ts-toolbar' }, h('div', { class: 'ts-toolbar-group' }, leading), trailing && h('div', { class: 'ts-toolbar-group' }, trailing));
}
