import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  shapeMain, prettyProject, shapeBlocks, shapeProjects, filterDaily, filterSessions, aggregate, totals,
  periodStats, agentSeries, modelSplit, heatmapCells, projectTotals, recentSessions, trayText, toCsv,
  shapeSnapshot, shapeMachines, mergeMachines, machineTotals,
} from '../src/Tokenscope/ui/shape.js';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const main = fixture('main.json');
const blocksRaw = fixture('blocks.json');
const projectsRaw = fixture('projects.json');
const claudeSessions = fixture('claude-sessions.json');

const USAGE = ['input', 'output', 'cacheWrite', 'cacheRead', 'tokens', 'cost'];
const isUsage = u => USAGE.every(f => Number.isFinite(u[f]));

// Hand-built raw day row in engine spelling. agents: {name: cost}; tokens = cost * 100.
function rawDay(period, agents) {
  const usage = cost => ({ inputTokens: cost * 100, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: cost * 100, totalCost: cost });
  const split = Object.entries(agents).map(([agent, cost]) => ({
    agent, ...usage(cost), modelBreakdowns: [{ modelName: `${agent}-model`, ...usage(cost), cost }],
  }));
  const total = split.reduce((s, a) => s + a.totalCost, 0);
  return { period, agent: 'all', agents: split, ...usage(total), modelBreakdowns: split.flatMap(a => a.modelBreakdowns) };
}
const days = spec => shapeMain({ daily: Object.entries(spec).map(([p, c]) => rawDay(p, typeof c === 'number' ? { claude: c } : c)) }).daily;

// ---- shapeMain ----

test('shapeMain(fixture): daily ascending, finite usage everywhere, daily cost sums to totals', () => {
  const { daily, sessions, agents } = shapeMain(main);
  assert.equal(daily.length, main.daily.length);
  for (let i = 1; i < daily.length; i++) assert.ok(daily[i - 1].period < daily[i].period);
  for (const r of daily) {
    assert.ok(isUsage(r) && r.models.every(isUsage) && r.agents.every(isUsage));
  }
  assert.ok(sessions.every(s => isUsage(s) && s.models.every(isUsage)));
  const sum = daily.reduce((s, r) => s + r.cost, 0);
  assert.ok(Math.abs(sum - main.totals.totalCost) < 1e-6);
  assert.deepEqual(agents, [...new Set(main.session.map(s => s.agent))].sort());
  for (let i = 1; i < sessions.length; i++) assert.ok(sessions[i - 1].last >= sessions[i].last);
});

test('field-spelling tolerance: block/legacy spellings shape to the same Row', () => {
  const base = { period: '2026-01-01', inputTokens: 1, outputTokens: 2, cacheReadTokens: 4, totalTokens: 10 };
  const a = { ...base, cacheCreationInputTokens: 3, costUSD: 0.5, modelBreakdowns: [{ model: 'm', inputTokens: 1, cacheCreationInputTokens: 3, costUSD: 0.5 }] };
  const b = { ...base, cacheCreationTokens: 3, totalCost: 0.5, modelBreakdowns: [{ modelName: 'm', inputTokens: 1, cacheCreationTokens: 3, cost: 0.5 }] };
  const ra = shapeMain({ daily: [a] }).daily[0];
  assert.deepEqual(ra, shapeMain({ daily: [b] }).daily[0]);
  assert.equal(ra.cacheWrite, 3);
  assert.equal(ra.cost, 0.5);
  assert.equal(ra.models[0].name, 'm');
});

test('missing cost: model without cost and missingPricing:true has cost 0, unpriced true, listed in unpriced', () => {
  const raw = {
    daily: [{ period: '2026-01-01', agents: [], inputTokens: 10, totalTokens: 10, modelBreakdowns: [{ modelName: 'mystery', inputTokens: 10, missingPricing: true }] }],
    totals: { unpricedModels: ['other'] },
  };
  const out = shapeMain(raw);
  const m = out.daily[0].models[0];
  assert.equal(m.cost, 0);
  assert.equal(m.unpriced, true);
  assert.equal(out.daily[0].cost, 0);
  assert.deepEqual(out.unpriced, ['mystery', 'other']);
});

