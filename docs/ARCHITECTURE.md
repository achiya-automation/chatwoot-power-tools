# Architecture

chatwoot-power-tools is a **sidecar** for a self-hosted Chatwoot Docker Compose deployment.
`install.sh` runs directly on the Chatwoot host, detects the running environment, and adds
one container, one reverse-proxy route, and one dashboard-script entry. Modules that need
database access also add one least-privilege role and the `drip` schema; an import-only
installation does not. `install.sh --uninstall` removes the runtime, proxy route and dashboard
entry; the database role, schema and data are intentionally retained for recovery and require
an explicit manual removal.

There is no separate backend service, no external database, and no telemetry. Everything
lives inside your own Chatwoot stack. Depending on the enabled modules and explicit settings,
the running system can call: your own Chatwoot API (`engine/src/chatwoot.js`); Meta's Graph
API directly for WhatsApp template management/media, number/template health reads and
presence operations (`meta.js`, `templates.js`, `presence.js`). Normal campaign/template
sends go through Chatwoot; only the explicitly enabled MM Lite experiment sends its test
arm directly to Graph before recording the message in Chatwoot. The other possible outbound
calls are the public Hebcal API for Jewish holiday dates (`calendar.js`) and only the
notification or Journey webhook destinations that an administrator explicitly configures.

## Repository layout

```
install.sh                     — the installer (see "Installation flow" below)
lib/                            — installer building blocks, sourced by install.sh
  detect.sh                     — environment discovery (compose dir, containers, proxy)
  db.sh                         — provisions the drip_engine role + drip schema
  proxy-caddy.sh, proxy-nginx.sh — idempotent reverse-proxy route insertion
  proxy-snippet.sh              — copy-paste fallback for any other reverse proxy
  inject.sh                     — writes the dashboard script into Chatwoot
  assemble-dashboard-script.sh  — builds the dashboard script HTML from module parts
docker-compose.addons.yml       — the cwpt-engine service definition (loaded as an extra
                                  -f file alongside Chatwoot's own docker-compose.yml)
modules/
  smart-import/                 — CSV/Excel contact-import wizard (lib/, ui/, inject/)
  sequences/
    engine/                     — the cwpt-engine Node service (src/, migrations/)
    webapp/                     — the sequences management UI (React, pre-built dist/)
    db/                         — schema files from an earlier architecture, carried over
                                  by history; not used by install.sh or the engine, which
                                  owns its own migrations under engine/migrations/ instead
    inject/                     — dashboard-script part: sidebar "Sequences" nav
  dashboard-enhancements/
    parts/                      — dashboard-script parts: campaign modal/stats, native i18n, whatsapp-theme (skin)
test/                            — bats tests for install.sh + lib/ (mocked docker/psql)
```

Each of the three modules also carries its own `node --test` suite under its own `test/`
directory (`modules/sequences/engine/test`, `modules/sequences/webapp/test`,
`modules/smart-import/test`).

## Installation flow (`install.sh`)

1. **Parse flags** — `--modules=`, `--dry-run`, `--uninstall`, `--yes`, `--help`.
2. **Preflight** — confirms `docker`, Docker Compose v2, and that the current user/sudo
   context can actually run `docker ps` (not just an `id -u` check).
3. **Detect the environment** (`lib/detect.sh`) — finds Chatwoot's compose directory via
   `docker compose ls` (falling back to common paths), then the real container names for
   the `rails` and `postgres` compose services, and which reverse proxy (if any) is
   running. Nothing about a specific deployment is hardcoded; every one of these values is
   discovered at run time so the same installer works across differently-named or
   differently-laid-out Chatwoot installs.
4. **Provision the database when selected** (`lib/db.sh`) — `sequences` and `dashboard`
   create the `drip_engine` role/schema; an `import`-only install skips this phase.
5. **Copy selected modules into the compose directory** — the shared
   `modules/sequences` sidecar runtime plus only selected optional module directories and
   `docker-compose.addons.yml` are copied to `<compose_dir>/chatwoot-power-tools/`.
   When that exact path is the source Git checkout, the pruned deployment is instead stored
   under its `.cwpt-runtime/` child so a subset install cannot delete tracked source; the
   image build context points only at that managed child. Reinstalling a subset first moves
   the old managed tree to a scoped rollback directory, so stale unselected assets cannot
   survive and an extraction failure can restore the previous runtime. The exact selection
   is also recorded in the managed runtime's `enabled-modules.txt`.
