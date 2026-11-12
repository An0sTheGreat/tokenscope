# Tokenscope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `dist/Tokenscope.exe`, an iOS-feeling Windows dashboard and tray meter over the bundled official ccusage binary.

**Architecture:** A .NET 10 WinForms host embeds WebView2, serves the UI from embedded resources, and runs `ccusage.exe … --json` on request. The UI is framework-free ES modules: `shape.js` turns engine JSON into view models, views render them with a small token-based design system and hand-drawn SVG charts.

**Tech Stack:** .NET 10 (`net10.0-windows`, WinForms), `Microsoft.Web.WebView2` NuGet, vanilla HTML/CSS/JS (ES modules), Node 24 built-in test runner, ccusage v20.0.50 native binary.

**Spec:** `docs/superpowers/specs/2026-11-11-tokenscope-design.md`

## Global Constraints

- Engine is pinned: npm `@ccusage/ccusage-win32-x64@20.0.50`. No parsing or pricing logic of our own.
- No npm runtime dependencies, no UI framework, no chart library, no build step for the UI.
- Only NuGet dependency: `Microsoft.Web.WebView2`.
- Raw colours, sizes, radii, shadows, durations and easings live only in `ui/design/tokens.css`.
- Animate only `transform`, `opacity`, `filter`. Honour `prefers-reduced-motion`.
- No Apple fonts, symbols or artwork. Icons are our own inline SVG.
- Strings from disk (project names, session ids, model names, engine stderr) reach the DOM only through `textContent` / attributes set via DOM APIs. No `innerHTML` in `ui/**/*.js`.
- `tests/fixtures/` holds real local usage data: never push this repository to a remote without removing it.
- Work on branch `feat/tokenscope`; commit after every task; never merge to `main` unasked.
- Test command: `node --test "tests/*.test.mjs"` — must be green before any task is reported done.

## Review Focus

1. **Day boundary vs timezone setting** — "today / this week / this month" must use the configured timezone's date, not the PC clock's UTC date. → Task 2, `periodStats` test with an explicit `today`.
2. **Block that just started** — zero elapsed minutes must give `burn: null`, never `Infinity`/`NaN` in the UI or tray. → Task 2, `shapeBlocks` zero-elapsed test.
3. **Rows without cost** (unpriced model, `--mode display`) — totals stay numeric and the model is flagged unpriced. → Task 2, missing-cost test.
4. **Engine stdout with a BOM or a warning line before the JSON** — still parses; pure-garbage output gives the "unexpected output" error. → Task 7, `ExtractJson` self-check cases.
5. **Hostile-looking names** (`<img onerror=…>` as a project name) — rendered as text. → Task 3, `design.test.mjs` no-`innerHTML` rule; Task 4, `h()` test.

## File Structure

```
CLAUDE.md                         AI brief: layout, commands, "read docs/DESIGN.md first"
build.ps1                         fetch engine if missing → dotnet publish → dist/Tokenscope.exe
docs/DESIGN.md                    design-system guide and recipes
engine/ccusage.exe                (gitignored) fetched by scripts/fetch-engine.mjs
engine/LICENSE-ccusage            upstream MIT licence text
scripts/fetch-engine.mjs          npm pack the pinned package, extract bin/ccusage.exe
scripts/make-icon.ps1             draws src/Tokenscope/app.ico (PNG-in-ICO, 256 px)
src/Tokenscope/Tokenscope.csproj
src/Tokenscope/Program.cs         entry, single instance, --selfcheck
src/Tokenscope/Engine.cs          ArgPolicy, unpack, run, ExtractJson
src/Tokenscope/MainForm.cs        window, WebView2, resource serving, bridge, tray
src/Tokenscope/app.ico
src/Tokenscope/ui/index.html      shell: sidebar, top bar, <main>, sheet + tooltip hosts
src/Tokenscope/ui/app.js          store, settings, router, refresh loop, shortcuts
src/Tokenscope/ui/bridge.js       host messaging; fixture fallback when not hosted
src/Tokenscope/ui/shape.js        pure: engine JSON → view models
src/Tokenscope/ui/format.js       pure: money, tokens, durations, relative time
src/Tokenscope/ui/args.js         pure: settings → engine argument arrays
src/Tokenscope/ui/dom.js          h(), svg(), sheet, tooltip, countUp, stagger, chunked list
src/Tokenscope/ui/charts.js       stackedBars, lineChart, rankBars, heatmap, blockTimeline
src/Tokenscope/ui/views/{overview,reports,sessions,blocks,projects,settings}.js
src/Tokenscope/ui/design/{tokens.css,components.css,gallery.html}
tests/fixtures/{main,blocks,projects,claude-sessions}.json
tests/{shape,format,design,dom}.test.mjs
```