test('project join: claude sessions get projectKey and title, codex gets Codex, null input works', () => {
  const ids = new Map(claudeSessions.sessions.map(s => [s.sessionId, s.projectPath]));
  const { sessions } = shapeMain(main, claudeSessions);
  const claude = sessions.filter(s => s.agent === 'claude' && ids.has(s.id));
  assert.ok(claude.length > 0);
  for (const s of claude) {
    assert.equal(s.projectKey, ids.get(s.id));
    assert.equal(s.title, prettyProject(s.projectKey));
  }
  const codex = sessions.filter(s => s.agent === 'codex');
  assert.ok(codex.length > 0 && codex.every(s => s.projectKey === null && s.title === 'Codex'));
  const bare = shapeMain(main, null).sessions;
  assert.equal(bare.length, sessions.length);
  assert.ok(bare.every(s => s.projectKey === null));
});

test('prettyProject: drive, user, known folder, AppData, no prefix', () => {
  assert.equal(prettyProject('Y--Programs-Sample-App'), 'Programs-Sample-App');
  assert.equal(prettyProject('C--Users-alex-Downloads-claude-api-usage-costs-translator'), 'claude-api-usage-costs-translator');
  assert.equal(prettyProject('C--Users-alex-AppData-Local-Claude-Data-scratch-1'), 'Claude workspace');
  assert.equal(prettyProject('my-project'), 'my-project');
  assert.equal(prettyProject('C--Users-alex-'), 'C--Users-alex-'); // empty remainder
});

// ---- filters and grouping ----

test('filterDaily by agent: rows re-totalled from the agent slice, absent days dropped', () => {
  const { daily } = shapeMain(main);
  const out = filterDaily(daily, { agent: 'claude' });
  const withClaude = daily.filter(r => r.agents.some(a => a.agent === 'claude'));
  assert.equal(out.length, withClaude.length);
  assert.ok(out.length < daily.length);
  out.forEach((r, i) => {
    const slice = withClaude[i].agents.find(a => a.agent === 'claude');
    assert.equal(r.period, withClaude[i].period);
    for (const f of USAGE) assert.equal(r[f], slice[f]);
    assert.deepEqual(r.agents.map(a => a.agent), ['claude']);
  });
  const small = days({ '2026-01-01': { claude: 1, codex: 2 }, '2026-01-02': { codex: 5 }, '2026-01-03': { codex: 7 } });
  assert.deepEqual(filterDaily(small, { agent: 'codex', since: '2026-01-02' }).map(r => [r.period, r.cost]), [['2026-01-02', 5], ['2026-01-03', 7]]);
  assert.deepEqual(filterDaily(small, { agent: 'claude' }).map(r => r.cost), [1]);
});

test('aggregate by week (monday vs sunday) and by month across a year boundary', () => {
  const spec = {};
  for (let i = 0; i < 14; i++) spec[`2026-03-${String(2 + i).padStart(2, '0')}`] = i + 1; // Mon 2 Mar .. Sun 15 Mar
  const daily = days(spec);
  const sums = rows => rows.map(r => [r.period, r.cost]);
  assert.deepEqual(sums(aggregate(daily, 'week', 'monday')), [['2026-03-02', 28], ['2026-03-09', 77]]);
  assert.deepEqual(sums(aggregate(daily, 'week', 'sunday')), [['2026-03-01', 21], ['2026-03-08', 70], ['2026-03-15', 14]]);
  const yearEnd = days({ '2025-12-30': 1, '2025-12-31': 2, '2026-01-01': 4 });
  assert.deepEqual(sums(aggregate(yearEnd, 'month')), [['2025-12', 3], ['2026-01', 4]]);
  assert.deepEqual(sums(aggregate(yearEnd, 'week', 'monday')), [['2025-12-29', 7]]);
  const agg = aggregate(days({ '2026-01-01': { claude: 1, codex: 2 }, '2026-01-02': { codex: 3 } }), 'month')[0];
  assert.deepEqual(agg.agents.map(a => [a.agent, a.cost]), [['claude', 1], ['codex', 5]]);
});

