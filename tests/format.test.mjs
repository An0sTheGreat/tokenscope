import { test } from 'node:test';
import assert from 'node:assert/strict';
import { money, tokens, duration, relative, pct } from '../src/Tokenscope/ui/format.js';

test('money: thousands separator, sub-cent and zero', () => {
  assert.equal(money(1234.56), '$1,234.56');
  assert.equal(money(0.004), '<$0.01');
  assert.equal(money(0), '$0.00');
});

test('tokens: plain, k, M, B', () => {
  assert.equal(tokens(999), '999');
  assert.equal(tokens(1234), '1.2k');
  assert.equal(tokens(3_400_000), '3.4M');
  assert.equal(tokens(1_200_000_000), '1.2B');
  assert.equal(tokens(999_960), '1.0M'); // rounds up into the next unit, never '1000.0k'
});

test('duration: hours and minutes, minutes only', () => {
  assert.equal(duration(130), '2h 10m');
  assert.equal(duration(45), '45m');
});

test('relative: just now, minutes, hours, yesterday, day + month', () => {
  const now = Date.parse('2026-11-20T12:00:00Z');
  const ago = ms => new Date(now - ms).toISOString();
  assert.equal(relative(ago(30e3), now), 'just now');
  assert.equal(relative(ago(5 * 60e3), now), '5m ago');
  assert.equal(relative(ago(3 * 3600e3), now), '3h ago');
  assert.equal(relative(ago(30 * 3600e3), now), 'yesterday');
  // noon UTC is 12 Nov in every timezone from UTC-11 to UTC+11
  assert.equal(relative('2026-11-12T12:00:00Z', now), '12 Nov');
});

test('pct: share as a rounded percentage', () => {
  assert.equal(pct(0.5), '50%');
  assert.equal(pct(0.256), '26%');
});

test('relative: missing or unparsable date gives an em dash', () => {
  for (const v of [null, undefined, '', 'garbage']) assert.equal(relative(v, Date.now()), '—');
});
