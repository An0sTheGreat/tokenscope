// Hand-drawn charts (styles: the ts-chart block in design/components.css). Charts are drawn in CSS
// pixels: the svg's viewBox is the container's content width × the chart height, and each
// container keeps one ResizeObserver that redraws on width change without the entrance classes.
// Colours arrive as 'var(--token)' strings; data strings only ever become text nodes.
import { h, svg, tooltip } from './dom.js';
import { pct, tokens as fmtTokens } from './format.js';

const HOUR = 3600000;
let uidN = 0;
const f2 = v => Math.round(v * 100) / 100;
const sum = a => a.reduce((s, v) => s + (v || 0), 0);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const parseDay = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayMonth = d => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const longDay = d => d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const weekday = d => d.toLocaleDateString(undefined, { weekday: 'short' });
const hhmm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const tokenPx = (el, name, fallback) => parseFloat(getComputedStyle(el).getPropertyValue(name)) || fallback;

// ---- mounting: one observer per container; `draw(width, fresh)` fills it ----

function contentWidth(el) {
  const cs = getComputedStyle(el);
  return Math.floor(el.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0));
}

function paint(el) {
  const st = el._tsChart, w = contentWidth(el);
  if (w <= 0) { st.w = 0; return; } // hidden: the observer paints once it has a size
  st.w = w;
  st.draw(w, st.fresh);
  st.fresh = false;
}

function mount(el, draw) {
  const st = (el._tsChart ??= { w: -1 });
  st.draw = draw;
  st.fresh = true; // new data animates in; resize redraws do not
  if (!st.ro) {
    st.ro = new ResizeObserver(() => { if (contentWidth(el) !== st.w) paint(el); });
    st.ro.observe(el);
  }
  paint(el);
}

let ctx2d;
function measurer(el) {
  ctx2d ??= document.createElement('canvas').getContext('2d');
  ctx2d.font = getComputedStyle(el).getPropertyValue('--text-caption').trim() || ctx2d.font;
  return s => ctx2d.measureText(String(s)).width;
}

// ---- shared pieces ----

const chartSvg = (W, H, label) => svg('svg', { class: 'ts-chart', viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': label });
const label = (x, y, text, extra) => svg('text', { class: 'ts-chart-label', x: f2(x), y: f2(y), ...extra }, text);
const dot = color => h('span', { class: 'ts-chip-dot', attrs: { style: `--dot: ${color}` } });

function emptyState() {
  return h('div', { class: 'ts-empty' },
    h('h3', { class: 'ts-empty-title' }, 'Nothing to show'),
    h('p', { class: 'ts-empty-text' }, 'No usage was recorded in this period.'));
}

// rows: [color|null, name, value?]
function tipContent(title, rows) {
  const frag = document.createDocumentFragment();
  frag.append(h('div', { class: 'ts-tooltip-title' }, title),
    ...rows.map(([color, name, value]) => h('div', { class: 'ts-tooltip-row' },
      color && dot(color), name, value != null && h('span', { class: 'ts-tooltip-value' }, value))));
  return frag;
}

// Hover/focus on `target` marks `marks` active (siblings dim) and shows a tooltip.
function hoverable(target, marks, content) {
  const set = on => marks.forEach(m => m.toggleAttribute('data-active', on));
  for (const t of ['pointerenter', 'focus']) target.addEventListener(t, () => set(true));
  for (const t of ['pointerleave', 'blur']) target.addEventListener(t, () => set(false));
  tooltip(target, content);
}

// 3–4 gridlines at a 1/2/2.5/5 × 10^n step.
function niceScale(max) {
  if (!(max > 0)) max = 1;
  const raw = max / 3, mag = 10 ** Math.floor(Math.log10(raw)), n = raw / mag;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  const top = Math.ceil(max / step - 1e-9) * step;
  const ticks = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
  return { top, ticks };
}

// Y gridlines with labels in a right-hand gutter; returns the plot geometry.
function yAxis(root, W, H, max, format, measure) {
  const { top, ticks } = niceScale(max);
  const texts = ticks.map(format);
  const right = W - Math.ceil(Math.max(...texts.map(measure))) - 8;
  const y0 = 8, y1 = H - 24;
  const y = v => y1 - (v / top) * (y1 - y0);
  ticks.forEach((t, i) => root.append(
    svg('line', { class: i ? 'ts-chart-grid' : 'ts-chart-axis', x1: 0, x2: f2(right), y1: f2(y(t)), y2: f2(y(t)) }),
    label(W, y(t), texts[i], { 'text-anchor': 'end', 'dominant-baseline': 'middle' })));
  return { right, y0, y1, y };
}

// Date labels under the plot: every k-th label (counted back from the newest) so none overlap;
// the month name shows on the first label and wherever the month changes.
function xDates(root, isoLabels, xAt, step, W, H, measure) {
  const dates = isoLabels.map(parseDay);
  const room = measure(dayMonth(new Date(2000, 8, 30))) + 12;
  const k = [1, 2, 3, 7, 14, 30, 60, 90].find(n => n * step >= room) ?? 120;
  let prev = null;
  for (let i = (dates.length - 1) % k; i < dates.length; i += k) {
    const d = dates[i];
    const text = !prev || prev.getMonth() !== d.getMonth() ? dayMonth(d) : String(d.getDate());
    prev = d;
    const w = measure(text), x = xAt(i);
    const anchor = x - w / 2 < 0 ? ['start', 0] : x + w / 2 > W ? ['end', W] : ['middle', x];
    root.append(label(anchor[1], H - 6, text, { 'text-anchor': anchor[0] }));
  }
}

// Monotone cubic (Fritsch–Carlson) through points: no overshoot, so never below a zero baseline.
function monotone(p) {
  const n = p.length;
  if (!n) return '';
  let d = `M${f2(p[0][0])},${f2(p[0][1])}`;
  if (n < 2) return d;
  const m = [], t = [];
  for (let i = 0; i < n - 1; i++) m.push((p[i + 1][1] - p[i][1]) / (p[i + 1][0] - p[i][0]));
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const q = 3 / Math.sqrt(s); t[i] = q * a * m[i]; t[i + 1] = q * b * m[i]; }
  }
  for (let i = 0; i < n - 1; i++) {
    const [xa, ya] = p[i], [xb, yb] = p[i + 1], hx = (xb - xa) / 3;
    d += `C${f2(xa + hx)},${f2(ya + t[i] * hx)} ${f2(xb - hx)},${f2(yb - t[i + 1] * hx)} ${f2(xb)},${f2(yb)}`;
  }
  return d;
}