test('periodStats with explicit today: today/week/month cost, prev and delta exact; null delta when prev is 0', () => {
  const daily = days({ '2026-02-01': 10, '2026-02-16': 5, '2026-02-22': 7, '2026-02-23': 3, '2026-02-28': 4, '2026-03-01': 6 });
  const s = periodStats(daily, '2026-03-01', 'monday');
  assert.deepEqual(s.today, { cost: 6, tokens: 600, prevCost: 4, delta: 0.5 });
  assert.deepEqual(s.week, { cost: 13, tokens: 1300, prevCost: 12, delta: 1 / 12 });
  assert.deepEqual(s.month, { cost: 6, tokens: 600, prevCost: 29, delta: -23 / 29 });
  const sun = periodStats(daily, '2026-03-01', 'sunday');
  assert.deepEqual(sun.week, { cost: 6, tokens: 600, prevCost: 14, delta: -8 / 14 });
  assert.equal(periodStats(daily, '2026-02-16', 'monday').today.delta, null);
});

test('filterSessions: agent, date range on last activity, query over title and models', () => {
  const ss = [
    { id: 'a', agent: 'claude', title: 'Sample-App', last: '2026-01-05T10:00:00Z', models: [{ name: 'claude-opus' }] },
    { id: 'b', agent: 'codex', title: 'Codex', last: '2026-01-10T10:00:00Z', models: [{ name: 'gpt-5' }] },
    { id: 'c', agent: 'claude', title: 'Other', last: null, models: [] },
  ];
  assert.deepEqual(filterSessions(ss, { agent: 'claude' }).map(s => s.id), ['a', 'c']);
  assert.deepEqual(filterSessions(ss, { since: '2026-01-06' }).map(s => s.id), ['b']);
  assert.deepEqual(filterSessions(ss, { query: 'SAMPLE' }).map(s => s.id), ['a']);
  assert.deepEqual(filterSessions(ss, { query: 'gpt' }).map(s => s.id), ['b']);
});

test('totals, modelSplit and agentSeries', () => {
  const daily = days({ '2026-01-01': { claude: 1, codex: 3 }, '2026-01-02': { codex: 4 } });
  const t = totals(daily);
  assert.equal(t.cost, 8);
  assert.deepEqual(t.models.map(m => [m.name, m.cost]), [['codex-model', 7], ['claude-model', 1]]);
  assert.deepEqual(modelSplit(daily).map(m => [m.name, m.share]), [['codex-model', 7 / 8], ['claude-model', 1 / 8]]);
  assert.deepEqual(agentSeries(daily), {
    labels: ['2026-01-01', '2026-01-02'],
    series: [{ agent: 'claude', values: [1, 0] }, { agent: 'codex', values: [3, 4] }],
  });
});

// ---- blocks ----

