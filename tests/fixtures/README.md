# Engine fixtures

Synthetic demo data in the exact shapes `ccusage` 20.0.50 prints, written by `node scripts/make-demo-fixtures.mjs`.
It contains no real usage: projects, sessions, tokens and costs are invented. The dev preview and the tests read these files.
Counts and totals quoted below describe the original capture the parser was built against, not the demo files.

| Fixture | Command |
|---|---|
| `main.json` | `ccusage daily --sections daily,session --by-agent --json` (10 to 12 s on a large log directory) |
| `blocks.json` | `ccusage blocks --json` |
| `projects.json` | `ccusage claude daily --instances --json` |
| `claude-sessions.json` | `ccusage claude session --json` |

## Naming cheat sheet (numbers are plain JSON numbers, cost in USD)

- cost: `totalCost` (daily, session, project rows, `totals`), `cost` (inside `modelBreakdowns`), `costUSD` (blocks)
- tokens: `inputTokens`, `outputTokens`, `cacheCreationTokens`, `cacheReadTokens`, `totalTokens`;
  **blocks use `tokenCounts.{inputTokens,outputTokens,cacheCreationInputTokens,cacheReadInputTokens}`** (different names)
- model name: `modelName` in `modelBreakdowns[]`; plain strings in `modelsUsed[]` / blocks `models[]`
- session id: `period` in `session[]` rows (claude: a UUID; codex: a relative path such as `2026/07/22/rollout-2026-07-22T14-40-36-<uuid>`, sometimes just `rollout-...`); `sessionId` in `claude-sessions.json` (equal to the claude `period`)
- project: **none in `main.json`** (session rows carry no project). `projects.json` has it per day (`project` on each row and the key of `projects`); `claude-sessions.json` has it per Claude session (`projectPath`, the same key), which is how sessions are joined to projects. Codex sessions have no project anywhere
- last activity: `metadata.lastActivity` on `session[]` rows (ISO-8601 UTC string). Day rows have no such field (`period` is `YYYY-MM-DD`). `claude-sessions.json` rows have top-level `firstActivity` and `lastActivity` instead
- agent: `agent` on every `daily[].agents[]` and `session[]` row; distinct values: `claude`, `codex`. Top-level `daily[].agent` is always the literal `"all"`
- no key is `null` anywhere except in `blocks.json` (see below)

## main.json

Top-level keys: `daily`, `session`, `totals`.

- `totals` (object): `cacheCreationTokens, cacheReadTokens, inputTokens, outputTokens, totalCost, totalTokens`.
- `daily` (array, 84 rows, ascending by `period`, 2026-07-14 .. 2026-11-11), row keys, all always present:
  `agent` ("all"), `agents`, `cacheCreationTokens`, `cacheReadTokens`, `inputTokens`, `metadata`, `modelBreakdowns`, `modelsUsed`, `outputTokens`, `period` (`YYYY-MM-DD`), `totalCost`, `totalTokens`.
  - `daily[].metadata` (object): only `agents` (array of strings, e.g. `["codex"]`; same agents as `agents[].agent`).
  - `daily[].agents[]` (97 rows total; 13 days have two agents): `agent, cacheCreationTokens, cacheReadTokens, inputTokens, modelBreakdowns, modelsUsed, outputTokens, totalCost, totalTokens`. This is the per-agent split; the day row is the sum.
  - `daily[].modelBreakdowns[]` (201 rows) and `daily[].agents[].modelBreakdowns[]` (201 rows): `cacheCreationTokens, cacheReadTokens, cost, inputTokens, modelName, outputTokens`, plus **optional** `cacheCreation1hTokens` (present on 70 of 201; claude rows only; a subset of `cacheCreationTokens`).
  - `modelsUsed[]`: array of model-name strings.
- `session` (array, 463 rows, **not** sorted by date), row keys:
  `agent, cacheCreationTokens, cacheReadTokens, inputTokens, metadata, modelBreakdowns, modelsUsed, outputTokens, period, totalCost, totalTokens`, all always present.
  - `session[].metadata` (object): `lastActivity` (always), `reasoningOutputTokens` (**optional**, 407 of 463, codex).
  - `session[].modelBreakdowns[]` (499 rows): same keys as above, `cacheCreation1hTokens` optional (78 of 499).
