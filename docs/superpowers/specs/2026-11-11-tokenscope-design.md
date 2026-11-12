# Tokenscope — design spec

2026-11-11. Working name "Tokenscope"; an unofficial desktop front end for
[ccusage](https://github.com/ccusage/ccusage) (MIT, © ryoppippi), credited in Settings → About.

## Goal

A Windows desktop `.exe` in this folder that presents everything ccusage reports —
daily, weekly, monthly and session usage, 5-hour billing blocks, per-model and
per-project breakdowns, date and source filters, cost tracking — as a beautiful,
coherent, easy and engaging dashboard, plus a tray meter for the active block.

Decided with the user: single PC (this one); theme follows Windows with a manual
override; dashboard window plus tray meter.

## Architecture

Three units, each replaceable without touching the others.

| Unit | Path | Does | Depends on |
|---|---|---|---|
| Host | `src/Tokenscope/` (.NET 10 WinForms) | Window, WebView2, tray icon, runs the engine, saves files | WebView2 runtime, engine exe |
| Engine | `engine/ccusage.exe` | Official ccusage native binary, pinned to v20.0.50 from npm `@ccusage/ccusage-win32-x64` | local agent data |
| UI | `src/Tokenscope/ui/` (HTML/CSS/JS, no framework, no build step) | All screens and charts (hand-drawn SVG) | host bridge only |

Output: `dist/Tokenscope.exe`, framework-dependent single file (needs the .NET 10
desktop runtime and WebView2, both installed here). The engine exe and the UI files
are embedded resources; on start the host unpacks the engine to
`%LOCALAPPDATA%\Tokenscope\engine\<version>\ccusage.exe` if absent. WebView2 user data
goes to `%LOCALAPPDATA%\Tokenscope\webview`.

### Bridge (UI ↔ host)

WebView2 web messages, request/response matched by id.

| Request | Host action | Response |
|---|---|---|
| `{id, type:"run", args:[...]}` | Runs `ccusage.exe <args> --json`, no shell, 120 s timeout | `{id, ok:true, data:<parsed JSON>}` or `{id, ok:false, error:<stderr or reason>}` |
| `{id, type:"save", name, content}` | Save-file dialog, writes UTF-8 | `{id, ok, path?}` |
| `{id, type:"tray", text, closeToTray}` | Sets the tray tooltip to `text` and remembers the close-to-tray preference | `{id, ok:true}` |
| `{id, type:"openExternal", url}` | Opens an `https://` URL in the default browser | `{id, ok}` |

The host rejects `run` unless `args[0]` (or `args[1]` after a source namespace) is one
of `daily weekly monthly session blocks`, and rejects any argument that is not a flag
from the allow-list below or a value for one. Source namespaces accepted: `claude
codex opencode amp droid codebuff cline hermes pi goose openclaw kilo kimi qwen
copilot gemini antigravity grok zcode`. The host appends `--json` itself. Navigation away from the embedded UI
origin is blocked.

Allowed flags: `--sections --by-agent --breakdown --instances --project
--since --until --last --timezone --mode --offline --order --start-of-week --active
--recent --token-limit --session-length --id`.

### Data flow

1. On start and on each refresh the UI sends four `run` requests in parallel:
   - **main**: `daily --sections daily,session --by-agent`
   - **sessions**: `claude session` (unified session rows carry no project; this report
     maps Claude session ids to projects. Other sources show the agent name instead.)
   - **blocks**: `blocks` (+ `--token-limit` when set)
   - **projects**: `claude daily --instances`

   Timezone, cost mode and offline pricing are passed to the engine as flags; changing
   one re-runs all four. The source filter and date range are applied in the UI on
   the loaded data, and weekly and monthly rows are summed from the engine's daily
   rows, so changing a filter is instant and animates instead of reloading.
2. `ui/shape.js` — pure functions, no DOM — normalises the raw JSON into view models
   (totals per period, series per agent and per model, heatmap cells, block timeline,
   project totals). It tolerates either field spelling ccusage emits
   (`cacheCreationTokens` / `cacheCreationInputTokens`, `totalCost` / `costUSD`,
   `modelName` / `model`) and missing optional keys.
3. Views render from view models only. Results are kept in memory; switching screens
   never re-runs the engine. Because the main query takes about 10 s on this machine,
   the last good results are also cached in `localStorage` and shown immediately at
   start-up while a fresh load runs. Auto-refresh every N seconds (default 60) re-runs **blocks**
   only; a manual Refresh re-runs all four.

The exact JSON shapes are captured from the real binary into `tests/fixtures/` as the
first implementation step; `shape.js` is written against those fixtures, not the docs.

## Screens

Sidebar navigation; a top bar with source filter, date range (presets: 7 d, 30 d,
90 d, this month, all time, custom), Refresh and last-updated time. Filters apply to
every screen except Blocks' live panel.

| Screen | Content |
|---|---|
| **Overview** | Four stat cards (today, this week, this month, selected range: cost, tokens, change vs previous period). Daily cost chart, stacked by agent, hover tooltip. Model split (ranked bars with share). Calendar heatmap of daily spend. Active-block card when a block is running. "Recent sessions" card: the 3 sessions with the latest activity (project, agent, relative time, tokens, cost); a row opens that session in Sessions, "See all" opens the Sessions screen. |
| **Reports** | Daily / Weekly / Monthly tabs. Sortable table: period, agents, models, input, output, cache write, cache read, total tokens, cost. Row expands to per-model breakdown. Totals row. Tokens/cost toggle on a small trend chart above the table. |
| **Sessions** | Search box (project, session id, model). Sortable list: project/session, agent, last activity, models, tokens, cost. Row expands to per-model breakdown. |
| **Blocks** | Live panel for the active block: spend, tokens, elapsed/remaining of 5 h, burn rate (tokens/min, $/h), projected end-of-block tokens and cost, bar against the token limit. Below: timeline of recent blocks (gaps shown), then full history table. |
| **Projects** | Claude Code projects ranked by cost with share bars; selecting one shows its daily trend. |
| **Settings** | Theme (System / Light / Dark). Timezone (system default or IANA name). Cost mode (auto / calculate / display). Offline pricing. Week starts on. Token limit (number or `max`). Auto-refresh interval. Close-to-tray on/off. Export current view as JSON or CSV. About + ccusage credit and licence. |

Settings persist in `localStorage` (single-user convenience data; the app works with
defaults if it is empty).

## Visual design

The app should feel like a native iOS/iPadOS app: calm, soft, spacious, and fluid. It
follows the conventions of that platform's design language without copying any Apple
asset (no SF fonts or SF Symbols are bundled; icons are our own inline SVGs).

**Layout and surfaces**
- iPadOS-style split view: a translucent sidebar (backdrop blur + saturation) and a
  content pane on a grouped background (light `#F2F2F7`-like, dark near-black).
- Each screen opens with a large title that collapses into a compact blurred top bar
  as the content scrolls.
- Content sits in inset grouped cards: continuous-looking corners (16–20 px), no hard
  borders, hairline separators inset from the leading edge, very soft shadows in
  light and elevated fills in dark.
- Controls are iOS-shaped: segmented controls with a sliding thumb, pill buttons,
  toggle switches, grouped list rows with chevrons, sheet-style panels that slide up
  over a dimmed backdrop for detail and for Settings pickers.

**Type and colour**
- System font stack (`"Segoe UI Variable Display"`, `"Segoe UI Variable Text"`,
  `system-ui`), tabular numerals for all figures; a type scale named after iOS text
  styles (largeTitle, title1–3, headline, body, callout, subheadline, footnote,
  caption).
- Colour tokens on `:root`, redefined for dark; `prefers-color-scheme` by default,
  `data-theme` attribute when overridden. Semantic tokens modelled on iOS system
  colours (label / secondaryLabel / tertiaryLabel, systemBackground /
  secondarySystemBackground / groupedBackground, separator, fill levels, tint). One
  tint colour; a fixed, colour-blind-safe categorical palette assigned to agents in a
  stable order; a single-hue sequential ramp for the heatmap. Both themes meet WCAG AA
  for text.

**Motion** — smoothness is a requirement, not a garnish.
- Only `transform`, `opacity` and `filter` are animated; no layout-affecting
  properties, so every animation stays on the compositor at the display's refresh
  rate.
- Spring-based easing tokens (CSS `linear()` spring curves) with three named springs:
  `--spring-snappy` (controls, ~250 ms), `--spring-smooth` (screen and sheet
  transitions, ~450 ms), `--spring-bouncy` (celebratory accents only).
- Screen changes use the View Transitions API: outgoing content fades and shifts,
  incoming content springs in; shared elements (a session row → its detail sheet, the
  segmented-control thumb, the sidebar selection pill) morph between states.
- Pressed states scale to 0.97 with a spring; lists stagger in by 20 ms per row
  (capped at 12 rows); stat figures count up; charts draw in (bars grow, lines trace)
  and re-flow between data sets by interpolating, never by snapping.
- Scrolling is native and momentum-based with overscroll contained per pane; long
  tables are rendered in chunks so scrolling never drops frames.
- Everything above collapses to simple 120 ms fades under `prefers-reduced-motion`.

**Design reference for future contributors (human or AI)**

The visual system lives in a few small files so additions stay consistent:

| File | Role |
|---|---|
| `src/Tokenscope/ui/design/tokens.css` | The only place raw values live: colours (both themes), type scale, spacing, radii, shadows, blur, springs, durations, z-index. Every token has a one-line comment saying when to use it. |
| `src/Tokenscope/ui/design/components.css` | One commented block per component (card, list row, segmented control, switch, button, sheet, stat, badge, table, chart primitives, skeleton, empty state), built only from tokens. |
| `src/Tokenscope/ui/design/gallery.html` | A living catalogue: every component in every state, in both themes, with the markup to copy. Opened from Settings → About → "Design gallery" and usable directly in a browser. |
| `docs/DESIGN.md` | The guide: principles, the token and component index, motion rules, do/don't list, and a step-by-step "adding a screen / a component / a chart" recipe. |
| `CLAUDE.md` (repo root) | Short project brief for AI agents: layout, build and test commands, and the rule "read `docs/DESIGN.md` before any UI change; never hard-code a value that has a token; add new components to the gallery". |

Rules enforced by a check, not by memory: `tests/design.test.mjs` fails if any CSS
or JS file outside `tokens.css` contains a raw colour (hex/rgb/hsl), or if a
component class defined in `components.css` is missing from `gallery.html`.

**Accessibility**
- Keyboard: every control reachable by Tab; `1`–`6` switch screens; `R` refreshes;
  visible focus rings. Charts have text equivalents (the tables).
- Loading shows skeleton placeholders in the final layout, never a blank window.

## Tray meter

- `NotifyIcon` with the app icon. Tooltip: `Active block · $12.40 · 2h 10m left ·
  3.1k tok/min`, or `No active block`.
- Left-click toggles the main window. Right-click menu: Open, Refresh now, Quit.
- Closing the window hides it to the tray when close-to-tray is on (default on, with a
  one-time balloon the first time); Quit exits.
- The tray text comes from the UI's `tray` message after each blocks refresh, so there
  is one source of truth for block maths. The hidden window keeps its refresh timer.
- Single instance: a second launch activates the existing window.

## Errors and empty states

| Situation | Behaviour |
|---|---|
| Engine exits non-zero or times out | Banner with the engine's stderr (first 2 000 chars) and Retry; last good data stays on screen |
| Engine output is not JSON | Same banner, message "ccusage returned unexpected output" |
| No usage data at all | Empty state naming the sources ccusage looks for, with a link to its docs |
| Filter matches nothing | Inline "No usage in this range" with a Reset filters button |
| Unpriced models (`totals.unpricedModels`, `missingPricing`) | "Unpriced" badge on the model and a note on the totals; never shown as free |
| WebView2 runtime missing | Native message box with the Microsoft download link, then exit |
| Engine unpack fails | Native message box with the path and the OS error, then exit |

## Testing

- `tests/shape.test.mjs`: Node's built-in `node:test` + `assert` against
  `tests/fixtures/*.json` (real engine output, plus one empty and one unpriced case).
  Covers period totals, per-agent/model series, heatmap cells, block burn-rate and
  projection maths, field-spelling tolerance. Run: `node --test "tests/*.test.mjs"`.
- Host: the arg allow-list is a pure static function with a small self-check run by
  `dotnet run -- --selfcheck` (exits non-zero on failure).
- `tests/design.test.mjs`: the token and gallery rules above.
- Manual gate: launch `dist/Tokenscope.exe` against this machine's real data; confirm
  each of the six screens renders in light and dark, the tray tooltip updates, and
  totals match `ccusage daily --json` for the same range.

## Out of scope

- Installer, auto-update, code signing (single-PC build).
- `ccusage statusline` (a Claude Code hook feature).
- Per-source path flags (`--pi-path`, `--open-claw-path`, …) and `ccusage.json` editing.
- Reimplementing ccusage's parsing or pricing; the bundled binary is the only engine.
- Non-Windows builds.
