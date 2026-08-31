import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const rootDir = fileURLToPath(new URL('..', import.meta.url));

const CAMPAIGN_DETAIL = {
  campaign: {
    id: 7,
    title: 'Dashboard-only campaign',
    campaign_status: 1,
    inbox_id: 21,
    template_name: 'offer',
    category: 'MARKETING',
    created_at: '2026-08-31 09:00',
  },
  funnel: { audience: 1, attempted: 1, sent: 0, delivered: 0, read: 0, failed: 1 },
  engagement: { replied: 0, reply_rate: 0, replies: [] },
  recipients: [{
    contact_name: 'Test contact', phone: '+972500000000', status: 3,
    sent_at: '2026-08-31 09:00', attempt_count: 1, error_title: '131049',
  }],
  not_sent: [],
  audience_source: 'snapshot',
};

test('real campaign UI stays read-only and never bootstraps sequences in dashboard-only mode', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: 'https://chatwoot.example/chatwoot-addons/sequences/?embed=1&nav=side&account_id=1&tab=campaigns&campaign=7',
  });
  const previous = new Map();
  const installGlobal = (key, value) => {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  installGlobal('window', dom.window);
  installGlobal('document', dom.window.document);
  installGlobal('navigator', dom.window.navigator);
  installGlobal('localStorage', dom.window.localStorage);
  installGlobal('sessionStorage', dom.window.sessionStorage);
  installGlobal('HTMLElement', dom.window.HTMLElement);
  installGlobal('MutationObserver', dom.window.MutationObserver);
  installGlobal('IS_REACT_ACT_ENVIRONMENT', true);

  const actions = [];
  let healthModules = ['enhancements'];
  installGlobal('fetch', async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith('/health')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, modules: healthModules }) };
    }
    const body = JSON.parse(init.body || '{}');
    actions.push(body.action);
    const data = body.action === 'campaign_detail' ? CAMPAIGN_DETAIL
      : body.action === 'campaign_experiments' ? [] : null;
    return { ok: true, status: 200, json: async () => ({ ok: true, data }) };
  });

  const vite = await createServer({
    root: rootDir,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true },
  });
  let reactRoot;
  try {
    const [{ default: App }, { ToastProvider }] = await Promise.all([
      vite.ssrLoadModule('/src/App.jsx'),
      vite.ssrLoadModule('/src/components/ui/Toast.jsx'),
    ]);
    reactRoot = createRoot(document.getElementById('root'));
    await act(async () => {
      reactRoot.render(React.createElement(ToastProvider, null, React.createElement(App)));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    assert.ok(actions.includes('campaign_detail'), actions);
    assert.ok(actions.includes('campaign_experiments'), actions);
    for (const forbidden of [
      'list', 'templates', 'campaigns_tier', 'campaign_resend_status',
      'campaign_resend_pending', 'campaign_resend', 'campaign_resend_schedule',
    ]) {
      assert.ok(!actions.includes(forbidden), `dashboard-only called ${forbidden}: ${actions}`);
    }
    assert.match(document.body.textContent, /כשלים לפי סיבה/);
    assert.doesNotMatch(document.body.textContent, /שליחה מחדש לנכשלים/);

    // Sequences is the full product: the same real campaign detail must remain available,
    // including its outbound controls, even when the standalone enhancements key is absent.
    await act(async () => reactRoot.unmount());
    reactRoot = null;
    healthModules = ['sequences'];
    actions.length = 0;
    sessionStorage.clear();
    reactRoot = createRoot(document.getElementById('root'));
    await act(async () => {
      reactRoot.render(React.createElement(ToastProvider, null, React.createElement(App)));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    assert.ok(actions.includes('campaign_detail'), actions);
    assert.match(document.body.textContent, /שליחה מחדש לנכשלים/);
  } finally {
    if (reactRoot) await act(async () => reactRoot.unmount());
    await vite.close();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