Dev preview without the host: from the repo root run `python -m http.server 5173` and open `http://localhost:5173/src/Tokenscope/ui/index.html`; `bridge.js` then serves `run` from `/tests/fixtures/`.

---

### Task 1: Engine and fixtures

**Files:** Create `scripts/fetch-engine.mjs`, `engine/LICENSE-ccusage`, `tests/fixtures/main.json`, `tests/fixtures/blocks.json`, `tests/fixtures/projects.json`, `tests/fixtures/claude-sessions.json`, `tests/fixtures/README.md`; modify `.gitignore` (add `engine/ccusage.exe`).

**Interfaces:**
- Produces: `engine/ccusage.exe`; three fixture files of real engine output; `tests/fixtures/README.md` listing every top-level and row-level key observed in each fixture plus the measured wall-clock time of each command.

- [ ] **Step 1:** Write `scripts/fetch-engine.mjs`: in a temp dir run `npm pack @ccusage/ccusage-win32-x64@20.0.50`, extract `package/bin/ccusage.exe` with `tar -xf`, copy to `engine/ccusage.exe`, delete the temp dir. Skip if the file already exists. Exit non-zero with the npm error on failure.
- [ ] **Step 2:** Run `node scripts/fetch-engine.mjs && engine/ccusage.exe --version`. Expected: prints `20.0.50`.
- [ ] **Step 3:** Save the upstream `LICENSE` to `engine/LICENSE-ccusage` (`gh api repos/ccusage/ccusage/contents/LICENSE -H "Accept: application/vnd.github.raw"`).
- [ ] **Step 4:** Capture fixtures, timing each:
  - `engine/ccusage.exe daily --sections daily,session --by-agent --json > tests/fixtures/main.json`
  - `engine/ccusage.exe blocks --json > tests/fixtures/blocks.json`
  - `engine/ccusage.exe claude daily --instances --json > tests/fixtures/projects.json`
  - `engine/ccusage.exe claude session --json > tests/fixtures/claude-sessions.json` (added after capture showed unified session rows carry no project; this report has `sessionId` + `projectPath`)

  Expected: each file parses with `node -e "JSON.parse(require('fs').readFileSync(f))"`.
- [ ] **Step 5:** Write `tests/fixtures/README.md` (keys observed per file, timings, the "never push" warning). If any command took over 10 s, record it prominently — Task 4's loading states depend on it.
- [ ] **Step 6:** Commit (`engine/ccusage.exe` stays ignored).

### Task 2: View-model layer (`shape.js`, `format.js`)

**Files:** Create `src/Tokenscope/ui/shape.js`, `src/Tokenscope/ui/format.js`; test `tests/shape.test.mjs`, `tests/format.test.mjs`.

**Interfaces:**
- Consumes: fixtures and key list from Task 1.
- Produces (all pure, all exported from `shape.js`):

