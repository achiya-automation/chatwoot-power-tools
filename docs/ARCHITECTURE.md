# Architecture

chatwoot-power-tools is a **sidecar** for a self-hosted Chatwoot Docker Compose deployment.
`install.sh` runs directly on the Chatwoot host, detects the running environment, and adds
one container, one database role/schema, one reverse-proxy route, and one dashboard-script
entry — all removable with `install.sh --uninstall`.

There is no separate backend service, no external database, and no telemetry. Everything
lives inside your own Chatwoot stack. The only outbound network calls the running system
makes are to your own Chatwoot instance's API (`modules/sequences/engine/src/chatwoot.js`
— Chatwoot itself then relays template sends to Meta's WhatsApp Cloud API, the same way it
already does for any WhatsApp Cloud API channel; the engine never talks to Meta directly)
and to the public Hebcal API (Jewish holiday dates, used to skip Shabbat/holidays in
sequences — see `modules/sequences/engine/src/calendar.js`).

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
    parts/                      — dashboard-script parts: campaign modal, video compressor
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
4. **Provision the database** (`lib/db.sh`) — creates the `drip_engine` role and `drip`
   schema (see "Database" below). Idempotent: skips creation if the role already exists.
5. **Copy modules into the compose directory** — `modules/` and
   `docker-compose.addons.yml` are copied to `<compose_dir>/chatwoot-power-tools/`, so the
   engine's Docker build context lives next to Chatwoot's own compose files.
6. **Write addons environment variables** into Chatwoot's own `.env`:
   `CWPT_DATABASE_URL` (written by `provision_db` itself), `CWPT_CHATWOOT_BASE_URL`
   (derived from the detected rails container name), and `CWPT_PUBLIC_BASE_URL` (derived
   from Chatwoot's own `FRONTEND_URL` — this must be an absolute `https://` origin, since
   Meta has to be able to fetch WhatsApp template media from it).
7. **Build and start `cwpt-engine`** — `docker compose -f docker-compose.yml -f
   chatwoot-power-tools/docker-compose.addons.yml up -d --build cwpt-engine`, joining
   Chatwoot's own compose project and network.
8. **Add the reverse-proxy route** — a single `/chatwoot-addons/*` route to
   `127.0.0.1:3100`, added automatically for Caddy (host-installed) or nginx. Any other
   proxy (Traefik, etc.) gets a copy-paste config block printed instead
   (`lib/proxy-snippet.sh`) — the installer never fails outright just because it can't
   auto-edit an unfamiliar proxy config.
9. **Inject the dashboard script** (`lib/inject.sh`) — merges the assembled HTML for the
   selected modules into Chatwoot's `DASHBOARD_SCRIPTS` `InstallationConfig` value via
   `docker exec ... rails runner`. See "Dashboard integration" below.
10. **Verify** — a loopback health check against the engine
    (`http://127.0.0.1:3100/drip-api/health`), reported but never fatal on its own (the
    install has already completed by this point; this is a diagnostic).

`--dry-run` runs steps 3-4 in read-only/best-effort mode and prints the full plan without
making any changes — it works the same way whether run on the real target server or on a
machine with no Docker at all. `--uninstall` reverses steps 5-9 (removes the route, stops
and removes the `cwpt-engine` container, strips only chatwoot-power-tools' own block from
`DASHBOARD_SCRIPTS`, deletes the copied `chatwoot-power-tools/` directory) but **always**
leaves the `drip_engine` role/schema and the `cwpt_media` volume in place — a manual `DROP`
command is printed, never run automatically, since destroying a database schema is
irreversible and the operator should make that call explicitly.

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
  caps (`MAX_SENDS_PER_TICK`, `MAX_DELIVERY_RETRIES`, `DELIVERY_RETRY_HOURS`,
  `MASTER_ACCOUNT_ID`). There is no hardcoded domain or fallback anywhere in this path —
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

- `provision_db` (`lib/db.sh`) creates a Postgres role `drip_engine` with a random password
  (`openssl rand`, generated on the host, never printed to stdout/logs) and a schema `drip`
  owned by that role.
- The role is **least-privilege** against Chatwoot's own tables: `SELECT` on
  `conversations`, `contacts`, `inboxes`, `contact_inboxes`, `channel_whatsapp`, `accounts`,
  `active_storage_attachments`/`active_storage_blobs` — and, narrowly, `UPDATE` on exactly
  one column: `contacts.custom_attributes` (the `UPDATE` privilege is `REVOKE`d at the
  table level first, then re-`GRANT`ed for that single column only). It has no access to
  any other Chatwoot table.
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
`drip.schema_migrations` tracking table if they don't already exist, then applies any
`.sql` file under `modules/sequences/engine/migrations/` that isn't already recorded there,
in filename order, inside a fail-fast check (a failed migration aborts startup with a clear
error rather than booting on a half-applied schema). One file is deliberately skipped by
this loop — `002_role_grants.sql`, whose own header says it must be run once by a Postgres
superuser, not by the engine — because granting privileges on Chatwoot's own tables to
`drip_engine` needs more than the schema-owner rights `drip_engine` itself has. `lib/db.sh`'s
`provision_db` (see "Database" above) is what actually applies those grants today, via
equivalent inline SQL; the migration file is kept as a plain, readable record of the same
intent. There is no separate table-migration step in `install.sh` itself beyond that
provisioning — applying `drip.*` table definitions is the engine's own responsibility every
time it starts, which also makes upgrades (pull a new image, restart) self-applying.

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
