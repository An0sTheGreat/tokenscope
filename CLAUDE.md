# Tokenscope

Windows desktop dashboard that shows AI coding-agent token usage and cost (Claude Code, Codex, and other sources). A .NET 10 WinForms window hosts a WebView2 UI. All data comes from the bundled official `ccusage` CLI, which the host runs locally with an allow-list of commands and flags. The UI aims for an iOS-like feel: grouped cards, one tint, spring motion.

## Layout
- `src/Tokenscope/ui/`: the UI. ES modules, no build step, no dependencies. Design system in `ui/design/` (`tokens.css`, `components.css`, `gallery.html`).
- `src/Tokenscope/`: the host (`Program.cs` entry and `--selfcheck`, `Engine.cs` arg policy and engine runner, `MainForm.cs` window, WebView2, bridge, tray).
- `engine/`: pinned official `ccusage.exe` v20.0.50, fetched by `node scripts/fetch-engine.mjs` (the exe is gitignored).
- `tests/`: Node tests and `tests/fixtures/*.json`.
- `docs/superpowers/`: spec and implementation plan. `docs/DESIGN.md`: design guide.

## Commands
- Tests: `node --test "tests/*.test.mjs"`. (`node --test tests/` does not work on Node 24.)
- Host self-check: `dotnet run --project src/Tokenscope -- --selfcheck`
- Build: `./build.ps1` → `dist/Tokenscope.exe`
- Dev preview: from the repo root run `python -m http.server 5173`, then open `http://localhost:5173/src/Tokenscope/ui/index.html`. Outside the host the UI reads `tests/fixtures/*.json` instead of the engine.
- Gallery: `http://localhost:5173/src/Tokenscope/ui/design/gallery.html`

## UI rules
- Read `docs/DESIGN.md` before any UI change.
- Build screens from `ui/kit.js` (`card`, `stat`, `row`, `list`, `dataTable`, `segmented`, `toolbar`, `empty`) and `ui/charts.js`, not from hand-written markup; a new screen is one file in `ui/views/` plus an entry in `VIEWS` in `app.js`.
- Never hard-code a value that has a token. Colours exist only in `tokens.css`, for both themes.
- Add every new component class to `gallery.html`, and its entry to `docs/DESIGN.md`.
- Animate only transform, opacity and filter (`translate`/`scale`/`rotate` included).
- No `innerHTML`, `outerHTML` or `insertAdjacentHTML`. Strings from disk are untrusted. Build DOM with `h()`/`svg()`.
- Views never call the engine or `bridge.js`. They read `ctx.vm` and act through `ctx.actions`.
- Check every UI change in light and dark.

## Data rules
- All engine JSON goes through `ui/shape.js` (pure, tested in `tests/shape.test.mjs`). Add derivations there, not in views.
- The host runs only allow-listed ccusage commands and flags (`ArgPolicy` in `Engine.cs`). A new flag needs `ui/args.js` and `ArgPolicy` changed together, with tests on the JS side.

## Safety
- `tests/fixtures/` is synthetic demo data from `node scripts/make-demo-fixtures.mjs`. Never commit real ccusage output: it holds project names and costs.
- Work on feature branches. Never merge to `main` unless asked.