6. **Write addons environment variables** into Chatwoot's own `.env`:
   `CWPT_DATABASE_URL` (written by `provision_db` itself), `CWPT_CHATWOOT_BASE_URL`
   (derived from the detected rails container name), `CWPT_PUBLIC_BASE_URL` (derived
   from Chatwoot's own `FRONTEND_URL` — this must be an absolute `https://` origin, since
   Meta has to be able to fetch WhatsApp template media from it), the exact
   `CWPT_ENABLED_MODULES`, a random per-run `CWPT_DEPLOY_ID`, and (only when sequences is
   selected) independent random secrets for the Journey event hook and optional external
   Journey intake endpoint. Import-only explicitly blanks `CWPT_DATABASE_URL`.
7. **Build and start `cwpt-engine`** — `docker compose -f docker-compose.yml -f
   chatwoot-power-tools/docker-compose.addons.yml up -d --build cwpt-engine`, joining
   Chatwoot's own compose project and network.
8. **Apply owner-only migrations** — the companions required by the exact module selection
   are applied in deterministic filename order as Chatwoot's DB owner after the selected
   engine schema is ready, then recorded in `drip.schema_migrations`.
9. **Add the reverse-proxy route** — a single `/chatwoot-addons/*` route to
   `127.0.0.1:3100`, added automatically for Caddy (host-installed) or nginx. Any other
   proxy (Traefik, etc.) gets a copy-paste config block printed instead.
10. **Verify before publishing UI** — both the loopback engine URL and the public
    `/chatwoot-addons/drip-api/health` URL must return the engine health JSON, with the exact
    requested modules, build and random deployment identity matching across both paths. A
    plain 200/SPA fallback or stale engine is rejected; the existing dashboard block remains
    untouched and the installer exits non-zero with `INCOMPLETE`.
11. **Publish the dashboard script** (`lib/inject.sh`) — only after verification, merges the
    assembled HTML for the selected modules into Chatwoot's `DASHBOARD_SCRIPTS`
    `InstallationConfig` via a locked compare-and-set and exact readback verification.

`--dry-run` performs detection in read-only/best-effort mode and prints the full plan without
making any changes — it works the same way whether run on the real target server or on a
machine with no Docker at all. `--uninstall` first validates the existing marked dashboard
block without changing it, then stops/removes the exact `cwpt-engine` container and verifies
that it is absent (Compose plus an exact-name Docker fallback). A stop failure exits
incomplete with the dashboard, route and files intact, so an old background engine can
never keep sending after a reported success. It then removes only chatwoot-power-tools' own
dashboard block with compare-and-set; a late conflict leaves the already-stopped engine and
preserves the route/files for retry. It never recursively deletes the whole
`chatwoot-power-tools/` target: unknown files and the dashboard backup are preserved,
and when the repository checkout itself is that target (a supported production layout),
only its `.cwpt-runtime/` deployment is removed while the checkout, `.git`, source modules
and compose source stay intact. It **always** leaves
the `drip_engine` role/schema and the `cwpt_media` volume in place — a manual `DROP` command
is printed, never run automatically, since destroying a database schema is irreversible
and the operator should make that call explicitly.

## The `cwpt-engine` sidecar container

`cwpt-engine` (`modules/sequences/engine/`) is a small Node/Express service, built from
`modules/sequences/engine/Dockerfile` with `modules/sequences` as its build context. It:

- Runs the WhatsApp sequences reconciler on an interval (default 60s): enrolls/advances/
  stops leads based on the `sequence` conversation custom attribute, sends due template
  messages through the Chatwoot API (which forwards to WhatsApp Cloud API), and skips
  sends during quiet hours / Shabbat / Jewish holidays.
- Serves the pre-built sequences web app (`modules/sequences/webapp/dist`, committed to
  git — see the note below) as static files, same-origin, under `/chatwoot-addons/*`.
