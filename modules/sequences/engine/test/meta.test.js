import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tierToCap, fetchNumberHealth, fetchTemplateHealth, refreshHealth,
  DEFAULT_CAP, _resetHealthCache,
} from '../src/meta.js';

const creds = { getWhatsappCreds: async () => ({ token: 't', phoneId: 'p', wabaId: 'w' }) };

// A pool stub: records every write, answers the account_health SELECT from what was written.
function fakePool(initial = null) {
  const writes = [];
  let health = initial;   // { tier, cap, quality } or null
  return {
    writes,
    get health() { return health; },
    query: async (sql, params) => {
      writes.push({ sql, params });
      if (/SELECT tier, cap, quality FROM drip\.account_health/.test(sql)) {
        return { rows: health ? [health] : [] };
      }
      if (/INSERT INTO drip\.account_health/.test(sql) && /tier, cap, quality/.test(sql)) {
        health = { tier: params[1], cap: params[2], quality: params[3] };
      }
      return { rows: [] };
    },
  };
}

// ── tierToCap ───────────────────────────────────────────────────────────────

test('tierToCap maps Meta tiers to numeric 24h caps', () => {
  assert.equal(tierToCap('TIER_250'), 250);
  assert.equal(tierToCap('TIER_10K'), 10000);
  assert.equal(tierToCap('TIER_100K'), 100000);
  assert.equal(tierToCap('UNLIMITED'), Infinity);
  assert.equal(tierToCap('tier_10k'), 10000);           // case-insensitive
});

test('REGRESSION: TIER_2K maps to 2000, not to DEFAULT_CAP', () => {
  // Meta replaced the old ladder (250 → 1K → 10K) with 250 → 2K → 10K. TIER_2K was missing
  // from the map, so tierToCap returned undefined → DEFAULT_CAP=250. A live account on
  // TIER_2K was therefore throttled to one eighth of what Meta allowed. Never again.
  assert.equal(tierToCap('TIER_2K'), 2000);
});

test('tierToCap falls back to DEFAULT_CAP for unknown/null tier', () => {
  assert.equal(tierToCap(null), DEFAULT_CAP);
  assert.equal(tierToCap('TIER_WEIRD'), DEFAULT_CAP);
  assert.equal(tierToCap(undefined), DEFAULT_CAP);
});

// ── fetchNumberHealth ───────────────────────────────────────────────────────

test('fetchNumberHealth prefers the CURRENT field over the deprecated one', async () => {
  // Meta deprecated messaging_limit_tier on 2026-05-21 and simply stopped returning it.
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      whatsapp_business_manager_messaging_limit: 'TIER_2K',
      quality_rating: 'GREEN',
    }),
  });
  const h = await fetchNumberHealth('p', 't', fetchImpl);
  assert.deepEqual(h, { tier: 'TIER_2K', quality: 'GREEN' });
});

test('fetchNumberHealth still reads the legacy field when that is all Meta returns', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ messaging_limit_tier: 'TIER_250', quality_rating: 'YELLOW' }),
  });
  const h = await fetchNumberHealth('p', 't', fetchImpl);
  assert.deepEqual(h, { tier: 'TIER_250', quality: 'YELLOW' });
});

test('fetchNumberHealth throws on a non-2xx (caller decides the fallback)', async () => {
  const fetchImpl = async () => ({ ok: false, status: 400 });
  await assert.rejects(() => fetchNumberHealth('p', 't', fetchImpl), /400/);
});

// ── fetchTemplateHealth ─────────────────────────────────────────────────────

