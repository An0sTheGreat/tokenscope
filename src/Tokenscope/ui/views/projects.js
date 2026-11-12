// Projects: Claude Code usage grouped by project; a row opens the project's daily trend.

import { h, openSheet } from '../dom.js';
import { money, tokens, pct } from '../format.js';
import { lineChart, rankBars } from '../charts.js';
import { icon as glyph, card, empty, row, list, seriesColor, fillDays, rangeLabel, dayLabel } from '../kit.js';

export const id = 'projects';
export const title = 'Projects';
export const tile = 'var(--cat-6)';
export const icon = () => glyph('projects');
export const agentFilter = false;   // projects exist for Claude Code only

const tail = key => (key.length > 44 ? `…${key.slice(-42)}` : key);

function openProject(p, { filter, today }) {
  const chartEl = h('div');
  const days = p.daily.length;
  openSheet(p.name, h('div', { class: 'ts-stack' },
    card({ title: `Daily cost · ${rangeLabel(filter)}` }, chartEl),
    list('Totals', [
      row({ title: 'Cost', trailing: money(p.cost) }),
      row({ title: 'Tokens', trailing: tokens(p.tokens) }),
      row({ title: 'Active days', subtitle: days ? `${dayLabel(p.daily[0].period)} – ${dayLabel(p.daily.at(-1).period)}` : null, trailing: String(days) }),
      row({ title: 'Share of project spend', trailing: pct(p.share) }),
      row({ title: 'Project key', subtitle: p.key }),
    ])));
  const rows = fillDays(p.daily, filter.since, filter.until ?? today);
  lineChart(chartEl, { labels: rows.map(r => r.period), values: rows.map(r => r.cost), format: money });
}

export function render(el, ctx) {
  const { vm, filter, actions, animate } = ctx;
  if (!vm.projects.length) {
    el.replaceChildren(card({ enter: animate }, empty({
      glyph: 'projects', title: 'No project usage in this range',
      text: 'Projects come from Claude Code. Other sources do not record a project.',
      action: { label: 'Show all time', onClick: () => actions.setFilter({ preset: 'all' }) },
    })));
    return;
  }
  const rankEl = h('div');
  el.replaceChildren(
    card({ title: `Top projects · ${rangeLabel(filter)}`, enter: animate }, rankEl),
    h('div', null, list(`${vm.projects.length} project${vm.projects.length === 1 ? '' : 's'}`, vm.projects.map((p, i) => row({
      glyph: 'projects', tile: seriesColor(i), title: p.name,
      subtitle: `${pct(p.share)} · ${tokens(p.tokens)} tokens · ${tail(p.key)}`,
      trailing: money(p.cost), onClick: () => openProject(p, ctx),
    })), 'Claude Code only. Names are shortened from the project folder.')));
  rankBars(rankEl, vm.projects.map((p, i) => ({ label: p.name, value: p.cost, share: p.share, color: seriesColor(i), badge: null })), { format: money });
}