```js
// Usage = {input, output, cacheWrite, cacheRead, tokens, cost}            numbers, never NaN
// Model = Usage & {name, unpriced:boolean}
// Row   = Usage & {period:'YYYY-MM-DD'|'YYYY-Www'|'YYYY-MM', models:Model[], agents:(Usage&{agent,models})[]}
// Session = Usage & {id, agent, last:string|null /*ISO*/, models:Model[],
//                    projectKey:string|null,   // raw ccusage project key (claude only, joined by session id), else null
//                    title:string}             // prettyProject(projectKey) when known, else the agent name capitalised ('Codex')
// Block = Usage & {id, start, end, actualEnd, isActive, isGap, modelNames:string[],
//                  elapsedMin, remainingMin, burn:{tokensPerMin,costPerHour}|null,
//                  projection:{tokens,cost}|null, limit:number|null, limitShare:number|null}
shapeMain(raw, claudeSessionsRaw)      // → {daily:Row[] (ascending), sessions:Session[] (latest first), agents:string[], unpriced:string[]}
                                       //   claudeSessionsRaw (output of `claude session`, may be null) supplies projectKey via sessionId === session `period`
prettyProject(key)                     // 'Y--Programs-Sample-App' → 'Programs-Sample-App';
                                       // 'C--Users-alex-Downloads-claude-api-usage-costs-translator' → 'claude-api-usage-costs-translator';
                                       // rule: drop leading '<Drive>--', then 'Users-<name>-', then one of 'Downloads-'|'Documents-'|'Desktop-';
                                       // a remainder starting 'AppData-' → 'Claude workspace'; empty remainder → the original key
shapeBlocks(raw, nowMs)                // → {active:Block|null, blocks:Block[] (latest first)}
shapeProjects(raw)                     // → [{key, name, daily:Row[]}]
filterDaily(daily, {agent, since, until})   // agent 'all' or a name; since/until 'YYYY-MM-DD'|null; re-totals rows from the agent slice
filterSessions(sessions, {agent, since, until, query})
aggregate(daily, unit, weekStart)      // unit 'week'|'month'; weekStart 'sunday'|'monday' → Row[]
totals(rows)                           // → Usage & {models:Model[] (by cost desc)}
periodStats(daily, today, weekStart)   // today 'YYYY-MM-DD' → {today,week,month} each {cost,tokens,prevCost,delta:number|null}
agentSeries(daily)                     // → {labels:string[], series:[{agent, values:number[]}]}  cost per day
modelSplit(rows)                       // → [{name, cost, tokens, share, unpriced}] by cost desc
heatmapCells(daily, today, weeks)      // → [{date, cost, level:0|1|2|3|4}] length weeks*7, ending on today's week
projectTotals(projects, {since, until})// → [{name, cost, tokens, share, daily:Row[]}] by cost desc
recentSessions(sessions, n)            // → first n by last desc; null `last` sorts last
trayText(active)                       // → 'Active block · $12.40 · 2h 10m left · 3.1k tok/min' | 'No active block'
toCsv(rows, columns)                   // columns [{key,label}] → RFC 4180 string
```

  `format.js`: `money(n)` (`$1,234.56`, `$0.004` → `<$0.01`, `0` → `$0.00`), `tokens(n)` (`999`, `1.2k`, `3.4M`, `1.2B`), `duration(min)` (`2h 10m`, `45m`), `relative(iso, nowMs)` (`just now`, `5m ago`, `3h ago`, `yesterday`, `12 Nov`), `pct(share)`.

