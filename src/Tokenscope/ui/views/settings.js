// Settings: appearance, engine options, behaviour, export and credits. Changes apply immediately.

import { h } from '../dom.js';
import { icon as glyph, row, list, segmented, switchInput } from '../kit.js';

export const id = 'settings';
export const title = 'Settings';
export const tile = 'var(--cat-8)';
export const icon = () => glyph('settings');
export const filters = false;
export const needsData = false;

const APP_VERSION = '1.0.0';
const ENGINE_VERSION = '20.0.50';
const REPO_URL = 'https://github.com/ccusage/ccusage';
const LICENSE_URL = 'https://github.com/ccusage/ccusage/blob/main/LICENSE';

// A validated text field in a row's trailing slot. `parse` returns the value to store, or throws
// an Error whose message is shown under the field.
function field({ label, value, placeholder, width = '12rem', parse, onCommit }) {
  const message = h('p', { class: 'ts-field-message' });
  const input = h('input', {
    class: 'ts-field-input', attrs: { type: 'text', value: String(value ?? ''), placeholder, 'aria-label': label, spellcheck: 'false', autocomplete: 'off' },
    onchange: () => {
      try {
        const parsed = parse(input.value.trim());
        input.removeAttribute('aria-invalid');
        message.textContent = '';
        input.value = String(parsed);
        onCommit(parsed);
      } catch (e) {
        input.setAttribute('aria-invalid', 'true');
        message.textContent = e.message;
      }
    },
    onkeydown: e => { if (e.key === 'Enter') input.blur(); },
  });
  return h('div', { attrs: { style: `inline-size: ${width}` } }, h('label', { class: 'ts-field' }, input), message);
}

const timezone = v => {
  if (!v) return '';
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: v }).resolvedOptions().timeZone; }   // canonical spelling
  catch { throw new Error('Not a known timezone. Example: Europe/London'); }
};
const tokenLimit = v => {
  if (!v) return '';
  if (v.toLowerCase() === 'max') return 'max';
  if (!/^\d{1,12}$/.test(v) || Number(v) < 1) throw new Error('Enter a whole number of tokens, or "max".');
  return String(Number(v));
};
const refreshSec = v => {
  const n = Number(v);
  if (!/^\d+$/.test(v) || n < 15 || n > 600) throw new Error('Enter 15 to 600 seconds.');
  return n;
};

export function render(el, ctx) {
  const { settings, actions, vm } = ctx;
  const set = key => value => actions.setSetting(key, value);
  const exportButtons = what => h('span', { class: 'ts-toolbar-group' }, ['csv', 'json'].map(format =>
    h('button', { class: 'ts-button ts-button--tinted', attrs: { type: 'button', disabled: !vm }, onclick: () => actions.exportData(what, format) }, glyph('download'), format.toUpperCase())));
  const link = (label, url) => h('button', { class: 'ts-button ts-button--plain', attrs: { type: 'button' }, onclick: () => actions.openExternal(url) }, label, glyph('external'));

  el.replaceChildren(...[
    list('Appearance', [
      row({ title: 'Theme', subtitle: 'System follows the Windows app theme.', trailing: segmented({
        name: 'theme', label: 'Theme', value: settings.theme, onChange: set('theme'),
        options: [{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }],
      }) }),
    ]),
    list('Data', [
      row({ title: 'Timezone', subtitle: 'Used to group usage into days. Empty uses this PC\'s timezone.', trailing: field({
        label: 'Timezone', value: settings.timezone, placeholder: Intl.DateTimeFormat().resolvedOptions().timeZone, parse: timezone, onCommit: set('timezone'),
      }) }),
      row({ title: 'Cost mode', subtitle: 'Auto uses logged costs when present; Calculate always prices tokens; Display only shows logged costs.', trailing: segmented({
        name: 'cost-mode', label: 'Cost mode', value: settings.costMode, onChange: set('costMode'),
        options: [{ value: 'auto', label: 'Auto' }, { value: 'calculate', label: 'Calculate' }, { value: 'display', label: 'Display' }],
      }) }),
      row({ title: 'Offline pricing', subtitle: 'Use the price list bundled with ccusage and skip the online update.', trailing: switchInput({ label: 'Offline pricing', checked: settings.offline, onChange: set('offline') }) }),
      row({ title: 'Week starts on', trailing: segmented({
        name: 'week-start', label: 'Week starts on', value: settings.weekStart, onChange: v => { actions.setSetting('weekStart', v); },
        options: [{ value: 'sunday', label: 'Sunday' }, { value: 'monday', label: 'Monday' }],
      }) }),
      row({ title: 'Block token limit', subtitle: 'A number of tokens, or "max" for your largest past block. Empty turns the limit bar off.', trailing: field({
        label: 'Block token limit', value: settings.tokenLimit, placeholder: 'Off', parse: tokenLimit, onCommit: set('tokenLimit'),
      }) }),
    ], 'Timezone, cost mode, offline pricing and the token limit reload all data.'),
    list('Behaviour', [
      row({ title: 'Live refresh interval', subtitle: 'How often the active block and tray meter update, in seconds.', trailing: field({
        label: 'Live refresh interval', value: settings.refreshSec, width: '6rem', parse: refreshSec, onCommit: set('refreshSec'),
      }) }),
      row({ title: 'Keep running in the tray', subtitle: 'Closing the window hides it; use Quit in the tray menu to exit.', trailing: switchInput({ label: 'Keep running in the tray', checked: settings.closeToTray, onChange: set('closeToTray') }) }),
    ]),
    list('Export', [
      row({ title: 'Daily usage', subtitle: 'The days in the current range and source filter.', trailing: exportButtons('daily') }),
      row({ title: 'Sessions', subtitle: 'The sessions in the current range and source filter.', trailing: exportButtons('sessions') }),
    ]),
    list('About', [
      row({ title: 'Tokenscope', subtitle: 'An unofficial desktop front end for ccusage.', trailing: `Version ${APP_VERSION}` }),
      row({ title: `ccusage ${ENGINE_VERSION}`, subtitle: 'The bundled engine that reads the logs and prices them. MIT licence, © ryoppippi.', trailing: h('span', { class: 'ts-toolbar-group' }, link('Project', REPO_URL), link('Licence', LICENSE_URL)) }),
      row({ title: 'Design gallery', subtitle: 'Every component and token used by this app.', onClick: () => { location.href = 'design/gallery.html'; } }),
    ], 'Shortcuts: 1–6 switch screens, R refreshes.'),
  ].flat().filter(Boolean));
}