const T = iso => Date.parse(iso);
const rawBlock = extra => ({
  id: '2026-01-01T10:00:00.000Z', startTime: '2026-01-01T10:00:00.000Z', endTime: '2026-01-01T15:00:00.000Z',
  actualEndTime: '2026-01-01T11:59:00.000Z', isActive: true, isGap: false, models: ['claude-opus-5-5'], costUSD: 6, totalTokens: 1200,
  tokenCounts: { inputTokens: 200, outputTokens: 1000, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
  burnRate: null, projection: null, ...extra,
});

test('shapeBlocks: active block mid-way computes elapsed, remaining, burn and projection', () => {
  const { active } = shapeBlocks({ blocks: [rawBlock()] }, T('2026-01-01T12:00:00Z'));
  assert.equal(active.elapsedMin, 120);
  assert.equal(active.remainingMin, 180);
  assert.deepEqual(active.burn, { tokensPerMin: 10, costPerHour: 3 });
  assert.deepEqual(active.projection, { tokens: 3000, cost: 15 });
  assert.equal(active.input, 200);
  assert.deepEqual(active.modelNames, ['claude-opus-5-5']);
  assert.equal(active.limit, null);
  assert.equal(active.limitShare, null);
});

test('shapeBlocks: zero-elapsed active block has null burn and null projection', () => {
  const { active } = shapeBlocks({ blocks: [rawBlock()] }, T('2026-01-01T10:00:00Z'));
  assert.equal(active.elapsedMin, 0);
  assert.equal(active.burn, null);
  assert.equal(active.projection, null);
});

test('shapeBlocks: engine-provided burnRate and projection win over computed values', () => {
  const b = rawBlock({ burnRate: { tokensPerMinute: 99, costPerHour: 42, tokensPerMinuteForIndicator: 1 }, projection: { totalTokens: 5000, totalCost: 77, remainingMinutes: 10 } });
  const { active } = shapeBlocks({ blocks: [b] }, T('2026-01-01T12:00:00Z'));
  assert.deepEqual(active.burn, { tokensPerMin: 1, costPerHour: 42 });
  assert.deepEqual(active.projection, { tokens: 5000, cost: 77 });
});

test('shapeBlocks: token limit from tokenLimitStatus (engine --token-limit)', () => {
  const b = rawBlock({ totalTokens: 250000, tokenLimitStatus: { limit: 500000, percentUsed: 120, projectedUsage: 600000, status: 'exceeds' } });
  const { active } = shapeBlocks({ blocks: [b] }, T('2026-01-01T12:00:00Z'));
  assert.equal(active.limit, 500000);
  assert.equal(active.limitShare, 0.5);
});

test('shapeBlocks(fixture): latest first, gaps flagged, one active, finite usage', () => {
  const now = Date.parse(blocksRaw.blocks.at(-1).startTime) + 60e3;
  const { active, blocks } = shapeBlocks(blocksRaw, now);
  assert.equal(blocks.length, blocksRaw.blocks.length);
  for (let i = 1; i < blocks.length; i++) assert.ok(blocks[i - 1].start > blocks[i].start);
  assert.equal(blocks.filter(b => b.isGap).length, blocksRaw.blocks.filter(b => b.isGap).length);
  assert.ok(blocks.filter(b => b.isGap).every(b => b.actualEnd === null && b.burn === null && b.cost === 0));
  assert.equal(active?.id ?? null, blocksRaw.blocks.find(b => b.isActive)?.id ?? null);
  assert.ok(blocks.every(isUsage));
});

// ---- projects, heatmap, sessions, tray, csv ----

test('shapeProjects: key, prettyProject name, Rows with period from date', () => {
  const projects = shapeProjects(projectsRaw);
  const keys = Object.keys(projectsRaw.projects);
  assert.deepEqual(projects.map(p => p.key), keys);
  for (const p of projects) {
    assert.equal(p.name, prettyProject(p.key));
    assert.equal(p.daily.length, projectsRaw.projects[p.key].length);
    assert.ok(p.daily.every(r => isUsage(r) && /^\d{4}-\d{2}-\d{2}$/.test(r.period)));
  }
  const first = projectsRaw.projects[keys[0]].map(r => r.date).sort();
  assert.deepEqual(projects[0].daily.map(r => r.period), first);
});

test('projectTotals: range filter, share and cost order', () => {
  const projects = [
    { key: 'A', name: 'a', daily: days({ '2026-01-01': 1, '2026-01-05': 2 }) },
    { key: 'B', name: 'b', daily: days({ '2026-01-05': 6 }) },
    { key: 'C', name: 'c', daily: days({ '2026-01-01': 9 }) },
  ];
  assert.deepEqual(projectTotals(projects, { since: '2026-01-02' }).map(p => [p.name, p.cost, p.share]), [['b', 6, 0.75], ['a', 2, 0.25]]);
});

test('heatmapCells: weeks*7 cells ending on today\'s week, quantile levels, zero days level 0', () => {
  const daily = days({ '2026-01-01': 1000, '2026-02-23': 1, '2026-02-24': 2, '2026-03-01': 3, '2026-03-02': 4 });
  const cells = heatmapCells(daily, '2026-03-04', 2);
  assert.equal(cells.length, 14);
  assert.equal(cells[0].date, '2026-02-22');
  assert.equal(cells.at(-1).date, '2026-03-07'); // Saturday ending the Sunday-started week of Wed 4 Mar
  const level = d => cells.find(c => c.date === d).level;
  assert.deepEqual(['2026-02-23', '2026-02-24', '2026-03-01', '2026-03-02'].map(level), [1, 2, 3, 4]);
  assert.ok(cells.filter(c => c.cost === 0).every(c => c.level === 0));
  assert.equal(heatmapCells(daily, '2026-03-04', 1, 'monday')[0].date, '2026-03-02');
});

test('recentSessions: n latest first, null last activity sorts last', () => {
  const ss = [{ id: 'a', last: '2026-01-01T00:00:00Z' }, { id: 'b', last: null }, { id: 'c', last: '2026-03-01T00:00:00Z' }, { id: 'd', last: '2026-02-01T00:00:00Z' }];
  assert.deepEqual(recentSessions(ss, 3).map(s => s.id), ['c', 'd', 'a']);
  assert.deepEqual(recentSessions(ss, 4).map(s => s.id), ['c', 'd', 'a', 'b']);
});

test('trayText: active with burn, without burn, none', () => {
  const active = { cost: 12.4, remainingMin: 130, burn: { tokensPerMin: 3100, costPerHour: 1 } };
  assert.equal(trayText(active), 'Active block · $12.40 · 2h 10m left · 3.1k tok/min');
  assert.equal(trayText({ ...active, burn: null }), 'Active block · $12.40 · 2h 10m left');
  assert.equal(trayText(null), 'No active block');
});

test('toCsv: header from labels, RFC 4180 quoting of comma, quote and newline', () => {
  const cols = [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }, { key: 'd', label: 'D' }];
  const csv = toCsv([{ a: 'x,y', b: 'he said "hi"', c: 'line\nbreak', d: 5 }, { a: 'plain', b: null, c: '', d: 0 }], cols);
  assert.equal(csv, 'A,B,C,D\r\n"x,y","he said ""hi""","line\nbreak",5\r\nplain,,,0');
});

