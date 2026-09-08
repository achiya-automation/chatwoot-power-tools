import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const source = readFileSync(new URL('../../../dashboard-enhancements/parts/native-ui-fixes.js', import.meta.url), 'utf8');

async function fixture(t) {
  const dom = new JSDOM(`<!doctype html><div id="app" dir="ltr">
    <div class="message-bubble-container">
      <div data-bubble-name="audio"><audio></audio><div class="rounded-xl">
        <div class="tabular-nums text-xs" id="clock">00:12 / 02:30</div>
      </div></div>
      <div class="h-9"><span class="max-w-36" title="קבלה_718.pdf" id="filename">קבלה_718.pdf</span></div>
      <div data-bubble-name="attachment"><div class="space-y-1"><div class="text-n-slate-11" id="address">רחוב הרצל 12</div></div></div>
      <div class="prose-bubble"><p>📱 נשלח מוואטסאפ</p><p>שלום</p></div>
      <time datetime="2024-05-03T09:15:00.000Z">May 3, 9:15 AM</time>
    </div>
  </div>`, { url: 'https://chatwoot.test', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  dom.window.MutationObserver = class { constructor() { assert.fail('Native UI fixes must not rewrite the dashboard DOM'); } };
  dom.window.eval(source);
  await new Promise(resolve => setTimeout(resolve, 10));
  return dom.window;
}

test('RTL isolates the audio clock and filename without changing message content or address direction', async t => {
  const w = await fixture(t);
  const doc = w.document;
  const app = doc.querySelector('#app');
  const originalContent = app.innerHTML;
  const style = id => w.getComputedStyle(doc.getElementById(id));
  const ltrFilenameStyle = { direction: style('filename').direction, textAlign: style('filename').textAlign };

  app.dir = 'rtl';
  assert.equal(style('clock').direction, 'ltr');
  assert.equal(style('clock').unicodeBidi, 'isolate');
  assert.equal(style('filename').direction, 'ltr');
  assert.equal(style('filename').unicodeBidi, 'isolate');
  assert.equal(style('filename').textAlign, 'right');
  assert.equal(style('address').direction, 'rtl', 'Hebrew addresses must keep their native direction');
  assert.equal(app.innerHTML, originalContent, 'The native DOM and timestamp text stay intact');

  app.dir = 'ltr';
  assert.equal(style('address').direction, 'ltr');
  assert.deepEqual({ direction: style('filename').direction, textAlign: style('filename').textAlign }, ltrFilenameStyle, 'The fix follows a later locale change');
});

test('repeated initialization mounts one stylesheet and never starts a DOM observer', async t => {
  const w = await fixture(t);
  w.MutationObserver = class { constructor() { assert.fail('Native UI fixes must not rewrite the dashboard DOM'); } };
  w.eval(source);
  assert.equal(w.document.querySelectorAll('#cwpt-native-ui-fixes').length, 1);
  assert.equal(w.document.querySelector('.cwpt-wa-day'), null);
});