- Models seen: claude: `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`, `claude-fable-5-2`; codex: `gpt-5`, `gpt-5.4`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-6-astra`, `gpt-6-sol`, `gpt-6.1-sol`.



## blocks.json

Top-level keys: `blocks` only (no `totals`). 142 rows, ascending by `startTime`: 101 normal, 40 gap, 1 active. Claude only (all `models` are claude models). Every row has exactly these 13 keys, regardless of kind:
`actualEndTime` (string, or `null` on gaps), `burnRate` (`null` except on the active block), `costUSD`, `endTime`, `entries`, `id`, `isActive`, `isGap`, `models` (string array; `[]` on gaps), `projection` (`null` except on the active block), `startTime`, `tokenCounts`, `totalTokens`.

- `tokenCounts` (object, always present, zeros on gaps): `cacheCreationInputTokens, cacheReadInputTokens, inputTokens, outputTokens`.
- `burnRate` (active block only): `costPerHour, tokensPerMinute, tokensPerMinuteForIndicator`.
- `projection` (active block only): `remainingMinutes, totalCost, totalTokens`.
- gap block: `isGap: true`, `id` is `gap-<ISO start>`, `actualEndTime: null`, `costUSD: 0`, `entries: 0`, `models: []`, zero tokens, `burnRate` and `projection` null. `startTime`/`endTime` span the gap.
- normal block: `id` is the ISO start time of the 5-hour window (e.g. `2026-09-29T23:00:00.000Z`), `isActive: false`, `burnRate`/`projection` null.
- The active block's `endTime` (2026-11-12T04:00Z) can be in the future; `projection.remainingMinutes` was 0 in the capture.

## projects.json

Top-level keys: `projects`, `totals`. **`projects` is an object keyed by project (not an array)**: 20 keys, each an array of per-day rows. Claude only. Keys are the sanitized project directory (path separators become `-`, e.g. `Y--Programs-Sample-App`, `C--Users-alex-Downloads-claude-api-usage-costs-translator`; scratch workspaces appear as long `C--Users-alex-AppData-Local-Claude-Data-...` keys). Every row's `project` equals its key.

- Row keys (all always present; 1 to 18 rows per project): `cacheCreationTokens, cacheReadTokens, date` (`YYYY-MM-DD`), `inputTokens, modelBreakdowns, modelsUsed, outputTokens, project, totalCost, totalTokens`.
- `modelBreakdowns[]`: `cacheCreation1hTokens` (always present here), `cacheCreationTokens, cacheReadTokens, cost, inputTokens, modelName, outputTokens`.
- `totals` (object): `cacheCreationTokens, cacheReadTokens, inputTokens, outputTokens, totalCost, totalTokens`
- Note the date key here is `date`, whereas `main.json` daily rows use `period`.

## claude-sessions.json

Command: `engine/ccusage.exe claude session --json` (about 1 s, nothing on stderr). Added because
`main.json` session rows carry no project. Top-level keys: `sessions`, `totals`.

- `sessions[]`: 56 rows (one per claude row of `main.json` `session[]`, a 1:1 match on id), **not** sorted by activity. Row keys, all always present: `cacheCreationTokens, cacheReadTokens, firstActivity, inputTokens, lastActivity, modelBreakdowns, modelsUsed, outputTokens, projectPath, sessionId, totalCost, totalTokens`.
- `sessionId` equals the `period` of the matching `agent: "claude"` row in `main.json` `session[]`.
- `projectPath` is the same sanitized project key used in `projects.json` (e.g. `Y--Programs-Sample-App`).
- Codex has no equivalent: `codex session` rows only have `directory` (a date path) and `sessionFile`.
- `sessions[].modelBreakdowns[]` (78 rows): `cacheCreation1hTokens, cacheCreationTokens, cacheReadTokens, cost, inputTokens, modelName, outputTokens` — `cacheCreation1hTokens` is always present here (optional in `main.json`).
- `totals` (object): `cacheCreationTokens, cacheReadTokens, inputTokens, outputTokens, totalCost, totalTokens`.
- Captured a few minutes after `main.json`: `lastActivity` differs from `main.json` on 3 of 56 sessions. Treat `main.json` as authoritative for usage and activity; use this file only for `sessionId` → `projectPath`.