// A bar segment with rounded top corners and a square bottom.
function topRounded(x, yt, w, yb, r) {
  r = Math.min(r, w / 2, yb - yt);
  return `M${f2(x)},${f2(yb)}V${f2(yt + r)}A${f2(r)},${f2(r)} 0 0 1 ${f2(x + r)},${f2(yt)}H${f2(x + w - r)}A${f2(r)},${f2(r)} 0 0 1 ${f2(x + w)},${f2(yt + r)}V${f2(yb)}Z`;
}

// Spreads the stagger index (capped at 12 in CSS) across the whole run.
const spread = (i, n) => (n > 1 ? Math.round((i * 12) / (n - 1)) : 0);

// ---- charts ----

export function stackedBars(el, { labels, series, format, height = 240 }) {
  const n = labels.length;
  const totals = labels.map((_, i) => sum(series.map(s => s.values[i])));
  const grand = sum(totals);
  mount(el, (W, fresh) => {
    if (!n || !(grand > 0)) return el.replaceChildren(emptyState());
    const measure = measurer(el);
    const root = chartSvg(W, height, `Stacked bars, ${n} days, total ${format(grand)}, ${series.map(s => `${s.name} ${format(sum(s.values))}`).join(', ')}`);
    const f = yAxis(root, W, height, Math.max(...totals), format, measure);
    const step = f.right / n, gap = step < 3 ? 0 : clamp(step * 0.35, 1, 12), bw = Math.max(0.5, step - gap);
    const r = Math.max(0, Math.min(tokenPx(el, '--radius-sm', 8), bw / 3));
    const cols = svg('g'), hits = svg('g');
    labels.forEach((iso, i) => {
      const g = svg('g', { class: fresh ? 'ts-chart-grow' : null, style: `--i: ${spread(i, n)}` });
      const segs = series.map(s => [s, s.values[i] || 0]).filter(([, v]) => v > 0);
      const x = i * step + gap / 2;
      let c = 0, base = f.y1;
      segs.forEach(([s, v], k) => {
        c += v;
        const yb = k ? base - 2 : base; // 2 px gap between segments
        const yt = Math.min(f.y(c), yb - 1);
        base = f.y(c);
        const style = `--series: ${s.color}`;
        g.append(k === segs.length - 1
          ? svg('path', { class: 'ts-chart-bar', style, d: topRounded(x, yt, bw, yb, r) })
          : svg('rect', { class: 'ts-chart-bar', style, x: f2(x), y: f2(yt), width: f2(bw), height: f2(yb - yt) }));
      });
      cols.append(g);
      const day = parseDay(iso);
      const hit = svg('rect', {
        class: 'ts-chart-hit', x: f2(i * step), y: f2(f.y0), width: f2(step), height: f2(f.y1 - f.y0), rx: f2(r),
        tabindex: n <= 31 ? 0 : null, 'aria-label': `${longDay(day)}, ${format(totals[i])}`,
      });
      hits.append(hit);
      hoverable(hit, [...g.children], () => tipContent(longDay(day), [
        ...segs.map(([s, v]) => [s.color, s.name, format(v)]),
        ...(segs.length > 1 ? [[null, 'Total', format(totals[i])]] : []),
      ]));
    });
    root.append(cols, hits);
    xDates(root, labels, i => i * step + step / 2, step, W, height, measure);
    const legend = h('div', { class: 'ts-chart-legend' },
      series.filter(s => sum(s.values) > 0).map(s => h('span', { class: 'ts-chip' }, dot(s.color), s.name)));
    el.replaceChildren(root, legend);
  });
}