test('shapeMain: a model breakdown with no cost field is unpriced; a literal 0 cost is not', () => {
  const raw = { daily: [{ period: '2026-01-01', agents: [], modelBreakdowns: [{ modelName: 'x', inputTokens: 10 }, { modelName: 'y', inputTokens: 5, cost: 0 }], inputTokens: 10, totalTokens: 10 }], session: [] };
  const r = shapeMain(raw, null);
  const [x, y] = r.daily[0].models;
  assert.deepEqual([x.cost, x.unpriced], [0, true]);
  assert.equal(y.unpriced, false);
  assert.deepEqual(r.unpriced, ['x']);
});

test('shapeBlocks: burn tokensPerMin prefers the indicator rate, then tokensPerMinute', () => {
  const burnRate = { costPerHour: 6, tokensPerMinute: 1400000, tokensPerMinuteForIndicator: 3100 };
  let { active } = shapeBlocks({ blocks: [rawBlock({ burnRate })] }, T('2026-01-01T12:00:00Z'));
  assert.deepEqual(active.burn, { tokensPerMin: 3100, costPerHour: 6 });
  delete burnRate.tokensPerMinuteForIndicator;
  ({ active } = shapeBlocks({ blocks: [rawBlock({ burnRate })] }, T('2026-01-01T12:00:00Z')));
  assert.equal(active.burn.tokensPerMin, 1400000);
});

test('toCsv: string fields starting with = + - @ get a leading apostrophe; numbers are untouched', () => {
  const csv = toCsv([{ name: '=HYPERLINK(1)', n: -5 }], [{ key: 'name', label: 'name' }, { key: 'n', label: 'n' }]);
  assert.equal(csv.split('\r\n')[1], "'=HYPERLINK(1),-5");
});

test('filterSessions: the range is compared in the given timezone, not in UTC', () => {
  const s = { id: 'a', agent: 'claude', title: 'T', models: [], last: '2026-11-12T01:00:00.000Z' }; // 20:00 on 11 Nov in New York
  const f = { since: '2026-11-11', until: '2026-11-11' };
  assert.equal(filterSessions([s], { ...f, timeZone: 'America/New_York' }).length, 1);
  assert.equal(filterSessions([s], { ...f, timeZone: 'UTC' }).length, 0);
  assert.equal(filterSessions([s], f).length, 0, 'no timezone given: UTC day');
});

