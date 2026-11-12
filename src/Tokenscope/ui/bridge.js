// Host messaging (app.js only; views never import this). Inside WebView2 the page posts
// {id, type, ...} and the host replies {id, ok, data?, error?, path?}; the host also pushes
// {type: 'refresh'} from the tray menu. Outside the host (dev preview) run() reads
// /tests/fixtures/*.json; ?mock=slow|error|empty shapes that fallback for UI checks.
import { h } from './dom.js';

const webview = globalThis.chrome?.webview;
export const hosted = !!webview;

const pending = new Map();
const refreshListeners = new Set();
let nextId = 1;

webview?.addEventListener('message', e => {
  const msg = e.data;
  if (msg?.type === 'refresh') { for (const fn of refreshListeners) fn(); return; }
  const p = pending.get(msg?.id);
  if (p) { pending.delete(msg.id); p(msg); }
});

const request = (type, payload) => new Promise(resolve => {
  const id = nextId++;
  pending.set(id, resolve);
  webview.postMessage({ id, type, ...payload });
});

// fn runs when the user picks "Refresh now" in the tray menu.
export function onRefresh(fn) { refreshListeners.add(fn); }

// ---- dev-preview fallback ----

const FIXTURES = [
  [/^daily\b/, 'main.json'],
  [/^blocks\b/, 'blocks.json'],
  [/^claude daily\b/, 'projects.json'],
  [/^claude session\b/, 'claude-sessions.json'],
];
const EMPTY = {
  'main.json': { daily: [], session: [], totals: {} },
  'blocks.json': { blocks: [] },
  'projects.json': { projects: {}, totals: {} },
  'claude-sessions.json': { sessions: [], totals: {} },
};
const mock = new URLSearchParams(globalThis.location?.search ?? '').get('mock');

async function runFixture(args) {
  const file = FIXTURES.find(([re]) => re.test(args.join(' ')))?.[1];
  if (!file) throw new Error(`no fixture for: ${args.join(' ')}`);
  if (mock === 'empty') return structuredClone(EMPTY[file]);
  if (file === 'main.json' && mock === 'error') throw new Error('ccusage failed: mock error');
  if (file === 'main.json' && mock === 'slow') await new Promise(r => setTimeout(r, 4000));
  const res = await fetch(`/tests/fixtures/${file}`);
  if (!res.ok) throw new Error(`fixture ${file}: HTTP ${res.status}`);
  return res.json();
}

// ---- public API ----

export async function run(args) {
  if (!hosted) return runFixture(args);
  const reply = await request('run', { args });
  if (!reply.ok) throw new Error(reply.error || 'ccusage failed');
  return reply.data;
}

export async function save(name, content) {
  if (hosted) {
    const reply = await request('save', { name, content });
    return { ok: !!reply.ok, path: reply.path };
  }
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  h('a', { attrs: { href: url, download: name } }).click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return { ok: true };
}

// theme: the resolved setting 'light' | 'dark' | 'system'; the host recolours its title bar.
export function setTray(text, closeToTray, theme) {
  if (hosted) request('tray', { text, closeToTray, theme });
}

export function openExternal(url) {
  if (hosted) request('openExternal', { url });
  else globalThis.open(url, '_blank', 'noopener');
}

// ---- machine sync (see Sync.cs) ----
// The host owns the folder: the page can ask for a folder dialog but never names a path.
// Info is {folder: string | null, machine: this PC's Windows name}. Outside the host sync is off,
// except with ?mock=machines, which invents a second PC from the fixtures.

const DEMO_FOLDER = 'G:\My Drive\Tokenscope';
const syncInfoOf = reply => (reply?.ok && reply.data ? reply.data : { folder: null, machine: '' });
const demoInfo = () => ({ folder: mock === 'machines' ? DEMO_FOLDER : null, machine: 'Home-PC' });

export async function syncInfo() { return hosted ? syncInfoOf(await request('syncInfo')) : demoInfo(); }
export async function syncPick() { return hosted ? syncInfoOf(await request('syncPick')) : demoInfo(); }
export async function syncOff() { return hosted ? syncInfoOf(await request('syncOff')) : { ...demoInfo(), folder: null }; }

// content: this PC's snapshot as a JSON string, or null to only read. Resolves to the other PCs'
// snapshots (untrusted: shape.js validates them).
export async function sync(content) {
  if (hosted) {
    const reply = await request('sync', { content });
    if (!reply.ok) throw new Error(reply.error || 'sync failed');
    return reply.data;
  }
  if (mock !== 'machines') return [];
  const [main, sessions, projects] = await Promise.all(['main.json', 'claude-sessions.json', 'projects.json'].map(f => fetch(`/tests/fixtures/${f}`).then(r => r.json())));
  const some = (xs, n) => xs.filter((_, i) => i % n === 0);
  return [{ v: 1, machine: 'Work-PC', savedAt: Date.now() - 26 * 36e5, raw: { main: { ...main, daily: some(main.daily, 2), session: some(main.session, 3) }, sessions, projects: { projects: Object.fromEntries(some(Object.entries(projects.projects), 2)) } } }];
}
