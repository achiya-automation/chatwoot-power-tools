import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTemplateCopy } from '../src/meta.js';

// fetch מדומה: GET מחזיר את תבנית המקור עם components; POST מחזיר עותק שנוצר.
// אוסף את הקריאות כדי לאמת שה-POST נשלח עם השם החדש וה-components של המקור.
function mockFetch({ found = true, postOk = true, postErr = 'שם כבר קיים' } = {}) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    calls.push({ url, method, body: opts.body ? JSON.parse(opts.body) : null });
    if (method === 'GET') {
      return {
        ok: true,
        json: async () => ({
          data: found
            ? [{ name: 'bb_x', language: 'he', category: 'MARKETING', components: [{ type: 'BODY', text: 'hi {{1}}' }] }]
            : [],
        }),
      };
    }
    // POST
    return postOk
      ? { ok: true, json: async () => ({ id: '99', status: 'PENDING' }) }
      : { ok: false, json: async () => ({ error: { error_user_msg: postErr } }) };
  };
  fn.calls = calls;
  return fn;
}

test('יוצר עותק — GET מקור ואז POST עם השם החדש וה-components', async () => {
  const f = mockFetch();
  const res = await createTemplateCopy('W', 'T', 'bb_x', 'bb_x_burn1', f);
  assert.deepEqual(res, { name: 'bb_x_burn1', id: '99', status: 'PENDING' });
  const post = f.calls.find((c) => c.method === 'POST');
  assert.ok(post, 'נשלחה בקשת POST');
  assert.equal(post.body.name, 'bb_x_burn1');                 // שם חדש
  assert.equal(post.body.language, 'he');                     // נלקח מהמקור
  assert.deepEqual(post.body.components, [{ type: 'BODY', text: 'hi {{1}}' }]);  // עותק זהה
  assert.equal(post.body.allow_category_change, true);
});

test('מקור לא נמצא → זורק, בלי POST', async () => {
  const f = mockFetch({ found: false });
  await assert.rejects(() => createTemplateCopy('W', 'T', 'missing', 'missing_burn1', f), /לא נמצאה/);
  assert.ok(!f.calls.some((c) => c.method === 'POST'), 'לא נשלח POST כשאין מקור');
});

test('POST נכשל (שם קיים) → זורק עם הודעת מטא', async () => {
  const f = mockFetch({ postOk: false, postErr: 'Template name already exists' });
  await assert.rejects(() => createTemplateCopy('W', 'T', 'bb_x', 'bb_x_burn1', f), /already exists/);
});

test('חסרים creds → זורק לפני כל קריאת רשת', async () => {
  const f = mockFetch();
  await assert.rejects(() => createTemplateCopy('', 'T', 'bb_x', 'bb_x_burn1', f), /WABA|טוקן/);
  assert.equal(f.calls.length, 0);
});
