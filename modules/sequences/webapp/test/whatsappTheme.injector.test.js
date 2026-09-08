import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const source = readFileSync(new URL('../../../dashboard-enhancements/parts/whatsapp-theme.js', import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setTimeout(resolve, 350));

async function fixture(t, messages, dir = 'ltr') {
  const dom = new JSDOM(`<!doctype html><div id="app" dir="${dir}"><ul class="conversation-panel">${messages}</ul></div>`, {
    url: 'https://chatwoot.test/app/accounts/1/conversations/1', runScripts: 'outside-only',
    virtualConsole: new VirtualConsole(),
  });
  t.after(() => dom.window.close());
  dom.window.eval(source);
  await settle();
  return dom.window.document;
}

test('native datetime preserves historical message year and exact instant', async t => {
  const instant = '2024-05-03T09:15:00.000Z';
  const doc = await fixture(t, `<div class="message-bubble-container" data-message-id="1"><time datetime="${instant}">May 3, 9:15 AM</time></div>`);
  assert.equal(doc.querySelector('time').dateTime, instant);
  assert.match(doc.querySelector('.cwpt-wa-day').textContent, /2024/);
});

test('late RTL language update relabels existing separators without duplicating them', async t => {
  const now = new Date();
  const doc = await fixture(t, `<div class="message-bubble-container" data-message-id="1"><time datetime="${now.toISOString()}">Sep 8, 9:15 AM</time></div>`);
  assert.equal(doc.querySelector('.cwpt-wa-day').textContent, 'Today');
  doc.querySelector('#app').dir = 'rtl';
  await settle();
  assert.equal(doc.querySelector('.cwpt-wa-day').textContent, 'היום');
  assert.equal(doc.querySelectorAll('.cwpt-wa-day').length, 1);
});

test('native historical datetime survives Vue refreshing only its yearless display text', async t => {
  const instant = '2024-05-03T09:15:00.000Z';
  const doc = await fixture(t, `<div class="message-bubble-container" data-message-id="1"><time datetime="${instant}">May 3, 9:15 AM</time></div>`);
  doc.querySelector('time').firstChild.nodeValue = 'May 3, 9:15 AM';
  await settle();
  assert.equal(doc.querySelector('time').dateTime, instant);
  assert.match(doc.querySelector('.cwpt-wa-day').textContent, /2024/);
});

test('Vue text-node updates on legacy messages refresh their time and separator', async t => {
  const doc = await fixture(t, '<div class="message-bubble-container" data-message-id="1"><time>Jan 2 2024, 9:15 AM</time></div>');
  doc.querySelector('time').firstChild.nodeValue = 'Feb 3 2023, 8:20 PM';
  await settle();
  assert.equal(doc.querySelector('time').textContent, '20:20');
  assert.equal(doc.querySelector('.cwpt-wa-day').textContent, '2/3/2023');
  assert.equal(doc.querySelectorAll('.cwpt-wa-day').length, 1);
});

test('updating machine timestamp refreshes day even when displayed time is unchanged', async t => {
  const doc = await fixture(t, '<div class="message-bubble-container" data-message-id="1"><time datetime="2024-05-03T09:15:00Z">May 3, 9:15 AM</time></div>');
  doc.querySelector('time').dateTime = '2023-05-03T09:15:00Z';
  await settle();
  assert.match(doc.querySelector('.cwpt-wa-day').textContent, /2023/);
  assert.match(doc.querySelector('time').title, /2023/);
});

test('light and dark unread badge colors meet readable text contrast', async t => {
  const doc = await fixture(t, '');
  const css = doc.querySelector('#cwpt-wa-theme').textContent;
  const luminance = hex => {
    const channels = hex.match(/[a-f0-9]{2}/gi).map(c => parseInt(c, 16) / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  for (const match of css.matchAll(/--wa-unread:(#[a-f0-9]+);--wa-unread-text:(#[a-f0-9]+)/gi)) {
    const levels = [luminance(match[1]), luminance(match[2])].sort((a, b) => b - a);
    assert.ok((levels[0] + 0.05) / (levels[1] + 0.05) >= 4.5);
  }
});
