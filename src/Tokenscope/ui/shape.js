// View models: turn ccusage JSON into the Rows, Sessions and Blocks every screen renders from.
// Pure; no DOM. Raw engine spellings are normalised once here (normUsage/normModel/normRow);
// everything else works on Rows. Dates 'YYYY-MM-DD' are handled in UTC so the PC's timezone
// cannot shift a day; callers pass `today` already resolved in the user's timezone.
import { money, duration, tokens as tokenCount } from './format.js';

const DAY_MS = 864e5;
const MIN_MS = 6e4;
const USAGE = ['input', 'output', 'cacheWrite', 'cacheRead', 'tokens', 'cost'];

// ---- normalisation ----

const num = (...vs) => {
  for (const v of vs) if (v != null && Number.isFinite(+v)) return +v;
  return 0;
};
const modelName = m => m.modelName ?? m.model ?? m.name ?? 'unknown';

function normUsage(r) {
  const tc = r.tokenCounts ?? {};
  const input = num(r.inputTokens, tc.inputTokens);
  const output = num(r.outputTokens, tc.outputTokens);
  const cacheWrite = num(r.cacheCreationTokens, r.cacheCreationInputTokens, tc.cacheCreationInputTokens);
  const cacheRead = num(r.cacheReadTokens, r.cacheReadInputTokens, tc.cacheReadInputTokens);
  return {
    input, output, cacheWrite, cacheRead,
    tokens: num(r.totalTokens, input + output + cacheWrite + cacheRead),
    cost: num(r.totalCost, r.costUSD, r.cost),
  };
}

// Absent cost fields mean the engine could not price the model.
const noCost = m => [m.cost, m.costUSD, m.totalCost].every(v => v == null);
const isUnpriced = (m, unpriced) => m.missingPricing === true || noCost(m) || unpriced.has(modelName(m));

function normModel(m, unpriced) {
  const name = modelName(m);
  return { ...normUsage(m), name, unpriced: isUnpriced(m, unpriced) };
}

const normModels = (r, unpriced) => (r.modelBreakdowns ?? []).map(m => normModel(m, unpriced));

function normRow(r, unpriced = new Set()) {
  return {
    ...normUsage(r),
    period: r.period ?? r.date,
    models: normModels(r, unpriced),
    agents: (r.agents ?? []).map(a => ({ ...normUsage(a), agent: a.agent, models: normModels(a, unpriced) })),
  };
}

// ---- small helpers ----

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byPeriod = (a, b) => cmp(a.period, b.period);
const byCostDesc = (a, b) => b.cost - a.cost;
const byLastDesc = (a, b) => cmp(b.last ?? '', a.last ?? '');
const zero = () => Object.fromEntries(USAGE.map(f => [f, 0]));
const add = (acc, u) => {
  for (const f of USAGE) acc[f] += u[f];
  return acc;
};
const inRange = (day, since, until) => (!since || day >= since) && (!until || day <= until);

const dayMs = d => Date.parse(`${d}T00:00:00Z`);
const isoDay = ms => new Date(ms).toISOString().slice(0, 10);
const addDays = (d, n) => isoDay(dayMs(d) + n * DAY_MS);
const weekOf = (d, weekStart) => addDays(d, -((new Date(dayMs(d)).getUTCDay() + (weekStart === 'monday' ? 6 : 0)) % 7));

function mergeModels(models) {
  return [...Map.groupBy(models, m => m.name)]
    .map(([name, ms]) => ({ ...ms.reduce(add, zero()), name, unpriced: ms.some(m => m.unpriced) }))
    .sort(byCostDesc);
}

// ---- engine output ----

export function prettyProject(key) {
  const rest = key
    .replace(/^[A-Za-z]--/, '')
    .replace(/^Users-[^-]+-/, '')
    .replace(/^(Downloads|Documents|Desktop)-/, '');
  if (rest.startsWith('AppData-')) return 'Claude workspace';
  return rest || key;
}

