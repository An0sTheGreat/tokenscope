// App shell: settings, data loading, filters, routing and the frame every view renders into.
// Views never call the engine; they render from the ctx this file builds (see docs/DESIGN.md).

import { h, transition, openSheet, closeSheet } from './dom.js';
import * as bridge from './bridge.js';
import { engineArgs } from './args.js';
import { shapeMain, shapeBlocks, shapeProjects, shapeMachines, mergeMachines, SNAPSHOT_VERSION, filterDaily, filterSessions, projectTotals, trayText, toCsv } from './shape.js';
import { relative } from './format.js';
import { icon, agentLabel, agentColor, segmented, chip, empty, toolbar, addDays, RANGES, rangeLabel } from './kit.js';
import * as overview from './views/overview.js';
import * as reports from './views/reports.js';
import * as sessions from './views/sessions.js';
import * as blocks from './views/blocks.js';
import * as projects from './views/projects.js';
import * as machines from './views/machines.js';
import * as settingsView from './views/settings.js';

const VIEWS = [overview, reports, sessions, blocks, projects, machines, settingsView];
const DEFAULTS = { theme: 'system', timezone: '', costMode: 'auto', offline: false, weekStart: 'sunday', tokenLimit: '', refreshSec: 60, closeToTray: true, machineName: '' };
const ENGINE_KEYS = ['timezone', 'costMode', 'offline', 'tokenLimit'];
const DOCS_URL = 'https://ccusage.com/guide/';

// localStorage is a convenience only: every read and write may fail and the app must still work.
const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const persist = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch {   // quota or disabled storage: preferences keep their last saved value, a stale cache is dropped
    if (key === 'tokenscope.cache') try { localStorage.removeItem(key); } catch { /* storage disabled */ }
  }
};

const settings = { ...DEFAULTS, ...load('tokenscope.settings', {}) };
const filter = { agent: 'all', machine: 'all', preset: '30d', since: null, until: null, ...load('tokenscope.filter', {}) };
let raw = null;          // last good engine payloads {main, sessions, blocks, projects}
let all = null;          // shaped, unfiltered view models (merged over the machines the filter selects)
let sync = { folder: null, machine: '' };   // host state: the sync folder (null = off) and this PC's Windows name
let remote = [];         // other PCs' snapshots from the sync folder, as read (untrusted)
let syncError = null;
let error = null;
let errorPartial = false;   // main data is fresh; only blocks or projects failed
let renderFailed = false;   // the error on screen is a display failure, cleared by the next good render
let loading = false;
let loadingBlocks = false;
let updatedAt = 0;
const knownView = id => (VIEWS.some(v => v.id === id) ? id : null);
let viewId = knownView(location.hash.slice(1)) ?? knownView(load('tokenscope.view', null)) ?? 'overview';
let params = null;       // one-shot navigation parameters
let viewRoot = null;
let blocksTimer = 0;

const $ = id => document.getElementById(id);
const currentView = () => VIEWS.find(v => v.id === viewId) ?? VIEWS[0];
const CACHE_VERSION = 1;   // bump when the shape of the cached payloads or of shape.js output changes
const settingsKey = () => JSON.stringify([CACHE_VERSION, ...ENGINE_KEYS.map(k => settings[k])]);

function today() {
  try { return new Intl.DateTimeFormat('en-CA', settings.timezone ? { timeZone: settings.timezone } : {}).format(new Date()); }
  catch { return new Intl.DateTimeFormat('en-CA').format(new Date()); }
}

function range() {
  const t = today();
  switch (filter.preset) {
    case '7d': return { since: addDays(t, -6), until: t };
    case '30d': return { since: addDays(t, -29), until: t };
    case '90d': return { since: addDays(t, -89), until: t };
    case 'month': return { since: `${t.slice(0, 8)}01`, until: t };
    case 'all': return { since: null, until: null };
    default: return { since: filter.since, until: filter.until };
  }
}

const localName = () => settings.machineName || sync.machine || 'This PC';

