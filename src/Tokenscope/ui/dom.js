// DOM helpers shared by app.js, views and charts. Strings always become text nodes, so data from
// disk can never become markup. Nothing here touches window/document at import time.

const SVG_NS = 'http://www.w3.org/2000/svg';
const reducedMotion = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function appendChildren(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === true) continue;
    el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
  return el;
}

const setAttrs = (el, attrs) => {
  for (const [k, v] of Object.entries(attrs ?? {})) if (v != null && v !== false) el.setAttribute(k, v === true ? '' : v);
};

// props: class, dataset, on<Event> handlers, attrs (any attribute, incl. style, aria-*, role).
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  const { class: cls, dataset, attrs, ...rest } = props ?? {};
  if (cls) el.setAttribute('class', cls);
  if (dataset) Object.assign(el.dataset, dataset);
  setAttrs(el, attrs);
  for (const [k, v] of Object.entries(rest)) {
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
  }
  return appendChildren(el, children);
}

// attrs: every attribute, incl. class and style; on<Event> functions become listeners.
export function svg(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else setAttrs(el, { [k]: v });
  }
  return appendChildren(el, children);
}

// ---- sheet: index.html provides an empty <div class="ts-sheet" inert> inside .ts-app-pane ----

let sheetReturnFocus = null;
// While a sheet is open everything behind it is inert, so Tab and clicks stay inside the dialog.
const setBehindInert = on => document.querySelectorAll('.ts-app-main, .ts-sidebar').forEach(el => { el.inert = on; });
const onSheetKey = e => { if (e.key === 'Escape') closeSheet(); };

export function openSheet(titleText, contentEl) {
  const host = document.querySelector('.ts-sheet');
  sheetReturnFocus = document.activeElement;
  const done = h('button', { class: 'ts-button ts-button--plain', attrs: { type: 'button' }, onclick: closeSheet }, 'Done');
  host.replaceChildren(
    h('div', { class: 'ts-sheet-backdrop', onclick: closeSheet }),
    h('section', { class: 'ts-sheet-panel', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ts-sheet-title' } },
      h('div', { class: 'ts-sheet-grabber' }),
      h('header', { class: 'ts-sheet-header' }, h('h2', { class: 'ts-sheet-title', attrs: { id: 'ts-sheet-title' } }, titleText), done),
      h('div', { class: 'ts-sheet-body' }, contentEl)));
  host.inert = false;
  setBehindInert(true);
  requestAnimationFrame(() => requestAnimationFrame(() => host.setAttribute('data-open', ''))); // after first style, so it slides
  document.addEventListener('keydown', onSheetKey);
  done.focus({ preventScroll: true });
}

export function closeSheet() {
  const host = document.querySelector('.ts-sheet');
  if (!host || host.inert) return;
  host.removeAttribute('data-open');
  host.inert = true;
  setBehindInert(false);
  document.removeEventListener('keydown', onSheetKey);
  sheetReturnFocus?.focus?.({ preventScroll: true });
  sheetReturnFocus = null;
}

// ---- tooltip: one shared .ts-tooltip on <body>, positioned with style.translate ----

let tip = null;
const hideTip = () => tip?.removeAttribute('data-open');

function tipEl() {
  if (tip) return tip;
  tip = h('div', { class: 'ts-tooltip', attrs: { role: 'tooltip' } });
  document.body.appendChild(tip);
  document.addEventListener('scroll', hideTip, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hideTip(); });
  return tip;
}

// getContentEl(event) returns the tooltip content (or null to hide) for the pointer position.
export function tooltip(targetEl, getContentEl) {
  const GAP = 12;
  const show = e => {
    const content = getContentEl(e);
    if (!content) return hideTip();
    const t = tipEl();
    t.replaceChildren(content);
    const r = targetEl.getBoundingClientRect();
    const x0 = e.clientX ?? r.left + r.width / 2;
    const y0 = e.clientY ?? r.top;
    const { width: w, height: ht } = t.getBoundingClientRect();
    let x = x0 + GAP;
    if (x + w > innerWidth - GAP) x = x0 - GAP - w; // flip left at the right edge
    let y = y0 - GAP - ht;
    if (y < GAP) y = y0 + GAP; // flip below at the top edge
    t.style.translate = `${Math.max(GAP, Math.round(x))}px ${Math.round(y)}px`;
    t.setAttribute('data-open', '');
  };
  targetEl.addEventListener('pointermove', show);
  targetEl.addEventListener('focus', show);
  targetEl.addEventListener('pointerleave', hideTip);
  targetEl.addEventListener('blur', hideTip);
}

// ---- motion helpers ----

export function countUp(el, to, formatFn = String) {
  cancelAnimationFrame(el._countRaf);
  const from = el._countValue ?? 0;
  el._countValue = to;
  if (reducedMotion() || from === to) { el.textContent = formatFn(to); return; }
  const start = performance.now();
  const MS = 600;
  const step = now => {
    const p = Math.min(1, (now - start) / MS);
    el.textContent = formatFn(from + (to - from) * (1 - (1 - p) ** 3)); // ease-out cubic
    if (p < 1) el._countRaf = requestAnimationFrame(step);
  };
  el._countRaf = requestAnimationFrame(step);
}

// Sets --i (the ts-enter stagger index) on the children; the index is capped at 12.
export function stagger(parentEl) {
  [...parentEl.children].forEach((c, i) => c.style.setProperty('--i', String(Math.min(i, 12))));
}

// First chunk synchronously, the rest one chunk per frame; a new call on the same container
// cancels the previous one.
export function chunked(container, items, renderItem, size = 60) {
  const token = {};
  container._chunkToken = token;
  container.replaceChildren();
  let i = 0;
  const next = () => {
    if (container._chunkToken !== token) return;
    const end = Math.min(items.length, i + size);
    const frag = document.createDocumentFragment();
    for (; i < end; i++) frag.appendChild(renderItem(items[i], i));
    container.appendChild(frag);
    if (i < items.length) requestAnimationFrame(next);
  };
  next();
}

// Screen changes: a view transition when supported and motion is allowed, else a plain call.
export function transition(updateFn) {
  if (!document.startViewTransition || reducedMotion()) { updateFn(); return Promise.resolve(); }
  return document.startViewTransition(updateFn).updateCallbackDone;
}
