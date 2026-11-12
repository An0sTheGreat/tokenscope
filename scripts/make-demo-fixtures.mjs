// Writes tests/fixtures/*.json: synthetic ccusage output in the exact shapes the engine prints
// (see tests/fixtures/README.md). Deterministic for a given `now`, and contains no real usage.
//   node scripts/make-demo-fixtures.mjs [now-as-ISO]
import { writeFileSync } from 'node:fs';

const NOW = new Date(process.argv[2] ?? '2026-11-12T14:00:00.000Z');
const DAYS = 120;
const DAY = 864e5, HOUR = 36e5;

let seed = 20261112;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const int = (a, b) => Math.floor(a + rnd() * (b - a + 1));
const pick = xs => xs[int(0, xs.length - 1)];
const uuid = () => 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => int(0, 15).toString(16));
const iso = ms => new Date(ms).toISOString();
const day = ms => iso(ms).slice(0, 10);

// USD per million tokens: [input, output, cache write, cache read]. Invented for the demo.
const PRICE = {
  'claude-opus-5-5': [5, 25, 6.25, 0.5], 'claude-sonnet-5-5': [3, 15, 3.75, 0.3], 'claude-haiku-5-5': [1, 5, 1.25, 0.1],
  'gpt-6-sol': [1.25, 10, 0, 0.125], 'gpt-5.6-luna': [0.25, 2, 0, 0.025],
};
const MODELS = { claude: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'], codex: ['gpt-6-sol', 'gpt-5.6-luna'] };
const PROJECTS = ['atlas-api', 'storefront-web', 'ledger-service', 'mobile-app', 'data-pipeline', 'docs-site', 'infra-terraform', 'design-system']
  .map(n => `C--Users-dev-Documents-${n}`);

const FIELDS = ['inputTokens', 'outputTokens', 'cacheCreationTokens', 'cacheReadTokens'];
function breakdown(agent, modelName, scale) {
  const claude = agent === 'claude';
  const outputTokens = int(2e3, 6e4) * scale;
  const b = {
    cacheCreationTokens: claude ? int(2e4, 4e5) * scale : 0,
    cacheReadTokens: int(5e5, 9e6) * scale,
    inputTokens: claude ? int(20, 900) * scale : int(4e4, 5e5) * scale,
    modelName, outputTokens,
  };
  if (claude) b.cacheCreation1hTokens = Math.floor(b.cacheCreationTokens * rnd());
  const [i, o, w, r] = PRICE[modelName];
  b.cost = (b.inputTokens * i + outputTokens * o + b.cacheCreationTokens * w + b.cacheReadTokens * r) / 1e6;
  return b;
}
// Sums breakdowns (merged by model) into one engine-style usage row.
function usage(breakdowns, { always1h = false } = {}) {
  const byModel = new Map();
  for (const b of breakdowns) {
    const m = byModel.get(b.modelName) ?? byModel.set(b.modelName, { cacheCreationTokens: 0, cacheReadTokens: 0, cost: 0, inputTokens: 0, modelName: b.modelName, outputTokens: 0 }).get(b.modelName);
    for (const f of [...FIELDS, 'cost']) m[f] += b[f];
    if (b.cacheCreation1hTokens != null || always1h) m.cacheCreation1hTokens = (m.cacheCreation1hTokens ?? 0) + (b.cacheCreation1hTokens ?? 0);
  }
  const modelBreakdowns = [...byModel.values()];
  const row = { modelBreakdowns, modelsUsed: modelBreakdowns.map(m => m.modelName).sort() };
  for (const f of FIELDS) row[f] = modelBreakdowns.reduce((s, m) => s + m[f], 0);
  row.totalCost = modelBreakdowns.reduce((s, m) => s + m.cost, 0);
  row.totalTokens = FIELDS.reduce((s, f) => s + row[f], 0);
  return row;
}
const totals = rows => {
  const t = Object.fromEntries([...FIELDS, 'totalCost', 'totalTokens'].map(f => [f, rows.reduce((s, r) => s + r[f], 0)]));
  return t;
};

// ---- sessions: the unit everything else is summed from ----
const todayStart = Date.parse(`${day(NOW.getTime())}T00:00:00Z`);
const sessions = [];
for (let d = DAYS - 1; d >= 0; d--) {
  const start = todayStart - d * DAY;
  const weekend = [0, 6].includes(new Date(start).getUTCDay());
  const ramp = 0.5 + (DAYS - d) / DAYS;                       // usage grows over the period
  if (rnd() < (weekend ? 0.6 : 0.08)) continue;               // days off
  for (const agent of ['claude', 'codex']) {
    if (rnd() > (agent === 'claude' ? 0.85 : 0.45)) continue;
    for (let n = int(1, agent === 'claude' ? 4 : 2); n > 0; n--) {
      const last = d === 0 ? NOW.getTime() - int(2, 110) * 6e4 : start + int(9 * 60, 23 * 60) * 6e4 + int(0, 59999);
      const models = MODELS[agent].filter((_, i) => i === 0 ? rnd() < 0.75 : rnd() < 0.5);
      if (!models.length) models.push(MODELS[agent][1]);
      const scale = Math.ceil(ramp * int(1, rnd() < 0.12 ? 14 : 5));
      sessions.push({
        agent, last, day: day(last), project: agent === 'claude' ? PROJECTS[Math.floor(rnd() ** 2 * PROJECTS.length)] : null,
        id: agent === 'claude' ? uuid() : `${day(last).replaceAll('-', '/')}/rollout-${iso(last).slice(0, 19).replaceAll(':', '-')}-${uuid()}`,
        breakdowns: models.map(m => breakdown(agent, m, scale)),
      });
    }
  }
}

const group = (xs, key) => xs.reduce((m, x) => (m.get(key(x)) ?? m.set(key(x), []).get(key(x))).push(x) && m, new Map());
const all = xs => xs.flatMap(s => s.breakdowns);

// ---- main.json ----
const daily = [...group(sessions, s => s.day)].sort(([a], [b]) => a.localeCompare(b)).map(([period, ss]) => {
  const agents = [...group(ss, s => s.agent)].sort(([a], [b]) => a.localeCompare(b)).map(([agent, xs]) => ({ agent, ...usage(all(xs)) }));
  return { agent: 'all', agents, ...usage(all(ss)), metadata: { agents: agents.map(a => a.agent) }, period };
});
const session = sessions.map(s => ({
  agent: s.agent, ...usage(s.breakdowns), period: s.id,
  metadata: { lastActivity: iso(s.last), ...(s.agent === 'codex' ? { reasoningOutputTokens: int(1e3, 9e4) } : {}) },
})).sort(() => rnd() - 0.5);
const main = { daily, session, totals: totals(daily) };

// ---- claude-sessions.json and projects.json ----
const claude = sessions.filter(s => s.agent === 'claude');
const claudeRows = claude.map(s => ({
  ...usage(s.breakdowns, { always1h: true }), firstActivity: iso(s.last - int(10, 240) * 6e4), lastActivity: iso(s.last),
  projectPath: s.project, sessionId: s.id,
}));
const projects = Object.fromEntries([...group(claude, s => s.project)].map(([project, ss]) =>
  [project, [...group(ss, s => s.day)].sort(([a], [b]) => a.localeCompare(b)).map(([date, xs]) => ({ ...usage(all(xs), { always1h: true }), date, project }))]));

// ---- blocks.json: one 5-hour block per claude session, gaps between, the last one active ----
const zeroCounts = { cacheCreationInputTokens: 0, cacheReadInputTokens: 0, inputTokens: 0, outputTokens: 0 };
const blocks = [];
const byBlock = [...group(claude, s => Math.floor(s.last / (5 * HOUR)))].sort(([a], [b]) => a - b);
byBlock.forEach(([slot, ss], i) => {
  const startTime = slot * 5 * HOUR, endTime = startTime + 5 * HOUR;
  const isActive = i === byBlock.length - 1 && NOW.getTime() < endTime;
  const u = usage(all(ss));
  const actualEnd = Math.max(...ss.map(s => s.last));
  const prev = blocks.at(-1);
  if (prev && startTime - Date.parse(prev.endTime) >= 5 * HOUR) {
    const from = prev.actualEndTime;
    blocks.push({ actualEndTime: null, burnRate: null, costUSD: 0, endTime: iso(startTime), entries: 0, id: `gap-${from}`, isActive: false, isGap: true, models: [], projection: null, startTime: from, tokenCounts: zeroCounts, totalTokens: 0 });
  }
  const minutes = Math.max(1, (actualEnd - startTime) / 6e4);
  const left = Math.max(0, Math.round((endTime - NOW.getTime()) / 6e4));
  blocks.push({
    actualEndTime: iso(actualEnd),
    burnRate: isActive ? { costPerHour: u.totalCost / minutes * 60, tokensPerMinute: u.totalTokens / minutes, tokensPerMinuteForIndicator: (u.inputTokens + u.outputTokens) / minutes } : null,
    costUSD: u.totalCost, endTime: iso(endTime), entries: int(20, 600), id: iso(startTime), isActive, isGap: false, models: u.modelsUsed,
    projection: isActive ? { remainingMinutes: left, totalCost: +(u.totalCost * (1 + left / minutes)).toFixed(2), totalTokens: Math.round(u.totalTokens * (1 + left / minutes)) } : null,
    startTime: iso(startTime),
    tokenCounts: { cacheCreationInputTokens: u.cacheCreationTokens, cacheReadInputTokens: u.cacheReadTokens, inputTokens: u.inputTokens, outputTokens: u.outputTokens },
    totalTokens: u.totalTokens,
  });
});

const out = { 'main.json': main, 'claude-sessions.json': { sessions: claudeRows, totals: totals(claudeRows) }, 'projects.json': { projects, totals: totals(Object.values(projects).flat()) }, 'blocks.json': { blocks } };
for (const [name, data] of Object.entries(out)) writeFileSync(new URL(`../tests/fixtures/${name}`, import.meta.url), JSON.stringify(data, null, 1) + '\n');
console.log(`${daily.length} days, ${session.length} sessions, ${blocks.length} blocks, $${main.totals.totalCost.toFixed(2)}, active block: ${blocks.some(b => b.isActive)}`);