// Blocks and the tray always describe this PC: another PC's snapshot is only as fresh as its last refresh.
function shape() {
  const local = { name: localName(), savedAt: updatedAt, ...shapeMain(raw.main, raw.sessions), projects: shapeProjects(raw.projects) };
  const list = shapeMachines(local, sync.folder ? remote : []);
  const machine = list.some(m => m.name === filter.machine) ? filter.machine : 'all';   // a PC that is gone falls back to all
  all = { ...mergeMachines(list.filter(m => machine === 'all' || m.name === machine)), ...shapeBlocks(raw.blocks, Date.now()), machines: list, machine };
  if (filter.agent !== 'all' && !all.agents.includes(filter.agent)) filter.agent = 'all';
}

function ctx(animate = false) {
  const r = range();
  const f = { agent: filter.agent, ...r };
  const timeZone = settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  return {
    vm: all && {
      daily: filterDaily(all.daily, f), sessions: filterSessions(all.sessions, { ...f, timeZone }), agents: all.agents, unpriced: all.unpriced,
      blocks: all.blocks, active: all.active, projects: projectTotals(all.projects, r), all,
      // every PC, whatever the machine filter says: the Machines screen makes its own selection
      machines: all.machines.map(m => ({ ...m, daily: filterDaily(m.daily, f), sessions: filterSessions(m.sessions, { ...f, timeZone }) })),
    },
    sync: { ...sync, error: syncError },
    filter: { ...filter, machine: all?.machine ?? 'all', ...r }, settings, today: today(), nowMs: Date.now(),
    status: { loading, error, updatedAt }, animate, actions,
  };
}

// ---- data ----

async function loadAll() {
  if (loading) return;
  loading = true;
  paintStatus();
  const key = settingsKey();
  const a = engineArgs(settings);
  const [main, sess, blk, proj] = await Promise.allSettled([bridge.run(a.main), bridge.run(a.sessions), bridge.run(a.blocks), bridge.run(a.projects)]);
  const first = !all;
  if (main.status === 'fulfilled') {
    raw = {
      main: main.value,
      sessions: sess.status === 'fulfilled' ? sess.value : null,   // only costs project names
      blocks: blk.status === 'fulfilled' ? blk.value : raw?.blocks ?? { blocks: [] },
      projects: proj.status === 'fulfilled' ? proj.value : raw?.projects ?? { projects: {} },
    };
    const failed = [blk, proj].find(r => r.status === 'rejected');
    error = failed ? messageOf(failed.reason) : null;
    errorPartial = !!failed;
    updatedAt = Date.now();
    await syncReady;
    await exchange(true);
    shape();
    pushTray();
  } else {
    error = messageOf(main.reason);
    errorPartial = false;
    if (all && blk.status === 'fulfilled') {   // the tray meter still follows the live block
      raw.blocks = blk.value;
      Object.assign(all, shapeBlocks(raw.blocks, Date.now()));
      pushTray();
    }
  }
  loading = false;
  // Cache only what rendered: a payload that breaks a view must never be shown again at start-up.
  if (safeRender(first) && main.status === 'fulfilled') persist('tokenscope.cache', { key, savedAt: updatedAt, raw });
  if (key !== settingsKey()) loadAll();   // a setting changed while loading
}

async function loadBlocks() {
  if (loading || loadingBlocks || !raw) return;
  loadingBlocks = true;
  const key = settingsKey();
  try {
    const fresh = await bridge.run(engineArgs(settings).blocks);
    if (key !== settingsKey() || loading) throw new Error('superseded');   // settings changed or a full load took over
    raw.blocks = fresh;
    Object.assign(all, shapeBlocks(raw.blocks, Date.now()));
    updatedAt = Date.now();
    pushTray();
    if (viewRoot?.isConnected) currentView().renderLive?.(viewRoot, ctx(false));
  } catch { /* the next tick or a manual refresh retries; the last block stays on screen */ }
  loadingBlocks = false;
  paintStatus();
}

// Writes this PC's snapshot (when asked and there is data) and reads the others. A sync failure never
// blocks local data: it is reported in Settings and the last snapshots read stay in use.
async function exchange(write) {
  if (!sync.folder) { remote = []; syncError = null; return; }
  try {
    const content = write && raw ? JSON.stringify({ v: SNAPSHOT_VERSION, machine: localName(), savedAt: updatedAt, raw: { main: raw.main, sessions: raw.sessions, projects: raw.projects } }) : null;
    const got = await bridge.sync(content);
    remote = Array.isArray(got) ? got : [];
    syncError = null;
  } catch (e) { syncError = messageOf(e); }
}