// tipLabel(iso, index) -> the hover title; defaults to the day. Pass it when a point is a week or a month.
export function lineChart(el, { labels, values, format, height = 200, color = 'var(--color-tint)', tipLabel = iso => longDay(parseDay(iso)) }) {
  const n = values.length;
  mount(el, (W, fresh) => {
    if (!n || !values.some(v => v > 0)) return el.replaceChildren(emptyState());
    const measure = measurer(el);
    const root = chartSvg(W, height, `Line chart, ${n} days, total ${format(sum(values))}, peak ${format(Math.max(...values))}`);
    root.style.setProperty('--series', color);
    const f = yAxis(root, W, height, Math.max(...values), format, measure);
    const dx = n > 1 ? f.right / (n - 1) : 0;
    const pts = values.map((v, i) => [n > 1 ? i * dx : f.right / 2, f.y(Math.max(0, v))]);
    const d = monotone(pts), id = `ts-clip-${++uidN}`;
    const cursor = svg('line', { class: 'ts-chart-hover', x1: 0, x2: 0, y1: f.y0, y2: f2(f.y1) });
    const mark = svg('circle', { class: 'ts-chart-dot', r: 4.5 });
    root.append(
      svg('clipPath', { id }, svg('rect', { class: fresh ? 'ts-chart-trace' : null, x: -4, y: 0, width: f2(f.right + 8), height })),
      svg('path', { class: fresh ? 'ts-chart-area ts-chart-fade' : 'ts-chart-area', d: `${d}L${f2(pts.at(-1)[0])},${f2(f.y1)}L${f2(pts[0][0])},${f2(f.y1)}Z` }),
      svg('path', { class: 'ts-chart-line', d, 'clip-path': `url(#${id})` }),
      cursor, mark);
    xDates(root, labels, i => pts[i][0], dx || f.right, W, height, measure);
    tooltip(root, e => {
      if (e.clientX == null) return null;
      const i = n > 1 ? clamp(Math.round((e.clientX - root.getBoundingClientRect().left) / dx), 0, n - 1) : 0;
      const [px, py] = pts[i];
      cursor.style.translate = `${f2(px)}px 0`;
      mark.style.translate = `${f2(px)}px ${f2(py)}px`;
      if (!root.hasAttribute('data-hover')) { getComputedStyle(mark).translate; root.setAttribute('data-hover', ''); } // appear in place, glide after
      return tipContent(tipLabel(labels[i], i), [[color, '', format(values[i])]]);
    });
    root.addEventListener('pointerleave', () => root.removeAttribute('data-hover'));
    el.replaceChildren(root);
  });
}