- [ ] **Step 1: Write failing tests** in `tests/shape.test.mjs` and `tests/format.test.mjs`. Required cases, each with literal expected values:
  - `shapeMain(fixture)`: daily ascending; every Usage field is a finite number; sum of `daily[].cost` equals the fixture's `totals` cost within 1e-6.
  - Field-spelling tolerance: a hand-built row using `cacheCreationInputTokens`, `costUSD`, `model` yields the same Row as one using `cacheCreationTokens`, `totalCost`, `modelName`.
  - Missing cost (Review Focus 3): model with no cost field and `missingPricing:true` → `cost === 0`, `unpriced === true`, name appears in `shapeMain().unpriced`.
  - `filterDaily` by agent: row totals equal that agent's slice; days where the agent is absent are dropped.
  - `aggregate(…, 'week', 'monday')` vs `'sunday'` on a 14-day synthetic set: exact periods and sums; `'month'` across a year boundary.
  - `periodStats` (Review Focus 1): synthetic days around `today='2026-03-01'`; today/week/month costs and `delta` exact; `delta === null` when the previous period is 0.
  - `shapeBlocks`: active block mid-way → `elapsedMin`, `remainingMin`, `burn`, `projection` exact; zero elapsed (Review Focus 2) → `burn === null`, `projection === null`; gap blocks flagged; engine-provided `burnRate`/`projection` win over computed values when present.
  - `heatmapCells`: length `weeks*7`, last cell's week contains `today`, levels are quantiles of non-zero days, zero days are level 0.
  - `recentSessions(sessions, 3)`: three, latest first, null dates last.
  - Project join: `shapeMain(main, claudeSessions)` gives every claude session whose id is in the claude-sessions fixture a non-null `projectKey` and a `title` equal to `prettyProject(projectKey)`; codex sessions get `projectKey === null`, `title === 'Codex'`; `shapeMain(main, null)` still works. `prettyProject`: the examples in Interfaces plus an `AppData` key and a key with no recognised prefix.
  - `shapeProjects`: `name` is `prettyProject(key)`, plus `key`; rows are Rows with `period` taken from `date`.
  - `trayText`: both exact strings above.
  - `toCsv`: quotes fields containing `,` `"` or newline.
  - `format.js`: every example listed in Interfaces.
- [ ] **Step 2:** Run `node --test "tests/*.test.mjs"`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement both modules. Normalise once at the edge (`normUsage`, `normModel`) and build everything else on Rows. Computed burn = `tokens / elapsedMin`, `cost / elapsedMin * 60`; projection = current + rate × `remainingMin`.
- [ ] **Step 4:** Run `node --test "tests/*.test.mjs"`. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 3: Design system and reference files

**Files:** Create `src/Tokenscope/ui/design/tokens.css`, `components.css`, `gallery.html`, `docs/DESIGN.md`, `CLAUDE.md`; test `tests/design.test.mjs`.

**Interfaces:**
- Produces: token names and component class names used by every later UI task. Naming is fixed here:
  - Tokens: `--color-{label,label-2,label-3,bg,bg-2,bg-grouped,fill,fill-2,separator,tint,tint-contrast,positive,negative,warning}`, `--cat-1…--cat-8` (agent palette), `--heat-0…--heat-4`, `--text-{large-title,title-1,title-2,title-3,headline,body,callout,subhead,footnote,caption}` (font shorthand), `--space-1…--space-8` (4 px base), `--radius-{sm,md,lg,xl,pill}`, `--shadow-{card,sheet,popover}`, `--blur-{bar,sidebar,sheet}`, `--spring-{snappy,smooth,bouncy}`, `--dur-{fast,base,slow}`, `--z-{bar,sheet,tooltip}`.
  - Components (class prefix `ts-`): `ts-sidebar`, `ts-nav-item`, `ts-topbar`, `ts-large-title`, `ts-card`, `ts-card-header`, `ts-list`, `ts-row`, `ts-segmented`, `ts-switch`, `ts-button` (`--tinted`, `--plain`), `ts-chip`, `ts-badge`, `ts-stat`, `ts-table`, `ts-sheet`, `ts-tooltip`, `ts-progress`, `ts-skeleton`, `ts-empty`, `ts-banner`, `ts-field`, `ts-chart`.
  - `tests/design.test.mjs` exports nothing; it enforces the rules below.

- [ ] **Step 1: Write the failing test** `tests/design.test.mjs`:
  - no hex / `rgb(` / `hsl(` / `oklch(` literal in any `ui/**/*.css` or `ui/**/*.js` except `tokens.css`;
  - every `.ts-*` base class defined in `components.css` appears in `gallery.html`;
  - every `var(--x)` used in `components.css` is defined in `tokens.css`, in both the light and the dark block for `--color-*`, `--cat-*`, `--heat-*`, `--shadow-*`;
  - no `innerHTML`, `outerHTML` or `insertAdjacentHTML` in `ui/**/*.js` (Review Focus 5);
  - no `transition`/`animation` in `components.css` names a property other than `transform`, `opacity`, `filter` (reject `all`).