// After the folder, this PC's name or the snapshots changed: re-merge and repaint.
async function resync(info) {
  if (info) sync = info;
  await exchange(true);
  if (raw) shape();
  safeRender(false);
}

const messageOf = e => String(e?.message ?? e ?? 'Unknown error').slice(0, 2000);
const pushTray = () => bridge.setTray(trayText(all?.active ?? null), settings.closeToTray, settings.theme);

function restartTimer() {
  clearInterval(blocksTimer);
  blocksTimer = setInterval(loadBlocks, Math.max(15, Number(settings.refreshSec) || 60) * 1000);
}

// ---- actions handed to views ----

const actions = {
  navigate(id, p = null) {
    params = p;
    if (location.hash === `#${id}`) go(id); else location.hash = `#${id}`;
  },
  setFilter(patch) { applyFilter(patch, true); },
  setSetting(key, value) {
    if (settings[key] === value) return;
    settings[key] = value;
    persist('tokenscope.settings', settings);
    if (key === 'theme') applyTheme();
    if (key === 'theme' || key === 'closeToTray') pushTray();
    if (key === 'refreshSec') restartTimer();
    if (key === 'machineName') resync();
    if (ENGINE_KEYS.includes(key)) { useCache(); loadAll(); }
  },
  refresh: () => loadAll(),
  pickSyncFolder: async () => resync(await bridge.syncPick()),
  syncOff: async () => resync(await bridge.syncOff()),
  exportData(what, format) {
    const c = ctx();
    if (!c.vm) return Promise.resolve({ ok: false });
    const usage = r => ({ input: r.input, output: r.output, cacheWrite: r.cacheWrite, cacheRead: r.cacheRead, tokens: r.tokens, cost: r.cost });
    const rows = what === 'sessions'
      ? c.vm.sessions.map(s => ({ session: s.id, project: s.projectKey ?? '', agent: s.agent, machine: s.machine, lastActivity: s.last ?? '', ...usage(s) }))
      : c.vm.daily.map(r => ({ date: r.period, agents: r.agents.map(a => a.agent).join(' '), models: r.models.map(m => m.name).join(' '), ...usage(r) }));
    const columns = Object.keys(rows[0] ?? {}).map(key => ({ key, label: key }));
    const content = format === 'json' ? JSON.stringify(rows, null, 2) : toCsv(rows, columns);
    return bridge.save(`tokenscope-${what}-${c.today}.${format}`, content);
  },
  openExternal: url => bridge.openExternal(url),
};

function applyFilter(patch, rebuildBar) {
  Object.assign(filter, patch);
  persist('tokenscope.filter', filter);
  if ('machine' in patch && raw) shape();
  const c = ctx(true);
  if (rebuildBar) $('filterbar')?.replaceWith(filterBar(c));
  if (viewRoot?.isConnected) currentView().render(viewRoot, c, null);
}

