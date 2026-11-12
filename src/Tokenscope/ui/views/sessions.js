// Sessions: every conversation, searchable and sortable; a row opens its detail sheet.

import { h, openSheet } from '../dom.js';
import { money, tokens, relative } from '../format.js';
import { filterSessions } from '../shape.js';
import { icon as glyph, card, empty, toolbar, dataTable, modelList, row, list, agentLabel, agentColor, stamp } from '../kit.js';

export const id = 'sessions';
export const title = 'Sessions';
export const tile = 'var(--cat-2)';
export const icon = () => glyph('sessions');

let query = '';
const sort = { key: 'last', dir: 'desc' };   // survives searches and re-renders
export const reset = () => { query = ''; };  // a fresh visit starts unfiltered

const shortId = s => (s.id.length > 12 ? `…${s.id.slice(-10)}` : s.id);

function openSession(s, agents) {
  openSheet(s.title, h('div', { class: 'ts-stack' },
    list('Session', [
      row({ glyph: 'sessions', tile: agentColor(s.agent, agents), title: agentLabel(s.agent), subtitle: s.projectKey ?? 'No project recorded for this source', trailing: money(s.cost) }),
      row({ title: 'Last activity', trailing: stamp(s.last) }),
      row({ title: 'Tokens', subtitle: `in ${tokens(s.input)} · out ${tokens(s.output)} · cache write ${tokens(s.cacheWrite)} · cache read ${tokens(s.cacheRead)}`, trailing: tokens(s.tokens) }),
      row({ title: 'Session id', subtitle: s.id }),
      row({ title: 'Machine', trailing: s.machine ?? '—' }),
    ]),
    h('p', { class: 'ts-list-header' }, 'Models'),
    modelList(s.models)));
}

export function render(el, ctx, params) {
  const { vm, nowMs, actions } = ctx;
  const agents = vm.all.agents;
  const multi = vm.all.machines.length > 1;   // more than one PC: say where each session ran
  const body = h('div', { class: 'ts-stack' });
  const count = h('span', { class: 'ts-badge', attrs: { role: 'status' } });

  const columns = [
    { key: 'title', label: 'Session', clip: true, render: s => h('span', { class: 'ts-row-content' }, h('span', { class: 'ts-row-title' }, s.title), h('span', { class: 'ts-row-subtitle' }, multi ? `${s.machine} · ${shortId(s)}` : shortId(s))) },
    { key: 'agent', label: 'Source', render: s => h('span', { class: 'ts-chip' }, h('span', { class: 'ts-chip-dot', attrs: { style: `--dot: ${agentColor(s.agent, agents)}` } }), agentLabel(s.agent)) },
    { key: 'last', label: 'Last activity', value: s => s.last ?? '', render: s => relative(s.last, nowMs) },
    { key: 'models', label: 'Models', value: s => s.models.length, render: s => (s.models.length > 1 ? `${s.models[0].name} +${s.models.length - 1}` : s.models[0]?.name ?? '—') },
    { key: 'tokens', label: 'Tokens', num: true, render: s => tokens(s.tokens) },
    { key: 'cost', label: 'Cost', num: true, render: s => money(s.cost) },
  ];

  const update = enter => {
    const rows = filterSessions(vm.sessions, { query });
    count.textContent = `${rows.length} session${rows.length === 1 ? '' : 's'}`;
    body.replaceChildren(card({ enter }, dataTable(columns, rows, {
      sort,
      onRow: s => openSession(s, agents),
      empty: empty({
        glyph: 'search', title: query ? 'No sessions match' : 'No sessions in this range',
        text: query ? 'Search looks at project, session id, source and model names.' : 'Try a longer range or another source.',
        action: query ? null : { label: 'Reset filters', onClick: () => actions.setFilter({ agent: 'all', preset: 'all' }) },
      }),
    })));
  };

  const search = h('input', {
    class: 'ts-field-input', attrs: { type: 'search', placeholder: 'Search sessions', 'aria-label': 'Search sessions', value: query },
    oninput: e => { query = e.target.value; update(false); },
  });
  el.replaceChildren(toolbar(h('label', { class: 'ts-field ts-field--search' }, glyph('search', 'ts-field-icon'), search), count), body);
  update(ctx.animate);

  if (params?.id) {
    const target = vm.all.sessions.find(s => s.id === params.id);
    if (target) openSession(target, agents);
  }
}