- [ ] **Step 2:** Run `node --test tests/design.test.mjs`. Expected: FAIL (files missing).
- [ ] **Step 3:** Write `tokens.css`: light values on `:root`, dark under `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }` and again under `:root[data-theme="dark"]`. Springs as CSS `linear()` curves: snappy ≈ 250 ms, smooth ≈ 450 ms, bouncy ≈ 550 ms with one overshoot. A one-line "use when" comment on every token. Text on every background pair meets WCAG AA; `--cat-*` is a colour-blind-safe set.
- [ ] **Step 4:** Write `components.css`: one commented block per component listed above, tokens only, pressed state `scale(0.97)`, segmented control with a sliding thumb element, sheet that translates up over a dimmed backdrop, reduced-motion block collapsing everything to 120 ms opacity fades.
- [ ] **Step 5:** Write `gallery.html`: every component in every state with a copyable markup snippet beside it, a theme toggle, and a motion section demonstrating each spring. Loads only `tokens.css` and `components.css`.
- [ ] **Step 6:** Write `docs/DESIGN.md` (principles; token index by purpose; component index with the markup for each; motion rules; do/don't; recipes: add a screen, add a component, add a chart, add a setting) and `CLAUDE.md` (project layout, `node --test "tests/*.test.mjs"`, `./build.ps1`, dev-preview command, the three UI rules from the spec).
- [ ] **Step 7:** Run `node --test "tests/*.test.mjs"`. Expected: PASS. Open the gallery via the dev preview in light and dark and fix anything that looks wrong.
- [ ] **Step 8:** Commit.

### Task 4: UI shell, DOM helpers and charts

**Files:** Create `src/Tokenscope/ui/index.html`, `app.js`, `bridge.js`, `dom.js`, `charts.js`, placeholder `views/*.js` (each exporting the interface below with an empty-state body); test `tests/dom.test.mjs`.

**Interfaces:**
- Consumes: Task 2 exports; Task 3 tokens and classes.
- Produces:

```js
// bridge.js
export const hosted;                         // true inside WebView2
export async function run(args);             // resolves parsed JSON; rejects Error(engine message)
export async function save(name, content);   // → {ok, path?}
export function setTray(text, closeToTray);
export function openExternal(url);
// not hosted: run() maps 'daily …'→main.json, 'blocks …'→blocks.json, 'claude daily …'→projects.json, 'claude session …'→claude-sessions.json under /tests/fixtures/

// dom.js
export function h(tag, props, ...children);  // props: class, dataset, on*, attrs; string children become text nodes
export function svg(tag, attrs, ...children);
export function openSheet(titleText, contentEl);  export function closeSheet();
export function tooltip(targetEl, getContentEl);
export function countUp(el, to, formatFn);
export function stagger(parentEl);           // sets --i on up to 12 children
export function chunked(container, items, renderItem, size = 60);
export function transition(updateFn);        // document.startViewTransition wrapper; plain call if unsupported or reduced motion

// charts.js — each fills `el` with an SVG sized to it, re-renders on resize, animates in
export function stackedBars(el, {labels, series:[{name, color, values}], format});
export function lineChart(el, {labels, values, format});
export function rankBars(el, [{label, value, share, color, badge}], {format});
export function heatmap(el, cells, {format});
export function blockTimeline(el, blocks, nowMs);

// app.js
// settings (localStorage key 'tokenscope.settings'), defaults:
//   {theme:'system', timezone:'', costMode:'auto', offline:false, weekStart:'sunday',
//    tokenLimit:'', refreshSec:60, closeToTray:true}
// ctx passed to every view:
//   {vm:{daily, sessions, agents, unpriced, blocks, active, projects},   // already filtered; vm.all holds the same, unfiltered
//    filter:{agent, preset, since, until}, settings, today, nowMs, status:{loading, error, updatedAt},
//    actions:{navigate(id, params), setFilter(patch), setSetting(key, value), refresh(), exportData(kind)}}

// views/<id>.js
export const id, title, icon;                // icon: function returning an SVG element
export function render(el, ctx, params);     // idempotent; called on navigation and on every data/filter change
```

  Engine args: main `['daily','--sections','daily,session','--by-agent', …common]`; sessions `['claude','session', …common]`; blocks `['blocks', …common]` plus `['--token-limit', v]` when set; projects `['claude','daily','--instances', …common]`; common = `--timezone <tz>` when set, `--mode <m>` when not `auto`, `--offline` when on.

- [ ] **Step 1: Write the failing test** `tests/dom.test.mjs` (pure parts only, with a minimal fake `document` built in the test): `h('div', null, '<img onerror=x>')` produces a text child equal to that literal string and no element child (Review Focus 5); `engineArgs(settings)`, exported from the pure module `ui/args.js` as `{main, sessions, blocks, projects}`, returns the exact arrays above for default settings and for `{timezone:'UTC', costMode:'calculate', offline:true, tokenLimit:'max'}`.
- [ ] **Step 2:** Run `node --test tests/dom.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement `ui/args.js`, `dom.js`, `bridge.js`.
- [ ] **Step 4:** Implement `index.html` + `app.js`: sidebar with six nav items and a sliding selection pill; top bar with source chips, range segmented control (7 d / 30 d / 90 d / Month / All / Custom), Refresh, "updated n ago"; large title collapsing on scroll; view switching through `transition()`; theme applied via `data-theme`; shortcuts `1`–`6` and `R`; refresh loop (all four on start/manual/setting change, blocks only every `refreshSec`); the main command takes 10–12 s on this machine, so the last good raw payloads are kept in `localStorage` key `tokenscope.cache` (with the settings they were loaded under) and rendered immediately on start while the refresh runs, with an "Updating…" indicator in the top bar — skeletons appear only when there is no usable cache; `setTray(trayText(active), closeToTray)` after every blocks load; error banner with Retry that keeps the last good data; skeletons while the first load is pending; global empty state when there is no data at all.
- [ ] **Step 5:** Implement `charts.js`. Bars grow with `transform: scaleY`, lines trace with a clip rect translated by `transform`, data changes re-flow by interpolating; hover shows a `ts-tooltip`.
- [ ] **Step 6:** Run `node --test "tests/*.test.mjs"`. Expected: PASS. Dev-preview check: shell loads fixtures, all six placeholders reachable by click and by key, theme toggles, no console errors.
- [ ] **Step 7:** Commit.

### Task 5: Overview and Reports screens

**Files:** Modify `src/Tokenscope/ui/views/overview.js`, `views/reports.js`; add any new component to `components.css` + `gallery.html`.

**Interfaces:** Consumes Task 4's `ctx` and helpers and Task 2's functions. Produces nothing new for other tasks.

- [ ] **Step 1: Overview.** In order: four `ts-stat` cards (today, this week, this month from `periodStats`; "selected range" from `totals`) with count-up and delta badge; active-block card (only when `ctx.vm.active`) linking to Blocks; daily cost `stackedBars` from `agentSeries`; model split `rankBars` from `modelSplit` with Unpriced badges; `heatmap` (26 weeks); "Recent sessions" card from `recentSessions(ctx.vm.sessions, 3)` showing project, agent, `relative(last)`, tokens, cost — a row calls `navigate('sessions', {id})`, "See all" calls `navigate('sessions')`. "No usage in this range" + Reset filters when the filter matches nothing.
- [ ] **Step 2: Reports.** Segmented control Daily / Weekly / Monthly (`ctx.vm.daily` or `aggregate`); trend `lineChart` with a Tokens/Cost toggle; `ts-table` with the nine columns from the spec, click-to-sort headers, rows expanding to per-model breakdown, a totals row, rendered through `chunked`.
- [ ] **Step 3:** Run `node --test "tests/*.test.mjs"`. Expected: PASS. Dev-preview check against the fixtures in light and dark: the selected-range cost on Overview equals the Reports totals row; switching range and source animates without a reload; screenshots look right at 1100×720 and 1600×1000.
- [ ] **Step 4:** Commit.

### Task 6: Sessions, Blocks, Projects and Settings screens

**Files:** Modify `src/Tokenscope/ui/views/sessions.js`, `blocks.js`, `projects.js`, `settings.js`; add any new component to `components.css` + `gallery.html`.

**Interfaces:** Consumes Task 4's `ctx` and helpers and Task 2's functions. Touches no file Task 5 touches except `components.css` / `gallery.html` (append-only), so it can run after or alongside Task 5 in its own worktree.

- [ ] **Step 1: Sessions.** Search field (`filterSessions` `query` over project, id, model names); sortable chunked list (project/session, agent, last activity, models, tokens, cost); a row opens a sheet with the per-model breakdown; `params.id` opens that session's sheet on arrival.
- [ ] **Step 2: Blocks.** Live panel for `ctx.vm.active` (spend, tokens, elapsed/remaining ring, burn tokens/min and $/h, projection, `ts-progress` against the token limit) or a calm "No active block" state; `blockTimeline` of the last 3 days with gaps; history table. Not affected by the date/source filters.
- [ ] **Step 3: Projects.** `projectTotals` ranked list with share bars; selecting a project morphs to its daily `lineChart` and totals.
- [ ] **Step 4: Settings.** Grouped lists: Appearance (theme segmented), Data (timezone field validated with `Intl.DateTimeFormat`, cost mode, offline switch, week start, token limit accepting a positive integer or `max`), Behaviour (refresh interval 15–600 s, close-to-tray switch), Export (current Reports view or Sessions as JSON / CSV through `save`), About (version, ccusage credit + licence link via `openExternal`, "Design gallery" link that navigates the window to `design/gallery.html`, which carries a Back link to `index.html`). Invalid input shows an inline message and is not saved.
- [ ] **Step 5:** Run `node --test "tests/*.test.mjs"`. Expected: PASS. Dev-preview check of all four screens in light and dark, including an empty search and the no-active-block state.
- [ ] **Step 6:** Commit.

### Task 7: Windows host

**Files:** Create `src/Tokenscope/Tokenscope.csproj`, `Program.cs`, `Engine.cs`, `MainForm.cs`, `scripts/make-icon.ps1`, `src/Tokenscope/app.ico`.

**Interfaces:**
- Consumes: `engine/ccusage.exe`, `src/Tokenscope/ui/**`, the bridge message table in the spec.
- Produces:

```csharp
static class ArgPolicy { public static string? Validate(string[] args); }   // null = allowed, else the reason
static class Engine {
    public const string Version = "20.0.50";
    public static string EnsureUnpacked();                                   // %LOCALAPPDATA%\Tokenscope\engine\20.0.50\ccusage.exe
    public static string? ExtractJson(string stdout);                        // strips BOM and anything before the first '{' or '['; null if none or invalid JSON
    public static Task<(bool ok, string payload)> RunAsync(string[] args, CancellationToken ct);  // appends --json; 120 s timeout; payload = JSON or error text (≤ 2000 chars)
}
```

  csproj: `net10.0-windows`, `OutputType=WinExe`, `UseWindowsForms=true`, `ApplicationIcon=app.ico`, `<EmbeddedResource Include="ui\**" />`, `<EmbeddedResource Include="..\..\engine\ccusage.exe" LogicalName="engine/ccusage.exe" />`, `Microsoft.Web.WebView2` package reference.

- [ ] **Step 1: Write the self-check first** in `Program.cs`: `--selfcheck` runs these assertions and exits 0, or 1 on the first failure:
  - `Validate(["daily","--sections","daily,session","--by-agent"])`, `(["blocks","--token-limit","max"])`, `(["claude","daily","--instances","--timezone","UTC"])` → null;
  - `Validate([])`, `(["statusline"])`, `(["daily","--config","x.json"])`, `(["notasource","daily"])`, `(["daily","--json"])` (host adds it), `(["daily","&","calc"])` → non-null;
  - `ExtractJson("﻿{\"a\":1}")` and `ExtractJson("warning: x\n{\"a\":1}")` → `{"a":1}`; `ExtractJson("oops")` and `ExtractJson("{broken")` → null (Review Focus 4).
- [ ] **Step 2:** Run `dotnet run --project src/Tokenscope -- --selfcheck; echo $?`. Expected: build error or exit 1.
- [ ] **Step 3:** Implement `Engine.cs`. `ProcessStartInfo` with `ArgumentList`, `UseShellExecute=false`, `CreateNoWindow=true`, stdout/stderr redirected and read concurrently, UTF-8.
- [ ] **Step 4:** Run the self-check. Expected: exit 0.
- [ ] **Step 5:** Run `scripts/make-icon.ps1` (System.Drawing: 256 px rounded-square gradient with a ring glyph, written as PNG-in-ICO) to create `app.ico`.
- [ ] **Step 6:** Implement `MainForm.cs` and the rest of `Program.cs`:
  - named-mutex single instance; a second launch signals the first (named `EventWaitHandle`) to show and activate, then exits;
  - WebView2 environment with user data in `%LOCALAPPDATA%\Tokenscope\webview`; missing runtime → message box with `https://developer.microsoft.com/microsoft-edge/webview2/` and exit; unpack failure → message box with path and OS error and exit;
  - `AddWebResourceRequestedFilter("https://app.tokenscope/*")` serving embedded `ui/` resources with correct MIME types (`.html .css .js .svg .json`), 404 otherwise; navigate to `https://app.tokenscope/index.html`; cancel any navigation or new-window request to another origin;
  - web-message dispatch for `run` (validate → `RunAsync` → `ExtractJson`), `save` (`SaveFileDialog`, UTF-8), `tray`, `openExternal` (`https://` only);
  - `NotifyIcon` using the exe icon: tooltip from `tray` (truncate to 127 chars), left-click toggles the window, menu Open / Refresh now (posts `{type:"refresh"}` to the page) / Quit;
  - closing hides to tray when `closeToTray` is on, with a one-time balloon tip (flag file in `%LOCALAPPDATA%\Tokenscope`); Quit disposes the icon and exits;
  - window 1280×820, minimum 960×640, remembers size/position in `%LOCALAPPDATA%\Tokenscope\window.json`, dark title bar matching the theme (`DwmSetWindowAttribute`).
- [ ] **Step 7:** `app.js`: handle the host's `{type:"refresh"}` message by calling `actions.refresh()`.
- [ ] **Step 8:** Run `dotnet run --project src/Tokenscope`. Expected: window shows live data from this machine; tray tooltip shows the block text; closing hides to tray; Quit exits and no `Tokenscope` or `ccusage` process remains.
- [ ] **Step 9:** Commit.

### Task 8: Package and acceptance

**Files:** Create `build.ps1`; modify `CLAUDE.md` if any command changed.

- [ ] **Step 1:** Write `build.ps1`: `node scripts/fetch-engine.mjs`; `node --test "tests/*.test.mjs"`; `dotnet publish src/Tokenscope -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:DebugType=none -o dist`; stop on the first failure.
- [ ] **Step 2:** Run `./build.ps1`. Expected: tests pass, `dist/Tokenscope.exe` exists.
- [ ] **Step 3:** Run `dist/Tokenscope.exe --selfcheck; echo $?`. Expected: 0.
- [ ] **Step 4: Acceptance (the spec's manual gate).** Launch `dist/Tokenscope.exe` and check, in light and in dark: all six screens render real data; Overview shows the three most recent sessions; the all-time cost equals `engine/ccusage.exe daily --json` `totals.totalCost`; range and source changes animate smoothly with no reload; tray tooltip updates within one refresh interval; second launch focuses the first window; with the engine file renamed in LOCALAPPDATA mid-run the banner shows the error and Retry recovers after it is restored.
- [ ] **Step 5:** Commit.