export function shapeMain(raw, claudeSessionsRaw) {
  const dayRows = raw?.daily ?? [];
  const sessionRows = raw?.session ?? [];
  const unpriced = new Set(raw?.totals?.unpricedModels ?? []);
  for (const r of [...dayRows, ...dayRows.flatMap(d => d.agents ?? []), ...sessionRows]) {
    for (const m of r.modelBreakdowns ?? []) if (isUnpriced(m, unpriced)) unpriced.add(modelName(m));
  }
  const projectOf = new Map((claudeSessionsRaw?.sessions ?? []).map(s => [s.sessionId, s.projectPath]));

  const daily = dayRows.map(r => normRow(r, unpriced)).sort(byPeriod);
  const sessions = sessionRows.map(r => {
    const projectKey = (r.agent === 'claude' && projectOf.get(r.period)) || null;
    return {
      ...normUsage(r),
      id: r.period,
      agent: r.agent,
      last: r.metadata?.lastActivity ?? null,
      models: normModels(r, unpriced),
      projectKey,
      title: projectKey ? prettyProject(projectKey) : r.agent.charAt(0).toUpperCase() + r.agent.slice(1),
    };
  }).sort(byLastDesc);
  const agents = [...new Set([...daily.flatMap(d => d.agents.map(a => a.agent)), ...sessions.map(s => s.agent)])].sort();
  return { daily, sessions, agents, unpriced: [...unpriced].sort() };
}

function shapeBlock(b, nowMs) {
  const u = normUsage(b);
  const startMs = Date.parse(b.startTime);
  const endMs = Date.parse(b.endTime);
  const elapsedMin = Math.min(Math.max(0, (nowMs - startMs) / MIN_MS), (endMs - startMs) / MIN_MS);
  const remainingMin = Math.max(0, (endMs - nowMs) / MIN_MS);

  let burn = null;
  if (b.burnRate) {
    burn = { tokensPerMin: num(b.burnRate.tokensPerMinuteForIndicator, b.burnRate.tokensPerMinute), costPerHour: num(b.burnRate.costPerHour) };
  } else if (b.isActive && elapsedMin > 0) { // no rate before any time has elapsed
    burn = { tokensPerMin: u.tokens / elapsedMin, costPerHour: (u.cost * 60) / elapsedMin };
  }
  let projection = null;
  if (b.projection) {
    projection = { tokens: num(b.projection.totalTokens), cost: num(b.projection.totalCost) };
  } else if (burn) {
    projection = { tokens: u.tokens + burn.tokensPerMin * remainingMin, cost: u.cost + (burn.costPerHour * remainingMin) / 60 };
  }
  // Present only when the engine ran with --token-limit.
  const limit = b.tokenLimitStatus?.limit ?? null;

  return {
    ...u,
    id: b.id,
    start: b.startTime,
    end: b.endTime,
    actualEnd: b.actualEndTime ?? null,
    isActive: !!b.isActive,
    isGap: !!b.isGap,
    modelNames: b.models ?? [],
    elapsedMin,
    remainingMin,
    burn,
    projection,
    limit,
    limitShare: limit ? u.tokens / limit : null,
  };
}

export function shapeBlocks(raw, nowMs) {
  const blocks = (raw?.blocks ?? []).map(b => shapeBlock(b, nowMs)).sort((a, b) => cmp(b.start, a.start));
  return { active: blocks.find(b => b.isActive) ?? null, blocks };
}

export function shapeProjects(raw) {
  return Object.entries(raw?.projects ?? {}).map(([key, rows]) => ({
    key,
    name: prettyProject(key),
    daily: rows.map(r => normRow(r)).sort(byPeriod),
  }));
}

// ---- filters and derived views ----

export function filterDaily(daily, { agent = 'all', since = null, until = null } = {}) {
  const out = [];
  for (const r of daily) {
    if (!inRange(r.period, since, until)) continue;
    if (agent === 'all') {
      out.push(r);
      continue;
    }
    const slice = r.agents.find(a => a.agent === agent);
    if (slice) {
      const { agent: _, ...usage } = slice;
      out.push({ ...usage, period: r.period, agents: [slice] });
    }
  }
  return out;
}

// Day of an instant in an IANA timezone ('YYYY-MM-DD'); UTC when no (or an unknown) zone is given.
const dayFormats = new Map();
function dayIn(iso, timeZone) {
  if (!timeZone || timeZone === 'UTC') return iso.slice(0, 10);
  try {
    if (!dayFormats.has(timeZone)) dayFormats.set(timeZone, new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }));
    return dayFormats.get(timeZone).format(new Date(iso));
  } catch { return iso.slice(0, 10); }
}

// since/until are days in the user's timezone; pass that zone as timeZone so an evening session
// (already "tomorrow" in UTC) still counts as today.
export function filterSessions(sessions, { agent = 'all', since = null, until = null, query = '', timeZone = null } = {}) {
  const q = (query || '').trim().toLowerCase();
  return sessions.filter(s =>
    (agent === 'all' || s.agent === agent)
    && (!(since || until) || (s.last && inRange(dayIn(s.last, timeZone), since, until)))
    && (!q || [s.title, s.id, s.agent, ...s.models.map(m => m.name)].some(t => t.toLowerCase().includes(q))));
}

