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
    submit: () => submit,
    take: () => take
  });

  // lib/csvParser.js
  function parseCsv(text) {
    if (text.charCodeAt(0) === 65279) text = text.slice(1);
    const delim = detectDelimiter(text.slice(0, text.indexOf("\n") + 1 || text.length));
    const records = [];
    let field = "";
    let record = [];
    let inQuotes = false;
    let fresh = true;
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
      if (ch === delim) {
        record.push(field);
        field = "";
        fresh = true;
        continue;
      }
      if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        record.push(field);
        field = "";
        fresh = true;
        if (record.length > 1 || record[0] !== "") records.push(record);
        record = [];
        continue;
      }
      if (ch === '"' && fresh) inQuotes = true;
      else field += ch;
      fresh = false;
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
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') i++;
          else inQuotes = false;
        }
      } else if (ch === '"') inQuotes = i === 0 || line[i - 1] in counts;
      else if (ch in counts) counts[ch]++;
    }
    return Object.keys(counts).reduce((a, b) => counts[b] > counts[a] ? b : a, ",");
  }

  // lib/xlsxReader.js
  function parseXlsxAoA(aoa) {
    const headers = (aoa[0] || []).map((h2) => String(h2 ?? "").trim());
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
  function stripIsraeliTrunk(rest) {
    return /^0\d{8,9}$/.test(rest) ? rest.slice(1) : rest;
  }
  function israeli(rest) {
    const r = stripIsraeliTrunk(rest);
    return r.length >= 8 ? "+972" + r : null;
  }
  function normalizePhone(raw) {
    if (raw == null) return null;
    let d = String(raw).trim().replace(/[^\d+]/g, "");
    if (d.startsWith("+972")) return israeli(d.slice(4));
    if (d.startsWith("+")) return d.length >= 11 ? d : null;
    const hadIntlPrefix = d.startsWith("00");
    if (hadIntlPrefix) d = d.slice(2);
    if (d.startsWith("972")) return israeli(d.slice(3));
    if (hadIntlPrefix) return d.length >= 9 ? "+" + d : null;
    if (d.startsWith("0")) {
      d = d.slice(1);
      return d.length === 9 || d.length === 8 ? "+972" + d : null;
    }
    if (d.length === 9) return "+972" + d;
    if (d.length === 10 && d.startsWith("5")) return null;
    if (d.length >= 10 && d.length <= 15) return "+" + d;
    return null;
  }

  // lib/columnDetector.js
  var SYNONYMS = {
    first_name: ["\u05E9\u05DD \u05E4\u05E8\u05D8\u05D9", "\u05E4\u05E8\u05D8\u05D9", "firstname", "first name", "fname", "given name"],
    last_name: ["\u05E9\u05DD \u05DE\u05E9\u05E4\u05D7\u05D4", "\u05DE\u05E9\u05E4\u05D7\u05D4", "lastname", "last name", "surname", "family name"],
    name: ["\u05E9\u05DD", "\u05E9\u05DD \u05DE\u05DC\u05D0", "\u05E9\u05DD \u05D0\u05D9\u05E9 \u05E7\u05E9\u05E8", "\u05D0\u05D9\u05E9 \u05E7\u05E9\u05E8", "name", "full name", "fullname", "contact name", "contact"],
    // 'phonenumber'/'emailaddress' cover snake_case exports (phone_number, email_address):
    // normHeader strips underscores, so the joined form is what actually gets compared.
    phone_number: ["\u05D8\u05DC\u05E4\u05D5\u05DF", "\u05E0\u05D9\u05D9\u05D3", "\u05DE\u05E1\u05E4\u05E8 \u05E0\u05D9\u05D9\u05D3", "\u05D8\u05DC\u05E4\u05D5\u05DF \u05E0\u05D9\u05D9\u05D3", "\u05E4\u05DC\u05D0\u05E4\u05D5\u05DF", "\u05E4\u05DC", "\u05E1\u05DC\u05D5\u05DC\u05E8\u05D9", "\u05E1\u05DC\u05D5\u05DC\u05D0\u05E8\u05D9", "\u05DE\u05E1\u05E4\u05E8 \u05D8\u05DC\u05E4\u05D5\u05DF", "\u05DE\u05E1\u05E4\u05E8", "\u05D5\u05D5\u05D0\u05D8\u05E1\u05D0\u05E4", "whatsapp", "phone", "mobile", "cell", "cellphone", "tel", "telephone", "phone number", "phonenumber", "msisdn"],
    email: ["\u05D0\u05D9\u05DE\u05D9\u05D9\u05DC", "\u05DE\u05D9\u05D9\u05DC", '\u05D3\u05D5\u05D0"\u05DC', "\u05D3\u05D5\u05D0\u05DC", "\u05DB\u05EA\u05D5\u05D1\u05EA \u05DE\u05D9\u05D9\u05DC", "email", "e-mail", "mail", "email address", "emailaddress"],
    // ⚠️ ID-number headers must be recognized here: Israeli IDs are 9 digits, which
    // normalizePhone happily turns into +972XXXXXXXXX — so an unrecognized ת"ז column
    // gets content-detected as phone_number and steals the real phone column's slot.
    identifier: ["\u05DE\u05D6\u05D4\u05D4", "\u05DE\u05D6\u05D4\u05D4 \u05D7\u05D9\u05E6\u05D5\u05E0\u05D9", "\u05EA\u05D6", '\u05EA"\u05D6', "\u05EA.\u05D6", "\u05DE\u05E1\u05E4\u05E8 \u05EA\u05D6", "\u05DE\u05E1 \u05EA\u05D6", "\u05DE\u05E1\u05E4\u05E8 \u05D6\u05D4\u05D5\u05EA", "\u05EA\u05E2\u05D5\u05D3\u05EA \u05D6\u05D4\u05D5\u05EA", "\u05DE\u05E1\u05E4\u05E8 \u05EA\u05E2\u05D5\u05D3\u05EA \u05D6\u05D4\u05D5\u05EA", "id", "identifier", "external id", "ref"],
    company_name: ["\u05D7\u05D1\u05E8\u05D4", "\u05E2\u05E1\u05E7", "\u05D0\u05E8\u05D2\u05D5\u05DF", "\u05E9\u05DD \u05D7\u05D1\u05E8\u05D4", "company", "company name", "organization", "organisation", "business"],
    city: ["\u05E2\u05D9\u05E8", "\u05D9\u05D9\u05E9\u05D5\u05D1", "\u05D9\u05E9\u05D5\u05D1", "city", "town"],
    country: ["\u05DE\u05D3\u05D9\u05E0\u05D4", "\u05D0\u05E8\u05E5", "country"],
    // Chatwoot's own CSV column: comma-separated label titles that already exist.
    labels: ["labels", "label", "tags", "tag", "\u05EA\u05D5\u05D5\u05D9\u05D5\u05EA", "\u05EA\u05D5\u05D5\u05D9\u05EA", "\u05EA\u05D2\u05D9\u05D5\u05EA"]
  };
  function normHeader(h2) {
    return String(h2 || "").toLowerCase().replace(/["'׳״“”„‘’.\-_/\\]/g, "").replace(/\s+/g, " ").trim();
  }
  var FILLER_WORDS = /* @__PURE__ */ new Set(["\u05DC\u05E7\u05D5\u05D7", "\u05DC\u05E7\u05D5\u05D7\u05D4", "customer", "client"]);
  function stripFiller(n) {
    return n.split(" ").filter((w) => !FILLER_WORDS.has(w)).join(" ");
  }
  function headerField(header) {
    const n = stripFiller(normHeader(header));
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
  var IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
  function contentField(values) {
    const nonEmpty = values.filter((v) => v && v.trim());
    if (!nonEmpty.length) return null;
    const emailish = nonEmpty.filter((v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim())).length;
    if (emailish / nonEmpty.length >= 0.6) return "email";
    const phoneish = nonEmpty.filter((v) => !IPV4.test(v.trim()) && normalizePhone(v) !== null).length;
    if (phoneish / nonEmpty.length >= 0.6) return "phone_number";
    return null;
  }
  var VALIDATORS = {
    email: (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim()),
    phone_number: (v) => normalizePhone(v) !== null,
    phone_number_alt: (v) => normalizePhone(v) !== null
  };
  function validateMapping(headers, rows, mapping) {
    const blockers = [];
    for (const { index, field } of mapping) {
      const check = VALIDATORS[field];
      if (!check) continue;
      const values = rows.map((r) => r[index] || "").filter((v) => v.trim() !== "");
      if (!values.length) continue;
      const valid = values.filter(check).length;
      if (valid / values.length < 0.5) {
        blockers.push({ header: headers[index], field, valid, total: values.length });
      }
    }
    return blockers;
  }
  var ALL_SYNONYMS = new Set(
    Object.values(SYNONYMS).flat().map((s) => normHeader(s))
  );
  var EMAILISH = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  function isHeaderEchoRow(cells, mapping) {
    for (const raw of cells) {
      const v = String(raw ?? "").trim();
      if (v && (normalizePhone(v) || EMAILISH.test(v))) return false;
    }
    return mapping.some(({ index, field }) => {
      if (!field) return false;
      const v = String(cells[index] ?? "").trim();
      return v !== "" && ALL_SYNONYMS.has(stripFiller(normHeader(v)));
    });
  }
  function matchCustomField(header, customDefs) {
    const n = stripFiller(normHeader(header));
    if (!n) return null;
    for (const d of customDefs || []) {
      if (normHeader(d.attribute_display_name) === n || normHeader(d.attribute_key) === n) {
        return d.attribute_key;
      }
    }
    return null;
  }
  function ownField(header) {
    const n = stripFiller(normHeader(header));
    return Object.keys(SYNONYMS).find((field) => normHeader(field) === n) || null;
  }
  function detectColumns(headers, sampleRows) {
    const own = headers.map(ownField).map((field, i, all) => field && all.indexOf(field) === i ? field : null);
    const taken = new Set(own.filter(Boolean));
    return headers.map((header, index) => {
      if (own[index]) return { header, index, field: own[index], confidence: 0.9 };
      const col = sampleRows.map((r) => r[index]);
      let field = headerField(header);
      let confidence = field ? 0.9 : 0;
      if (!field) {
        field = contentField(col);
        confidence = field ? 0.7 : 0;
      }
      if (field && taken.has(field)) {
        const isPhone = field === "phone_number" || field === "phone_number_alt";
        field = isPhone ? "phone_number_alt" : null;
        confidence = isPhone ? 0.6 : 0;
      }
      if (field && field !== "phone_number_alt") taken.add(field);
      return { header, index, field, confidence };
    });
  }

  // lib/fieldMapper.js
  var TOP_LEVEL = /* @__PURE__ */ new Set(["name", "email", "identifier"]);
  var ADDITIONAL = /* @__PURE__ */ new Set(["company_name", "city", "country"]);
  function buildContactPayload(row, mapping, customMap) {
    const payload = { additional_attributes: {}, custom_attributes: {} };
    let first = "";
    let last = "";
    const phones = [];
    for (const { index, field } of mapping) {
      const val = (row[index] || "").trim();
      if (!val || !field) continue;
      if (field === "first_name") first = val;
      else if (field === "last_name") last = val;
      else if (field === "phone_number") phones.unshift(val);
      else if (field === "phone_number_alt") phones.push(val);
      else if (TOP_LEVEL.has(field)) payload[field] = val;
      else if (ADDITIONAL.has(field)) payload.additional_attributes[field] = val;
    }
    for (const raw of phones) {
      const p = normalizePhone(raw);
      if (p) {
        payload.phone_number = p;
        break;
      }
    }
    if (!payload.phone_number && phones.length) payload.__phoneRaw = phones[0];
    if (!payload.name && (first || last)) payload.name = [first, last].filter(Boolean).join(" ");
    for (const { index, attribute_key } of customMap || []) {
      const val = (row[index] || "").trim();
      if (val && attribute_key) payload.custom_attributes[attribute_key] = val;
    }
    if (!Object.keys(payload.additional_attributes).length) delete payload.additional_attributes;
    if (!Object.keys(payload.custom_attributes).length) delete payload.custom_attributes;
    return payload;
  }

  // lib/labelTitle.js
  var VALID_LABEL_TITLE = /^[\p{L}\p{N}][\p{L}\p{N}_-]+$/u;
  function normalizeLabelTitle(value) {
    return String(value ?? "").trim().replace(/[^\p{L}\p{N}_-]+/gu, "_").replace(/_+/g, "_").replace(/^[_-]+/, "").replace(/[_-]+$/, "");
  }
  function isValidLabelTitle(value) {
    return VALID_LABEL_TITLE.test(String(value ?? ""));
  }

  // lib/nativeCsv.js
  var STANDARD_HEADERS = ["name", "email", "identifier", "phone_number"];
  var ADDITIONAL2 = ["company_name", "city", "country"];
  function cell(value) {
    const s = value == null ? "" : String(value);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function toNativeCsv(contacts, label = "") {
    const custom = [...new Set(contacts.flatMap((c) => Object.keys(c.custom_attributes || {})))];
    const additional = ADDITIONAL2.filter((k) => contacts.some((c) => c.additional_attributes?.[k]));
    const hasRaw = contacts.some((c) => c.__phoneRaw);
    const hasLabels = Boolean(label) || contacts.some((c) => c.__labels);
    const headers = [
      ...STANDARD_HEADERS,
      ...additional.map((k) => `cwpt:${k}`),
      ...custom.map((k) => `cwpt:custom:${k}`),
      ...hasLabels ? ["labels"] : [],
      "cwpt:row",
      ...hasRaw ? ["cwpt:phone_raw"] : []
    ];
    const lines = contacts.map((c) => [
      ...STANDARD_HEADERS.map((k) => c[k]),
      ...additional.map((k) => c.additional_attributes?.[k]),
      ...custom.map((k) => c.custom_attributes?.[k]),
      ...hasLabels ? [[c.__labels, label].filter(Boolean).join(",")] : [],
      c.__row,
      ...hasRaw ? [c.__phoneRaw] : []
    ].map(cell).join(","));
    return [headers.map(cell).join(","), ...lines].join("\n") + "\n";
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
      listLabels: () => req("GET", "/labels"),
      // Chatwoot's LabelsController requires the attributes under `label`:
      // params.require(:label).permit(:title, ...).
      createLabel: (title) => req("POST", "/labels", { label: { title } }),
      listCustomAttributes: () => req("GET", "/custom_attribute_definitions?attribute_model=contact_attribute"),
      createCustomAttribute: (def) => req("POST", "/custom_attribute_definitions", { custom_attribute_definition: def }),
      // smart_import_server.rb: counts against the account's contacts, no writes.
      smartImportPreview: (contacts) => req("POST", "/smart_import/preview", { contacts }),
      // smart_import_server.rb: the options Chatwoot's import of this exact file picks up.
      smartImportArm: (body) => req("POST", "/smart_import/arm", body)
    };
  }

  // lib/basepath.js
  var vendorUrl = (base) => (base || "/chatwoot-addons") + "/smart-import/xlsx.mini.min.js";

  // ui/styles.js
  var STYLES = `
.cwi-box{border:1px solid rgb(var(--border-weak));border-radius:.75rem;padding:.875rem;min-width:0}
/* Chatwoot's CSV preview shows the converted file; the mapping table replaces it. */
.cwi-box ~ section{display:none!important}
.cwi-fs{display:flex;flex-direction:column;gap:1.125rem;min-width:0;margin:0;padding:0;border:0}
.cwi-sec{display:flex;flex-direction:column;gap:.75rem;min-width:0}
.cwi-sec.cwi-tight{gap:.375rem}
.cwi-h,.cwi-hint{margin:0}
.cwi-scroll{overflow-x:auto;min-width:0}
.cwi-map{width:100%;border:1px solid rgb(var(--border-weak));border-radius:.625rem;border-collapse:separate;border-spacing:0;overflow:hidden;font-size:.8125rem;color:rgb(var(--slate-12))}
.cwi-map th,.cwi-map td{padding:.5rem .75rem;text-align:start;vertical-align:middle;border-bottom:1px solid rgb(var(--border-weak))}
.cwi-map tbody tr:last-child td{border-bottom:0}
.cwi-map th{background:rgb(var(--slate-2));font-weight:500;color:rgb(var(--slate-11))}
.cwi-map td:last-child{width:45%;min-width:9rem}
.cwi-col{overflow-wrap:anywhere}
.cwi-auto{display:block;font-size:.6875rem;color:rgb(var(--teal-11))}
.cwi-sample{color:rgb(var(--slate-11));max-width:9.5rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cwi-box select,.cwi-box input[type=text]{margin:0!important;height:2rem;padding-top:0;padding-bottom:0;font-size:.8125rem}
.cwi-edit{display:flex;gap:.375rem;align-items:center}
.cwi-edit input{flex:1;min-width:0}
.cwi-btn{flex:none;height:2rem;padding:0 .75rem;border-radius:.5rem;font-size:.8125rem;font-weight:500;color:rgb(var(--slate-12));background:transparent;outline:1px solid rgb(var(--border-strong));outline-offset:-1px}
.cwi-btn.cwi-primary{color:#fff;background:rgb(var(--blue-9));outline:0}
.cwi-btn:focus-visible{outline:2px solid rgb(var(--blue-9));outline-offset:2px}
.cwi-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.5rem}
.cwi-stat{border:1px solid rgb(var(--border-weak));border-radius:.625rem;padding:.5rem .625rem;background:rgb(var(--solid-1));min-width:0}
.cwi-stat b{display:block;font-size:1.0625rem;font-weight:600;color:rgb(var(--slate-12))}
.cwi-stat span{display:block;font-size:.75rem;line-height:1.3;color:rgb(var(--slate-11))}
.cwi-err{border-radius:.625rem;padding:.625rem .75rem;font-size:.8125rem;background:rgb(var(--ruby-3));color:rgb(var(--ruby-11))}
.cwi-err[hidden],.cwi-box [hidden]{display:none}
@media (max-width:760px){.cwi-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.cwi-sm-hide{display:none}.cwi-map th,.cwi-map td{padding:.5rem}.cwi-map td:last-child{width:58%}}
/* Phones: a row per column, the field picker under its name, so no option is cut off. */
@media (max-width:480px){.cwi-map,.cwi-map tbody{display:block}.cwi-map thead{display:none}.cwi-map tr{display:flex;flex-direction:column;gap:.375rem;padding:.625rem .75rem;border-bottom:1px solid rgb(var(--border-weak))}.cwi-map tbody tr:last-child{border-bottom:0}.cwi-map td:not(.cwi-sm-hide){display:block;width:auto;min-width:0;padding:0;border:0}.cwi-auto{display:inline;margin-inline-start:.5rem}}
`;

  // ui/enhancer.js
  var MAX_BYTES = 50 * 1024 * 1024;
  var PRECHECK_MAX = 25e3;
  var OWN = "__cwiOwn";
  var FIELD_ORDER = [
    "first_name",
    "last_name",
    "name",
    "phone_number",
    "phone_number_alt",
    "email",
    "company_name",
    "city",
    "country",
    "identifier",
    "labels"
  ];
  var IDENTITY = /* @__PURE__ */ new Set(["name", "first_name", "last_name", "phone_number", "phone_number_alt", "email", "identifier"]);
  var I18N = {
    he: {
      fields: {
        name: "\u05E9\u05DD \u05DE\u05DC\u05D0",
        first_name: "\u05E9\u05DD \u05E4\u05E8\u05D8\u05D9",
        last_name: "\u05E9\u05DD \u05DE\u05E9\u05E4\u05D7\u05D4",
        phone_number: "\u05D8\u05DC\u05E4\u05D5\u05DF",
        phone_number_alt: "\u05D8\u05DC\u05E4\u05D5\u05DF \u05E0\u05D5\u05E1\u05E3 (\u05D2\u05D9\u05D1\u05D5\u05D9)",
        email: "\u05D0\u05D9\u05DE\u05D9\u05D9\u05DC",
        identifier: "\u05DE\u05D6\u05D4\u05D4",
        company_name: "\u05D7\u05D1\u05E8\u05D4",
        city: "\u05E2\u05D9\u05E8",
        country: "\u05DE\u05D3\u05D9\u05E0\u05D4",
        labels: "\u05EA\u05D5\u05D5\u05D9\u05D5\u05EA (\u05DE\u05D4\u05E7\u05D5\u05D1\u05E5)"
      },
      mapTitle: "\u05DE\u05D9\u05E4\u05D5\u05D9 \u05E2\u05DE\u05D5\u05D3\u05D5\u05EA",
      mapHint: "\u05D6\u05D9\u05D4\u05D9\u05E0\u05D5 \u05D0\u05EA \u05D4\u05E2\u05DE\u05D5\u05D3\u05D5\u05EA \u05DC\u05D1\u05D3. \u05D0\u05E4\u05E9\u05E8 \u05DC\u05E9\u05E0\u05D5\u05EA \u05DB\u05DC \u05D0\u05D7\u05EA.",
      colFile: "\u05E2\u05DE\u05D5\u05D3\u05D4 \u05D1\u05E7\u05D5\u05D1\u05E5",
      colSample: "\u05D3\u05D5\u05D2\u05DE\u05D4",
      colField: "\u05E9\u05D3\u05D4 \u05D1-Chatwoot",
      detected: "\u05D6\u05D5\u05D4\u05D4",
      ignore: "\u2014 \u05D4\u05EA\u05E2\u05DC\u05DD \u2014",
      systemFields: "\u05E9\u05D3\u05D5\u05EA \u05DE\u05E2\u05E8\u05DB\u05EA",
      customFields: "\u05E9\u05D3\u05D5\u05EA \u05DE\u05D5\u05EA\u05D0\u05DE\u05D9\u05DD",
      newFieldOpt: (n) => `${n} (\u05E9\u05D3\u05D4 \u05D7\u05D3\u05E9)`,
      createField: "\u05E6\u05D5\u05E8 \u05E9\u05D3\u05D4 \u05DE\u05D5\u05EA\u05D0\u05DD \u05D7\u05D3\u05E9\u2026",
      newFieldName: "\u05E9\u05DD \u05D4\u05E9\u05D3\u05D4 \u05D4\u05D7\u05D3\u05E9",
      add: "\u05D4\u05D5\u05E1\u05E4\u05D4",
      cancel: "\u05D1\u05D9\u05D8\u05D5\u05DC",
      selectFieldFor: (h2) => `\u05D4\u05E9\u05D3\u05D4 \u05DC\u05E2\u05DE\u05D5\u05D3\u05D4 ${h2}`,
      labelTitle: "\u05EA\u05D5\u05D5\u05D9\u05EA \u05DC\u05DB\u05DC \u05D0\u05E0\u05E9\u05D9 \u05D4\u05E7\u05E9\u05E8 \u05D1\u05D9\u05D9\u05D1\u05D5\u05D0",
      noLabel: "\u2014 \u05DC\u05DC\u05D0 \u05EA\u05D5\u05D5\u05D9\u05EA \u2014",
      newLabelOpt: (t) => `\u05EA\u05D5\u05D5\u05D9\u05EA \u05D7\u05D3\u05E9\u05D4: ${t}`,
      otherLabel: "\u05EA\u05D5\u05D5\u05D9\u05EA \u05D7\u05D3\u05E9\u05D4 \u05D1\u05E9\u05DD \u05D0\u05D7\u05E8\u2026",
      newLabelName: "\u05E9\u05DD \u05D4\u05EA\u05D5\u05D5\u05D9\u05EA \u05D4\u05D7\u05D3\u05E9\u05D4",
      labelHint: "\u05DE\u05EA\u05D5\u05D5\u05E1\u05E4\u05EA \u05DC\u05EA\u05D5\u05D5\u05D9\u05D5\u05EA \u05E9\u05DB\u05D1\u05E8 \u05D9\u05E9 \u05DC\u05D4\u05DD, \u05D5\u05DC\u05D0 \u05DE\u05D5\u05D7\u05E7\u05EA \u05D0\u05D5\u05EA\u05DF.",
      monthLabel: (month) => `\u05D9\u05D9\u05D1\u05D5\u05D0-${month}`,
      checkTitle: "\u05D1\u05D3\u05D9\u05E7\u05D4 \u05DC\u05E4\u05E0\u05D9 \u05D9\u05D9\u05D1\u05D5\u05D0",
      statNew: "\u05D7\u05D3\u05E9\u05D9\u05DD",
      statExisting: "\u05E7\u05D9\u05D9\u05DE\u05D9\u05DD, \u05D9\u05E2\u05D5\u05D3\u05DB\u05E0\u05D5",
      statDup: "\u05DB\u05E4\u05D5\u05DC\u05D9\u05DD \u05D1\u05E7\u05D5\u05D1\u05E5, \u05D9\u05DE\u05D5\u05D6\u05D2\u05D5",
      statNoPhone: "\u05D1\u05DC\u05D9 \u05DE\u05E1\u05E4\u05E8 \u05EA\u05E7\u05D9\u05DF",
      checking: "\u05D1\u05D5\u05D3\u05E7\u05D9\u05DD\u2026",
      phoneFormat: (s) => `\u05DE\u05E1\u05E4\u05E8\u05D9\u05DD \u05DB\u05DE\u05D5 ${s} \u05E0\u05E9\u05DE\u05E8\u05D9\u05DD \u05D1\u05E4\u05D5\u05E8\u05DE\u05D8 \u05D1\u05D9\u05E0\u05DC\u05D0\u05D5\u05DE\u05D9.`,
      waLinked: "\u05DE\u05D9 \u05E9\u05D9\u05E9 \u05DC\u05D5 \u05DE\u05E1\u05E4\u05E8 \u05DE\u05D7\u05D5\u05D1\u05E8 \u05DC\u05EA\u05D9\u05D1\u05EA \u05D4\u05D5\u05D5\u05D0\u05D8\u05E1\u05D0\u05E4.",
      noPhoneNote: (n) => n === 1 ? "\u05D0\u05D9\u05E9 \u05D4\u05E7\u05E9\u05E8 \u05D1\u05DC\u05D9 \u05DE\u05E1\u05E4\u05E8 \u05EA\u05E7\u05D9\u05DF \u05D9\u05D9\u05D5\u05D5\u05E6\u05E8, \u05D0\u05D1\u05DC \u05DC\u05D0 \u05D9\u05E7\u05D1\u05DC \u05D4\u05D5\u05D3\u05E2\u05D5\u05EA." : "\u05D0\u05E0\u05E9\u05D9 \u05D4\u05E7\u05E9\u05E8 \u05D1\u05DC\u05D9 \u05DE\u05E1\u05E4\u05E8 \u05EA\u05E7\u05D9\u05DF \u05D9\u05D9\u05D5\u05D5\u05E6\u05E8\u05D5, \u05D0\u05D1\u05DC \u05DC\u05D0 \u05D9\u05E7\u05D1\u05DC\u05D5 \u05D4\u05D5\u05D3\u05E2\u05D5\u05EA.",
      precheckFailed: "\u05D4\u05D1\u05D3\u05D9\u05E7\u05D4 \u05D4\u05DE\u05D5\u05E7\u05D3\u05DE\u05EA \u05DC\u05D0 \u05D6\u05DE\u05D9\u05E0\u05D4 \u05DB\u05E8\u05D2\u05E2. \u05D4\u05D9\u05D9\u05D1\u05D5\u05D0 \u05E2\u05E6\u05DE\u05D5 \u05D9\u05D1\u05D3\u05D5\u05E7 \u05DB\u05DC \u05E9\u05D5\u05E8\u05D4.",
      precheckTooBig: (max) => `\u05D1\u05E7\u05D5\u05D1\u05E5 \u05D2\u05D3\u05D5\u05DC \u05DE\u05BE${max} \u05E9\u05D5\u05E8\u05D5\u05EA \u05D4\u05D1\u05D3\u05D9\u05E7\u05D4 \u05DE\u05D5\u05DC \u05D0\u05E0\u05E9\u05D9 \u05D4\u05E7\u05E9\u05E8 \u05D4\u05E7\u05D9\u05D9\u05DE\u05D9\u05DD \u05E0\u05E2\u05E9\u05D9\u05EA \u05D1\u05D6\u05DE\u05DF \u05D4\u05D9\u05D9\u05D1\u05D5\u05D0.`,
      headerEcho: (rows) => `\u05E9\u05D5\u05E8\u05D5\u05EA \u05DB\u05D5\u05EA\u05E8\u05EA \u05D1\u05EA\u05D5\u05DA \u05D4\u05E7\u05D5\u05D1\u05E5 \u05D3\u05D5\u05DC\u05D2\u05D5 (\u05E9\u05D5\u05E8\u05D5\u05EA ${rows}). \u05E0\u05E8\u05D0\u05D4 \u05E9\u05DB\u05DE\u05D4 \u05E8\u05E9\u05D9\u05DE\u05D5\u05EA \u05D4\u05D5\u05D3\u05D1\u05E7\u05D5 \u05D9\u05D7\u05D3.`,
      emptyRows: (n) => n === 1 ? "\u05E9\u05D5\u05E8\u05D4 \u05D0\u05D7\u05EA \u05D1\u05DC\u05D9 \u05E9\u05DD, \u05D8\u05DC\u05E4\u05D5\u05DF, \u05D0\u05D9\u05DE\u05D9\u05D9\u05DC \u05D0\u05D5 \u05DE\u05D6\u05D4\u05D4 \u05DC\u05D0 \u05EA\u05D9\u05D5\u05D1\u05D0." : `${n} \u05E9\u05D5\u05E8\u05D5\u05EA \u05D1\u05DC\u05D9 \u05E9\u05DD, \u05D8\u05DC\u05E4\u05D5\u05DF, \u05D0\u05D9\u05DE\u05D9\u05D9\u05DC \u05D0\u05D5 \u05DE\u05D6\u05D4\u05D4 \u05DC\u05D0 \u05D9\u05D9\u05D5\u05D1\u05D0\u05D5.`,
      emailSummary: "\u05DC\u05E9\u05DC\u05D5\u05D7 \u05DC\u05D9 \u05E1\u05D9\u05DB\u05D5\u05DD \u05D1\u05DE\u05D9\u05D9\u05DC \u05D1\u05E1\u05D9\u05D5\u05DD, \u05E2\u05DD \u05D4\u05D3\u05D5\u05D7 \u05D4\u05DE\u05DC\u05D0",
      needIdentity: "\u05D1\u05D7\u05E8\u05D5 \u05DC\u05E4\u05D7\u05D5\u05EA \u05E2\u05DE\u05D5\u05D3\u05D4 \u05D0\u05D7\u05EA \u05E9\u05DC \u05E9\u05DD, \u05D8\u05DC\u05E4\u05D5\u05DF, \u05D0\u05D9\u05DE\u05D9\u05D9\u05DC \u05D0\u05D5 \u05DE\u05D6\u05D4\u05D4.",
      badMapping: (h2, bad, total, field) => `\u05D1\u05E2\u05DE\u05D5\u05D3\u05D4 \xAB${h2}\xBB ${bad} \u05DE\u05EA\u05D5\u05DA ${total} \u05D4\u05E2\u05E8\u05DB\u05D9\u05DD \u05DC\u05D0 \u05E0\u05E8\u05D0\u05D9\u05DD \u05DB\u05DE\u05D5 ${field}. \u05D1\u05D7\u05E8\u05D5 \u05DC\u05D4 \u05E9\u05D3\u05D4 \u05D0\u05D7\u05E8, \u05D0\u05D5 \xAB\u05D4\u05EA\u05E2\u05DC\u05DD\xBB.`,
      labelNameInvalid: "\u05E9\u05DD \u05D4\u05EA\u05D5\u05D5\u05D9\u05EA \u05E6\u05E8\u05D9\u05DA \u05DC\u05D4\u05EA\u05D7\u05D9\u05DC \u05D1\u05D0\u05D5\u05EA \u05D0\u05D5 \u05D1\u05DE\u05E1\u05E4\u05E8, \u05D5\u05DC\u05D4\u05DB\u05D9\u05DC \u05DC\u05E4\u05D7\u05D5\u05EA \u05E9\u05E0\u05D9 \u05EA\u05D5\u05D5\u05D9\u05DD.",
      fieldNameMissing: "\u05DB\u05EA\u05D1\u05D5 \u05E9\u05DD \u05DC\u05E9\u05D3\u05D4 \u05D4\u05D7\u05D3\u05E9.",
      labelCreateFailed: "\u05DC\u05D0 \u05D4\u05E6\u05DC\u05D7\u05E0\u05D5 \u05DC\u05D9\u05E6\u05D5\u05E8 \u05D0\u05EA \u05D4\u05EA\u05D5\u05D5\u05D9\u05EA. \u05E0\u05E1\u05D5 \u05E9\u05D5\u05D1.",
      fieldCreateFailed: (n) => `\u05DC\u05D0 \u05D4\u05E6\u05DC\u05D7\u05E0\u05D5 \u05DC\u05D9\u05E6\u05D5\u05E8 \u05D0\u05EA \u05D4\u05E9\u05D3\u05D4 \xAB${n}\xBB. \u05E0\u05E1\u05D5 \u05E9\u05D5\u05D1.`,
      armFailed: "\u05DC\u05D0 \u05D4\u05E6\u05DC\u05D7\u05E0\u05D5 \u05DC\u05D4\u05DB\u05D9\u05DF \u05D0\u05EA \u05D4\u05D9\u05D9\u05D1\u05D5\u05D0. \u05E0\u05E1\u05D5 \u05E9\u05D5\u05D1 \u05D1\u05E2\u05D5\u05D3 \u05E8\u05D2\u05E2.",
      preparing: "\u05DE\u05DB\u05D9\u05E0\u05D9\u05DD \u05D0\u05EA \u05D4\u05E7\u05D5\u05D1\u05E5\u2026",
      rows: (n) => n === 1 ? "\u05E9\u05D5\u05E8\u05D4 \u05D0\u05D7\u05EA" : `${n.toLocaleString("he")} \u05E9\u05D5\u05E8\u05D5\u05EA`
    },
    en: {
      fields: {
        name: "Full name",
        first_name: "First name",
        last_name: "Last name",
        phone_number: "Phone",
        phone_number_alt: "Additional phone (fallback)",
        email: "Email",
        identifier: "Identifier",
        company_name: "Company",
        city: "City",
        country: "Country",
        labels: "Labels (from the file)"
      },
      mapTitle: "Map columns",
      mapHint: "We matched the columns for you. You can change any of them.",
      colFile: "Column in the file",
      colSample: "Example",
      colField: "Chatwoot field",
      detected: "Matched",
      ignore: "\u2014 Ignore \u2014",
      systemFields: "System fields",
      customFields: "Custom fields",
      newFieldOpt: (n) => `${n} (new field)`,
      createField: "Create a new custom field\u2026",
      newFieldName: "New field name",
      add: "Add",
      cancel: "Cancel",
      selectFieldFor: (h2) => `Field for column ${h2}`,
      labelTitle: "Label for every contact in this import",
      noLabel: "\u2014 No label \u2014",
      newLabelOpt: (t) => `New label: ${t}`,
      otherLabel: "New label with another name\u2026",
      newLabelName: "New label name",
      labelHint: "Added next to the labels they already have. Nothing is removed.",
      monthLabel: (month) => `import-${month.toLowerCase()}`,
      checkTitle: "Check before importing",
      statNew: "New",
      statExisting: "Existing, will be updated",
      statDup: "Duplicates in the file, merged",
      statNoPhone: "No valid number",
      checking: "Checking\u2026",
      phoneFormat: (s) => `Numbers like ${s} are saved in international format.`,
      waLinked: "Contacts with a number are linked to the WhatsApp inbox.",
      noPhoneNote: (n) => n === 1 ? "The contact without a valid number is created, but will not receive messages." : "Contacts without a valid number are created, but will not receive messages.",
      precheckFailed: "The check is not available right now. The import checks every row itself.",
      precheckTooBig: (max) => `For files over ${max} rows, matching against existing contacts happens during the import.`,
      headerEcho: (rows) => `Header rows inside the file were skipped (rows ${rows}). It looks like several lists were pasted together.`,
      emptyRows: (n) => n === 1 ? "One row without a name, phone, email or identifier will not be imported." : `${n} rows without a name, phone, email or identifier will not be imported.`,
      emailSummary: "Email me a summary when it finishes, with the full report",
      needIdentity: "Choose at least one column for name, phone, email or identifier.",
      badMapping: (h2, bad, total, field) => `In column \u201C${h2}\u201D, ${bad} of ${total} values do not look like ${field}. Choose another field for it, or \u201CIgnore\u201D.`,
      labelNameInvalid: "A label name starts with a letter or a number and has at least two characters.",
      fieldNameMissing: "Type a name for the new field.",
      labelCreateFailed: "We could not create the label. Try again.",
      fieldCreateFailed: (n) => `We could not create the field \u201C${n}\u201D. Try again.`,
      armFailed: "We could not prepare the import. Try again in a moment.",
      preparing: "Preparing the file\u2026",
      rows: (n) => n === 1 ? "1 row" : `${n.toLocaleString("en")} rows`
    }
  };
  var Notice = class extends Error {
  };
  var token = 0;
  var cur = null;
  function locale() {
    const a = document.querySelector("#app[dir]");
    return (a || document.documentElement).getAttribute("dir") === "rtl" ? "he" : "en";
  }
  function h(tag, props = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (typeof v === "boolean") el[k] = v;
      else el.setAttribute(k === "className" ? "class" : k, v);
    }
    el.append(...kids.flat().filter((kid) => kid != null && kid !== false));
    return el;
  }
  function fire(el, type) {
    const e = new Event(type, { bubbles: true });
    e[OWN] = true;
    el.dispatchEvent(e);
  }
  function setFiles(input, file) {
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
    } catch {
      Object.defineProperty(input, "files", { configurable: true, value: [file] });
    }
  }
  function passThrough(input, file) {
    if (!input.isConnected) return;
    setFiles(input, file);
    fire(input, "change");
  }
  var xlsxLoading = null;
  function loadXlsx(assetBase) {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!xlsxLoading) {
      xlsxLoading = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = vendorUrl(assetBase);
        const failed = () => {
          s.remove();
          xlsxLoading = null;
          reject(new Error("SheetJS load failed"));
        };
        s.onload = () => window.XLSX ? resolve(window.XLSX) : failed();
        s.onerror = failed;
        document.head.appendChild(s);
      });
    }
    return xlsxLoading;
  }
  function injectStyles() {
    if (document.getElementById("cwi-styles")) return;
    document.head.appendChild(h("style", { id: "cwi-styles" }, STYLES));
  }
  var asList = (r) => Array.isArray(r) ? r : r?.payload || [];
  var labelTitles = (r) => asList(r).map((l) => l?.title).filter(Boolean);
  var slugify = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9֐-׿]+/g, "_").replace(/^_|_$/g, "") || "field";
  var isolate = (s) => `\u2066${s}\u2069`;
  function formatBytes(bytes) {
    if (!bytes) return "0 Bytes";
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${parseFloat((bytes / 1024 ** i).toFixed(2))} ${["Bytes", "KB", "MB", "GB"][i]}`;
  }
  async function digest(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  async function take(input, file, ctx) {
    const my = ++token;
    drop();
    try {
      if (!file || !file.size || file.size > MAX_BYTES || !/\.(csv|xlsx|xls)$/i.test(file.name || "")) {
        passThrough(input, file);
        return;
      }
      const api = createApiClient(ctx.accountId, ctx.authHeaders);
      const [table, defs, labels] = await Promise.all([
        readFileToTable(file, { loadXlsx: () => loadXlsx(ctx.assetBase) }),
        api.listCustomAttributes().then(asList).catch(() => []),
        api.listLabels().then(labelTitles).catch(() => [])
      ]);
      if (my !== token) return;
      const { headers, rows } = table;
      if (!headers.some((x) => String(x).trim()) || !rows.length || headers.includes("__chatwoot_csv_format")) {
        passThrough(input, file);
        return;
      }
      mount(input, file, api, { headers, rows, defs, labels });
    } catch {
      if (my !== token) return;
      drop();
      passThrough(input, file);
    }
  }
  function submit(form) {
    const s = cur;
    if (!s || s.bypass || !form.contains(s.input)) return false;
    if (!s.busy) run(s, form);
    return true;
  }
  function drop() {
    const s = cur;
    if (!s) return;
    cur = null;
    clearTimeout(s.preTimer);
    s.observer.disconnect();
    s.box.remove();
  }
  function mount(input, file, api, { headers, rows, defs, labels }) {
    injectStyles();
    const loc = locale();
    const T = I18N[loc];
    const detected = detectColumns(headers, rows.slice(0, 50));
    const values = detected.map((d) => {
      const key = matchCustomField(d.header, defs);
      return key ? `custom:${key}` : d.field || "";
    });
    const month = new Intl.DateTimeFormat(loc, { month: "long" }).format(/* @__PURE__ */ new Date());
    const monthLabel = normalizeLabelTitle(T.monthLabel(month));
    const existing = labels.find((t) => t.toLowerCase() === monthLabel.toLowerCase());
    const s = {
      input,
      file,
      api,
      T,
      locale: loc,
      headers,
      rows,
      defs,
      labels,
      values,
      detected: values.map(Boolean),
      zone: input.parentElement,
      label: existing ? `label:${existing}` : `new:${monthLabel}`,
      // Only a label that already exists rides in the first CSV: if Import ever reached Chatwoot
      // without run(), a label created later would fail every row as "Unknown labels".
      monthLabel,
      labelTitle: existing || "",
      selects: [],
      busy: false,
      bypass: false,
      mounted: false,
      pre: null,
      preToken: 0,
      preTimer: null
    };
    cur = s;
    s.box = render(s);
    s.zone.after(s.box);
    s.observer = new MutationObserver(() => watch(s));
    s.observer.observe(input.form || document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"] });
    feed(s);
    setTimeout(() => {
      s.mounted = cur === s && patchFileRow(s);
    });
    precheck(s);
  }
  function watch(s) {
    if (cur !== s || !s.mounted) return;
    if (!s.zone.isConnected || !s.zone.querySelector("span.truncate")) {
      drop();
      return;
    }
    syncDisabled(s);
    patchFileRow(s);
  }
  function syncDisabled(s) {
    const disabled = s.busy || s.input.disabled;
    if (s.fieldset.disabled !== disabled) s.fieldset.disabled = disabled;
  }
  function patchFileRow(s) {
    const name = s.zone.querySelector("span.truncate");
    if (!name) return false;
    if (name.textContent !== s.file.name) name.textContent = s.file.name;
    const size = name.nextElementSibling;
    const text = `${s.T.rows(s.rows.length)} \xB7 ${isolate(formatBytes(s.file.size))}`;
    if (size && size.textContent !== text) size.textContent = text;
    return true;
  }
  function plan(s) {
    const mapping = [];
    const customMap = [];
    let labelsAt = -1;
    s.values.forEach((v, index) => {
      if (!v) return;
      if (v === "labels") labelsAt = index;
      else if (v.startsWith("custom:")) customMap.push({ index, attribute_key: v.slice(7) });
      else if (v.startsWith("new:")) customMap.push({ index, attribute_key: slugify(v.slice(4)) });
      else mapping.push({ index, field: v });
    });
    return { mapping, customMap, labelsAt };
  }
  function buildContacts(s) {
    const { mapping, customMap, labelsAt } = plan(s);
    const contacts = [];
    const echo = [];
    let empty = 0;
    s.rows.forEach((row, idx) => {
      if (isHeaderEchoRow(row, mapping)) {
        echo.push(idx + 2);
        return;
      }
      const c = buildContactPayload(row, mapping, customMap);
      if (!(c.name || c.email || c.identifier || c.phone_number)) {
        empty += 1;
        return;
      }
      const tags = labelsAt < 0 ? "" : String(row[labelsAt] ?? "").trim();
      if (tags) c.__labels = tags;
      c.__row = idx + 2;
      contacts.push(c);
    });
    return { contacts, echo, empty };
  }
  function feed(s) {
    s.built = buildContacts(s);
    const csv = toNativeCsv(s.built.contacts, s.labelTitle);
    const name = `${s.file.name.replace(/\.[^.]+$/, "") || "contacts"}.csv`;
    setFiles(s.input, new File([csv], name, { type: "text/csv" }));
    fire(s.input, "change");
    setTimeout(() => cur === s && patchFileRow(s));
    return csv;
  }
  function render(s) {
    const T = s.T;
    const title = (text, attrs = {}) => h("h4", { class: "cwi-h text-heading-3 text-n-slate-12", ...attrs }, text);
    const hint = (text) => h("p", { class: "cwi-hint text-label-small text-n-slate-11" }, text);
    const sample = (i) => (s.rows.find((r) => String(r[i] ?? "").trim()) || [])[i] || "";
    const table = h(
      "table",
      { class: "cwi-map" },
      h("thead", {}, h(
        "tr",
        {},
        h("th", {}, T.colFile),
        h("th", { class: "cwi-sm-hide" }, T.colSample),
        h("th", {}, T.colField)
      )),
      h("tbody", {}, s.headers.map((header, i) => h(
        "tr",
        {},
        h(
          "td",
          {},
          h("span", { class: "cwi-col" }, String(header).trim() || `#${i + 1}`),
          s.detected[i] && h("span", { class: "cwi-auto" }, T.detected)
        ),
        h("td", { class: "cwi-sample cwi-sm-hide" }, String(sample(i)).trim()),
        h("td", {}, s.selects[i] = fieldSelect(s, i))
      )))
    );
    s.labelSelect = labelSelect(s);
    s.statsEl = h("div", { class: "cwi-stats" });
    s.notesEl = h("p", { class: "cwi-hint text-label-small text-n-slate-11" });
    s.email = h("input", {
      type: "checkbox",
      checked: true,
      class: "peer absolute inset-0 z-10 h-4 w-4 disabled:opacity-50 appearance-none rounded border border-n-slate-6 ring-transparent transition-all duration-200 checked:border-n-brand checked:bg-n-brand dark:border-gray-600 dark:checked:border-n-brand hover:enabled:bg-n-blue-border cursor-pointer"
    });
    const tick = h("span", { class: "relative w-4 h-4 shrink-0" }, s.email);
    tick.insertAdjacentHTML("beforeend", '<svg viewBox="0 0 14 14" fill="none" aria-hidden="true" class="pointer-events-none absolute w-3.5 h-3.5 z-20 stroke-white opacity-0 peer-checked:opacity-100 transition-opacity duration-200 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"><path d="M3 8L6 11L11 3.5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>');
    s.status = h("p", { role: "status", class: "cwi-hint text-body-main text-n-slate-11", hidden: true });
    s.error = h("div", { role: "alert", class: "cwi-err", hidden: true });
    s.fieldset = h(
      "fieldset",
      { class: "cwi-fs" },
      h("div", { class: "cwi-sec" }, h("div", {}, title(T.mapTitle), hint(T.mapHint)), h("div", { class: "cwi-scroll" }, table)),
      h("div", { class: "cwi-sec cwi-tight" }, title(T.labelTitle, { id: "cwi-label-title" }), s.labelSelect, hint(T.labelHint)),
      h(
        "div",
        { class: "cwi-sec" },
        title(T.checkTitle),
        s.statsEl,
        s.notesEl,
        h("label", { class: "cwi-cb inline-flex cursor-pointer items-center gap-2 text-body-main text-n-slate-12" }, tick, T.emailSummary)
      ),
      s.status,
      s.error
    );
    renderCheck(s);
    return h("div", { class: "cwi-box" }, s.fieldset);
  }
  function fieldSelect(s, i) {
    const T = s.T;
    const v = s.values[i];
    const header = String(s.headers[i]).trim();
    const sel = h(
      "select",
      { "aria-label": T.selectFieldFor(header || `#${i + 1}`), onchange: () => onField(s, i, sel) },
      h("option", { value: "" }, T.ignore),
      h("optgroup", { label: T.systemFields }, FIELD_ORDER.map((f) => h("option", { value: f }, T.fields[f]))),
      h(
        "optgroup",
        { label: T.customFields },
        s.defs.map((d) => h("option", { value: `custom:${d.attribute_key}` }, d.attribute_display_name || d.attribute_key)),
        header && !matchCustomField(header, s.defs) && h("option", { value: `new:${header}` }, T.newFieldOpt(header)),
        v.startsWith("new:") && v !== `new:${header}` && h("option", { value: v }, T.newFieldOpt(v.slice(4))),
        h("option", { value: "__create" }, T.createField)
      )
    );
    sel.value = v;
    return sel;
  }
  function onField(s, i, sel) {
    if (sel.value !== "__create") {
      setField(s, i, sel.value);
      return;
    }
    sel.value = s.values[i];
    inlineEdit(s, sel, s.T.newFieldName, (name) => {
      if (!name) return s.T.fieldNameMissing;
      const def = s.defs.find((d) => matchCustomField(name, [d]));
      setField(s, i, def ? `custom:${def.attribute_key}` : `new:${name}`);
      return "";
    }, () => replaceSelect(s, i));
  }
  function setField(s, i, v) {
    s.values[i] = v;
    if (v && v !== "phone_number_alt") {
      s.values.forEach((x, j) => {
        if (j !== i && x === v) {
          s.values[j] = "";
          s.selects[j].value = "";
        }
      });
    }
    showError(s, "");
    clearTimeout(s.preTimer);
    s.preTimer = setTimeout(() => precheck(s), 250);
  }
  function replaceSelect(s, i) {
    const next = fieldSelect(s, i);
    s.selects[i].replaceWith(next);
    s.selects[i] = next;
    return next;
  }
  function inlineEdit(s, sel, placeholder, done, restore) {
    const T = s.T;
    const input = h("input", { type: "text", maxlength: "80", placeholder, "aria-label": placeholder });
    const finish = (save) => {
      if (save) {
        const problem = done(input.value.trim());
        if (problem) {
          showError(s, problem);
          input.focus();
          return;
        }
      }
      showError(s, "");
      editor.replaceWith(sel);
      restore().focus();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finish(true);
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      }
    });
    const editor = h(
      "div",
      { class: "cwi-edit" },
      input,
      h("button", { type: "button", class: "cwi-btn cwi-primary", onclick: () => finish(true) }, T.add),
      h("button", { type: "button", class: "cwi-btn", onclick: () => finish(false) }, T.cancel)
    );
    sel.replaceWith(editor);
    input.focus();
  }
  function labelSelect(s) {
    const T = s.T;
    const has = (t) => s.labels.some((x) => x.toLowerCase() === t.toLowerCase());
    const sel = h(
      "select",
      { "aria-labelledby": "cwi-label-title", onchange: () => onLabel(s, sel) },
      h("option", { value: "" }, T.noLabel),
      !has(s.monthLabel) && h("option", { value: `new:${s.monthLabel}` }, T.newLabelOpt(s.monthLabel)),
      s.label.startsWith("new:") && s.label !== `new:${s.monthLabel}` && h("option", { value: s.label }, T.newLabelOpt(s.label.slice(4))),
      s.labels.map((t) => h("option", { value: `label:${t}` }, t)),
      h("option", { value: "__other" }, T.otherLabel)
    );
    sel.value = s.label;
    return sel;
  }
  function onLabel(s, sel) {
    if (sel.value !== "__other") {
      s.label = sel.value;
      showError(s, "");
      return;
    }
    sel.value = s.label;
    inlineEdit(s, sel, s.T.newLabelName, (typed) => {
      const title = normalizeLabelTitle(typed);
      if (!isValidLabelTitle(title)) return s.T.labelNameInvalid;
      const hit = s.labels.find((t) => t.toLowerCase() === title.toLowerCase());
      s.label = hit ? `label:${hit}` : `new:${title}`;
      return "";
    }, () => replaceLabelSelect(s));
  }
  function replaceLabelSelect(s) {
    const next = labelSelect(s);
    s.labelSelect.replaceWith(next);
    s.labelSelect = next;
    return next;
  }
  async function precheck(s) {
    const my = ++s.preToken;
    s.built = buildContacts(s);
    const { contacts } = s.built;
    if (contacts.length > PRECHECK_MAX) s.pre = "big";
    else if (!contacts.length) s.pre = { new: 0, existing: 0, dup_in_file: 0 };
    else s.pre = null;
    renderCheck(s);
    if (s.pre !== null) return;
    try {
      const keys = contacts.map((c) => ({ identifier: c.identifier, email: c.email?.toLowerCase(), phone_number: c.phone_number }));
      const result = await s.api.smartImportPreview(keys);
      if (my === s.preToken && cur === s) s.pre = result;
    } catch {
      if (my === s.preToken && cur === s) s.pre = "error";
    }
    if (my === s.preToken && cur === s) renderCheck(s);
  }
  function phoneSample(s) {
    const cols = s.values.flatMap((v, i) => v === "phone_number" || v === "phone_number_alt" ? [i] : []);
    for (const row of s.rows.slice(0, 200)) {
      for (const i of cols) {
        const raw = String(row[i] ?? "").trim();
        const e164 = raw && normalizePhone(raw);
        if (e164 && e164 !== raw) return raw;
      }
    }
    return "";
  }
  function renderCheck(s) {
    const T = s.T;
    const p = s.pre;
    const ok = p && typeof p === "object";
    const { contacts, echo, empty } = s.built || buildContacts(s);
    const n = (k) => ok ? Number(p[k] || 0).toLocaleString(s.locale) : p === null ? "\u2026" : "\u2014";
    const noPhone = contacts.filter((c) => !c.phone_number).length;
    const stat = (num, label) => h("div", { class: "cwi-stat" }, h("b", {}, num), h("span", {}, label));
    s.statsEl.replaceChildren(
      stat(n("new"), T.statNew),
      stat(n("existing"), T.statExisting),
      stat(n("dup_in_file"), T.statDup),
      stat(noPhone.toLocaleString(s.locale), T.statNoPhone)
    );
    const sample = phoneSample(s);
    const notes = [
      p === null && T.checking,
      sample && T.phoneFormat(isolate(sample)),
      ok && p.whatsapp && contacts.some((c) => c.phone_number) && T.waLinked,
      noPhone > 0 && T.noPhoneNote(noPhone),
      echo.length > 0 && T.headerEcho(echo.slice(0, 10).join(", ") + (echo.length > 10 ? "\u2026" : "")),
      empty > 0 && T.emptyRows(empty),
      p === "error" && T.precheckFailed,
      p === "big" && T.precheckTooBig(PRECHECK_MAX.toLocaleString(s.locale))
    ].filter(Boolean);
    s.notesEl.textContent = notes.join(" ");
    s.notesEl.hidden = !notes.length;
  }
  function showError(s, message) {
    s.error.textContent = message;
    s.error.hidden = !message;
  }
  function setBusy(s, busy) {
    s.busy = busy;
    syncDisabled(s);
    s.status.textContent = busy ? s.T.preparing : "";
    s.status.hidden = !busy;
  }
  function problemOf(s) {
    const T = s.T;
    const { mapping } = plan(s);
    if (!mapping.some((m) => IDENTITY.has(m.field))) return T.needIdentity;
    const [bad] = validateMapping(s.headers, s.rows, mapping);
    if (bad) return T.badMapping(bad.header, bad.total - bad.valid, bad.total, T.fields[bad.field]);
    if (s.label.startsWith("new:") && !isValidLabelTitle(s.label.slice(4))) return T.labelNameInvalid;
    if (!buildContacts(s).contacts.length) return T.needIdentity;
    return "";
  }
  async function ensureFields(s) {
    for (let i = 0; i < s.values.length; i += 1) {
      if (!s.values[i].startsWith("new:")) continue;
      const name = s.values[i].slice(4).trim();
      const key = slugify(name);
      const find = () => s.defs.find((d) => d.attribute_key === key || matchCustomField(name, [d]));
      let def = find();
      if (!def) {
        try {
          def = await s.api.createCustomAttribute({
            attribute_display_name: name,
            attribute_key: key,
            attribute_display_type: "text",
            attribute_model: "contact_attribute"
          });
          s.defs.push(def);
        } catch {
          s.defs = await s.api.listCustomAttributes().then(asList).catch(() => s.defs);
          def = find();
          if (!def) throw new Notice(s.T.fieldCreateFailed(name));
        }
      }
      s.values[i] = `custom:${def.attribute_key}`;
      replaceSelect(s, i);
    }
  }
  async function ensureLabel(s) {
    s.labelTitle = "";
    if (s.label.startsWith("label:")) s.labelTitle = s.label.slice(6);
    if (!s.label.startsWith("new:")) return;
    const title = s.label.slice(4);
    try {
      s.labelTitle = (await s.api.createLabel(title))?.title || title;
    } catch {
      const hit = (await s.api.listLabels().then(labelTitles).catch(() => [])).find((t) => t.toLowerCase() === title.toLowerCase());
      if (!hit) throw new Notice(s.T.labelCreateFailed);
      s.labelTitle = hit;
    }
    s.labels = [.../* @__PURE__ */ new Set([...s.labels, s.labelTitle])];
    s.label = `label:${s.labelTitle}`;
    replaceLabelSelect(s);
  }
  async function run(s, form) {
    const problem = problemOf(s);
    if (problem) {
      showError(s, problem);
      return;
    }
    clearTimeout(s.preTimer);
    showError(s, "");
    setBusy(s, true);
    try {
      await ensureFields(s);
      await ensureLabel(s);
      if (cur !== s) return;
      const csv = feed(s);
      const sha256 = await digest(csv);
      await s.api.smartImportArm({ sha256, whatsapp: true, email_summary: s.email.checked, label: s.labelTitle, locale: s.locale }).catch(() => {
        throw new Notice(s.T.armFailed);
      });
      if (cur !== s) return;
      s.bypass = true;
      try {
        form.requestSubmit();
      } finally {
        s.bypass = false;
      }
    } catch (e) {
      if (cur === s) showError(s, e instanceof Notice ? e.message : s.T.armFailed);
    } finally {
      if (cur === s) setBusy(s, false);
    }
  }
  return __toCommonJS(entry_exports);
})();
