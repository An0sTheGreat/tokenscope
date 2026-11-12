// Machines: usage per PC from the sync folder. Pick any set of PCs and see just their overview:
// totals, daily cost stacked by PC, each PC's share and the model split.

import { h, stagger } from '../dom.js';
import { money, tokens, relative } from '../format.js';
import { mergeMachines, machineTotals, modelSplit, totals } from '../shape.js';
import { stackedBars, rankBars } from '../charts.js';
import { icon as glyph, card, stat, empty, row, list, chip, toolbar, seriesColor, fillDays, rangeLabel } from '../kit.js';

export const id = 'machines';
export const title = 'Machines';
export const tile = 'var(--cat-3)';
export const icon = () => glyph('machines');
export const machineFilter = false;   // this screen chooses PCs itself, so the shared PC filter is hidden

const count = v => String(Math.round(v));
let picked = null;   // names of the PCs shown; null = all of them

export function render(el, ctx) {
  const { vm, filter, today, nowMs, actions, animate, sync } = ctx;
  const all = vm.machines;
  if (picked && !all.some(m => picked.has(m.name))) picked = null;   // the chosen PCs are gone
  const chosen = all.filter(m => !picked || picked.has(m.name));
  const colorOf = name => seriesColor(all.findIndex(m => m.name === name));

  const merged = mergeMachines(chosen);
  const sum = totals(merged.daily);
  const labels = fillDays(merged.daily, filter.since, filter.until ?? today).map(r => r.period);
  const perPc = machineTotals(chosen, labels);
  const range = rangeLabel(filter);

  const toggle = name => {
    const next = new Set(chosen.map(m => m.name));
    if (next.has(name)) next.delete(name); else next.add(name);
    if (!next.size) return;   // at least one PC stays selected
    picked = next.size === all.length ? null : next;
    render(el, { ...ctx, animate: false });
  };
  const chips = all.length > 1 ? toolbar(all.map(m => chip({ label: m.name, dot: colorOf(m.name), pressed: chosen.includes(m), onClick: () => toggle(m.name) }))) : null;

  const hint = all.length > 1 ? null : card({ enter: animate }, empty({
    glyph: 'machines',
    title: sync.folder ? 'No other PC found yet' : 'Only this PC so far',
    text: sync.folder
      ? 'Open Tokenscope on another PC and choose the same sync folder there. It appears here after its next refresh.'
      : 'Choose a sync folder that your PCs share, such as one inside Google Drive, to see them side by side.',
    action: { label: 'Open Settings', onClick: () => actions.navigate('settings') },
  }));

  const stats = h('div', { class: 'ts-grid ts-grid--stats' },
    stat({ label: `Cost · ${range}`, value: sum.cost, meta: `${chosen.length} of ${all.length} PC${all.length === 1 ? '' : 's'}`, animate }),
    stat({ label: 'Tokens', value: sum.tokens, format: tokens, meta: `${tokens(sum.output)} output`, animate }),
    stat({ label: 'Sessions', value: merged.sessions.length, format: count, meta: 'with activity in range', animate }),
    stat({ label: 'Active days', value: merged.daily.length, format: count, meta: `of ${labels.length || 0} in range`, animate }));
  if (animate) stagger(stats);

  const chartEl = h('div');
  const shareEl = h('div');
  const modelsEl = h('div');
  el.replaceChildren(...[
    hint,
    chips,
    stats,
    card({ title: `Daily cost by PC · ${range}`, enter: animate }, merged.daily.length ? chartEl : empty({
      title: 'No usage in this range', text: 'Try a longer range or another source.',
      action: { label: 'Show all time', onClick: () => actions.setFilter({ preset: 'all' }) },
    })),
    h('div', { class: 'ts-grid ts-grid--halves' },
      card({ title: 'Share of spend', enter: animate }, shareEl),
      card({ title: 'Models', enter: animate }, modelsEl)),
    h('div', null, list(`${all.length} PC${all.length === 1 ? '' : 's'}`, machineTotals(all).map(m => row({
      glyph: 'machines', tile: colorOf(m.name), title: m.name,
      subtitle: `${m.local ? 'This PC' : `Synced ${m.savedAt ? relative(new Date(m.savedAt).toISOString(), nowMs) : 'at an unknown time'}`} · ${m.sessions} session${m.sessions === 1 ? '' : 's'} · ${tokens(m.tokens)} tokens`,
      trailing: money(m.cost),
      onClick: () => { actions.setFilter({ machine: m.name }); actions.navigate('overview'); },
    })), 'Select a PC to open the Overview for it alone. Other PCs are as fresh as their last refresh.')),
  ].filter(Boolean));

  if (merged.daily.length) {
    stackedBars(chartEl, { labels, format: money, series: perPc.map(m => ({ name: m.name, color: colorOf(m.name), values: m.values })) });
  }
  rankBars(shareEl, perPc.map(m => ({ label: m.name, value: m.cost, share: m.share, color: colorOf(m.name), badge: null })), { format: money });
  rankBars(modelsEl, modelSplit(merged.daily).map((m, i) => ({ label: m.name, value: m.cost, share: m.share, color: seriesColor(i), badge: m.unpriced ? 'Unpriced' : null })), { format: money });
}
