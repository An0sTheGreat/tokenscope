// Overview: the at-a-glance screen. The four period stats are a fixed row; every card below them
// sits on one board (a 4-column grid of equal rows). "Customize layout" lets the user drag a card
// onto another to move it and drag its corner to resize it.

import { h, stagger } from '../dom.js';
import { money, tokens, relative, duration } from '../format.js';
import { periodStats, totals, agentSeries, modelSplit, heatmapCells, recentSessions, filterDaily, boardLayout } from '../shape.js';
import { stackedBars, rankBars, heatmap } from '../charts.js';
import { icon as glyph, card, stat, empty, row, toolbar, agentLabel, agentColor, seriesColor, fillDays, rangeLabel, clock } from '../kit.js';

export const id = 'overview';
export const title = 'Overview';
export const tile = 'var(--color-tint-fill)';
export const icon = () => glyph('overview');

// Default board: id, columns wide (1-4), rows tall. The flow is dense, so the two quarter cards
// tuck in under Recent sessions beside the tall Models card.
const CARDS = [['chart', 4, 3], ['sessions', 2, 2], ['models', 2, 4], ['activity', 1, 2], ['block', 1, 2]].map(([id, w, h]) => ({ id, w, h }));
const MAX_ROWS = 6;

let editing = false;
export const reset = () => { editing = false; };   // leaving the screen ends customizing

function activeCard({ vm }, enter) {
  const b = vm.active;
  const attrs = { href: '#blocks', 'data-live': '' };
  if (!b) {
    return card({ title: 'Active block', tag: 'a', attrs, enter },
      h('span', { class: 'ts-stat-value' }, 'Idle'),
      h('span', { class: 'ts-stat-meta' }, 'No 5-hour block is running.'));
  }
  const share = b.elapsedMin / Math.max(1, b.elapsedMin + b.remainingMin);
  return card({ title: 'Active block', tag: 'a', attrs, enter, cls: 'ts-stat' },
    h('span', { class: 'ts-stat-value' }, money(b.cost)),
    h('span', { class: 'ts-stat-meta' }, `${duration(b.remainingMin)} left · ends ${clock(b.end)}`),
    h('div', { class: 'ts-progress-label' }, h('span', null, b.burn ? `${tokens(b.burn.tokensPerMin)} tok/min` : 'Block time'), h('strong', null, `${Math.round(share * 100)}%`)),
    h('div', { class: 'ts-progress', attrs: { role: 'progressbar', 'aria-label': 'Block time elapsed', 'aria-valuenow': String(Math.round(share * 100)), style: `--value: ${share.toFixed(3)}` } },
      h('span', { class: 'ts-progress-fill' })));
}

export function renderLive(el, ctx) {
  el.querySelector('[data-live]')?.replaceWith(activeCard(ctx, false));
}

// Drag a card onto another to move it there; drag the corner handle to change its span.
function customize(board, layout, save) {
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  let dragged = null, lastOver = null, resizing = false;
  board.addEventListener('dragstart', e => {
    if (resizing) { e.preventDefault(); return; }
    dragged = e.target.closest('.ts-board-item');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragged.dataset.id);
    dragged.dataset.dragging = '';
  });
  board.addEventListener('dragover', e => {
    if (!dragged) return;
    e.preventDefault();
    const over = e.target.closest('.ts-board-item');
    if (!over) { lastOver = null; return; }
    if (over === dragged || over === lastOver) return;   // one swap per card entered, or the two trade places for ever
    lastOver = over;
    const after = dragged.compareDocumentPosition(over) & Node.DOCUMENT_POSITION_FOLLOWING;
    board.insertBefore(dragged, after ? over.nextSibling : over);
  });
  board.addEventListener('dragend', () => {
    if (!dragged) return;
    dragged = null;
    save([...board.children].map(n => layout.find(c => c.id === n.dataset.id)));
  });
  board.addEventListener('pointerdown', e => {
    const handle = e.target.closest('.ts-board-handle');
    if (!handle) return;
    e.preventDefault();
    resizing = true;
    const cell = handle.parentElement, item = layout.find(c => c.id === cell.dataset.id);
    const cs = getComputedStyle(board), columns = cs.gridTemplateColumns.split(' ');
    const gap = parseFloat(cs.columnGap) || 0, col = parseFloat(columns[0]), rowSize = parseFloat(cs.gridAutoRows);
    handle.setPointerCapture(e.pointerId);
    const move = ev => {
      const r = cell.getBoundingClientRect();
      item.w = clamp(Math.round((ev.clientX - r.left + gap) / (col + gap)), 1, columns.length);
      item.h = clamp(Math.round((ev.clientY - r.top + gap) / (rowSize + gap)), 1, MAX_ROWS);
      cell.style.setProperty('--w', item.w);
      cell.style.setProperty('--h', item.h);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      resizing = false;
      save(layout);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up, { once: true });
    handle.addEventListener('pointercancel', up, { once: true });
  });
}