export function sparkline(el, values, { color = 'var(--color-tint)' } = {}) {
  mount(el, (W, fresh) => {
    const own = el instanceof SVGSVGElement;
    const root = own ? el : svg('svg', { class: 'ts-stat-spark' });
    if (!own) el.replaceChildren(root);
    root.setAttribute('aria-hidden', 'true'); // decorative: the card states the figure
    root.style.setProperty('--series', color);
    const H = root.clientHeight || 32;
    root.setAttribute('viewBox', `0 0 ${W} ${H}`);
    if (values.length < 2) return root.replaceChildren();
    const lo = Math.min(...values), hi = Math.max(...values), pad = 3;
    const pts = values.map((v, i) => [pad + (i * (W - 2 * pad)) / (values.length - 1), H - pad - (hi > lo ? ((v - lo) / (hi - lo)) * (H - 2 * pad) : (H - 2 * pad) / 2)]);
    const id = `ts-clip-${++uidN}`;
    root.replaceChildren(
      svg('clipPath', { id }, svg('rect', { class: fresh ? 'ts-chart-trace' : null, x: 0, y: -pad, width: W, height: H + 2 * pad })),
      svg('path', { class: 'ts-chart-line', d: monotone(pts), 'clip-path': `url(#${id})` }));
  });
}

export function rankBars(el, items, { format }) {
  let rows = items;
  if (items.length > 8) {
    const rest = items.slice(7);
    rows = [...items.slice(0, 7), { label: 'Other', value: sum(rest.map(r => r.value)), share: sum(rest.map(r => r.share)), color: 'var(--cat-8)', badge: rest.find(r => r.badge)?.badge ?? null }];
  }
  if (!rows.length) return el.replaceChildren(emptyState());
  el.replaceChildren(h('div', { class: 'ts-rank', attrs: { role: 'img', 'aria-label': rows.map(r => `${r.label} ${format(r.value)} (${pct(r.share)})`).join(', ') } },
    rows.map((r, i) => h('div', { class: 'ts-rank-row', attrs: { style: `--i: ${i}; --series: ${r.color}` } },
      h('div', { class: 'ts-rank-head' },
        dot(r.color),
        h('span', { class: 'ts-rank-label' }, r.label),
        r.badge && h('span', { class: 'ts-badge ts-badge--warning' }, r.badge),
        h('span', { class: 'ts-rank-value' }, format(r.value)),
        h('span', { class: 'ts-rank-share' }, pct(r.share))),
      h('div', { class: 'ts-progress', attrs: { role: 'progressbar', 'aria-valuenow': Math.round(r.share * 100), style: `--value: ${r.share}` } },
        h('span', { class: 'ts-progress-fill' }))))));
}

// today: 'YYYY-MM-DD' in the user's timezone (cells after it are not drawn); defaults to the PC date.
export function heatmap(el, cells, { format, today = isoDay(new Date()) }) {
  const weeks = Math.ceil(cells.length / 7);
  mount(el, (W, fresh) => {
    if (!cells.length) return el.replaceChildren(emptyState());
    const measure = measurer(el);
    const rowDays = cells.slice(0, 7).map(c => parseDay(c.date));
    const shownRows = rowDays.map((d, r) => [d, r]).filter(([d]) => [1, 3, 5].includes(d.getDay()));
    const lw = Math.ceil(Math.max(0, ...shownRows.map(([d]) => measure(weekday(d))))) + 8;
    const size = Math.max(4, Math.min(16, Math.floor((W - lw) / weeks)));
    const gap = Math.max(2, Math.round(size / 6)), c = size - gap, top = 20;
    const H = top + 7 * size - gap;
    const root = chartSvg(W, H, `Activity, ${weeks} weeks, total ${format(sum(cells.map(x => x.cost)))}`);
    for (const [d, r] of shownRows) root.append(label(0, top + r * size + c / 2, weekday(d), { 'dominant-baseline': 'middle' }));
    let lastX = -Infinity, lastMonth = -1;
    for (let w = 0; w < weeks; w++) {
      const d = parseDay(cells[w * 7].date), x = lw + w * size;
      if (d.getMonth() === lastMonth) continue;
      lastMonth = d.getMonth();
      const text = d.toLocaleDateString(undefined, { month: 'short' });
      if (x - lastX < measure(text) + 8 && lastX > -Infinity) continue;
      lastX = x;
      root.append(label(x, 12, text));
    }
    const grid = svg('g', { class: fresh ? 'ts-chart-fade' : null });
    cells.forEach((cell, i) => {
      if (cell.date > today) return;
      grid.append(svg('rect', { class: 'ts-chart-cell', 'data-level': clamp(cell.level | 0, 0, 4), 'data-i': i, x: lw + Math.floor(i / 7) * size, y: top + (i % 7) * size, width: c, height: c, rx: f2(c / 4) }));
    });
    root.append(grid);
    tooltip(root, e => {
      const node = e.target.closest?.('.ts-chart-cell');
      if (!node) return null;
      const cell = cells[+node.dataset.i];
      return tipContent(longDay(parseDay(cell.date)), [[null, '', format(cell.cost)]]);
    });
    const scale = h('div', { class: 'ts-chart-scale', attrs: { 'aria-hidden': 'true' } }, 'Less',
      svg('svg', { viewBox: '0 0 76 12', width: 76, height: 12 },
        [0, 1, 2, 3, 4].map(l => svg('rect', { class: 'ts-chart-cell', 'data-level': l, x: l * 16, width: 12, height: 12, rx: 3 }))),
      'More');
    el.replaceChildren(root, scale);
  });
}

