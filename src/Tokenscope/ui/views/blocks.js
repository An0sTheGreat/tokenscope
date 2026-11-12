// Blocks: Claude's 5-hour billing windows. A live panel for the active block, a 3-day timeline
// and the full history. Not affected by the date/source filters.

import { h } from '../dom.js';
import { money, tokens, duration } from '../format.js';
import { blockTimeline } from '../charts.js';
import { icon as glyph, card, empty, row, dataTable, stamp, clock } from '../kit.js';

export const id = 'blocks';
export const title = 'Blocks';
export const tile = 'var(--cat-1)';
export const icon = () => glyph('blocks');
export const filters = false;

function progress(label, figure, share, state = '') {
  return [
    h('div', { class: 'ts-progress-label' }, h('span', null, label), h('strong', null, figure)),
    h('div', { class: `ts-progress${state}`, attrs: { role: 'progressbar', 'aria-label': label, 'aria-valuenow': String(Math.round(share * 100)), style: `--value: ${Math.min(1, share).toFixed(3)}` } },
      h('span', { class: 'ts-progress-fill' })),
  ];
}

function livePanel({ vm, settings }, enter) {
  const b = vm.active;
  if (!b) {
    return card({ enter, attrs: { 'data-live': '' } }, empty({
      glyph: 'blocks', title: 'No active block',
      text: 'A 5-hour block starts with your next Claude Code message.',
    }));
  }
  const total = b.elapsedMin + b.remainingMin;
  const limitState = b.limitShare == null ? '' : b.limitShare > 1 ? ' ts-progress--over' : b.limitShare > 0.8 ? ' ts-progress--warning' : '';
  return card({ title: 'Active block', enter, cls: 'ts-stat', attrs: { 'data-live': '' } },
    h('span', { class: 'ts-stat-value' }, money(b.cost)),
    h('span', { class: 'ts-stat-meta' }, `Started ${clock(b.start)} · ends ${clock(b.end)} · ${tokens(b.tokens)} tokens`),
    progress('Time', `${duration(b.remainingMin)} left of ${duration(total)}`, b.elapsedMin / Math.max(1, total)),
    b.limit
      ? progress('Token limit', `${tokens(b.tokens)} of ${tokens(b.limit)}`, b.limitShare, limitState)
      : h('p', { class: 'ts-list-footer' }, settings.tokenLimit ? null : 'Set a token limit in Settings to track quota here.'),
    h('ul', { class: 'ts-list' },
      row({ glyph: 'bolt', tile: 'var(--cat-1)', title: 'Burn rate', subtitle: 'Excludes cache reads', trailing: b.burn ? `${tokens(b.burn.tokensPerMin)} tok/min · ${money(b.burn.costPerHour)}/h` : 'Not enough data yet' }),
      row({ glyph: 'reports', tile: 'var(--cat-7)', title: 'Projected at block end', trailing: b.projection ? `${money(b.projection.cost)} · ${tokens(b.projection.tokens)} tokens` : '—' }),
      row({ glyph: 'sessions', tile: 'var(--cat-2)', title: 'Models', trailing: b.modelNames.join(', ') || '—' })));
}

export function renderLive(el, ctx) {
  el.querySelector('[data-live]')?.replaceWith(livePanel(ctx, false));
}

export function render(el, ctx) {
  const { vm, nowMs, animate } = ctx;
  const timelineEl = h('div');
  const history = vm.blocks.filter(b => !b.isGap);
  const minutes = b => (Date.parse(b.actualEnd ?? b.end) - Date.parse(b.start)) / 60000;

  const columns = [
    { key: 'start', label: 'Started', render: b => [stamp(b.start), b.isActive && ' ', b.isActive && h('span', { class: 'ts-badge ts-badge--tint' }, 'Active')] },
    { key: 'duration', label: 'Active for', num: true, value: minutes, render: b => duration(minutes(b)) },
    { key: 'models', label: 'Models', clip: true, value: b => b.modelNames.join(', '), render: b => b.modelNames.join(', ') || '—' },
    { key: 'tokens', label: 'Tokens', num: true, render: b => tokens(b.tokens) },
    { key: 'cost', label: 'Cost', num: true, render: b => money(b.cost) },
  ];

  el.replaceChildren(
    livePanel(ctx, animate),
    card({ title: 'Last 3 days', enter: animate }, timelineEl),
    card({ title: 'History', enter: animate }, dataTable(columns, history, {
      sort: { key: 'start', dir: 'desc' },
      empty: empty({ glyph: 'blocks', title: 'No blocks recorded', text: 'Blocks come from Claude Code usage.' }),
    })));
  blockTimeline(timelineEl, vm.blocks, nowMs, { format: money });
}