- Serves the smart-import bundle the same way: `modules/smart-import`'s built assets are
  merged into `modules/sequences/webapp/dist/smart-import/` at build time (not at install
  time — see the header comment in `install.sh`), because the engine's Docker build
  context (`modules/sequences`) has no access to the sibling `modules/smart-import/`
  directory. The already-committed, already-merged copy is what actually ships.
- Reads all configuration from environment variables only
  (`modules/sequences/engine/src/config.js`): `DATABASE_URL`, `CHATWOOT_BASE_URL`,
  `PUBLIC_BASE_URL`, `PORT`, `RECONCILE_INTERVAL`, `MEDIA_DIR`, plus a few tunable safety
  caps (`MAX_SENDS_PER_TICK`, `SPREAD_WINDOW_MS`).
  Cross-account authority comes only from Chatwoot's native `SuperAdmin` user type; an
  administrator of account 1 is not treated as a platform administrator. There is no
  hardcoded domain or fallback anywhere in this path —
  every deployment supplies its own values via `docker-compose.addons.yml`'s `CWPT_*`
  variables, written by `install.sh`.
- Is reachable from the host only on loopback (`127.0.0.1:3100`) — the reverse-proxy route
  is the only path in from outside.

> **Note on the pre-built webapp:** a clean `git clone` of this repository has no local
> Node/npm build step of its own before `install.sh` runs — `modules/sequences/webapp/dist`
> is committed so the engine's Docker build can `COPY` it directly. After any change under
> `modules/sequences/webapp/src` or `modules/smart-import`, both must be rebuilt and the
> smart-import output re-merged into `webapp/dist/smart-import/` before committing (see the
> exact commands in `install.sh`'s header comment).

## Database: schema `drip`, role `drip_engine`

All persistent state lives inside Chatwoot's own Postgres instance, isolated by role and
schema rather than by a separate database server:

- When a selected module needs database access, `provision_db` (`lib/db.sh`) creates a
  Postgres role `drip_engine` with a random password (`openssl rand`, generated on the host,
  never printed to stdout/logs) and a schema `drip` owned by that role. Import-only installs
  create neither the role nor the schema.
- The role is **least-privilege** against Chatwoot's own tables: module-scoped `SELECT` on
  `conversations`, `contacts`, `inboxes`, `contact_inboxes`, `channel_whatsapp`, `accounts`,
  `agent_bot_inboxes`, `campaigns`, `campaign_recipients`, `messages`, labels/tagging tables,
  and `active_storage_attachments`/`active_storage_blobs`. Version-specific grants such as
  `campaign_recipients` live in explicit `*_role_grants.sql` files. `SELECT` is read-only but
  includes contact names, phones and emails used by the product's contact, bot-ownership,
  sequence and campaign screens.
  With `sequences`, `UPDATE` is limited to three columns: `contacts.custom_attributes`
  (assignment state) plus `channel_whatsapp.message_templates` and
  `channel_whatsapp.message_templates_last_updated` (Chatwoot's approved-template cache).
  A dashboard-only re-run explicitly revokes all three column grants, both sequence-only
  `SECURITY DEFINER` execute grants, and sequence-only reads (`accounts`, `agent_bot_inboxes`
  and Active Storage),
  then grants only its campaign-report reads. Import-only clears the container credential
  and revokes all public-schema table/sequence grants, database `CREATE`, owner-function
  execution, and their ledger markers. It cannot change contact identity fields.
- It additionally holds `CREATE` on the database itself — not because it needs broad
  access, but because the engine's own `migrate.js` runs `CREATE SCHEMA IF NOT EXISTS drip`
  on every boot (see "Self-migration on boot" below), and creating a schema requires that
  grant. Everything under the `drip` schema itself is owned outright by `drip_engine`.
- All sequences/enrollments state (`drip.sequences`, `drip.sequence_steps`,
  `drip.enrollments`, delivery/backoff tracking, the Shabbat/holiday calendar cache, etc.)
  lives in this one schema, applied incrementally via the migrations under
  `modules/sequences/engine/migrations/`.

## Networking: a single `/chatwoot-addons/*` route

Every module — the sequences web app, its API, the smart-import bundle, and uploaded
template media — is served **same-origin**, under one reverse-proxy route:
`/chatwoot-addons/*` → `127.0.0.1:3100` (the `cwpt-engine` container). There is no separate
subdomain, no CORS configuration, and no extra CSP grant needed: the browser sees
everything as coming from Chatwoot's own origin.

`lib/proxy-caddy.sh` and `lib/proxy-nginx.sh` insert this route automatically and
idempotently (a repeat run is a no-op, detected via a grep guard), always backing up the
config file first and validating (`caddy validate` / `nginx -t`) before reloading — a
failed validation rolls the file back rather than leaving a broken proxy config live. Any
other reverse proxy gets `lib/proxy-snippet.sh`'s printed copy-paste block instead of a
silent gap.

## Dashboard integration: `DASHBOARD_SCRIPTS` marker-merge

Chatwoot has one instance-wide extension point for arbitrary JavaScript: the
`DASHBOARD_SCRIPTS` `InstallationConfig` value, loaded at the end of `<body>` on every
dashboard page. `lib/assemble-dashboard-script.sh` builds one HTML blob from the parts of
whichever modules were selected at install time (`modules/smart-import/inject/`,
`modules/sequences/inject/`, `modules/dashboard-enhancements/parts/`), with
`window.__CW_ADDONS_BASE` set once at the top so every part resolves its own asset and API
paths from that single dynamic value — no part hardcodes a path or domain.

Because `DASHBOARD_SCRIPTS` is a single value that may already hold an operator's own
snippet (analytics, a custom banner, etc.), `lib/inject.sh` never overwrites it blindly:
the chatwoot-power-tools contribution is always wrapped in `<!-- CWPT:START -->` /
`<!-- CWPT:END -->` markers. On every write, the current value is read first, backed up to
`<compose_dir>/chatwoot-power-tools/dashboard_scripts.prev.bak`, and then either the
existing CWPT block is replaced in place (re-install/upgrade) or the new block is appended
after whatever else was already there (first install). `--uninstall` mirrors this precisely
in reverse: it strips only the CWPT-marked block, and only removes the
`InstallationConfig` row entirely once nothing — not even unrelated operator content — is
left in it afterward.

## Self-migration on boot

`cwpt-engine` manages its own schema. On every start
(`modules/sequences/engine/src/migrate.js`), it creates the `drip` schema and a
`drip.schema_migrations` tracking table if they don't already exist, then applies each
ordinary `.sql` file selected for the enabled modules that isn't already recorded there,
in filename order, inside a fail-fast check. Dashboard-only uses a minimal campaign/media
manifest and does not create sequence/journey state. Files ending in `_role_grants.sql` need
the Chatwoot database owner, so the engine checks their ledger markers and logs any pending
ones instead of silently skipping them. `install.sh` waits for the last selected ordinary
migration, applies the selected owner companions through `apply_owner_migrations`, and records
each filename in the same ledger. The production `sync-servers.sh` path likewise re-applies
and ledgers owner files transactionally before rebuilding either flat or modular engines,
safely backfilling installs whose grants predated the ledger. The engine does not start its
HTTP server or background work until the required markers exist; its normal DB-ready retry
loop waits while the installer completes the owner phase. Both phases are idempotent.

## Testing

- **Shell/installer logic** (`lib/*.sh`, `install.sh`) is tested with
  [bats-core](https://github.com/bats-core/bats-core) under `test/*.bats`, against mocked
  `docker`/`psql` (`test/mocks/`) and fixture config files (`test/fixtures/`) — no real
  Docker or Postgres is required to run this suite.
- Each Node module has its own `node --test` suite: `modules/sequences/engine/test`
  (needs a real Postgres — see below), `modules/sequences/webapp/test`, and
  `modules/smart-import/test` (neither of the latter two needs a database).
- The engine's test suite runs real queries against a throwaway Postgres, since its
  migrations and read-paths `JOIN` against Chatwoot's own tables. That Postgres needs
  stand-in versions of the handful of Chatwoot tables the engine reads
  (`conversations`, `contacts`, `messages`, `inboxes`, `contact_inboxes`,
  `channel_whatsapp`, `accounts`) — see `.github/workflows/ci.yml` for the exact scaffold
  used in CI.