export function blockTimeline(el, blocks, nowMs, { hours = 72, format }) {
  const active = blocks.find(b => b.isActive && !b.isGap);
  const end = active ? Math.max(Date.parse(active.end), nowMs) : nowMs;
  const start = end - hours * HOUR;
  const shown = blocks.filter(b => !b.isGap && Date.parse(b.end) > start && Date.parse(b.start) < end)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  mount(el, (W, fresh) => {
    if (!shown.length) return el.replaceChildren(emptyState());
    const measure = measurer(el);
    const H = 92, laneTop = 26, yc = (laneTop + H) / 2;
    const x = t => ((t - start) / (end - start)) * W;
    const maxCost = Math.max(...shown.map(b => b.cost)) || 1;
    const root = chartSvg(W, H, `Usage blocks, last ${hours} hours, ${shown.length} blocks, total ${format(sum(shown.map(b => b.cost)))}`);
    const dayText = d => `${weekday(d)} ${d.getDate()}`;
    const mid = new Date(start);
    mid.setHours(24, 0, 0, 0); // next local midnight
    if (x(+mid) > measure(dayText(new Date(start))) + 16) root.append(label(0, 14, dayText(new Date(start))));
    for (; +mid < end; mid.setDate(mid.getDate() + 1)) {
      const mx = x(+mid);
      root.append(svg('line', { class: 'ts-chart-grid', x1: f2(mx), x2: f2(mx), y1: 0, y2: H }));
      if (W - mx > measure(dayText(mid)) + 6) root.append(label(mx + 6, 14, dayText(mid)));
    }
    shown.forEach((b, i) => {
      const s = Date.parse(b.start), e = Date.parse(b.end);
      const used = b.actualEnd ? Date.parse(b.actualEnd) : b.isActive ? nowMs : e;
      const x0 = Math.max(0, x(s)), x1 = Math.min(W, x(e)), xa = clamp(x(used), x0, x1);
      const bh = 10 + 22 * (b.cost / maxCost), y = yc - bh / 2;
      const color = b.isActive ? 'var(--color-tint)' : 'var(--color-label-3)';
      const bar = svg('rect', { class: 'ts-chart-bar', x: f2(x0), y: f2(y), width: f2(xa - x0), height: f2(bh), rx: f2(bh / 2) });
      const g = svg('g', { class: fresh ? 'ts-chart-grow ts-chart-grow--x' : null, style: `--i: ${spread(i, shown.length)}; --series: ${color}` },
        svg('rect', { class: 'ts-timeline-track', x: f2(x0), y: f2(y), width: f2(x1 - x0), height: f2(bh), rx: f2(bh / 2) }), bar);
      root.append(g);
      const sd = new Date(s);
      hoverable(g, [bar], () => tipContent(`${weekday(sd)} ${hhmm(sd)}–${hhmm(new Date(e))}`, [
        [color, 'Cost', format(b.cost)],
        [null, 'Tokens', fmtTokens(b.tokens)],
        ...(b.modelNames?.length ? [[null, b.modelNames.join(', ')]] : []),
      ]));
    });
    if (nowMs > start) root.append(svg('line', { class: 'ts-timeline-now', x1: f2(x(nowMs)), x2: f2(x(nowMs)), y1: laneTop - 6, y2: H }));
    el.replaceChildren(root);
  });
}