export function render(el, ctx) {
  const { vm, filter, settings, today, nowMs, actions, animate } = ctx;
  const agents = vm.all.agents;
  const scope = filterDaily(vm.all.daily, { agent: filter.agent });   // agent filter only: "today" ignores the range
  const ps = periodStats(scope, today, settings.weekStart);
  const selected = totals(vm.daily);
  const layout = boardLayout(CARDS, settings.overviewLayout, MAX_ROWS);
  const size = Object.fromEntries(layout.map(c => [c.id, c]));
  const redraw = () => render(el, { ...ctx, animate: false });
  const save = next => { actions.setSetting('overviewLayout', next.map(({ id, w, h }) => ({ id, w, h }))); redraw(); };

  const stats = h('div', { class: 'ts-grid ts-grid--stats' },
    stat({ label: 'Today', value: ps.today.cost, delta: ps.today.delta, meta: 'vs yesterday', animate }),
    stat({ label: 'This week', value: ps.week.cost, meta: `${money(ps.week.prevCost)} last week`, animate }),
    stat({ label: 'This month', value: ps.month.cost, meta: `${money(ps.month.prevCost)} last month`, animate }),
    stat({ label: rangeLabel(filter), value: selected.cost, meta: `${tokens(selected.tokens)} tokens`, animate }));
  if (animate) stagger(stats);

  const unpriced = vm.unpriced.length ? h('div', { class: 'ts-banner ts-banner--warning', attrs: { role: 'status' } },
    glyph('warning', 'ts-banner-icon'),
    h('div', { class: 'ts-banner-content' },
      h('span', { class: 'ts-banner-title' }, `${vm.unpriced.length} model${vm.unpriced.length > 1 ? 's have' : ' has'} no known price`),
      h('p', { class: 'ts-banner-text' }, `Counted as $0, so totals are understated: ${vm.unpriced.join(', ')}`))) : null;

  const chartEl = h('div');
  const heatEl = h('div');
  const rankEl = h('div');
  // a taller Recent sessions card lists more of them
  const recent = recentSessions(vm.all.sessions.filter(s => filter.agent === 'all' || s.agent === filter.agent), Math.max(1, size.sessions.h * 2 - 1));
  const wide = size.activity.w > 1;   // a wider Activity card has room for half a year and the scale

  const cards = {
    chart: card({ title: `Daily cost · ${rangeLabel(filter)}`, enter: animate }, vm.daily.length ? chartEl : empty({
      title: 'No usage in this range', text: 'Try a longer range or another source.',
      action: { label: 'Reset filters', onClick: () => actions.setFilter({ agent: 'all', preset: 'all' }) },
    })),
    sessions: card({ title: 'Recent sessions', action: { label: 'See all', onClick: () => actions.navigate('sessions') }, enter: animate },
      recent.length
        ? h('ul', { class: 'ts-list' }, recent.map(s => row({
          glyph: 'sessions', tile: agentColor(s.agent, agents), title: s.title,
          subtitle: `${agentLabel(s.agent)} · ${relative(s.last, nowMs)} · ${tokens(s.tokens)} tokens`,
          trailing: money(s.cost), onClick: () => actions.navigate('sessions', { id: s.id }),
        })))
        : empty({ glyph: 'sessions', title: 'No sessions yet' })),
    models: card({ title: 'Models', enter: animate }, rankEl),
    activity: card({ title: `Activity · ${wide ? 26 : 16} weeks`, enter: animate }, heatEl),
    block: activeCard(ctx, animate),
  };

  const board = h('div', { class: `ts-board${editing ? ' ts-board--editing' : ''}` }, layout.map(c =>
    h('div', { class: 'ts-board-item', dataset: { id: c.id }, attrs: { style: `--w: ${c.w}; --h: ${c.h}`, draggable: editing ? 'true' : null } },
      cards[c.id],
      editing ? h('span', { class: 'ts-board-handle', attrs: { title: 'Drag to resize', draggable: 'false' } }) : null)));

  const button = (label, cls, onClick) => h('button', { class: `ts-button ${cls}`, attrs: { type: 'button' }, onclick: onClick }, label);
  const bar = editing
    ? h('div', { class: 'ts-banner', attrs: { role: 'status' } },
      glyph('overview', 'ts-banner-icon'),
      h('div', { class: 'ts-banner-content' },
        h('span', { class: 'ts-banner-title' }, 'Customizing the layout'),
        h('p', { class: 'ts-banner-text' }, 'Drag a card onto another to move it. Drag the blue corner to resize it.')),
      button('Reset', 'ts-button--plain', () => save(CARDS)),
      button('Done', '', () => { editing = false; redraw(); }))
    : null;

  el.replaceChildren(...[
    unpriced,
    stats,
    bar,
    board,
    editing ? null : toolbar([], button('Customize layout', 'ts-button--plain', () => { editing = true; redraw(); })),
  ].filter(Boolean));

  if (vm.daily.length) {
    const s = agentSeries(fillDays(vm.daily, filter.since, filter.until ?? today));
    // the plot takes what the card leaves after its header, padding and legend
    const room = chartEl.parentElement.clientHeight - chartEl.offsetTop - 64;
    stackedBars(chartEl, {
      labels: s.labels, format: money, height: Math.max(96, room),
      series: s.series.map(x => ({ name: agentLabel(x.agent), color: agentColor(x.agent, agents), values: x.values })),
    });
  }
  heatmap(heatEl, heatmapCells(scope, today, wide ? 26 : 16, settings.weekStart), { format: money, today, legend: wide });
  rankBars(rankEl, modelSplit(vm.daily).map((m, i) => ({
    label: m.name, value: m.cost, share: m.share, color: seriesColor(i), badge: m.unpriced ? 'Unpriced' : null,
  })), { format: money });
  if (editing) customize(board, layout, save);
}
