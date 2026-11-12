// Reports: daily / weekly / monthly usage as a trend and a sortable table with per-model detail.

import { h } from '../dom.js';
import { money, tokens } from '../format.js';
import { aggregate, totals } from '../shape.js';
import { lineChart } from '../charts.js';
import { icon as glyph, card, empty, segmented, toolbar, dataTable, modelList, agentLabel, fillDays, dayLabel, monthLabel, rangeLabel } from '../kit.js';

export const id = 'reports';
export const title = 'Reports';
export const tile = 'var(--cat-7)';
export const icon = () => glyph('reports');

let unit = 'day';       // day | week | month
let metric = 'cost';    // cost | tokens
const sort = { key: 'period', dir: 'desc' };   // survives the grouping and metric switches

const periodLabel = p => (unit === 'month' ? monthLabel(p) : unit === 'week' ? `Week of ${dayLabel(p)}` : dayLabel(p));

export function render(el, ctx) {
  const { vm, filter, settings, today, actions, animate } = ctx;
  const body = h('div', { class: 'ts-stack' });

  const update = enter => {
    if (!vm.daily.length) {
      body.replaceChildren(card({ enter }, empty({
        title: 'No usage in this range', text: 'Try a longer range or another source.',
        action: { label: 'Reset filters', onClick: () => actions.setFilter({ agent: 'all', preset: 'all' }) },
      })));
      return;
    }
    const rows = unit === 'day' ? vm.daily : aggregate(vm.daily, unit, settings.weekStart);
    const format = metric === 'cost' ? money : tokens;
    const trendRows = unit === 'day' ? fillDays(vm.daily, filter.since, filter.until ?? today) : rows;
    const sum = totals(rows);
    const chartEl = h('div');

    const columns = [
      { key: 'period', label: unit === 'day' ? 'Date' : unit === 'week' ? 'Week' : 'Month', render: r => periodLabel(r.period) },
      { key: 'agents', label: 'Sources', value: r => r.agents.length, render: r => r.agents.map(a => agentLabel(a.agent)).join(', ') },
      { key: 'models', label: 'Models', clip: true, value: r => r.models.length, render: r => (r.models.length > 1 ? `${r.models[0].name} +${r.models.length - 1}` : r.models[0]?.name ?? '—') },
      { key: 'input', label: 'Input', num: true, render: r => tokens(r.input) },
      { key: 'output', label: 'Output', num: true, render: r => tokens(r.output) },
      { key: 'cacheWrite', label: 'Cache write', num: true, render: r => tokens(r.cacheWrite) },
      { key: 'cacheRead', label: 'Cache read', num: true, render: r => tokens(r.cacheRead) },
      { key: 'tokens', label: 'Total', num: true, render: r => tokens(r.tokens) },
      { key: 'cost', label: 'Cost', num: true, render: r => money(r.cost) },
    ];
    body.replaceChildren(
      card({ title: `${metric === 'cost' ? 'Cost' : 'Tokens'} · ${rangeLabel(filter)}`, enter }, chartEl),
      card({ enter }, dataTable(columns, rows, {
        sort,
        detail: r => modelList(r.models),
        footer: ['Total', '', '', tokens(sum.input), tokens(sum.output), tokens(sum.cacheWrite), tokens(sum.cacheRead), tokens(sum.tokens), money(sum.cost)],
      })));
    lineChart(chartEl, {
      labels: trendRows.map(r => (r.period.length === 7 ? `${r.period}-01` : r.period)),
      values: trendRows.map(r => r[metric]),
      format,
      tipLabel: (iso, i) => periodLabel(trendRows[i].period),
    });
  };

  el.replaceChildren(
    toolbar(
      segmented({
        name: 'report-unit', label: 'Group by', value: unit,
        options: [{ value: 'day', label: 'Daily' }, { value: 'week', label: 'Weekly' }, { value: 'month', label: 'Monthly' }],
        onChange: v => { unit = v; update(true); },
      }),
      segmented({
        name: 'report-metric', label: 'Metric', value: metric,
        options: [{ value: 'cost', label: 'Cost' }, { value: 'tokens', label: 'Tokens' }],
        onChange: v => { metric = v; update(true); },
      })),
    body);
  update(animate);
}
