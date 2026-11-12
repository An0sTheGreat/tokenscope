// Design-system rules for src/Tokenscope/ui (see docs/DESIGN.md). Exports nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = join(import.meta.dirname, '..');
const ui = join(root, 'src', 'Tokenscope', 'ui');
const tokensPath = join(ui, 'design', 'tokens.css');
const componentsPath = join(ui, 'design', 'components.css');
const galleryPath = join(ui, 'design', 'gallery.html');

const read = (p) => readFileSync(p, 'utf8');
const rel = (p) => relative(root, p).split(sep).join('/');
const stripCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const styleBlocks = (html) => [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
const uiFiles = (ext) =>
  readdirSync(ui, { recursive: true })
    .filter((f) => f.endsWith(ext))
    .map((f) => join(ui, f));

// Every CSS source under ui/ except tokens.css: .css files plus <style> blocks of .html files.
const cssSources = () => [
  ...uiFiles('.css').filter((p) => p !== tokensPath).map((p) => ({ p, css: stripCss(read(p)) })),
  ...uiFiles('.html').map((p) => ({ p, css: stripCss(styleBlocks(read(p))) })),
];

// `prop: value` pairs; a declaration starts after `{` or `;`.
const declarations = (css) =>
  [...css.matchAll(/(?:^|[{;])\s*(-{0,2}[a-zA-Z_][\w-]*)\s*:\s*([^;{}]+)/g)].map((m) => ({
    prop: m[1].toLowerCase(),
    value: m[2].trim().replace(/\s+/g, ' '),
  }));

// Body of the first `{…}` block whose opening matches `re`, brace-balanced.
function blockBody(css, re) {
  const m = re.exec(css);
  if (!m) return null;
  let depth = 0;
  const start = css.indexOf('{', m.index);
  for (let i = start; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(start + 1, i);
  }
  return null;
}
const customProps = (body) => new Map(declarations(body).filter((d) => d.prop.startsWith('--')).map((d) => [d.prop, d.value]));

const RAW_COLOUR =
  /(?<![\w&-])#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})(?![\w-])|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(/gi;
// ponytail: common CSS colour keywords only, not all 148; extend the list if one slips through.
const NAMED =
  'white|black|red|green|blue|yellow|orange|purple|pink|gray|grey|silver|navy|teal|aqua|cyan|magenta|fuchsia|lime|maroon|olive|gold|brown|indigo|violet|crimson|coral|salmon|tomato|beige|ivory';
const NAMED_IN_VALUE = new RegExp(`(?<![\\w-])(?:${NAMED})(?![\\w(-])`, 'i');
const NAMED_IN_STRING = new RegExp(`(['"\`])(?:${NAMED})\\1`, 'i');

test('no raw colour outside tokens.css (colours reach CSS/JS/HTML only as var(--token))', () => {
  const hits = [];
  for (const p of [...uiFiles('.css'), ...uiFiles('.js'), ...uiFiles('.html')]) {
    if (p === tokensPath) continue;
    const text = p.endsWith('.css') ? stripCss(read(p)) : read(p);
    for (const m of text.matchAll(RAW_COLOUR)) hits.push(`${rel(p)}: ${m[0]}`);
    if (p.endsWith('.js')) {
      for (const m of text.matchAll(new RegExp(NAMED_IN_STRING, 'gi'))) hits.push(`${rel(p)}: ${m[0]}`);
    }
  }
  for (const { p, css } of cssSources()) {
    for (const d of declarations(css)) {
      if (!d.prop.startsWith('--') && NAMED_IN_VALUE.test(d.value)) hits.push(`${rel(p)}: ${d.prop}: ${d.value}`);
    }
  }
  assert.deepEqual(hits, [], 'raw colours found; define a token in tokens.css and use var(--token)');
});

test('every .ts-* class defined in components.css appears in gallery.html', () => {
  const classes = new Set([...stripCss(read(componentsPath)).matchAll(/\.(ts-[\w-]+)/g)].map((m) => m[1]));
  assert.ok(classes.size > 0, 'components.css defines no .ts-* classes');
  const gallery = read(galleryPath);
  const missing = [...classes].filter((c) => !new RegExp(`(?<![\\w-])${c}(?![\\w-])`).test(gallery));
  assert.deepEqual(missing, [], 'add these to gallery.html');
});

test('every var() is defined; themed tokens are defined for light and both dark blocks', () => {
  const tokensCss = stripCss(read(tokensPath));
  const tokenNames = new Set(customProps(tokensCss).keys());
  const undefinedVars = [];
  for (const { p, css } of cssSources()) {
    const local = new Set(customProps(css).keys());
    for (const m of css.matchAll(/var\(\s*(--[\w-]+)/g)) {
      if (!tokenNames.has(m[1]) && !local.has(m[1])) undefinedVars.push(`${rel(p)}: ${m[1]}`);
    }
  }
  assert.deepEqual(undefinedVars, [], 'var() names defined neither in tokens.css nor in the same file');

  const light = blockBody(tokensCss, /(?:^|\})\s*:root\s*\{/);
  const mediaBody = blockBody(tokensCss, /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{/);
  const darkMedia = mediaBody && blockBody(mediaBody, /:root:not\(\[data-theme="light"\]\)\s*\{/);
  const darkAttr = blockBody(tokensCss, /:root\[data-theme="dark"\]\s*\{/);
  assert.ok(light && darkMedia && darkAttr, 'tokens.css needs :root, the prefers-color-scheme dark block and :root[data-theme="dark"]');

  const lightProps = customProps(light);
  const dark = customProps(darkMedia);
  assert.deepEqual(dark, customProps(darkAttr), 'the two dark blocks must be identical');

  const themed = /^--(?:color|cat|heat|shadow)-/;
  const isRaw = (v) => new RegExp(RAW_COLOUR.source, 'i').test(v.replace(/color-mix\(/gi, ''));
  const problems = [];
  for (const name of tokenNames) {
    if (!themed.test(name)) continue;
    if (!lightProps.has(name)) problems.push(`${name}: missing from the light :root block`);
    // A token derived only from other tokens (var()/color-mix) follows the theme by itself.
    else if (isRaw(lightProps.get(name)) && !dark.has(name)) problems.push(`${name}: raw light value but no dark value`);
  }
  for (const name of dark.keys()) if (!lightProps.has(name)) problems.push(`${name}: dark-only token`);
  assert.deepEqual(problems, []);
});

test('no innerHTML / outerHTML / insertAdjacentHTML in ui JS or HTML', () => {
  const hits = [];
  for (const p of [...uiFiles('.js'), ...uiFiles('.html')]) {
    for (const m of read(p).matchAll(/\b(?:innerHTML|outerHTML|insertAdjacentHTML)\b/g)) hits.push(`${rel(p)}: ${m[0]}`);
  }
  assert.deepEqual(hits, [], 'build DOM with createElement + textContent');
});

test('transitions and keyframes animate only transform, opacity, filter (and translate/scale/rotate)', () => {
  const allowed = new Set(['transform', 'translate', 'scale', 'rotate', 'opacity', 'filter', 'none']);
  const splitTop = (v) => {
    const parts = [];
    let depth = 0;
    let cur = '';
    for (const ch of v) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) parts.push(cur), (cur = '');
      else cur += ch;
    }
    return [...parts, cur].map((s) => s.trim());
  };
  const bad = [];
  for (const { p, css } of cssSources()) {
    for (const d of declarations(css)) {
      if (d.prop !== 'transition' && d.prop !== 'transition-property') continue;
      for (const item of splitTop(d.value)) {
        const prop = item.split(' ')[0];
        if (!allowed.has(prop)) bad.push(`${rel(p)}: ${d.prop}: ${d.value}`);
      }
    }
    for (const m of css.matchAll(/@keyframes\s+([\w-]+)/g)) {
      const body = blockBody(css.slice(m.index), /@keyframes/);
      for (const d of declarations(body.replace(/[^{}]*\{/g, '{'))) {
        if (!allowed.has(d.prop)) bad.push(`${rel(p)}: @keyframes ${m[1]} animates ${d.prop}`);
      }
    }
  }
  assert.deepEqual(bad, [], 'animate only compositor properties');
});
