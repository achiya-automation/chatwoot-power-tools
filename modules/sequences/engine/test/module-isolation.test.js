import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/api.js';

const sessionCookie = `cw_d_session_info=${encodeURIComponent(JSON.stringify({
  'access-token': 'test-token',
  client: 'test-client',
  uid: 'agent@example.test',
}))}`;

const profileFetch = async () => ({
  status: 200,
  json: async () => ({ id: 7, accounts: [{ id: 1, role: 'administrator' }] }),
});

async function withServer(config, fn) {
  const app = createApp(config);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function fixtureDist() {
  const root = await mkdtemp(join(tmpdir(), 'cwpt-modules-'));
  await mkdir(join(root, 'smart-import'), { recursive: true });
  await mkdir(join(root, 'assets'), { recursive: true });
  await writeFile(join(root, 'smart-import', 'import-tool.js'), 'window.importTool = true;');
  await writeFile(join(root, 'assets', 'sequence.js'), 'window.sequenceApp = true;');
  await writeFile(join(root, 'index.html'), '<html>sequence app</html>');
  return root;
}

test('import-only mode serves import assets without initializing sequence API/static routes', async () => {
  const webappDist = await fixtureDist();
  try {
    await withServer({
      enabledModules: ['import'],
      databaseFeaturesEnabled: false,
      chatwootBaseUrl: 'http://chatwoot.test',
      webappDist,
      fetchImpl: profileFetch,
    }, async base => {
      const headers = { cookie: sessionCookie, connection: 'close' };
      const health = await fetch(`${base}/drip-api/health`, { headers });
      assert.equal(health.status, 200);
      assert.deepEqual((await health.json()).modules, ['import']);

      const imported = await fetch(`${base}/smart-import/import-tool.js`, { headers });
      assert.equal(imported.status, 200);

      const sequenceAsset = await fetch(`${base}/assets/sequence.js`, { headers });
      assert.equal(sequenceAsset.status, 404);

      const api = await fetch(`${base}/drip-api?account_id=1`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'list' }),
      });
      assert.equal(api.status, 404);
      assert.deepEqual(await api.json(), { ok: false, error: 'module disabled' });
    });
  } finally {
    await rm(webappDist, { recursive: true, force: true });
  }
});

test('sequences without import blocks a guessed smart-import asset URL', async () => {
  const webappDist = await fixtureDist();
  try {
    await withServer({
      enabledModules: ['sequences'],
      databaseFeaturesEnabled: true,
      databaseUrl: 'postgres://unused-in-this-test',
      chatwootBaseUrl: 'http://chatwoot.test',
      webappDist,
      fetchImpl: profileFetch,
    }, async base => {
      const response = await fetch(`${base}/smart-import/import-tool.js`, {
        headers: { cookie: sessionCookie, connection: 'close' },
      });
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { ok: false, error: 'module disabled' });
    });
  } finally {
    await rm(webappDist, { recursive: true, force: true });
  }
});

test('dashboard-only exposes campaign deep links but blocks sequence SPA and actions', async () => {
  const webappDist = await fixtureDist();
  try {
    await withServer({
      enabledModules: ['enhancements'],
      databaseFeaturesEnabled: true,
      databaseUrl: 'postgres://unused-in-this-test',
      chatwootBaseUrl: 'http://chatwoot.test',
      webappDist,
      fetchImpl: profileFetch,
    }, async base => {
      const headers = { cookie: sessionCookie, connection: 'close' };

      const campaignView = await fetch(`${base}/?tab=campaigns&account_id=1`, { headers });
      assert.equal(campaignView.status, 200);
      assert.match(await campaignView.text(), /sequence app/);

      const sequenceView = await fetch(`${base}/?tab=sequences&account_id=1`, { headers });
      assert.equal(sequenceView.status, 404);
      assert.deepEqual(await sequenceView.json(), { ok: false, error: 'module disabled' });

      const sequenceAction = await fetch(`${base}/drip-api?account_id=1`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'list' }),
      });
      assert.equal(sequenceAction.status, 404);
      assert.deepEqual(await sequenceAction.json(), { ok: false, error: 'module disabled' });

      const importAsset = await fetch(`${base}/smart-import/import-tool.js`, { headers });
      assert.equal(importAsset.status, 404);
    });
  } finally {
    await rm(webappDist, { recursive: true, force: true });
  }
});