function applyTheme() {
  if (settings.theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = settings.theme;
}

// ---- frame ----

function buildNav() {
  $('nav').append(...VIEWS.map(v => h('a', { class: 'ts-nav-item', attrs: { href: `#${v.id}` }, dataset: { view: v.id } },
    h('span', { class: 'ts-nav-icon', attrs: { style: `--tile: ${v.tile}` } }, v.icon()),
    h('span', { class: 'ts-nav-label' }, v.title))));
  $('bar-actions').append(
    h('span', { class: 'ts-badge', attrs: { id: 'status' } }),
    h('button', { class: 'ts-button ts-button--tinted', attrs: { type: 'button', id: 'refresh', title: 'Refresh (R)' }, onclick: actions.refresh }, icon('refresh'), 'Refresh'));
}

function syncNav() {
  const index = VIEWS.findIndex(v => v.id === viewId);
  $('nav').style.setProperty('--index', String(index));
  for (const a of $('nav').querySelectorAll('.ts-nav-item')) {
    if (a.dataset.view === viewId) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}

function paintStatus() {
  const el = $('status');
  if (!el) return;
  el.className = `ts-badge${loading ? ' ts-badge--tint' : ''}`;
  el.textContent = loading ? (all ? 'Updating…' : 'Loading…') : updatedAt ? `Updated ${relative(new Date(updatedAt).toISOString(), Date.now())}` : '';
  el.hidden = !el.textContent;
  $('refresh').disabled = loading;
}

function banner() {
  return h('div', { class: `ts-banner ${errorPartial ? 'ts-banner--warning' : 'ts-banner--negative'} ts-enter`, attrs: { role: 'alert' } },
    icon('warning', 'ts-banner-icon'),
    h('div', { class: 'ts-banner-content' },
      h('span', { class: 'ts-banner-title' }, errorPartial ? 'Some data could not be refreshed' : 'Could not load usage'),
      h('p', { class: 'ts-banner-text' }, errorPartial ? 'Usage is up to date; blocks or projects show their last good data.' : all ? 'Showing the last good data.' : 'ccusage did not return any data.'),
      h('pre', { class: 'ts-banner-detail' }, error)),
    h('button', { class: 'ts-button ts-button--tinted', attrs: { type: 'button' }, onclick: actions.refresh }, 'Retry'));
}

function skeleton() {
  const line = width => h('span', { class: 'ts-skeleton', attrs: { style: `width: ${width}` } });
  return h('div', { class: 'ts-stack', attrs: { 'aria-busy': 'true', 'aria-label': 'Loading usage' } },
    h('div', { class: 'ts-grid ts-grid--stats' }, [0, 1, 2, 3].map(() =>
      h('article', { class: 'ts-card ts-stat' }, line('40%'), h('span', { class: 'ts-skeleton ts-skeleton--title', attrs: { style: 'width: 70%' } }), line('55%')))),
    h('article', { class: 'ts-card' }, line('25%'), h('span', { class: 'ts-skeleton ts-skeleton--block' })),
    h('article', { class: 'ts-card' }, line('30%'), line('90%'), line('80%'), line('85%')));
}

function noData() {
  return h('article', { class: 'ts-card ts-enter' }, empty({
    title: 'No usage found yet',
    text: 'Tokenscope reads the local logs of Claude Code, Codex, OpenCode, Gemini CLI, Copilot CLI and the other agents ccusage supports. Run one of them, then refresh.',
    action: { label: 'Supported sources', onClick: () => actions.openExternal(DOCS_URL) },
  }));
}

function filterBar(c) {
  const agents = c.vm.all.agents;
  const chips = [['all', 'All', null], ...agents.map(a => [a, agentLabel(a), agentColor(a, agents)])].map(([value, label, dot]) => {
    const el = chip({
      label, dot, pressed: filter.agent === value,
      onClick: () => {
        chips.forEach(x => x.setAttribute('aria-pressed', String(x === el)));
        applyFilter({ agent: value }, false);
      },
    });
    return el;
  });
  const pcs = c.vm.all.machines;
  const pcChips = [['all', 'All PCs'], ...pcs.map(m => [m.name, m.name])].map(([value, label]) => {
    const el = chip({
      label, pressed: c.filter.machine === value,
      onClick: () => {
        pcChips.forEach(x => x.setAttribute('aria-pressed', String(x === el)));
        applyFilter({ machine: value }, false);
      },
    });
    return el;
  });
  const view = currentView();
  const leading = [
    agents.length > 1 && view.agentFilter !== false ? h('span', { class: 'ts-toolbar-group' }, chips) : null,
    pcs.length > 1 && view.machineFilter !== false ? h('span', { class: 'ts-toolbar-group' }, pcChips) : null,
  ].filter(Boolean);
  const custom = h('button', { class: `ts-button ${filter.preset === 'custom' ? 'ts-button--tinted' : 'ts-button--plain'}`, attrs: { type: 'button' }, onclick: () => customRange(c) },
    icon('calendar'), filter.preset === 'custom' ? rangeLabel(c.filter) : 'Custom');
  const presets = segmented({
    name: 'range', label: 'Date range', options: RANGES, value: filter.preset,
    onChange: preset => {
      const rebuild = filter.preset === 'custom';
      applyFilter({ preset }, rebuild);
      if (rebuild) $('filterbar')?.querySelector('input:checked')?.focus();
    },
  });
  const bar = toolbar(leading, [presets, custom]);
  bar.id = 'filterbar';
  return bar;
}

function customRange(c) {
  const field = (label, value) => {
    const input = h('input', { class: 'ts-field-input', attrs: { type: 'date', value: value ?? '', max: c.today, 'aria-label': label } });
    return { input, el: h('li', null, h('div', { class: 'ts-row' }, h('span', { class: 'ts-row-content' }, h('span', { class: 'ts-row-title' }, label)), h('span', { class: 'ts-row-trailing' }, h('label', { class: 'ts-field' }, input)))) };
  };
  const from = field('From', c.filter.since);
  const to = field('To', c.filter.until ?? c.today);
  const apply = h('button', {
    class: 'ts-button', attrs: { type: 'button' },
    onclick: () => {
      const since = from.input.value || null, until = to.input.value || null;
      from.input.removeAttribute('aria-invalid');
      if (since && until && since > until) { from.input.setAttribute('aria-invalid', 'true'); from.input.focus(); return; }
      closeSheet();
      applyFilter({ preset: 'custom', since, until }, true);
      $('filterbar')?.querySelector('.ts-toolbar-group:last-child > .ts-button')?.focus();
    },
  }, 'Show range');
  openSheet('Custom range', h('div', { class: 'ts-stack' }, h('ul', { class: 'ts-list' }, from.el, to.el), apply));
}

function render(animate = false) {
  const view = currentView();
  const c = ctx(animate);
  $('bar-title').textContent = view.title;
  document.title = `Tokenscope — ${view.title}`;
  const kids = [h('h1', { class: 'ts-large-title' }, view.title)];
  if (error) kids.push(banner());
  viewRoot = null;
  const hasData = all && (all.daily.length || all.sessions.length || all.blocks.length);
  if (view.needsData === false || hasData) {
    if (view.filters !== false && hasData) kids.push(filterBar(c));
    viewRoot = h('div', { class: 'ts-stack' });
    kids.push(viewRoot);
  } else if (!all && loading) kids.push(skeleton());
  else if (all) kids.push(noData());
  else if (!error) kids.push(skeleton());
  $('content').replaceChildren(...kids);
  if (viewRoot) view.render(viewRoot, c, params);   // after attach: charts measure their container
  params = null;
  paintStatus();
}

function safeRender(animate) {
  if (renderFailed) { renderFailed = false; error = null; }   // give the next view a clean slate
  try { render(animate); return true; } catch (e) {
    console.error(e);
    renderFailed = true;
    error = `Could not display this data: ${messageOf(e)}`;
    errorPartial = false;
    viewRoot = null;
    $('content').replaceChildren(h('h1', { class: 'ts-large-title' }, currentView().title), banner());
    paintStatus();
    return false;
  }
}

function go(id) {
  if (!VIEWS.some(v => v.id === id)) return;
  transition(() => {
    viewId = id;
    currentView().reset?.();
    persist('tokenscope.view', id);
    closeSheet();
    syncNav();
    safeRender(true);
    $('main').scrollTop = 0;
  });
}

// ---- start ----

function useCache() {
  const cache = load('tokenscope.cache', null);
  if (cache?.key !== settingsKey() || !cache.raw?.main) return;
  try { raw = cache.raw; updatedAt = cache.savedAt; shape(); } catch { raw = null; all = null; }
}

addEventListener('hashchange', () => go(location.hash.slice(1)));
addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  if (e.key >= '1' && e.key <= String(VIEWS.length)) actions.navigate(VIEWS[e.key - 1].id);
  else if (e.key === 'r' || e.key === 'R') actions.refresh();
});
bridge.onRefresh(actions.refresh);

// Machine sync starts in parallel with the first engine load, which waits on it before merging.
const syncReady = (async () => {
  try {
    sync = await bridge.syncInfo();
    if (!sync.folder) return;
    await exchange(false);
    if (raw) { shape(); safeRender(false); }
  } catch (e) { syncError = messageOf(e); }
})();

applyTheme();
buildNav();
useCache();
syncNav();
if (!safeRender(true) && raw) {   // the cached payload cannot be shown: drop it and start clean
  raw = null; all = null; error = null;
  try { localStorage.removeItem('tokenscope.cache'); } catch { /* storage disabled */ }
  safeRender(true);
}
loadAll();
restartTimer();
setInterval(paintStatus, 30_000);
