var __cwImport = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // ui/entry.js
  var entry_exports = {};
  __export(entry_exports, {
    openWizard: () => openWizard
  });

  // lib/csvParser.js
  function parseCsv(text) {
    if (text.charCodeAt(0) === 65279) text = text.slice(1);
    const delim = detectDelimiter(text.slice(0, text.indexOf("\n") + 1 || text.length));
    const records = [];
    let field = "";
    let record = [];
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else inQuotes = false;
        } else field += ch;
        continue;
      }
      if (ch === '"') inQuotes = true;
      else if (ch === delim) {
        record.push(field);
        field = "";
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        record.push(field);
        field = "";
        if (record.length > 1 || record[0] !== "") records.push(record);
        record = [];
      } else field += ch;
    }
    if (field !== "" || record.length) {
      record.push(field);
      records.push(record);
    }
    return { headers: records[0] || [], rows: records.slice(1) };
  }
  function detectDelimiter(line) {
    const counts = { ",": 0, ";": 0, "	": 0 };
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (!inQuotes && ch in counts) counts[ch]++;
    }
    return Object.keys(counts).reduce((a, b) => counts[b] > counts[a] ? b : a, ",");
  }

  // lib/xlsxReader.js
  function parseXlsxAoA(aoa) {
    const headers = (aoa[0] || []).map((h) => String(h ?? "").trim());
    const rows = [];
    for (let i = 1; i < aoa.length; i++) {
      const r = aoa[i] || [];
      const cells = headers.map((_, j) => r[j] == null ? "" : String(r[j]));
      if (cells.some((c) => c.trim() !== "")) rows.push(cells);
    }
    return { headers, rows };
  }
  async function readFileToTable(file, { loadXlsx: loadXlsx2 } = {}) {
    const isXlsx = /\.xlsx?$/i.test(file.name);
    if (!isXlsx) return parseCsv(await file.text());
    const XLSX = await loadXlsx2();
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
    return parseXlsxAoA(aoa);
  }

  // lib/phoneNormalizer.js
  function normalizePhone(raw) {
    if (raw == null) return null;
    let d = String(raw).trim().replace(/[^\d+]/g, "");
    if (d.startsWith("+")) return d.length >= 11 ? d : null;
    if (d.startsWith("00")) {
      d = d.slice(2);
      return d.length >= 9 ? "+" + d : null;
    }
    if (d.startsWith("972")) return d.length >= 11 ? "+" + d : null;
    if (d.startsWith("0")) {
      d = d.slice(1);
      return d.length === 9 || d.length === 8 ? "+972" + d : null;
    }
    if (d.length === 9) return "+972" + d;
    return null;
  }

  // lib/columnDetector.js
  var SYSTEM_FIELDS = [
    "name",
    "first_name",
    "last_name",
    "phone_number",
    "email",
    "identifier",
    "company_name",
    "city",
    "country"
  ];
  var SYNONYMS = {
    first_name: ["\u05E9\u05DD \u05E4\u05E8\u05D8\u05D9", "\u05E4\u05E8\u05D8\u05D9", "firstname", "first name", "fname", "given name"],
    last_name: ["\u05E9\u05DD \u05DE\u05E9\u05E4\u05D7\u05D4", "\u05DE\u05E9\u05E4\u05D7\u05D4", "lastname", "last name", "surname", "family name"],
    name: ["\u05E9\u05DD", "\u05E9\u05DD \u05DE\u05DC\u05D0", "\u05E9\u05DD \u05D0\u05D9\u05E9 \u05E7\u05E9\u05E8", "\u05D0\u05D9\u05E9 \u05E7\u05E9\u05E8", "name", "full name", "fullname", "contact name", "contact"],
    phone_number: ["\u05D8\u05DC\u05E4\u05D5\u05DF", "\u05E0\u05D9\u05D9\u05D3", "\u05E4\u05DC\u05D0\u05E4\u05D5\u05DF", "\u05E4\u05DC", "\u05E1\u05DC\u05D5\u05DC\u05E8\u05D9", "\u05E1\u05DC\u05D5\u05DC\u05D0\u05E8\u05D9", "\u05DE\u05E1\u05E4\u05E8 \u05D8\u05DC\u05E4\u05D5\u05DF", "\u05DE\u05E1\u05E4\u05E8", "\u05D5\u05D5\u05D0\u05D8\u05E1\u05D0\u05E4", "whatsapp", "phone", "mobile", "cell", "cellphone", "tel", "telephone", "phone number", "msisdn"],
    email: ["\u05D0\u05D9\u05DE\u05D9\u05D9\u05DC", "\u05DE\u05D9\u05D9\u05DC", '\u05D3\u05D5\u05D0"\u05DC', "\u05D3\u05D5\u05D0\u05DC", "\u05DB\u05EA\u05D5\u05D1\u05EA \u05DE\u05D9\u05D9\u05DC", "email", "e-mail", "mail", "email address"],
    // ⚠️ ID-number headers must be recognized here: Israeli IDs are 9 digits, which
    // normalizePhone happily turns into +972XXXXXXXXX — so an unrecognized ת"ז column
    // gets content-detected as phone_number and steals the real phone column's slot.
    identifier: ["\u05DE\u05D6\u05D4\u05D4", "\u05DE\u05D6\u05D4\u05D4 \u05D7\u05D9\u05E6\u05D5\u05E0\u05D9", "\u05EA\u05D6", '\u05EA"\u05D6', "\u05EA.\u05D6", "\u05DE\u05E1\u05E4\u05E8 \u05EA\u05D6", "\u05DE\u05E1 \u05EA\u05D6", "\u05DE\u05E1\u05E4\u05E8 \u05D6\u05D4\u05D5\u05EA", "\u05EA\u05E2\u05D5\u05D3\u05EA \u05D6\u05D4\u05D5\u05EA", "\u05DE\u05E1\u05E4\u05E8 \u05EA\u05E2\u05D5\u05D3\u05EA \u05D6\u05D4\u05D5\u05EA", "id", "identifier", "external id", "ref"],
    company_name: ["\u05D7\u05D1\u05E8\u05D4", "\u05E2\u05E1\u05E7", "\u05D0\u05E8\u05D2\u05D5\u05DF", "\u05E9\u05DD \u05D7\u05D1\u05E8\u05D4", "company", "company name", "organization", "organisation", "business"],
    city: ["\u05E2\u05D9\u05E8", "\u05D9\u05D9\u05E9\u05D5\u05D1", "\u05D9\u05E9\u05D5\u05D1", "city", "town"],
    country: ["\u05DE\u05D3\u05D9\u05E0\u05D4", "\u05D0\u05E8\u05E5", "country"]
  };
  function normHeader(h) {
    return String(h || "").toLowerCase().replace(/["'.\-_/\\]/g, "").replace(/\s+/g, " ").trim();
  }
  var FILLER_WORDS = /* @__PURE__ */ new Set(["\u05DC\u05E7\u05D5\u05D7", "\u05DC\u05E7\u05D5\u05D7\u05D4", "customer", "client"]);
  function stripFiller(n) {
    return n.split(" ").filter((w) => !FILLER_WORDS.has(w)).join(" ");
  }
  function headerField(header2) {
    const n = stripFiller(normHeader(header2));
    if (!n) return null;
    let best = null;
    let bestLen = 0;
    for (const field of Object.keys(SYNONYMS)) {
      for (const syn of SYNONYMS[field]) {
        const sn = normHeader(syn);
        if (n === sn && sn.length > bestLen) {
          best = field;
          bestLen = sn.length;
        }
      }
    }
    return best;
  }
  function contentField(values) {
    const nonEmpty = values.filter((v) => v && v.trim());
    if (!nonEmpty.length) return null;
    const emailish = nonEmpty.filter((v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim())).length;
    if (emailish / nonEmpty.length >= 0.6) return "email";
    const phoneish = nonEmpty.filter((v) => normalizePhone(v) !== null).length;
    if (phoneish / nonEmpty.length >= 0.6) return "phone_number";
    return null;
  }
  function detectColumns(headers, sampleRows) {
    const taken = /* @__PURE__ */ new Set();
    return headers.map((header2, index) => {
      const col = sampleRows.map((r) => r[index]);
      let field = headerField(header2);
      let confidence = field ? 0.9 : 0;
      if (!field) {
        field = contentField(col);
        confidence = field ? 0.7 : 0;
      }
      if (field && taken.has(field)) {
        field = null;
        confidence = 0;
      }
      if (field) taken.add(field);
      return { header: header2, index, field, confidence };
    });
  }

  // lib/fieldMapper.js
  var TOP_LEVEL = /* @__PURE__ */ new Set(["name", "email", "identifier"]);
  var ADDITIONAL = /* @__PURE__ */ new Set(["company_name", "city", "country"]);
  function buildContactPayload(row, mapping, customMap) {
    const payload = { additional_attributes: {}, custom_attributes: {} };
    let first = "";
    let last = "";
    for (const { index, field } of mapping) {
      const val = (row[index] || "").trim();
      if (!val || !field) continue;
      if (field === "first_name") first = val;
      else if (field === "last_name") last = val;
      else if (field === "phone_number") {
        const p = normalizePhone(val);
        if (p) payload.phone_number = p;
      } else if (TOP_LEVEL.has(field)) payload[field] = val;
      else if (ADDITIONAL.has(field)) payload.additional_attributes[field] = val;
    }
    if (!payload.name && (first || last)) payload.name = [first, last].filter(Boolean).join(" ");
    for (const { index, attribute_key } of customMap || []) {
      const val = (row[index] || "").trim();
      if (val && attribute_key) payload.custom_attributes[attribute_key] = val;
    }
    if (!Object.keys(payload.additional_attributes).length) delete payload.additional_attributes;
    if (!Object.keys(payload.custom_attributes).length) delete payload.custom_attributes;
    return payload;
  }

  // lib/dedup.js
  var KEYS = ["identifier", "phone_number", "email"];
  function clause(key, value) {
    return { attribute_key: key, filter_operator: "equal_to", values: [value], query_operator: null };
  }
  function buildFilterPayload(contact) {
    const clauses = KEYS.filter((k) => contact[k] != null && contact[k] !== "").map((k) => clause(k, contact[k]));
    if (!clauses.length) return null;
    clauses.forEach((c, i) => {
      c.query_operator = i < clauses.length - 1 ? "or" : null;
    });
    return { payload: clauses };
  }
  function pickMatch(results, contact) {
    if (!results || !results.length) return null;
    for (const key of KEYS) {
      if (contact[key] == null || contact[key] === "") continue;
      const hit = results.find((r) => r[key] && String(r[key]) === String(contact[key]));
      if (hit) return hit;
    }
    return results[0];
  }
  function normVal(key, value) {
    return key === "phone_number" ? String(value) : String(value).toLowerCase();
  }
  var CHUNK = 40;
  var MAX_PAGES = 40;
  async function batchDedup(contacts, api, onProgress) {
    const wanted = {};
    const found = {};
    for (const k of KEYS) {
      wanted[k] = /* @__PURE__ */ new Set();
      found[k] = /* @__PURE__ */ new Map();
    }
    for (const c of contacts) {
      for (const k of KEYS) if (c[k] != null && c[k] !== "") wanted[k].add(normVal(k, c[k]));
    }
    const totalValues = KEYS.reduce((s, k) => s + wanted[k].size, 0);
    let processed = 0;
    for (const k of KEYS) {
      const values = Array.from(wanted[k]);
      for (let o = 0; o < values.length; o += CHUNK) {
        const chunk = values.slice(o, o + CHUNK);
        const clauses = chunk.map((v, i) => ({
          attribute_key: k,
          filter_operator: "equal_to",
          values: [v],
          query_operator: i < chunk.length - 1 ? "or" : null
        }));
        let page = 1;
        let got = 0;
        let count = Infinity;
        while (got < count && page <= MAX_PAGES) {
          const res = await api.filterContacts({ payload: clauses }, page);
          const arr = res?.payload || [];
          count = res?.meta?.count ?? arr.length;
          got += arr.length;
          for (const r of arr) {
            if (r[k] == null || r[k] === "") continue;
            const nv = normVal(k, r[k]);
            if (!found[k].has(nv)) found[k].set(nv, r);
          }
          if (!arr.length) break;
          page++;
        }
        processed += chunk.length;
        onProgress?.(Math.min(processed, totalValues), totalValues);
      }
    }
    const claimed = /* @__PURE__ */ new Set();
    for (const c of contacts) {
      delete c.__dupTail;
      let match = null;
      for (const k of KEYS) {
        if (c[k] == null || c[k] === "") continue;
        const m = found[k].get(normVal(k, c[k]));
        if (m) {
          match = m;
          break;
        }
      }
      if (match) {
        c.__match = match;
        continue;
      }
      const ids = KEYS.filter((k) => c[k] != null && c[k] !== "").map((k) => k + ":" + normVal(k, c[k]));
      if (ids.some((id) => claimed.has(id))) {
        delete c.__match;
        c.__dupTail = true;
      } else {
        c.__match = null;
        ids.forEach((id) => claimed.add(id));
      }
    }
    return contacts;
  }

  // lib/importLog.js
  var STATUSES = ["created", "updated", "skipped", "failed"];
  function csvCell(v) {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  var ImportLog = class {
    constructor() {
      this.rows = [];
    }
    add(rowNum, name, status, contactId, reason) {
      this.rows.push({ rowNum, name: name || "", status, contactId: contactId || "", reason: reason || "" });
    }
    summary() {
      const s = { created: 0, updated: 0, skipped: 0, failed: 0, total: this.rows.length };
      for (const r of this.rows) if (STATUSES.includes(r.status)) s[r.status]++;
      return s;
    }
    toCsv() {
      const head = "row,name,status,contact_id,reason";
      const body = this.rows.map((r) => [r.rowNum, r.name, r.status, r.contactId, r.reason].map(csvCell).join(","));
      return [head, ...body].join("\n") + "\n";
    }
  };

  // lib/importRunner.js
  var defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function runImport({
    contacts,
    api,
    labelTitle,
    waInboxId = null,
    onProgress,
    concurrency = 5,
    isCancelled = () => false,
    cooldownMs = 2e4,
    sleep = defaultSleep
  }) {
    const log = new ImportLog();
    const total = contacts.length;
    let done = 0;
    let cooldown = null;
    async function call(fn) {
      for (let attempt = 0; ; attempt++) {
        if (cooldown) await cooldown;
        try {
          return await fn();
        } catch (e) {
          if (e?.status !== 429 || attempt >= 3) throw e;
          if (!cooldown) cooldown = sleep(cooldownMs * (attempt + 1)).then(() => {
            cooldown = null;
          });
        }
      }
    }
    async function importOne(c) {
      const row = c.__row;
      const name = c.name || "";
      const filter = buildFilterPayload(c);
      if (!name && !filter) {
        log.add(row, name, "skipped", null, "\u05D0\u05D9\u05DF \u05E9\u05DD \u05D0\u05D5 \u05DE\u05D6\u05D4\u05D4 \u05D9\u05D9\u05D7\u05D5\u05D3\u05D9");
        onProgress?.(++done, total, log);
        return;
      }
      const body = stripMeta(c);
      try {
        let contactId = null;
        let status = "created";
        let match = null;
        if ("__match" in c) {
          match = c.__match;
        } else if (filter) {
          const res = await call(() => api.filterContacts(filter));
          match = pickMatch(res?.payload || [], c);
        }
        if (match) {
          await call(() => api.updateContact(match.id, body));
          contactId = match.id;
          status = "updated";
        } else {
          const created = await call(() => api.createContact(body));
          contactId = created?.payload?.contact?.id ?? created?.id;
          if (!contactId) throw new Error("Chatwoot create response is missing the contact id");
          status = "created";
        }
        if (waInboxId && contactId) {
          const sourceId = waSourceId(body.phone_number);
          if (sourceId) {
            try {
              await call(() => api.createContactInbox(contactId, { inbox_id: waInboxId, source_id: sourceId }));
            } catch {
            }
          }
        }
        if (labelTitle && contactId) {
          if (match) {
            let cur = [];
            try {
              cur = (await call(() => api.getContactLabels(contactId)))?.payload || [];
            } catch {
            }
            const union = Array.from(/* @__PURE__ */ new Set([...cur, labelTitle]));
            await call(() => api.assignLabels(contactId, union));
          } else {
            await call(() => api.assignLabels(contactId, [labelTitle]));
          }
        }
        log.add(row, name, status, contactId, "");
      } catch (e) {
        log.add(row, name, "failed", null, (e.body || e.message || "error").slice(0, 200));
      }
      onProgress?.(++done, total, log);
    }
    const poolRows = contacts.filter((c) => !c.__dupTail);
    const tailRows = contacts.filter((c) => c.__dupTail);
    let next = 0;
    const workers = Array.from({ length: Math.min(concurrency, poolRows.length) }, async () => {
      while (next < poolRows.length && !isCancelled()) {
        await importOne(poolRows[next++]);
      }
    });
    await Promise.all(workers);
    for (const c of tailRows) {
      if (isCancelled()) break;
      delete c.__match;
      await importOne(c);
    }
    return log;
  }
  function createImportJob({ contacts, api, labelTitle, waInboxId, concurrency }) {
    const listeners = /* @__PURE__ */ new Set();
    const progress = {
      done: 0,
      total: contacts.length,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      state: "running"
      // running → cancelling → done | cancelled | error
    };
    let cancelled = false;
    const emit = () => listeners.forEach((cb) => {
      try {
        cb(progress);
      } catch {
      }
    });
    const job = {
      progress,
      log: null,
      error: null,
      labelTitle: labelTitle || "",
      cancel() {
        if (progress.state === "running") {
          cancelled = true;
          progress.state = "cancelling";
          emit();
        }
      },
      onUpdate(cb) {
        listeners.add(cb);
        return () => listeners.delete(cb);
      }
    };
    job.promise = runImport({
      contacts,
      api,
      labelTitle,
      waInboxId,
      concurrency,
      isCancelled: () => cancelled,
      onProgress(done, totalCount, log) {
        progress.done = done;
        progress.total = totalCount;
        const s = log.summary();
        progress.created = s.created;
        progress.updated = s.updated;
        progress.skipped = s.skipped;
        progress.failed = s.failed;
        emit();
      }
    }).then((log) => {
      job.log = log;
      progress.state = cancelled && progress.done < progress.total ? "cancelled" : "done";
      emit();
      return log;
    }).catch((e) => {
      job.error = e;
      progress.state = "error";
      emit();
      return job.log;
    });
    return job;
  }
  function stripMeta(c) {
    const { __row, __match, __dupTail, ...rest } = c;
    return rest;
  }
  function waSourceId(phone) {
    const digits = String(phone || "").replace(/\D/g, "");
    return digits || null;
  }

  // lib/apiClient.js
  var ApiError = class extends Error {
    constructor(status, body) {
      super(`API ${status}: ${body}`);
      this.status = status;
      this.body = body;
    }
  };
  function createApiClient(accountId, headers, fetchImpl = fetch) {
    const base = `/api/v1/accounts/${accountId}`;
    async function req(method, path, body) {
      const r = await fetchImpl(base + path, {
        method,
        headers: { ...headers, "Content-Type": "application/json" },
        credentials: "same-origin",
        body: body === void 0 ? void 0 : JSON.stringify(body)
      });
      if (!r.ok) throw new ApiError(r.status, await r.text());
      return r.status === 204 ? null : r.json();
    }
    return {
      // page: contacts/filter is paginated at 15 results/page (RESULTS_PER_PAGE) —
      // batchDedup walks the pages of each chunked OR query.
      filterContacts: (payload, page) => req("POST", "/contacts/filter" + (page ? `?page=${page}` : ""), payload),
      createContact: (c) => req("POST", "/contacts", c),
      updateContact: (id, c) => req("PUT", `/contacts/${id}`, c),
      listInboxes: () => req("GET", "/inboxes"),
      // Links a contact to a channel inbox at import time. Chatwoot resolves an
      // inbound/outbound WhatsApp message through contact_inboxes.source_id — never
      // through phone_number — so an imported contact without this row is invisible to
      // the channel: Chatwoot opens the conversation on a nameless auto-created twin
      // ("aged-glitter-248") and the real name never reaches the conversation or the bot.
      createContactInbox: (contactId, body) => req("POST", `/contacts/${contactId}/contact_inboxes`, body),
      getContactLabels: (id) => req("GET", `/contacts/${id}/labels`),
      assignLabels: (id, labels) => req("POST", `/contacts/${id}/labels`, { labels }),
      listLabels: () => req("GET", "/labels"),
      // Chatwoot's LabelsController requires the attributes under `label`:
      // params.require(:label).permit(:title, ...).
      createLabel: (title) => req("POST", "/labels", { label: { title } }),
      listCustomAttributes: () => req("GET", "/custom_attribute_definitions?attribute_model=contact_attribute"),
      createCustomAttribute: (def) => req("POST", "/custom_attribute_definitions", { custom_attribute_definition: def })
    };
  }

  // lib/basepath.js
  var vendorUrl = (base) => (base || "/chatwoot-addons") + "/smart-import/xlsx.mini.min.js";

  // lib/labelTitle.js
  var VALID_LABEL_TITLE = /^[\p{L}\p{N}][\p{L}\p{N}_-]+$/u;
  function normalizeLabelTitle(value) {
    return String(value ?? "").trim().replace(/[^\p{L}\p{N}_-]+/gu, "_").replace(/_+/g, "_").replace(/^[_-]+/, "").replace(/[_-]+$/, "");
  }
  function isValidLabelTitle(value) {
    return VALID_LABEL_TITLE.test(String(value ?? ""));
  }

  // ui/styles.js
  var STYLES = `
dialog.cwi-dlg{padding:0;border:0;background:transparent;width:100%;max-width:42rem;max-height:90vh;overflow:visible;color:inherit}
dialog.cwi-dlg::backdrop{background:rgba(0,0,0,.5);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}
dialog.cwi-dlg::backdrop{animation:cwiBackdrop .2s ease-out}
@keyframes cwiBackdrop{from{opacity:0}to{opacity:1}}
/* Animate the inner card, NOT the <dialog>: a transform on the dialog would make it
   the containing block for the fixed dropdown panel (panel is a child of the dialog),
   breaking viewport-relative positioning. The modal is a sibling of the panel, so its
   transform can't affect the panel. */
.cwi-modal{max-height:90vh;overflow:auto;animation:cwiIn .2s ease-out}
@keyframes cwiIn{from{opacity:0;transform:translateY(6px) scale(.985)}to{opacity:1;transform:none}}
.cwi-prog-fill{height:100%;background:var(--color-n-brand, #6366f1);transition:width .2s}
.cwi-tbl-cell{border-bottom:1px solid}
.cwi-cs-panel{transition:opacity .2s ease-out}
/* Background-import pill \u2014 fixed to the bottom start corner (dir-aware via
   inset-inline-start; the pill carries its own dir attribute). Below the browser
   top layer, so any open Chatwoot <dialog> still covers it. */
.cwi-pill{position:fixed;bottom:16px;inset-inline-start:16px;z-index:2147483000;width:320px;max-width:calc(100vw - 32px);animation:cwiIn .2s ease-out}
`;

  // ui/wizard.js
  var DRIP_LOCALE = function() {
    const a = document.querySelector("#app[dir]");
    return (a || document.documentElement).getAttribute("dir") === "rtl" ? "he" : "en";
  }();
  var I18N = {
    he: {
      // system-field labels (mapping dropdown)
      ignore: "\u2014 \u05D4\u05EA\u05E2\u05DC\u05DD \u2014",
      fName: "\u05E9\u05DD \u05DE\u05DC\u05D0",
      fFirstName: "\u05E9\u05DD \u05E4\u05E8\u05D8\u05D9",
      fLastName: "\u05E9\u05DD \u05DE\u05E9\u05E4\u05D7\u05D4",
      fPhone: "\u05D8\u05DC\u05E4\u05D5\u05DF",
      fEmail: "\u05D0\u05D9\u05DE\u05D9\u05D9\u05DC",
      fIdentifier: "\u05DE\u05D6\u05D4\u05D4",
      fCompany: "\u05D7\u05D1\u05E8\u05D4",
      fCity: "\u05E2\u05D9\u05E8",
      fCountry: "\u05DE\u05D3\u05D9\u05E0\u05D4",
      // step 1 — upload
      uploadTitle: "\u05D9\u05D9\u05D1\u05D5\u05D0 \u05D0\u05E0\u05E9\u05D9 \u05E7\u05E9\u05E8",
      uploadDesc: "\u05D2\u05E8\u05E8\u05D5 \u05E7\u05D5\u05D1\u05E5 CSV \u05D0\u05D5 Excel, \u05D0\u05D5 \u05DC\u05D7\u05E6\u05D5 \u05DC\u05D1\u05D7\u05D9\u05E8\u05D4. ",
      sampleLink: "\u05D4\u05D5\u05E8\u05D3\u05EA \u05E7\u05D5\u05D1\u05E5 \u05DC\u05D3\u05D5\u05D2\u05DE\u05D4",
      sampleFileName: "\u05D3\u05D5\u05D2\u05DE\u05D4-\u05D0\u05E0\u05E9\u05D9-\u05E7\u05E9\u05E8.csv",
      dropText: "\u05D1\u05D7\u05D9\u05E8\u05EA \u05E7\u05D5\u05D1\u05E5 \u05D0\u05D5 \u05D2\u05E8\u05D9\u05E8\u05D4 \u05DC\u05DB\u05D0\u05DF",
      csvOrExcel: "CSV \u05D0\u05D5 Excel",
      replace: "\u05D4\u05D7\u05DC\u05E3",
      remove: "\u05D4\u05E1\u05E8",
      emptyFile: "\u05D4\u05E7\u05D5\u05D1\u05E5 \u05E8\u05D9\u05E7 \u05D0\u05D5 \u05DC\u05DC\u05D0 \u05DB\u05D5\u05EA\u05E8\u05D5\u05EA",
      // step 2 — mapping
      mappingTitle: "\u05DE\u05D9\u05E4\u05D5\u05D9 \u05E2\u05DE\u05D5\u05D3\u05D5\u05EA",
      mappingDesc: "\u05D4\u05EA\u05D0\u05D9\u05DE\u05D5 \u05DB\u05DC \u05E2\u05DE\u05D5\u05D3\u05D4 \u05DC\u05E9\u05D3\u05D4 \u05D1-Chatwoot. \u05D6\u05D9\u05D4\u05D9\u05E0\u05D5 \u05D0\u05D5\u05D8\u05D5\u05DE\u05D8\u05D9\u05EA \u2014 \u05EA\u05E7\u05E0\u05D5 \u05D1\u05DE\u05D9\u05D3\u05EA \u05D4\u05E6\u05D5\u05E8\u05DA.",
      colInFile: "\u05E2\u05DE\u05D5\u05D3\u05D4 \u05D1\u05E7\u05D5\u05D1\u05E5",
      fieldInChatwoot: "\u05E9\u05D3\u05D4 \u05D1-Chatwoot",
      example: "\u05D3\u05D5\u05D2\u05DE\u05D4",
      systemFields: "\u05E9\u05D3\u05D5\u05EA \u05DE\u05E2\u05E8\u05DB\u05EA",
      customFields: "\u05E9\u05D3\u05D5\u05EA \u05DE\u05D5\u05EA\u05D0\u05DE\u05D9\u05DD",
      createNewField: "\u05E6\u05D5\u05E8 \u05E9\u05D3\u05D4 \u05DE\u05D5\u05EA\u05D0\u05DD \u05D7\u05D3\u05E9\u2026",
      newFieldName: "\u05E9\u05DD \u05D4\u05E9\u05D3\u05D4 \u05D4\u05D7\u05D3\u05E9",
      confirmTitle: "\u05D0\u05E9\u05E8",
      cancel: "\u05D1\u05D9\u05D8\u05D5\u05DC",
      change: "\u05E9\u05E0\u05D4",
      // customSelect
      search: "\u05D7\u05D9\u05E4\u05D5\u05E9\u2026",
      noResults: "\u05D0\u05D9\u05DF \u05EA\u05D5\u05E6\u05D0\u05D5\u05EA",
      // step 3 — label
      labelStepTitle: "\u05EA\u05D5\u05D5\u05D9\u05EA",
      labelStepDesc: "\u05EA\u05D5\u05E7\u05E6\u05D4 \u05DC\u05DB\u05DC \u05D0\u05E0\u05E9\u05D9 \u05D4\u05E7\u05E9\u05E8 \u05D4\u05DE\u05D9\u05D5\u05D1\u05D0\u05D9\u05DD (\u05DC\u05D0 \u05EA\u05DE\u05D7\u05E7 \u05EA\u05D5\u05D5\u05D9\u05D5\u05EA \u05E7\u05D9\u05D9\u05DE\u05D5\u05EA)",
      noLabel: "\u2014 \u05DC\u05DC\u05D0 \u05EA\u05D5\u05D5\u05D9\u05EA \u2014",
      newLabelPlaceholder: "\u05D0\u05D5 \u05E6\u05E8\u05D5 \u05EA\u05D5\u05D5\u05D9\u05EA \u05D7\u05D3\u05E9\u05D4",
      selectLabel: "\u05D1\u05D7\u05E8 \u05EA\u05D5\u05D5\u05D9\u05EA:",
      newLabelField: "\u05EA\u05D5\u05D5\u05D9\u05EA \u05D7\u05D3\u05E9\u05D4:",
      labelNameInvalid: "\u05E9\u05DD \u05D4\u05EA\u05D5\u05D5\u05D9\u05EA \u05D7\u05D9\u05D9\u05D1 \u05DC\u05D4\u05EA\u05D7\u05D9\u05DC \u05D1\u05D0\u05D5\u05EA \u05D0\u05D5 \u05DE\u05E1\u05E4\u05E8 \u05D5\u05DC\u05DB\u05DC\u05D5\u05DC \u05DC\u05E4\u05D7\u05D5\u05EA \u05E9\u05E0\u05D9 \u05EA\u05D5\u05D5\u05D9\u05DD.",
      labelCreateFailed: "\u05D9\u05E6\u05D9\u05E8\u05EA \u05D4\u05EA\u05D5\u05D5\u05D9\u05EA \u05E0\u05DB\u05E9\u05DC\u05D4. \u05D7\u05D6\u05E8\u05D5 \u05D5\u05D1\u05D3\u05E7\u05D5 \u05D0\u05EA \u05E9\u05DD \u05D4\u05EA\u05D5\u05D5\u05D9\u05EA.",
      // step 4 — preview
      previewTitle: "\u05D1\u05D3\u05D9\u05E7\u05D4 \u05DC\u05E4\u05E0\u05D9 \u05D9\u05D9\u05D1\u05D5\u05D0",
      checkingDupes: "\u05D1\u05D5\u05D3\u05E7 \u05DB\u05E4\u05D9\u05DC\u05D5\u05D9\u05D5\u05EA\u2026",
      readyToImport: "\u05DE\u05D5\u05DB\u05DF \u05DC\u05D9\u05D9\u05D1\u05D5\u05D0:",
      newWord: "\u05D7\u05D3\u05E9\u05D9\u05DD",
      existingWillUpdate: "\u05E7\u05D9\u05D9\u05DE\u05D9\u05DD (\u05D9\u05E2\u05D5\u05D3\u05DB\u05E0\u05D5)",
      importVerb: "\u05D9\u05D9\u05D1\u05D0",
      contactsWord: "\u05D0\u05E0\u05E9\u05D9 \u05E7\u05E9\u05E8",
      // step 5 — run / done
      importing: "\u05DE\u05D9\u05D9\u05D1\u05D0\u2026",
      importDone: "\u05D4\u05D9\u05D9\u05D1\u05D5\u05D0 \u05D4\u05D5\u05E9\u05DC\u05DD",
      createdWord: "\u05E0\u05D5\u05E6\u05E8\u05D5",
      updatedWord: "\u05E2\u05D5\u05D3\u05DB\u05E0\u05D5",
      skippedWord: "\u05D3\u05D5\u05DC\u05D2\u05D5",
      failedWord: "\u05E0\u05DB\u05E9\u05DC\u05D5",
      downloadReport: "\u05D4\u05D5\u05E8\u05D3 \u05D3\u05D5\u05D7 CSV",
      close: "\u05E1\u05D2\u05D5\u05E8",
      // background pill
      bgImporting: "\u05DE\u05D9\u05D9\u05D1\u05D0 \u05D0\u05E0\u05E9\u05D9 \u05E7\u05E9\u05E8 \u05D1\u05E8\u05E7\u05E2\u2026",
      bgCancelling: "\u05E2\u05D5\u05E6\u05E8\u2026",
      bgCancelled: "\u05D4\u05D9\u05D9\u05D1\u05D5\u05D0 \u05D4\u05D5\u05E4\u05E1\u05E7",
      bgError: "\u05D4\u05D9\u05D9\u05D1\u05D5\u05D0 \u05E0\u05E2\u05E6\u05E8 \u05E2\u05E7\u05D1 \u05E9\u05D2\u05D9\u05D0\u05D4",
      stopImport: "\u05E2\u05E6\u05D9\u05E8\u05EA \u05D4\u05D9\u05D9\u05D1\u05D5\u05D0",
      bgHint: "\u05D0\u05E4\u05E9\u05E8 \u05DC\u05D4\u05DE\u05E9\u05D9\u05DA \u05DC\u05E2\u05D1\u05D5\u05D3 \u05D1\u05D9\u05E0\u05EA\u05D9\u05D9\u05DD \u2014 \u05E8\u05E7 \u05D0\u05DC \u05EA\u05E1\u05D2\u05E8\u05D5 \u05D0\u05EA \u05D4\u05D8\u05D0\u05D1 \u05E2\u05D3 \u05DC\u05E1\u05D9\u05D5\u05DD",
      dupInFile: "\u05DB\u05E4\u05D5\u05DC\u05D9\u05DD \u05D1\u05E7\u05D5\u05D1\u05E5 (\u05D9\u05DE\u05D5\u05D6\u05D2\u05D5)",
      alreadyRunning: "\u05D9\u05D9\u05D1\u05D5\u05D0 \u05E7\u05D5\u05D3\u05DD \u05E2\u05D3\u05D9\u05D9\u05DF \u05E8\u05E5 \u05D1\u05E8\u05E7\u05E2 \u2014 \u05D4\u05DE\u05EA\u05D9\u05E0\u05D5 \u05DC\u05E1\u05D9\u05D5\u05DE\u05D5",
      dedupFailed: "\u05D1\u05D3\u05D9\u05E7\u05EA \u05D4\u05DB\u05E4\u05D9\u05DC\u05D5\u05D9\u05D5\u05EA \u05E0\u05DB\u05E9\u05DC\u05D4 \u2014 \u05D4\u05DB\u05E4\u05D9\u05DC\u05D5\u05D9\u05D5\u05EA \u05D9\u05D9\u05D1\u05D3\u05E7\u05D5 \u05E9\u05D5\u05D1 \u05D1\u05DE\u05D4\u05DC\u05DA \u05D4\u05D9\u05D9\u05D1\u05D5\u05D0",
      // footer
      back: "\u05D7\u05D6\u05E8\u05D4",
      continue: "\u05D4\u05DE\u05E9\u05DA",
      // preview table headers
      thName: "\u05E9\u05DD",
      thPhone: "\u05D8\u05DC\u05E4\u05D5\u05DF",
      thEmail: "\u05D0\u05D9\u05DE\u05D9\u05D9\u05DC",
      thCompany: "\u05D7\u05D1\u05E8\u05D4"
    },
    en: {
      ignore: "\u2014 Ignore \u2014",
      fName: "Full name",
      fFirstName: "First name",
      fLastName: "Last name",
      fPhone: "Phone",
      fEmail: "Email",
      fIdentifier: "Identifier",
      fCompany: "Company",
      fCity: "City",
      fCountry: "Country",
      uploadTitle: "Import contacts",
      uploadDesc: "Drag a CSV or Excel file here, or click to choose. ",
      sampleLink: "Download a sample file",
      sampleFileName: "sample-contacts.csv",
      dropText: "Choose a file or drag it here",
      csvOrExcel: "CSV or Excel",
      replace: "Replace",
      remove: "Remove",
      emptyFile: "The file is empty or has no headers",
      mappingTitle: "Map columns",
      mappingDesc: "Match each column to a Chatwoot field. We detected these automatically \u2014 adjust as needed.",
      colInFile: "Column in file",
      fieldInChatwoot: "Chatwoot field",
      example: "Example",
      systemFields: "System fields",
      customFields: "Custom fields",
      createNewField: "Create a new custom field\u2026",
      newFieldName: "New field name",
      confirmTitle: "Confirm",
      cancel: "Cancel",
      change: "Change",
      search: "Search\u2026",
      noResults: "No results",
      labelStepTitle: "Label",
      labelStepDesc: "Applied to all imported contacts (existing labels are kept)",
      noLabel: "\u2014 No label \u2014",
      newLabelPlaceholder: "Or create a new label",
      selectLabel: "Select a label:",
      newLabelField: "New label:",
      labelNameInvalid: "The label must start with a letter or number and contain at least two characters.",
      labelCreateFailed: "The label could not be created. Go back and check the label name.",
      previewTitle: "Review before import",
      checkingDupes: "Checking for duplicates\u2026",
      readyToImport: "Ready to import:",
      newWord: "new",
      existingWillUpdate: "existing (will be updated)",
      importVerb: "Import",
      contactsWord: "contacts",
      importing: "Importing\u2026",
      importDone: "Import complete",
      createdWord: "Created",
      updatedWord: "Updated",
      skippedWord: "Skipped",
      failedWord: "Failed",
      downloadReport: "Download CSV report",
      close: "Close",
      bgImporting: "Importing contacts in the background\u2026",
      bgCancelling: "Stopping\u2026",
      bgCancelled: "Import stopped",
      bgError: "Import stopped due to an error",
      stopImport: "Stop import",
      bgHint: "You can keep working \u2014 just don't close this tab until it finishes",
      dupInFile: "duplicates in file (will be merged)",
      alreadyRunning: "A previous import is still running in the background \u2014 wait for it to finish",
      dedupFailed: "Duplicate check failed \u2014 duplicates will be re-checked during the import",
      back: "Back",
      continue: "Continue",
      thName: "Name",
      thPhone: "Phone",
      thEmail: "Email",
      thCompany: "Company"
    }
  };
  function t(k) {
    return (I18N[DRIP_LOCALE] || I18N.en)[k] || I18N.en[k] || k;
  }
  var FIELD_LABELS = {
    "": t("ignore"),
    name: t("fName"),
    first_name: t("fFirstName"),
    last_name: t("fLastName"),
    phone_number: t("fPhone"),
    email: t("fEmail"),
    identifier: t("fIdentifier"),
    company_name: t("fCompany"),
    city: t("fCity"),
    country: t("fCountry")
  };
  var XLSX_LOADING = null;
  function loadXlsx(assetBase) {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!XLSX_LOADING) {
      XLSX_LOADING = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = vendorUrl(assetBase);
        s.onload = () => resolve(window.XLSX);
        s.onerror = () => reject(new Error("SheetJS load failed"));
        document.head.appendChild(s);
      });
    }
    return XLSX_LOADING;
  }
  function openWizard({ accountId, authHeaders, assetBase }) {
    injectStyles();
    const api = createApiClient(accountId, authHeaders);
    const state = { table: null, mapping: [], customMap: [], labelTitle: "", labelNeedsCreation: false, waInboxId: null };
    api.listInboxes().then((r) => {
      const list = r?.payload || r || [];
      const wa = list.find((i) => /whatsapp/i.test(i?.channel_type || ""));
      state.waInboxId = wa?.id || null;
    }).catch(() => {
    });
    var dlg = document.createElement("dialog");
    dlg.className = "cwi-dlg";
    const pageIsDark = document.documentElement.classList.contains("dark") || document.body.classList.contains("dark");
    if (pageIsDark) dlg.classList.add("dark");
    const appDir = (document.querySelector("#app[dir]") || document.documentElement).getAttribute("dir");
    const pageIsRTL = appDir ? appDir === "rtl" : getComputedStyle(document.body).direction === "rtl";
    dlg.setAttribute("dir", pageIsRTL ? "rtl" : "ltr");
    const modal = el("div", "cwi-modal flex flex-col gap-5 p-6 bg-n-alpha-3 backdrop-blur-[100px] shadow-xl rounded-xl rtl:text-right");
    dlg.appendChild(modal);
    document.body.appendChild(dlg);
    dlg.showModal();
    function close() {
      try {
        dlg.close();
      } catch (e) {
      }
      dlg.remove();
    }
    dlg.addEventListener("cancel", function(e) {
      e.preventDefault();
      close();
    });
    dlg.addEventListener("mousedown", function(e) {
      if (e.target === dlg) close();
    });
    stepUpload();
    function stepUpload() {
      modal.replaceChildren();
      const desc = el("p", "mb-0 text-sm text-n-slate-11");
      desc.append(t("uploadDesc"));
      const sample = el("a", "text-n-blue-11");
      sample.textContent = t("sampleLink");
      sample.setAttribute("download", t("sampleFileName"));
      sample.setAttribute("href", sampleCsvHref());
      desc.appendChild(sample);
      modal.appendChild(header(t("uploadTitle"), desc));
      const input = el("input");
      input.type = "file";
      input.accept = ".csv,.xlsx,.xls";
      input.style.display = "none";
      input.addEventListener("change", () => input.files[0] && handleFile(input.files[0], drop, body));
      const drop = el(
        "div",
        "flex flex-col items-center justify-center gap-2 p-6 rounded-lg outline-dashed outline-1 outline-n-weak bg-n-alpha-1 cursor-pointer hover:bg-n-alpha-2 transition-colors"
      );
      const body = el("div", "flex flex-col items-center justify-center gap-2");
      body.append(
        icon("upload", "size-6 text-n-slate-11"),
        elWithText("span", "text-sm text-n-slate-12", t("dropText")),
        elWithText("span", "text-xs text-n-slate-11", t("csvOrExcel"))
      );
      drop.appendChild(body);
      drop.addEventListener("click", () => input.click());
      drop.addEventListener("dragover", (e) => {
        e.preventDefault();
      });
      drop.addEventListener("drop", (e) => {
        e.preventDefault();
        if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0], drop, body);
      });
      modal.append(drop, input, footer({ onCancel: close }));
    }
    function showPickedFile(file, body) {
      body.replaceChildren();
      body.className = "flex items-center gap-2 w-full";
      body.addEventListener("click", (e) => e.stopPropagation());
      const left = el("div", "flex items-center min-w-0 gap-2 flex-1");
      left.append(
        icon("file-text", "size-4 text-n-slate-11 shrink-0"),
        elWithText("span", "text-sm text-n-slate-12 truncate", processFileName(file.name))
      );
      const right = el("div", "flex items-center gap-2 shrink-0");
      const replaceBtn = btn("ghost");
      replaceBtn.textContent = t("replace");
      replaceBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        stepUpload();
      });
      const sep = el("div", "w-px h-3 bg-n-strong");
      const trashBtn = el(
        "button",
        BTN_BASE + " text-n-slate-12 hover:bg-n-alpha-2 outline-transparent h-8 w-8 p-0 cursor-pointer"
      );
      trashBtn.appendChild(icon("trash", "size-4"));
      trashBtn.title = t("remove");
      trashBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        stepUpload();
      });
      right.append(replaceBtn, sep, trashBtn);
      body.append(left, right);
    }
    async function handleFile(file, drop, body) {
      if (drop && body) showPickedFile(file, body);
      try {
        const table = await readFileToTable(file, { loadXlsx: () => loadXlsx(assetBase) });
        if (!table.headers.length) throw new Error(t("emptyFile"));
        state.table = table;
        state.mapping = detectColumns(table.headers, table.rows.slice(0, 20)).map((d) => ({ index: d.index, field: d.field }));
        stepMapping();
      } catch (e) {
        showError(e.message);
      }
    }
    async function stepMapping() {
      modal.replaceChildren();
      modal.appendChild(header(t("mappingTitle"), t("mappingDesc")));
      let customDefs = [];
      try {
        customDefs = await api.listCustomAttributes();
      } catch {
      }
      const tbl = el("table", "w-full text-sm border-collapse");
      const thead = el("tr");
      [t("colInFile"), t("fieldInChatwoot"), t("example")].forEach((h) => {
        const th = el("th", "text-start font-medium text-n-slate-11 px-3 py-2 cwi-tbl-cell border-n-weak");
        th.textContent = h;
        thead.appendChild(th);
      });
      tbl.appendChild(thead);
      state.customMap = [];
      state.table.headers.forEach((colHeader, i) => {
        const sample = (state.table.rows.find((r) => (r[i] || "").trim()) || [])[i] || "";
        const options = [];
        options.push({ value: "", label: t("ignore") });
        SYSTEM_FIELDS.forEach((fld) => {
          options.push({ value: fld, label: FIELD_LABELS[fld] || fld, group: t("systemFields") });
        });
        if (customDefs.length) {
          customDefs.forEach((d) => {
            options.push({ value: "custom:" + d.attribute_key, label: d.attribute_display_name, group: t("customFields") });
          });
        }
        options.push({ value: "__new__", label: t("createNewField"), icon: "plus" });
        const initial = state.mapping[i]?.field && SYSTEM_FIELDS.includes(state.mapping[i].field) ? state.mapping[i].field : "";
        const row = el("tr");
        const tdHeader = el("td", "px-3 py-2 cwi-tbl-cell border-n-weak text-n-slate-12");
        tdHeader.textContent = colHeader;
        const tdSel = el("td", "px-3 py-2 cwi-tbl-cell border-n-weak text-n-slate-12");
        const cs = customSelect({
          options,
          value: initial,
          placeholder: t("ignore"),
          onSelect: (v) => {
            if (v === "__new__") {
              showInlineNewField(i, colHeader, tdSel, cs);
            } else {
              updateMapping(i, v);
            }
          }
        });
        tdSel.appendChild(cs.el);
        const tdSample = el("td", "px-3 py-2 cwi-tbl-cell border-n-weak text-n-slate-12");
        tdSample.textContent = sample;
        row.append(tdHeader, tdSel, tdSample);
        tbl.appendChild(row);
      });
      modal.append(tbl, footer({ onBack: stepUpload, onNext: stepLabel, nextLabel: t("continue") }));
    }
    function showInlineNewField(i, colHeader, tdSel, origCs) {
      state.mapping[i] = { index: i, field: null };
      state.customMap = state.customMap.filter((c) => c.index !== i);
      const wrap = el("div", "flex items-center gap-1");
      const inp = el(
        "input",
        "h-8 px-3 rounded-lg bg-n-alpha-black2 text-n-slate-12 outline outline-1 outline-n-weak focus:outline-n-brand text-sm w-full border-0 outline-offset-[-1px]"
      );
      inp.value = colHeader;
      inp.placeholder = t("newFieldName");
      const confirmBtn = el(
        "button",
        BTN_BASE + " bg-n-brand text-white hover:brightness-110 outline-transparent h-8 w-8 p-0 shrink-0 cursor-pointer"
      );
      confirmBtn.appendChild(icon("check", "size-4"));
      confirmBtn.title = t("confirmTitle");
      const cancelBtn = el(
        "button",
        BTN_BASE + " text-n-slate-12 hover:bg-n-alpha-2 outline-transparent h-8 w-8 p-0 shrink-0 cursor-pointer"
      );
      cancelBtn.appendChild(icon("x", "size-4"));
      cancelBtn.title = t("cancel");
      function commit() {
        const name = inp.value.trim() || colHeader;
        state.customMap.push({ index: i, attribute_key: slugify(name), create: { display: name } });
        const done = el("div", "flex items-center gap-1");
        const lbl = el("span", "text-sm text-n-slate-12 flex-1 truncate");
        lbl.textContent = name;
        const changeBtn = el(
          "button",
          BTN_BASE + " text-n-slate-12 hover:bg-n-alpha-2 outline-transparent h-8 w-8 p-0 shrink-0 cursor-pointer"
        );
        changeBtn.appendChild(icon("x", "size-4"));
        changeBtn.title = t("change");
        changeBtn.addEventListener("click", revert);
        done.append(lbl, changeBtn);
        tdSel.replaceChildren(done);
      }
      function revert() {
        state.mapping[i] = { index: i, field: null };
        state.customMap = state.customMap.filter((c) => c.index !== i);
        origCs.setValue("");
        tdSel.replaceChildren(origCs.el);
      }
      confirmBtn.addEventListener("click", commit);
      cancelBtn.addEventListener("click", revert);
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          revert();
        }
      });
      wrap.append(inp, confirmBtn, cancelBtn);
      tdSel.replaceChildren(wrap);
      inp.focus();
    }
    function updateMapping(i, value) {
      state.mapping[i] = { index: i, field: null };
      state.customMap = state.customMap.filter((c) => c.index !== i);
      if (SYSTEM_FIELDS.includes(value)) {
        state.mapping[i].field = value;
      } else if (value.startsWith("custom:")) {
        state.customMap.push({ index: i, attribute_key: value.slice(7) });
      }
    }
    let openPanelCloser = null;
    function customSelect({ options, value, onSelect, placeholder, size }) {
      let currentValue = value == null ? "" : value;
      const heightCls = size === "field" ? "h-10" : "h-8";
      const container = el("div", "relative w-full");
      const trigger = el(
        "button",
        "inline-flex items-center min-w-0 gap-2 transition-all duration-100 ease-out border-0 rounded-lg outline-1 outline disabled:opacity-50 " + heightCls + " px-3 text-sm text-n-slate-12 font-normal justify-between w-full outline-n-weak hover:outline-n-slate-6 focus:outline-n-brand cursor-pointer"
      );
      trigger.type = "button";
      const labelSpan = el("span", "truncate");
      const chevron = icon("chevron-down", "size-4 text-n-slate-11 shrink-0");
      trigger.append(labelSpan, chevron);
      container.appendChild(trigger);
      let panel = null;
      let panelRows = [];
      let activeNode = null;
      function visibleRows() {
        return panelRows.filter((n) => n.style.display !== "none");
      }
      function clearActive() {
        if (activeNode) activeNode.classList.remove("bg-n-alpha-3");
        activeNode = null;
      }
      function setActiveNode(node) {
        clearActive();
        activeNode = node;
        if (node) {
          node.classList.add("bg-n-alpha-3");
          node.scrollIntoView({ block: "nearest" });
        }
      }
      function moveActive(delta) {
        const vis = visibleRows();
        if (!vis.length) return;
        const cur = activeNode ? vis.indexOf(activeNode) : -1;
        let next = cur + delta;
        if (next < 0) next = vis.length - 1;
        else if (next >= vis.length) next = 0;
        setActiveNode(vis[next]);
      }
      function labelFor(v) {
        const opt = options.find((o) => o.value === v);
        return opt ? opt.label : "";
      }
      function renderTriggerLabel() {
        const txt = labelFor(currentValue);
        if (txt) {
          labelSpan.textContent = txt;
          labelSpan.className = "truncate text-n-slate-12";
        } else {
          labelSpan.textContent = placeholder || "";
          labelSpan.className = "truncate text-n-slate-11";
        }
      }
      renderTriggerLabel();
      function setChevron(open) {
        chevron.className = "i-lucide-chevron-" + (open ? "up" : "down") + " size-4 text-n-slate-11 shrink-0";
      }
      function setTriggerOpen(open) {
        trigger.classList.toggle("outline-n-weak", !open);
        trigger.classList.toggle("hover:outline-n-slate-6", !open);
        trigger.classList.toggle("outline-n-brand", open);
        setChevron(open);
      }
      function positionPanel() {
        if (!panel) return;
        const GAP = 8, MARGIN = 16;
        const r = trigger.getBoundingClientRect();
        const vw = window.innerWidth, vh = window.innerHeight;
        const list = panel.querySelector("ul");
        if (list) list.style.maxHeight = "";
        const dh = panel.offsetHeight || 240;
        panel.style.position = "fixed";
        panel.style.width = r.width + "px";
        const spaceBelow = vh - r.bottom, spaceAbove = r.top;
        const placeAbove = spaceBelow < dh + MARGIN && (spaceAbove >= dh + MARGIN || spaceAbove > spaceBelow);
        if (placeAbove) {
          panel.style.top = "auto";
          panel.style.bottom = vh - r.top + GAP + "px";
          if (list) list.style.maxHeight = Math.max(80, Math.min(240, spaceAbove - GAP - MARGIN)) + "px";
        } else {
          panel.style.bottom = "auto";
          panel.style.top = r.bottom + GAP + "px";
          if (list) list.style.maxHeight = Math.max(80, Math.min(240, spaceBelow - GAP - MARGIN)) + "px";
        }
        let left = r.left;
        if (left + r.width > vw - MARGIN) left = vw - MARGIN - r.width;
        if (left < MARGIN) left = MARGIN;
        panel.style.left = left + "px";
      }
      function closePanel() {
        if (!panel) return;
        document.removeEventListener("mousedown", onOutside, true);
        document.removeEventListener("keydown", onKey, true);
        window.removeEventListener("resize", positionPanel, true);
        modal.removeEventListener("scroll", positionPanel, true);
        panel.remove();
        panel = null;
        panelRows = [];
        activeNode = null;
        openPanelCloser = null;
        setTriggerOpen(false);
      }
      function onOutside(e) {
        if (panel && !panel.contains(e.target) && !trigger.contains(e.target)) closePanel();
      }
      function onKey(e) {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          closePanel();
          return;
        }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          moveActive(1);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          moveActive(-1);
          return;
        }
        if (e.key === "Enter" && activeNode) {
          e.preventDefault();
          activeNode.click();
        }
      }
      function buildRow(opt) {
        const isSel = opt.value === currentValue;
        const row = el(
          "li",
          "flex items-center justify-between w-full gap-2 px-3 py-2 text-sm transition-colors duration-150 cursor-pointer hover:bg-n-alpha-2" + (isSel ? " bg-n-alpha-2" : "")
        );
        row.setAttribute("role", "option");
        const lead = el("span", "flex items-center min-w-0 gap-2");
        if (opt.icon) lead.appendChild(icon(opt.icon, "size-4 text-n-slate-11 shrink-0"));
        const txt = el("span", "truncate text-n-slate-12" + (isSel ? " font-medium" : ""));
        txt.textContent = opt.label;
        lead.appendChild(txt);
        row.appendChild(lead);
        if (isSel) row.appendChild(icon("check", "flex-shrink-0 size-4 text-n-slate-11"));
        row.addEventListener("click", () => {
          currentValue = opt.value;
          renderTriggerLabel();
          closePanel();
          onSelect(opt.value);
        });
        return row;
      }
      function openPanel() {
        if (openPanelCloser) openPanelCloser();
        panel = el(
          "div",
          "cwi-cs-panel z-50 transition-opacity duration-200 border rounded-md shadow-lg bg-n-solid-1 border-n-strong"
        );
        if (pageIsDark) panel.classList.add("dark");
        panel.style.position = "fixed";
        panel.style.top = "0";
        panel.style.left = "0";
        panel.style.opacity = "0";
        const withSearch = options.length > 7;
        let searchInput = null;
        if (withSearch) {
          const searchWrap = el("div", "relative border-b border-n-strong");
          searchWrap.appendChild(icon("search", "absolute top-2.5 size-4 text-n-slate-11 " + (pageIsRTL ? "right-3" : "left-3")));
          searchInput = el(
            "input",
            "reset-base w-full py-2 text-sm focus:outline-none border-none rounded-t-md bg-n-solid-1 text-n-slate-12 " + (pageIsRTL ? "pr-10 pl-2 text-right" : "pl-10 pr-2")
          );
          searchInput.type = "search";
          searchInput.placeholder = t("search");
          searchWrap.appendChild(searchInput);
          panel.appendChild(searchWrap);
        }
        const list = el("ul", "py-1 mb-0 overflow-auto max-h-60");
        list.setAttribute("role", "listbox");
        const groupNodes = [];
        const rowNodes = [];
        let lastGroup;
        options.forEach((opt) => {
          if (opt.group && opt.group !== lastGroup) {
            lastGroup = opt.group;
            const gl = el("li", "px-3 py-1.5 text-xs font-medium text-n-slate-11");
            gl.textContent = opt.group;
            list.appendChild(gl);
            groupNodes.push({ node: gl, group: opt.group });
          }
          if (!opt.group) lastGroup = void 0;
          const rowNode = buildRow(opt);
          rowNodes.push({ node: rowNode, group: opt.group, label: opt.label });
          list.appendChild(rowNode);
        });
        const empty = el("li", "px-3 py-2 text-sm text-n-slate-11");
        empty.textContent = t("noResults");
        empty.style.display = "none";
        list.appendChild(empty);
        panel.appendChild(list);
        panelRows = rowNodes.map((r) => r.node);
        function applyFilter(q) {
          const needle = q.trim().toLowerCase();
          let anyVisible = false;
          const groupHasVisible = {};
          rowNodes.forEach((r) => {
            const match = !needle || r.label.toLowerCase().indexOf(needle) !== -1;
            r.node.style.display = match ? "" : "none";
            if (match) {
              anyVisible = true;
              if (r.group) groupHasVisible[r.group] = true;
            }
          });
          groupNodes.forEach((g) => {
            g.node.style.display = groupHasVisible[g.group] ? "" : "none";
          });
          empty.style.display = anyVisible ? "none" : "";
          if (activeNode && activeNode.style.display === "none") clearActive();
        }
        if (searchInput) {
          searchInput.addEventListener("input", () => applyFilter(searchInput.value));
        }
        dlg.appendChild(panel);
        positionPanel();
        setTriggerOpen(true);
        requestAnimationFrame(() => {
          if (panel) panel.style.opacity = "1";
        });
        if (searchInput) searchInput.focus({ preventScroll: true });
        document.addEventListener("mousedown", onOutside, true);
        document.addEventListener("keydown", onKey, true);
        window.addEventListener("resize", positionPanel, true);
        modal.addEventListener("scroll", positionPanel, true);
        openPanelCloser = closePanel;
      }
      trigger.addEventListener("click", (e) => {
        e.preventDefault();
        if (panel) closePanel();
        else openPanel();
      });
      return {
        el: container,
        setValue(v) {
          currentValue = v == null ? "" : v;
          renderTriggerLabel();
        }
      };
    }
    async function stepLabel() {
      modal.replaceChildren();
      modal.appendChild(header(t("labelStepTitle"), t("labelStepDesc")));
      let labels = [];
      try {
        labels = await api.listLabels().then((r) => r.payload || r);
      } catch {
      }
      let selValue = "";
      const options = [{ value: "", label: t("noLabel") }];
      (labels || []).forEach((l) => options.push({ value: l.title, label: l.title }));
      const existingLabelTitles = new Set((labels || []).map((l) => String(l.title).toLowerCase()));
      const newInput = el(
        "input",
        "h-8 w-full px-3 py-2 text-sm rounded-lg bg-n-alpha-black2 text-n-slate-12 outline outline-1 outline-n-weak focus:outline-n-brand border-0 outline-offset-[-1px]"
      );
      newInput.placeholder = t("newLabelPlaceholder");
      const labelError = el("div", "min-h-5 text-sm text-n-ruby-11");
      newInput.addEventListener("input", () => {
        labelError.textContent = "";
      });
      newInput.addEventListener("blur", () => {
        const normalized = normalizeLabelTitle(newInput.value);
        if (normalized) newInput.value = normalized;
      });
      const cs = customSelect({
        options,
        value: "",
        placeholder: t("noLabel"),
        size: "field",
        // roomier single-select field for the label step
        onSelect: (v) => {
          selValue = v;
          if (v) newInput.value = "";
          labelError.textContent = "";
        }
      });
      modal.append(
        formRow(t("selectLabel"), cs.el),
        formRow(t("newLabelField"), newInput),
        labelError,
        footer({
          onBack: stepMapping,
          onNext: () => {
            const rawTitle = newInput.value.trim();
            const enteredTitle = normalizeLabelTitle(rawTitle);
            if (rawTitle && !isValidLabelTitle(enteredTitle)) {
              labelError.textContent = t("labelNameInvalid");
              newInput.focus({ preventScroll: true });
              return;
            }
            if (enteredTitle) newInput.value = enteredTitle;
            state.labelTitle = enteredTitle || selValue;
            state.labelNeedsCreation = Boolean(enteredTitle) && !existingLabelTitles.has(enteredTitle.toLowerCase());
            stepPreview();
          },
          nextLabel: t("continue")
        })
      );
    }
    async function stepPreview() {
      modal.replaceChildren();
      modal.appendChild(header(t("previewTitle"), ""));
      const status = el("div", "text-sm text-n-slate-11");
      status.textContent = t("checkingDupes");
      modal.appendChild(status);
      await ensureCustomAttributes();
      try {
        await ensureLabel();
      } catch {
        status.textContent = t("labelCreateFailed");
        modal.appendChild(footer({ onBack: stepLabel }));
        return;
      }
      const contacts = state.table.rows.map((row, idx) => ({
        ...buildContactPayload(row, state.mapping, state.customMap),
        __row: idx + 2
      }));
      state.contacts = contacts;
      const N = contacts.length;
      let dedupOk = true;
      try {
        await batchDedup(contacts, api, (d, tot) => {
          status.textContent = `${t("checkingDupes")} ${d}/${tot}`;
        });
      } catch {
        dedupOk = false;
        contacts.forEach((c) => {
          delete c.__match;
          delete c.__dupTail;
        });
      }
      const dupes = contacts.filter((c) => c.__dupTail).length;
      const existing = contacts.filter((c) => c.__match).length;
      const created = N - existing - dupes;
      status.textContent = dedupOk ? `${t("readyToImport")} ${N} \xB7 ${created} ${t("newWord")} \xB7 ${existing} ${t("existingWillUpdate")}` + (dupes ? ` \xB7 ${dupes} ${t("dupInFile")}` : "") : t("dedupFailed");
      modal.append(
        previewTable(contacts.slice(0, 10)),
        footer({ onBack: stepLabel, onNext: stepRun, nextLabel: `${t("importVerb")} ${N} ${t("contactsWord")}` })
      );
    }
    async function ensureCustomAttributes() {
      for (const c of state.customMap.filter((x) => x.create)) {
        try {
          await api.createCustomAttribute({
            attribute_display_name: c.create.display,
            attribute_key: c.attribute_key,
            attribute_display_type: "text",
            attribute_model: "contact_attribute"
          });
        } catch {
        }
      }
    }
    async function ensureLabel() {
      if (!state.labelTitle || !state.labelNeedsCreation) return;
      const created = await api.createLabel(state.labelTitle);
      state.labelTitle = created?.title || state.labelTitle;
      state.labelNeedsCreation = false;
    }
    function stepRun() {
      if (window.__cwImportJob && ["running", "cancelling"].includes(window.__cwImportJob.progress.state)) {
        showError(t("alreadyRunning"));
        return;
      }
      const job = createImportJob({ contacts: state.contacts, api, labelTitle: state.labelTitle, waInboxId: state.waInboxId });
      window.__cwImportJob = job;
      mountPill(job, { dark: pageIsDark, rtl: pageIsRTL });
      close();
    }
    function showError(msg) {
      const e = el("div", "text-sm text-n-ruby-11");
      e.textContent = msg;
      modal.appendChild(e);
    }
    function previewTable(contacts) {
      const tbl = el("table", "w-full text-sm border-collapse");
      const thead = el("tr");
      [t("thName"), t("thPhone"), t("thEmail"), t("thCompany")].forEach((h) => {
        const th = el("th", "text-start font-medium text-n-slate-11 px-3 py-2 cwi-tbl-cell border-n-weak");
        th.textContent = h;
        thead.appendChild(th);
      });
      tbl.appendChild(thead);
      contacts.forEach((c) => {
        const row = el("tr");
        [c.name || "", c.phone_number || "", c.email || "", (c.additional_attributes || {}).company_name || ""].forEach((v) => {
          const td = el("td", "px-3 py-2 cwi-tbl-cell border-n-weak text-n-slate-12");
          td.textContent = v;
          row.appendChild(td);
        });
        tbl.appendChild(row);
      });
      return tbl;
    }
    function footer({ onBack, onNext, onCancel, nextLabel }) {
      const bar = el("div", "flex items-center justify-between w-full gap-3");
      if (onBack) {
        const b = btn("faded");
        b.className += " w-full";
        b.textContent = t("back");
        b.onclick = onBack;
        bar.appendChild(b);
      }
      if (onCancel) {
        const b = btn("ghost");
        b.className += " w-full";
        b.textContent = t("cancel");
        b.onclick = onCancel;
        bar.appendChild(b);
      }
      if (onNext) {
        const b = btn("primary");
        b.className += " w-full";
        b.textContent = nextLabel || t("continue");
        b.onclick = onNext;
        bar.appendChild(b);
      }
      return bar;
    }
    function formRow(labelText, control) {
      const wrap = el("div", "flex flex-col gap-1");
      const lbl = el("label", "text-sm text-n-slate-12 mb-1");
      lbl.textContent = labelText;
      wrap.append(lbl, control);
      return wrap;
    }
  }
  function injectStyles() {
    if (document.getElementById("cwi-styles")) return;
    const s = document.createElement("style");
    s.id = "cwi-styles";
    s.textContent = STYLES;
    document.head.appendChild(s);
  }
  function mountPill(job, { dark, rtl }) {
    injectStyles();
    document.getElementById("cwi-pill")?.remove();
    const pill = el("div", "cwi-pill flex flex-col gap-2 p-4 rounded-xl shadow-lg border border-n-strong bg-n-solid-1");
    pill.id = "cwi-pill";
    if (dark) pill.classList.add("dark");
    pill.setAttribute("dir", rtl ? "rtl" : "ltr");
    const head = el("div", "flex items-center justify-between gap-3");
    const title = el("span", "text-sm font-medium text-n-slate-12");
    const xBtn = el("button", BTN_BASE + " text-n-slate-12 hover:bg-n-alpha-2 outline-transparent h-6 w-6 p-0 shrink-0 cursor-pointer");
    xBtn.appendChild(icon("x", "size-4"));
    head.append(title, xBtn);
    const track = el("div", "h-1.5 w-full rounded-full bg-n-alpha-2 overflow-hidden");
    const fill = el("div", "cwi-prog-fill");
    fill.style.width = "0%";
    track.appendChild(fill);
    const detail = el("div", "text-xs text-n-slate-11");
    const hint = elWithText("div", "text-xs text-n-slate-11", t("bgHint"));
    const actions = el("div", "flex items-center gap-2");
    actions.style.display = "none";
    pill.append(head, track, detail, hint, actions);
    document.body.appendChild(pill);
    function warnUnload(e) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", warnUnload);
    function dismiss() {
      off();
      window.removeEventListener("beforeunload", warnUnload);
      pill.remove();
      if (window.__cwImportJob === job) window.__cwImportJob = null;
    }
    xBtn.addEventListener("click", () => {
      const st = job.progress.state;
      if (st === "running") job.cancel();
      else if (st !== "cancelling") dismiss();
    });
    function render(p) {
      fill.style.width = (p.total ? Math.round(p.done / p.total * 100) : 100) + "%";
      const counts = `${t("createdWord")} ${p.created} \xB7 ${t("updatedWord")} ${p.updated}` + (p.skipped ? ` \xB7 ${t("skippedWord")} ${p.skipped}` : "") + (p.failed ? ` \xB7 ${t("failedWord")} ${p.failed}` : "");
      if (p.state === "running" || p.state === "cancelling") {
        title.textContent = p.state === "running" ? t("bgImporting") : t("bgCancelling");
        xBtn.title = t("stopImport");
        detail.textContent = `${p.done}/${p.total} \xB7 ${counts}`;
        return;
      }
      window.removeEventListener("beforeunload", warnUnload);
      xBtn.title = t("close");
      hint.remove();
      title.textContent = p.state === "done" ? t("importDone") : p.state === "cancelled" ? `${t("bgCancelled")} (${p.done}/${p.total})` : t("bgError");
      detail.textContent = counts;
      if (job.log && !actions.childElementCount) {
        actions.style.display = "";
        const dl = btn("ghost");
        dl.textContent = t("downloadReport");
        dl.addEventListener("click", () => downloadCsv(job.log.toCsv(), "import-log.csv"));
        actions.appendChild(dl);
      }
    }
    const off = job.onUpdate(render);
    render(job.progress);
  }
  function el(tag, cls) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }
  function icon(name, extra) {
    return el("span", "i-lucide-" + name + (extra ? " " + extra : ""));
  }
  function header(title, subtitle) {
    const wrap = el("div", "flex flex-col gap-2");
    const h = el("h3", "text-base font-medium leading-6 text-n-slate-12 m-0");
    h.textContent = title;
    wrap.appendChild(h);
    if (subtitle != null && subtitle !== "") {
      if (typeof subtitle === "string") {
        const p = el("p", "mb-0 text-sm text-n-slate-11");
        p.textContent = subtitle;
        wrap.appendChild(p);
      } else {
        wrap.appendChild(subtitle);
      }
    }
    return wrap;
  }
  var BTN_BASE = "inline-flex items-center justify-center min-w-0 gap-2 transition-all duration-100 ease-out border-0 rounded-lg outline-1 outline disabled:opacity-50 active:enabled:scale-[0.97] text-sm font-medium";
  function btn(variant) {
    const b = el("button", BTN_BASE + " cursor-pointer");
    if (variant === "primary") {
      b.className += " bg-n-brand text-white hover:brightness-110 outline-transparent h-10 px-4";
    } else if (variant === "faded") {
      b.className += " bg-n-slate-9/10 text-n-slate-12 hover:bg-n-slate-9/20 outline-transparent h-10 px-4";
    } else {
      b.className += " text-n-slate-12 hover:bg-n-alpha-2 outline-transparent h-8 px-3";
    }
    return b;
  }
  function elWithText(tag, cls, text) {
    const e = el(tag, cls);
    e.textContent = text;
    return e;
  }
  function processFileName(name) {
    const MAX = 24;
    if (!name || name.length <= MAX) return name || "";
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 ? name.slice(dot) : "";
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const keep = MAX - ext.length - 1;
    if (keep <= 1) return name.slice(0, MAX - 1) + "\u2026";
    const head = Math.ceil(keep / 2);
    const tail = Math.floor(keep / 2);
    return stem.slice(0, head) + "\u2026" + stem.slice(stem.length - tail) + ext;
  }
  function sampleCsvHref() {
    const rows = DRIP_LOCALE === "he" ? [
      "\u05E9\u05DD \u05E4\u05E8\u05D8\u05D9,\u05E9\u05DD \u05DE\u05E9\u05E4\u05D7\u05D4,\u05D8\u05DC\u05E4\u05D5\u05DF,\u05D0\u05D9\u05DE\u05D9\u05D9\u05DC,\u05D7\u05D1\u05E8\u05D4",
      '\u05D9\u05E9\u05E8\u05D0\u05DC,\u05D9\u05E9\u05E8\u05D0\u05DC\u05D9,0501234567,israel@example.com,\u05D7\u05D1\u05E8\u05D4 \u05D1\u05E2"\u05DE',
      "\u05D3\u05E0\u05D4,\u05DB\u05D4\u05DF,0527654321,dana@example.com,\u05E1\u05D8\u05D0\u05E8\u05D8\u05D0\u05E4"
    ] : [
      "First name,Last name,Phone,Email,Company",
      "John,Doe,+15551234567,john@example.com,Acme Inc.",
      "Jane,Smith,+15557654321,jane@example.com,Startup LLC"
    ];
    const BOM = "\uFEFF";
    return "data:text/csv;charset=utf-8," + encodeURIComponent(BOM + rows.join("\r\n"));
  }
  function slugify(s) {
    return String(s).toLowerCase().trim().replace(/[^a-z0-9֐-׿]+/g, "_").replace(/^_|_$/g, "") || "field";
  }
  function downloadCsv(content, name) {
    const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  return __toCommonJS(entry_exports);
})();
