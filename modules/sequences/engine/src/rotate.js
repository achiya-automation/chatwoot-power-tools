/**
 * rotate.js — a template is a CONSUMABLE. When it wears out, the engine replaces it itself.
 *
 * WHY THIS IS NOT OPTIONAL
 *   Every failed delivery devalues the template, for everyone. Measured on a live account
 *   (n=4,994, outside the service window):
 *
 *     failures on template │ lead Meta never capped │ lead Meta HAS capped
 *     ─────────────────────┼───────────────────────┼─────────────────────
 *     0                    │        82.8%          │       69.0%   ⭐
 *     1-10                 │        84.9%          │       14.5%
 *     11-50                │        71.8%          │       10.9%
 *     50+                  │        17.9%          │        1.3%
 *
 *   A capped recipient gets 69% on a virgin template and 1.3% on a spent one — a 53× spread.
 *   The template, not the recipient, is what died. And it wears out fast: ~10 failures is
 *   enough. A human cannot keep up with that by hand, and the day nobody notices, the client
 *   silently drops from 69% to 14% and blames the system.
 *
 * WHAT IT DOES
 *   Template at/over budget → create an identical twin under the next version name → wait for
 *   Meta to approve → point the step at it. The old one is left ORPHANED, never deleted.
 *
 * ⛔ WHY NOT DELETE THE OLD ONE
 *   Deleting locks the NAME at Meta for 30 days. Rotation happens weekly, so a delete-on-swap
 *   policy runs out of names and the rotation dies after one cycle. An orphaned template costs
 *   nothing: it is not in any sequence, so it is never sent. Reaping them is a separate, safe
 *   job once the 30-day lock no longer matters.
 *
 * ⚠️ Media must be re-uploaded per twin (the handle belongs to the upload session), and Meta
 * chunks at 1,000,000 bytes returning ONE HANDLE PER CHUNK — the handle is the WHOLE
 * newline-joined string. Keeping line 1 truncates the video to 1MB and Meta approves it anyway.
 */
import { templateFamily } from './reconcile.js';

const API = 'https://graph.facebook.com/v21.0';

/** `bb_new_01_btn_v4` → `bb_new_01_btn_v5` · `bb_new_02_burn1` → `bb_new_02_burn2` */
export function nextVersion(name) {
  const n = String(name || '');
  const burn = n.match(/^(.*_burn)(\d+)$/);
  if (burn) return `${burn[1]}${Number(burn[2]) + 1}`;
  const ver = n.match(/^(.*)_v(\d+)$/);
  if (ver) return `${ver[1]}_v${Number(ver[2]) + 1}`;
  return `${n}_v2`;                       // no suffix yet → start the series
}

/** The components Meta needs to recreate this template, media re-uploaded. */
async function cloneComponents(src, mediaUrl, deps) {
  const out = [];
  for (const c of src.components || []) {
    const t = String(c.type).toUpperCase();
    if (t === 'HEADER' && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(c.format)) {
      if (!mediaUrl) throw new Error(`media header but no media_url`);
      out.push({ type: 'HEADER', format: c.format,
                 example: { header_handle: [await deps.uploadMedia(mediaUrl)] } });
    } else if (t === 'BODY') {
      const b = { type: 'BODY', text: c.text };
      if (c.example) b.example = c.example;   // {{1}} → Meta rejects without an example
      out.push(b);
    } else if (t === 'BUTTONS') {
      out.push({ type: 'BUTTONS', buttons: c.buttons });
    } else if (t === 'FOOTER') {
      out.push(c);
    }
  }
  return out;
}

/**
 * Rotate every template that has reached its failure budget.
 *
 * Runs on the reconcile tick but does its own work off the send path: a rotation failure must
 * never stop a send, and a send must never wait on Meta's template review.
 *
 * @returns {Promise<Array<{step:number, field:string, from:string, to:string, status:string}>>}
 */