export function totals(rows) {
  return { ...rows.reduce(add, zero()), models: mergeModels(rows.flatMap(r => r.models)) };
}

// Period label: month 'YYYY-MM'; week the ISO date of its first day.
export function aggregate(daily, unit, weekStart) {
  const groups = Map.groupBy(daily, r => (unit === 'month' ? r.period.slice(0, 7) : weekOf(r.period, weekStart)));
  return [...groups].map(([period, rows]) => ({
    ...totals(rows),
    period,
    agents: [...Map.groupBy(rows.flatMap(r => r.agents), a => a.agent)].map(([agent, list]) => ({ ...totals(list), agent })),
  })).sort(byPeriod);
}

// Current period (to date) against the whole previous one; delta is a fraction (0.5 = +50%).
export function periodStats(daily, today, weekStart) {
  const sum = (from, to) => daily.filter(r => inRange(r.period, from, to)).reduce(add, zero());
  const stat = (from, to, prevFrom, prevTo) => {
    const cur = sum(from, to);
    const prevCost = sum(prevFrom, prevTo).cost;
    return { cost: cur.cost, tokens: cur.tokens, prevCost, delta: prevCost ? (cur.cost - prevCost) / prevCost : null };
  };
  const yesterday = addDays(today, -1);
  const week = weekOf(today, weekStart);
  const [y, m] = today.split('-').map(Number);
  const month = isoDay(Date.UTC(y, m - 1, 1));
  return {
    today: stat(today, today, yesterday, yesterday),
    week: stat(week, addDays(week, 6), addDays(week, -7), addDays(week, -1)),
    month: stat(month, addDays(isoDay(Date.UTC(y, m, 1)), -1), isoDay(Date.UTC(y, m - 2, 1)), addDays(month, -1)),
  };
}

export function agentSeries(daily) {
  const agents = [...new Set(daily.flatMap(r => r.agents.map(a => a.agent)))].sort();
  return {
    labels: daily.map(r => r.period),
    series: agents.map(agent => ({ agent, values: daily.map(r => r.agents.find(a => a.agent === agent)?.cost ?? 0) })),
  };
}

export function modelSplit(rows) {
  const models = totals(rows).models;
  const all = models.reduce((s, m) => s + m.cost, 0);
  return models.map(({ name, cost, tokens, unpriced }) => ({ name, cost, tokens, share: all ? cost / all : 0, unpriced }));
}

// weekStart is optional (default 'sunday') so the grid can follow the user's week setting.
export function heatmapCells(daily, today, weeks, weekStart = 'sunday') {
  const start = addDays(weekOf(today, weekStart), -7 * (weeks - 1));
  const costOn = new Map(daily.map(r => [r.period, r.cost]));
  const cells = Array.from({ length: weeks * 7 }, (_, i) => {
    const date = addDays(start, i);
    return { date, cost: costOn.get(date) ?? 0 };
  });
  const nonZero = cells.map(c => c.cost).filter(c => c > 0).sort((a, b) => a - b);
  const quantile = p => nonZero[Math.ceil(p * nonZero.length) - 1];
  const cuts = [quantile(0.25), quantile(0.5), quantile(0.75)];
  return cells.map(c => ({ ...c, level: c.cost > 0 ? 1 + cuts.filter(t => c.cost > t).length : 0 }));
}

// Projects with no rows in range are left out.
export function projectTotals(projects, { since = null, until = null } = {}) {
  const list = projects
    .map(p => ({ ...p, daily: filterDaily(p.daily, { since, until }) }))
    .filter(p => p.daily.length)
    .map(p => {
      const t = p.daily.reduce(add, zero());
      return { ...p, cost: t.cost, tokens: t.tokens };
    });
  const all = list.reduce((s, p) => s + p.cost, 0);
  return list.map(p => ({ ...p, share: all ? p.cost / all : 0 })).sort(byCostDesc);
}

export function recentSessions(sessions, n) {
  return [...sessions].sort(byLastDesc).slice(0, n);
}

export function trayText(active) {
  if (!active) return 'No active block';
  const parts = ['Active block', money(active.cost), `${duration(active.remainingMin)} left`];
  if (active.burn) parts.push(`${tokenCount(active.burn.tokensPerMin)} tok/min`);
  return parts.join(' · ');
}

