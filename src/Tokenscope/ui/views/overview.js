// Overview: the at-a-glance screen. Period stats, daily cost by agent, recent sessions, the active
// block, a 26-week activity heatmap and the model split.

import { h, stagger } from '../dom.js';
import { money, tokens, relative, duration } from '../format.js';
import { periodStats, totals, agentSeries, modelSplit, heatmapCells, recentSessions, filterDaily } from '../shape.js';
import { stackedBars, rankBars, heatmap } from '../charts.js';
import { icon as glyph, card, stat, empty, row, agentLabel, agentColor, seriesColor, fillDays, rangeLabel, clock } from '../kit.js';

export const id = 'overview';
export const title = 'Overview';
export const tile = 'var(--color-tint-fill)';
export const icon = () => glyph('overview');

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

export function render(el, ctx) {
  const { vm, filter, settings, today, nowMs, actions, animate } = ctx;
  const agents = vm.all.agents;
  const scope = filterDaily(vm.all.daily, { agent: filter.agent });   // agent filter only: "today" ignores the range
  const ps = periodStats(scope, today, settings.weekStart);
  const selected = totals(vm.daily);

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
  const recent = recentSessions(vm.all.sessions.filter(s => filter.agent === 'all' || s.agent === filter.agent), 3);

  const sessionsCard = card({ title: 'Recent sessions', action: { label: 'See all', onClick: () => actions.navigate('sessions') }, enter: animate },
    recent.length
      ? h('ul', { class: 'ts-list' }, recent.map(s => row({
        glyph: 'sessions', tile: agentColor(s.agent, agents), title: s.title,
        subtitle: `${agentLabel(s.agent)} · ${relative(s.last, nowMs)} · ${tokens(s.tokens)} tokens`,
        trailing: money(s.cost), onClick: () => actions.navigate('sessions', { id: s.id }),
      })))
      : empty({ glyph: 'sessions', title: 'No sessions yet' }));

  el.replaceChildren(...[
    unpriced,
    stats,
    card({ title: `Daily cost · ${rangeLabel(filter)}`, enter: animate }, vm.daily.length ? chartEl : empty({
      title: 'No usage in this range', text: 'Try a longer range or another source.',
      action: { label: 'Reset filters', onClick: () => actions.setFilter({ agent: 'all', preset: 'all' }) },
    })),
    h('div', { class: 'ts-grid ts-grid--split' }, sessionsCard, activeCard(ctx, animate)),
    h('div', { class: 'ts-grid ts-grid--split' },
      card({ title: 'Activity · last 26 weeks', enter: animate }, heatEl),
      card({ title: 'Models', enter: animate }, rankEl)),
  ].filter(Boolean));

  if (vm.daily.length) {
    const s = agentSeries(fillDays(vm.daily, filter.since, filter.until ?? today));
    stackedBars(chartEl, {
      labels: s.labels, format: money,
      series: s.series.map(x => ({ name: agentLabel(x.agent), color: agentColor(x.agent, agents), values: x.values })),
    });
  }
  heatmap(heatEl, heatmapCells(scope, today, 26, settings.weekStart), { format: money, today });
  rankBars(rankEl, modelSplit(vm.daily).map((m, i) => ({
    label: m.name, value: m.cost, share: m.share, color: seriesColor(i), badge: m.unpriced ? 'Unpriced' : null,
  })), { format: money });
}