export async function rotateSpentTemplates(pool, accountId, deps) {
  const { wabaId, token, fetchImpl = fetch, uploadMedia } = deps;
  if (!wabaId || !token || !uploadMedia) return [];

  const budget = Number((await pool.query(
    `SELECT max_template_failures FROM drip.compliance WHERE account_id = $1`, [accountId]
  )).rows[0]?.max_template_failures || 0);
  if (budget <= 0) return [];               // brake disabled → rotation off too

  // Which templates IN USE have spent their budget? Both slots: the one new leads land on,
  // and the burn copy the capped tail is routed to. Each rotates on its own schedule.
  const spent = (await pool.query(
    `WITH fails AS (
       SELECT template_name, count(*)::int AS n
         FROM drip.sent_messages
        WHERE account_id = $1 AND delivery_status = 'failed'
        GROUP BY template_name
     )
     SELECT s.id, s.step_order, s.sequence_id, s.media_url, s.language,
            slot.field, slot.name, COALESCE(f.n, 0) AS failures
       FROM drip.sequence_steps s
       JOIN drip.sequences q ON q.id = s.sequence_id AND q.account_id = $1
       CROSS JOIN LATERAL (VALUES ('template_name', s.template_name),
                                  ('template_burn', s.template_burn)) AS slot(field, name)
       LEFT JOIN fails f ON f.template_name = slot.name
      WHERE slot.name IS NOT NULL AND COALESCE(f.n, 0) >= $2`,
    [accountId, budget]
  )).rows;
  if (!spent.length) return [];

  // The live template list — needed for the source components and to skip a twin already made.
  let live;
  try {
    const r = await fetchImpl(
      `${API}/${wabaId}/message_templates?fields=name,status,category,language,components,parameter_format&limit=200`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const j = await r.json();
    if (!j.data) throw new Error(j.error?.message || 'no data');
    live = new Map(j.data.map((t) => [t.name, t]));
  } catch (e) {
    console.error('[drip] rotate: cannot read templates:', e.message);
    return [];
  }

  const done = [];
  for (const row of spent) {
    const target = nextVersion(row.name);
    const src = live.get(row.name);
    if (!src) continue;                                    // vanished from Meta → nothing to clone

    let twin = live.get(target);

    // 1. Create the twin (idempotent — a crashed run resumes here).
    if (!twin) {
      let components;
      try {
        components = await cloneComponents(src, row.media_url, deps);
      } catch (e) {
        console.error(`[drip] rotate ${row.name}: ${e.message}`);
        continue;
      }
      const payload = {
        name: target, language: src.language, category: src.category,
        components, allow_category_change: true,
        ...(src.parameter_format ? { parameter_format: src.parameter_format } : {}),
      };
      try {
        const r = await fetchImpl(`${API}/${wabaId}/message_templates`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const j = await r.json();
        if (!j.id) throw new Error(j.error?.message || JSON.stringify(j).slice(0, 120));
        console.log(`[drip] rotate: יצרתי ${target} (${row.name} הגיעה ל-${row.failures} כישלונות)`);
        twin = { name: target, status: j.status || 'PENDING' };
      } catch (e) {
        console.error(`[drip] rotate: יצירת ${target} נכשלה — ${e.message}`);
        continue;
      }
    }

    // 2. Swap ONLY once Meta has approved it. Until then the step keeps the old template and the
    //    gate defers — the lead waits a few minutes, it is never dropped. Swapping into a PENDING
    //    template would block the whole step.
    if (twin.status !== 'APPROVED') continue;

    // ⚠️ `language` is part of the PRIMARY KEY (account_id, template_name, language). Inserting
    // without it writes a row keyed on '' — and Meta's own sync later writes the SAME template
    // keyed on 'he'. Two rows for one template, and loadTemplateHealth's Map silently keeps
    // whichever came last, failure counter included. Always carry the step's language.
    await pool.query(
      `INSERT INTO drip.template_health (account_id, template_name, language, status, quality, checked_at)
       VALUES ($1, $2, $3, 'APPROVED', 'UNKNOWN', now())
       ON CONFLICT (account_id, template_name, language) DO UPDATE
         SET status = 'APPROVED', checked_at = now()`,
      [accountId, target, row.language || 'he']
    );
    await pool.query(
      `UPDATE drip.sequence_steps SET ${row.field === 'template_burn' ? 'template_burn' : 'template_name'} = $2
        WHERE id = $1`,
      [row.id, target]
    );

    console.log(`[drip] rotate: שלב ${row.step_order} ${row.field}: ${row.name} → ${target}`);
    done.push({ step: row.step_order, field: row.field, from: row.name, to: target, status: 'swapped' });
  }

  // ⚠️ The old templates are NOT deleted. Deleting locks the name for 30 days at Meta, and the
  // next rotation would have nowhere to go. They are orphaned: in no sequence, never sent.
  return done;
}

/**
 * Upload media to Meta and return the handle a template creation needs.
 *
 * ⚠️ THE TRAP: Meta chunks the upload at 1,000,000 bytes and returns ONE HANDLE PER CHUNK,
 * newline-separated. The handle is the WHOLE multi-line string. Keeping only the first line
 * truncates the video to its first 1MB — and Meta approves the broken template without a word.
 * A client's 3-minute video silently becomes a 1MB fragment. Return `h` verbatim.
 *
 * @param {string} url     - where the sequence actually serves the media from
 * @param {string} token   - Graph token (whatsapp_business_management)
 * @param {string} appId   - Meta app id; the upload session lives on the APP, not the WABA
 */
export async function uploadToMeta(url, token, appId, fetchImpl = fetch) {
  if (!appId) throw new Error('META_APP_ID not set — cannot upload media');

  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`media fetch ${url} → ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());

  const ext  = (url.split('?')[0].match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  const mime = { mp4: 'video/mp4', jpg: 'image/jpeg', jpeg: 'image/jpeg',
                 png: 'image/png', pdf: 'application/pdf' }[ext];
  if (!mime) throw new Error(`unsupported media type: .${ext}`);

  const sess = await (await fetchImpl(
    `${API}/${appId}/uploads?file_name=${encodeURIComponent(url.split('/').pop())}` +
    `&file_length=${bytes.length}&file_type=${encodeURIComponent(mime)}`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}` } }
  )).json();
  if (!sess.id) throw new Error(`upload session: ${sess.error?.message || 'failed'}`);

  const up = await (await fetchImpl(`${API}/${sess.id}`, {
    method: 'POST',
    headers: { Authorization: `OAuth ${token}`, file_offset: '0' },
    body: bytes,
  })).json();
  if (!up.h) throw new Error(`upload: ${up.error?.message || 'no handle'}`);

  return up.h;                      // ⛔ the WHOLE string — never up.h.split('\n')[0]
}

/** Exported for tests — same family ⇒ the duplicate guard still sees one message. */
export const _sameFamily = (a, b) => templateFamily(a) === templateFamily(b);