test('fetchTemplateHealth returns status + quality per template, and follows paging', async () => {
  let page = 0;
  const fetchImpl = async () => {
    page += 1;
    if (page === 1) {
      return {
        ok: true,
        json: async () => ({
          data: [
            { name: 'a', language: 'he', status: 'APPROVED', category: 'MARKETING',
              quality_score: { score: 'GREEN' } },
          ],
          paging: { next: 'https://graph.facebook.com/next' },
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        data: [{ name: 'b', language: 'en', status: 'PAUSED', category: 'MARKETING' }],
      }),
    };
  };
  const t = await fetchTemplateHealth('w', 't', fetchImpl);
  assert.equal(t.length, 2);
  assert.deepEqual(t[0], { name: 'a', language: 'he', status: 'APPROVED', quality: 'GREEN', category: 'MARKETING' });
  assert.equal(t[1].status, 'PAUSED');
  assert.equal(t[1].quality, 'UNKNOWN');   // no quality_score yet
});

// ── refreshHealth ───────────────────────────────────────────────────────────

const numberHealth = (tier, quality = 'GREEN') => async () => ({ tier, quality });
const noTemplates = async () => [];

test('refreshHealth persists the tier and returns the numeric cap', async () => {
  _resetHealthCache();
  const pool = fakePool();
  const r = await refreshHealth(pool, creds, 7, new Date(), {
    fetchNumberHealthFn: numberHealth('TIER_2K'),
    fetchTemplateHealthFn: noTemplates,
  });
  assert.equal(r.cap, 2000);
  assert.equal(r.tier, 'TIER_2K');
  assert.deepEqual(pool.health, { tier: 'TIER_2K', cap: 2000, quality: 'GREEN' });
});

test('refreshHealth stores the unlimited tier as -1 and returns Infinity', async () => {
  _resetHealthCache();
  const pool = fakePool();
  const r = await refreshHealth(pool, creds, 7, new Date(), {
    fetchNumberHealthFn: numberHealth('TIER_UNLIMITED'),
    fetchTemplateHealthFn: noTemplates,
  });
  assert.equal(r.cap, Infinity);
  assert.equal(pool.health.cap, -1);      // Infinity cannot live in an int column
});

test('refreshHealth caches within refreshMs (no second Graph call)', async () => {
  _resetHealthCache();
  const pool = fakePool();
  let calls = 0;
  const fn = async () => { calls += 1; return { tier: 'TIER_250', quality: 'GREEN' }; };
  await refreshHealth(pool, creds, 7, new Date('2026-07-08T10:00:00Z'),
    { fetchNumberHealthFn: fn, fetchTemplateHealthFn: noTemplates, refreshMs: 3600000 });
  await refreshHealth(pool, creds, 7, new Date('2026-07-08T10:20:00Z'),
    { fetchNumberHealthFn: fn, fetchTemplateHealthFn: noTemplates, refreshMs: 3600000 });
  assert.equal(calls, 1);
});

test('refreshHealth re-fetches after refreshMs elapses', async () => {
  _resetHealthCache();
  const pool = fakePool();
  let calls = 0;
  const fn = async () => { calls += 1; return { tier: 'TIER_250', quality: 'GREEN' }; };
  await refreshHealth(pool, creds, 7, new Date('2026-07-08T10:00:00Z'),
    { fetchNumberHealthFn: fn, fetchTemplateHealthFn: noTemplates, refreshMs: 1000 });
  await refreshHealth(pool, creds, 7, new Date('2026-07-08T12:00:00Z'),
    { fetchNumberHealthFn: fn, fetchTemplateHealthFn: noTemplates, refreshMs: 1000 });
  assert.equal(calls, 2);
});

test('refreshHealth NEVER throws — a Graph outage keeps the last known cap', async () => {
  _resetHealthCache();
  const pool = fakePool({ tier: 'TIER_10K', cap: 10000, quality: 'GREEN' });
  const r = await refreshHealth(pool, creds, 5, new Date(), {
    fetchNumberHealthFn: async () => { throw new Error('graph down'); },
    fetchTemplateHealthFn: noTemplates,
  });
  assert.equal(r.cap, 10000);   // last known, NOT DEFAULT_CAP and NOT unlimited
  assert.equal(r.tier, 'TIER_10K');
});

test('refreshHealth falls back to DEFAULT_CAP when there is nothing known at all', async () => {
  _resetHealthCache();
  const pool = fakePool();
  const r = await refreshHealth(pool, { getWhatsappCreds: async () => null }, 3, new Date(), {
    fetchNumberHealthFn: numberHealth('TIER_10K'),
    fetchTemplateHealthFn: noTemplates,
  });
  assert.equal(r.cap, DEFAULT_CAP);   // fail DOWN, never up
});

test('refreshHealth halts the account on a RED quality rating', async () => {
  _resetHealthCache();
  const pool = fakePool();
  const halted = [];
  const compliance = {
    loadSettings: async () => ({ halt_on_red: true }),
    loadHealth:   async () => ({ halted: false }),
    haltAccount:  async (_p, acct, reason) => halted.push({ acct, reason }),
    raiseAlert:   async () => {},
  };
  await refreshHealth(pool, creds, 7, new Date(), {
    fetchNumberHealthFn: numberHealth('TIER_2K', 'RED'),
    fetchTemplateHealthFn: noTemplates,
    compliance,
  });
  assert.equal(halted.length, 1);
  assert.equal(halted[0].acct, 7);
  assert.match(halted[0].reason, /RED/);
});

test('refreshHealth only warns on YELLOW — it does not halt', async () => {
  _resetHealthCache();
  const pool = fakePool();
  const halted = [], alerts = [];
  const compliance = {
    loadSettings: async () => ({ halt_on_red: true }),
    loadHealth:   async () => ({ halted: false }),
    haltAccount:  async () => halted.push(1),
    raiseAlert:   async (_p, _a, level, code) => alerts.push({ level, code }),
  };
  await refreshHealth(pool, creds, 7, new Date(), {
    fetchNumberHealthFn: numberHealth('TIER_2K', 'YELLOW'),
    fetchTemplateHealthFn: noTemplates,
    compliance,
  });
  assert.equal(halted.length, 0);
  assert.equal(alerts[0].code, 'quality_yellow');
});

test('refreshHealth auto-resumes on GREEN when the halt came from RED', async () => {
  _resetHealthCache();
  const pool = fakePool();
  const resumed = [];
  const compliance = {
    loadSettings:  async () => ({ halt_on_red: true }),
    loadHealth:    async () => ({ halted: true, halt_reason: 'דירוג האיכות של המספר ירד ל-RED' }),
    haltAccount:   async () => {},
    resumeAccount: async (_p, acct) => resumed.push(acct),
    raiseAlert:    async () => {},
  };
  await refreshHealth(pool, creds, 7, new Date(), {
    fetchNumberHealthFn: numberHealth('TIER_2K', 'GREEN'),
    fetchTemplateHealthFn: noTemplates, compliance,
  });
  assert.deepEqual(resumed, [7]);
});

test('refreshHealth NEVER auto-resumes on UNKNOWN — the 20/07 lesson', async () => {
  _resetHealthCache();
  const pool = fakePool();
  const resumed = [];
  const compliance = {
    loadSettings:  async () => ({ halt_on_red: true }),
    loadHealth:    async () => ({ halted: true, halt_reason: 'דירוג האיכות של המספר ירד ל-RED' }),
    haltAccount:   async () => {},
    resumeAccount: async (_p, acct) => resumed.push(acct),
    raiseAlert:    async () => {},
  };
  await refreshHealth(pool, creds, 7, new Date(), {
    fetchNumberHealthFn: numberHealth('TIER_2K', 'UNKNOWN'),
    fetchTemplateHealthFn: noTemplates, compliance,
  });
  assert.equal(resumed.length, 0);   // UNKNOWN הוא ברירת המחדל בנפח נמוך — לא עדות להתאוששות
});

test('refreshHealth does NOT auto-resume a delivery-floor halt on GREEN', async () => {
  _resetHealthCache();
  const pool = fakePool();
  const resumed = [];
  const compliance = {
    loadSettings:  async () => ({ halt_on_red: true }),
    loadHealth:    async () => ({ halted: true, halt_reason: 'שיעור ההגעה צנח ל-40%' }),
    haltAccount:   async () => {},
    resumeAccount: async (_p, acct) => resumed.push(acct),
    raiseAlert:    async () => {},
  };
  await refreshHealth(pool, creds, 7, new Date(), {
    fetchNumberHealthFn: numberHealth('TIER_2K', 'GREEN'),
    fetchTemplateHealthFn: noTemplates, compliance,
  });
  assert.equal(resumed.length, 0);   // רק halt מדירוג RED משוחרר על GREEN — לא כשל מסירה
});

test('refreshHealth respects halt_on_red=false for a client who opted out of auto-halt', async () => {
  _resetHealthCache();
  const pool = fakePool();
  const halted = [];
  const compliance = {
    loadSettings: async () => ({ halt_on_red: false }),
    loadHealth:   async () => ({ halted: false }),
    haltAccount:  async () => halted.push(1),
    raiseAlert:   async () => {},
  };
  await refreshHealth(pool, creds, 7, new Date(), {
    fetchNumberHealthFn: numberHealth('TIER_2K', 'RED'),
    fetchTemplateHealthFn: noTemplates,
    compliance,
  });
  assert.equal(halted.length, 0);
});

test('refreshHealth raises an alert for every paused template', async () => {
  _resetHealthCache();
  const pool = fakePool();
  const alerts = [];
  const compliance = {
    loadSettings: async () => ({ halt_on_red: true }),
    loadHealth:   async () => ({ halted: false }),
    haltAccount:  async () => {},
    raiseAlert:   async (_p, _a, level, code, msg) => alerts.push({ code, msg }),
  };
  await refreshHealth(pool, creds, 7, new Date(), {
    fetchNumberHealthFn: numberHealth('TIER_2K', 'GREEN'),
    fetchTemplateHealthFn: async () => ([
      { name: 'good', language: 'he', status: 'APPROVED', quality: 'GREEN', category: 'MARKETING' },
      { name: 'bad',  language: 'he', status: 'PAUSED',   quality: 'RED',   category: 'MARKETING' },
    ]),
    compliance,
  });
  const paused = alerts.filter((a) => a.code === 'template_paused');
  assert.equal(paused.length, 1);
  assert.match(paused[0].msg, /bad/);
});