// ---- machines ----

test('shapeSnapshot: accepts the expected shape only; names are cleaned and capped', () => {
  const snap = { v: 1, machine: '  Work\u0000-PC ' + 'x'.repeat(60), savedAt: 5, raw: { main: { daily: [rawDay('2026-01-01', { claude: 2 })], session: [] } } };
  const m = shapeSnapshot(snap);
  assert.equal(m.name.length, 40);
  assert.ok(m.name.startsWith('Work-PC'));
  assert.equal(m.savedAt, 5);
  assert.equal(m.daily[0].cost, 2);
  assert.deepEqual(m.projects, []);
  for (const bad of [null, 'x', [], {}, { v: 2, raw: { main: {} } }, { v: 1 }, { v: 1, raw: { main: null } }, { v: 1, raw: { main: { daily: 'nope' } } }]) assert.equal(shapeSnapshot(bad), null);
  assert.equal(shapeSnapshot({ v: 1, machine: 7, savedAt: 'x', raw: { main: {} } }).savedAt, null);
});

test('shapeMachines + mergeMachines: unique names, days summed per agent and model, rows tagged', () => {
  const shaped = (spec, session) => shapeMain({ daily: Object.entries(spec).map(([p, c]) => rawDay(p, c)), session });
  const sess = (id, last) => ({ period: id, agent: 'codex', totalCost: 1, metadata: { lastActivity: last }, modelBreakdowns: [] });
  const local = { name: 'Home', savedAt: 1, ...shaped({ '2026-01-01': { claude: 1 }, '2026-01-02': { claude: 2, codex: 3 } }, [sess('a', '2026-01-02T00:00:00Z')]), projects: [{ key: 'K', name: 'k', daily: [] }] };
  const snap = (machine, spec) => ({ v: 1, machine, savedAt: 9, raw: { main: { daily: Object.entries(spec).map(([p, c]) => rawDay(p, c)), session: [sess('b', '2026-01-03T00:00:00Z')] } } });
  const machines = shapeMachines(local, [snap('Home', { '2026-01-02': { claude: 10 }, '2026-01-03': { codex: 5 } }), { junk: true }, snap('Home', {})]);
  assert.deepEqual(machines.map(m => [m.name, m.local]), [['Home', true], ['Home (2)', false], ['Home (3)', false]]);

  const all = mergeMachines(machines);
  assert.deepEqual(all.daily.map(r => [r.period, r.cost]), [['2026-01-01', 1], ['2026-01-02', 15], ['2026-01-03', 5]]);
  const day2 = all.daily[1];
  assert.deepEqual(day2.agents.map(a => [a.agent, a.cost]), [['claude', 12], ['codex', 3]]);
  assert.deepEqual(day2.models.map(m => [m.name, m.cost]), [['claude-model', 12], ['codex-model', 3]]);
  assert.equal(day2.tokens, 1500);
  assert.deepEqual(all.sessions.map(s => [s.id, s.machine]), [['b', 'Home (2)'], ['b', 'Home (3)'], ['a', 'Home']]);
  assert.deepEqual(all.agents, ['claude', 'codex']);
  assert.deepEqual(all.projects.map(p => [p.key, p.machine]), [['K', 'Home']]);
  assert.deepEqual(filterDaily(all.daily, { agent: 'codex' }).map(r => r.cost), [3, 5]);

  const one = mergeMachines([machines[0]]);
  assert.deepEqual(one.daily.map(r => r.cost), local.daily.map(r => r.cost));

  const t = machineTotals(machines.slice(0, 2), ['2026-01-02', '2026-01-03']);
  assert.deepEqual(t.map(m => [m.name, m.cost, m.sessions, m.days, m.values]), [['Home', 6, 1, 2, [5, 0]], ['Home (2)', 15, 1, 2, [10, 5]]]);
  assert.ok(Math.abs(t[0].share - 6 / 21) < 1e-9);
});