const csvField = v => {
  let s = v == null ? '' : String(v);
  if (typeof v === 'string' && /^[=+\-@]/.test(s)) s = `'${s}`; // spreadsheet formula guard
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export function toCsv(rows, columns) {
  return [columns.map(c => c.label), ...rows.map(r => columns.map(c => r[c.key]))]
    .map(line => line.map(csvField).join(','))
    .join('\r\n');
}

// ---- board layout (Overview's movable cards) ----
// The saved layout is a preference from localStorage: unknown ids are dropped, missing cards are
// appended in their default order and spans outside the grid fall back to the default. Returns
// fresh objects, so the caller may change them while the user drags.
export function boardLayout(defaults, saved, maxRows = 6) {
  const left = new Map(defaults.map(c => [c.id, c]));
  const span = (v, max, fallback) => (Number.isInteger(v) && v >= 1 && v <= max ? v : fallback);
  const out = [];
  for (const c of Array.isArray(saved) ? saved : []) {
    const d = left.get(c?.id);
    if (!d) continue;
    left.delete(d.id);
    out.push({ id: d.id, w: span(c.w, 4, d.w), h: span(c.h, maxRows, d.h) });
  }
  return [...out, ...[...left.values()].map(c => ({ ...c }))];
}

// ---- machines (sync folder) ----
// Each PC writes a snapshot {v, machine, savedAt, raw:{main, sessions, projects}} into the shared
// folder. Snapshots from other PCs are untrusted files: shapeSnapshot accepts only the expected
// shape and everything inside goes through the same normalisation as local engine output.

export const SNAPSHOT_VERSION = 1;
const MAX_DATE_MS = 8.64e15;   // the largest instant a Date can hold
const cleanName = v => String(v ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40);

export function shapeSnapshot(snap) {
  if (snap?.v !== SNAPSHOT_VERSION || typeof snap.raw?.main !== 'object' || snap.raw.main === null) return null;
  try {
    return {
      name: cleanName(snap.machine) || 'Unnamed PC',
      savedAt: Number.isFinite(snap.savedAt) && Math.abs(snap.savedAt) <= MAX_DATE_MS ? snap.savedAt : null,   // must survive new Date()
      ...shapeMain(snap.raw.main, snap.raw.sessions),
      projects: shapeProjects(snap.raw.projects),
    };
  } catch { return null; }   // a malformed file is skipped, never fatal
}

// local: {name, savedAt, daily, sessions, agents, unpriced, projects}. Names are made unique so a
// name is a safe filter key; unreadable snapshots are dropped.
export function shapeMachines(local, snapshots = []) {
  const taken = new Set();
  return [{ ...local, name: cleanName(local.name) || 'This PC', local: true }, ...snapshots.map(shapeSnapshot).filter(Boolean).map(m => ({ ...m, local: false }))]
    .map(m => {
      const base = m.name.toLowerCase() === 'all' ? `${m.name} (PC)` : m.name;   // 'all' is the filter's "every PC" value
      let name = base;
      for (let n = 2; taken.has(name); n++) name = `${base} (${n})`;
      taken.add(name);
      return { ...m, name };
    });
}

// One combined view model. Sessions and projects keep the machine they came from.
export function mergeMachines(machines) {
  const daily = [...Map.groupBy(machines.flatMap(m => m.daily), r => r.period)].map(([period, rows]) => ({
    ...rows.reduce(add, zero()),
    period,
    models: mergeModels(rows.flatMap(r => r.models)),
    agents: [...Map.groupBy(rows.flatMap(r => r.agents), a => a.agent)]
      .map(([agent, list]) => ({ ...list.reduce(add, zero()), agent, models: mergeModels(list.flatMap(a => a.models)) }))
      .sort((a, b) => cmp(a.agent, b.agent)),
  })).sort(byPeriod);
  return {
    daily,
    sessions: machines.flatMap(m => m.sessions.map(s => ({ ...s, machine: m.name }))).sort(byLastDesc),
    agents: [...new Set(machines.flatMap(m => m.agents))].sort(),
    unpriced: [...new Set(machines.flatMap(m => m.unpriced))].sort(),
    projects: machines.flatMap(m => m.projects.map(p => ({ ...p, machine: m.name }))),
  };
}

// Per-machine totals and a cost series over `labels` (ISO days) for the Machines screen.
export function machineTotals(machines, labels = []) {
  const list = machines.map(m => {
    const costOn = new Map(m.daily.map(r => [r.period, r.cost]));
    const t = m.daily.reduce(add, zero());
    return { name: m.name, local: m.local, savedAt: m.savedAt, cost: t.cost, tokens: t.tokens, sessions: m.sessions.length, days: m.daily.length, values: labels.map(d => costOn.get(d) ?? 0) };
  });
  const all = list.reduce((s, m) => s + m.cost, 0);
  return list.map(m => ({ ...m, share: all ? m.cost / all : 0 }));
}
