// dom.js h() text safety and args.js engine arguments. Fake document built here; exports nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';

class FakeNode {
  constructor(nodeType, name) { this.nodeType = nodeType; this.nodeName = name; this.childNodes = []; this.attributes = {}; this.style = {}; this.dataset = {}; }
  appendChild(n) { this.childNodes.push(n); return n; }
  append(...ns) { for (const n of ns) this.appendChild(typeof n === 'string' ? globalThis.document.createTextNode(n) : n); }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  addEventListener() {}
}
globalThis.document = {
  createElement: (tag) => new FakeNode(1, tag.toUpperCase()),
  createElementNS: (_ns, tag) => new FakeNode(1, tag),
  createTextNode: (text) => Object.assign(new FakeNode(3, '#text'), { data: text, textContent: text }),
};

const { h } = await import('../src/Tokenscope/ui/dom.js');
const { engineArgs } = await import('../src/Tokenscope/ui/args.js');

test('h() turns a string child into a text node, never markup', () => {
  const el = h('div', null, '<img onerror=x>');
  assert.equal(el.childNodes.length, 1);
  assert.equal(el.childNodes[0].nodeType, 3);
  assert.equal(el.childNodes[0].data, '<img onerror=x>');
  assert.equal(el.childNodes.filter((n) => n.nodeType === 1).length, 0);
});

test('h() applies class, attrs and nested children; skips null/false', () => {
  const el = h('a', { class: 'ts-nav-item', attrs: { href: '#x', 'aria-current': 'page' } }, h('span', null, 'A'), null, false, 3);
  assert.equal(el.attributes.class, 'ts-nav-item');
  assert.equal(el.attributes.href, '#x');
  assert.equal(el.attributes['aria-current'], 'page');
  assert.deepEqual(el.childNodes.map((n) => n.nodeName), ['SPAN', '#text']);
  assert.equal(el.childNodes[1].data, '3');
});

test('engineArgs: default settings', () => {
  assert.deepEqual(engineArgs({ timezone: '', costMode: 'auto', offline: false, tokenLimit: '' }), {
    main: ['daily', '--sections', 'daily,session', '--by-agent'],
    sessions: ['claude', 'session'],
    blocks: ['blocks'],
    projects: ['claude', 'daily', '--instances'],
  });
});

test('engineArgs: timezone, cost mode, offline, token limit', () => {
  const c = ['--timezone', 'UTC', '--mode', 'calculate', '--offline'];
  assert.deepEqual(engineArgs({ timezone: 'UTC', costMode: 'calculate', offline: true, tokenLimit: 'max' }), {
    main: ['daily', '--sections', 'daily,session', '--by-agent', ...c],
    sessions: ['claude', 'session', ...c],
    blocks: ['blocks', ...c, '--token-limit', 'max'],
    projects: ['claude', 'daily', '--instances', ...c],
  });
});
