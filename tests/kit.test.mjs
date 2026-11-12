// Pure helpers of the view kit (no DOM needed to import it).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fillDays, addDays, agentColor } from '../src/Tokenscope/ui/kit.js';

const day = (period, cost = 1) => ({ period, cost, tokens: 1, agents: [], models: [] });

test('fillDays: zero-fills every day from since to until', () => {
  const out = fillDays([day('2026-03-02', 5)], '2026-03-01', '2026-03-04');
  assert.deepEqual(out.map(r => r.period), ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04']);
  assert.deepEqual(out.map(r => r.cost), [0, 5, 0, 0]);
});

test('fillDays: a very long range keeps the most recent days, never drops the end', () => {
  const out = fillDays([day('2026-11-11', 7)], '2020-01-01', '2026-11-11');
  assert.equal(out.length, 800);
  assert.equal(out.at(-1).period, '2026-11-11');
  assert.equal(out.at(-1).cost, 7);
  assert.equal(out[0].period, addDays('2026-11-11', -799));
});

test('fillDays: no rows gives no days; without since it starts at the first row', () => {
  assert.deepEqual(fillDays([], '2026-01-01', '2026-01-03'), []);
  assert.deepEqual(fillDays([day('2026-01-02'), day('2026-01-04')], null, null).map(r => r.period), ['2026-01-02', '2026-01-03', '2026-01-04']);
});

test('agentColor: claude and codex are fixed, others follow alphabetically', () => {
  const agents = ['gemini', 'claude', 'amp', 'codex'];
  assert.equal(agentColor('claude', agents), 'var(--cat-1)');
  assert.equal(agentColor('codex', agents), 'var(--cat-2)');
  assert.equal(agentColor('amp', agents), 'var(--cat-3)');
  assert.equal(agentColor('gemini', agents), 'var(--cat-4)');
});
