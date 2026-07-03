# chatwoot-power-tools

**One command adds smart contact import, WhatsApp drip sequences, and dashboard
upgrades to your self-hosted Chatwoot — no separate server, no subdomain, no
accounts to sign up for.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/achiya-automation/chatwoot-power-tools?style=social)](https://github.com/achiya-automation/chatwoot-power-tools/stargazers)
[![CI](https://github.com/achiya-automation/chatwoot-power-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/achiya-automation/chatwoot-power-tools/actions/workflows/ci.yml)

chatwoot-power-tools installs a small sidecar container into your existing Chatwoot
Docker Compose stack. Everything it adds is served **same-origin**, under a single
`/chatwoot-addons/*` route — no separate domain, no CORS, no extra login.

> **Not for Chatwoot Cloud.** This installs a container, a database role, and a
> reverse-proxy route directly on your server — none of which is possible on the managed
> Chatwoot Cloud offering. Self-hosted Docker Compose only. See
> [docs/hosting.md](docs/hosting.md) if you're weighing the two.

## Features

### 📥 Smart Contact Import
A CSV/Excel import wizard, styled to match Chatwoot's own UI. Detects columns
bilingually (Hebrew and English headers), flags duplicates before import, maps columns
onto Chatwoot custom attributes, and applies tags — all from inside the dashboard.

<!-- TODO: add GIF — docs/screenshots/smart-import-wizard.gif -->

### 🔁 WhatsApp Drip Sequences
Automated WhatsApp Cloud API template-message sequences, managed entirely from inside
Chatwoot. A lead is enrolled by setting a conversation attribute; messages then send at
the intervals you configure per step, with automatic skipping of quiet hours, Shabbat,
and Jewish holidays.

<!-- TODO: add GIF — docs/screenshots/sequences-editor.gif -->

### ✨ Dashboard Enhancements
Adds a "Sequences" item to the main sidebar, upgrades Chatwoot's native WhatsApp
campaign modal with variable chips and a live message preview, and adds a client-side
video-compression button (via WebCodecs) so you can attach videos over WhatsApp's
16MB media limit without a server-side transcoding step.

<!-- TODO: add GIF — docs/screenshots/dashboard-enhancements.gif -->

## Quick Start

Run this **on your self-hosted Chatwoot host**, as root or with sudo:

```bash
curl -fsSL https://github.com/achiya-automation/chatwoot-power-tools/archive/refs/heads/main.tar.gz | tar xz \
  && cd chatwoot-power-tools-main \
  && sudo bash install.sh
```

This detects your Chatwoot installation, asks for a yes/no confirmation, and installs
all three modules (add `--modules=` to pick a subset — see below). Prefer to review the
code first (recommended) or use `git`?

```bash
git clone https://github.com/achiya-automation/chatwoot-power-tools.git
cd chatwoot-power-tools
sudo bash install.sh --dry-run   # see the full plan, zero changes made
sudo bash install.sh             # install for real
```

## Modules

| Module | `--modules=` flag | What it adds |
|---|---|---|
| Smart Contact Import | `import` | CSV/Excel import wizard in the dashboard |
| WhatsApp Drip Sequences | `sequences` | Sequence engine + management UI + sidebar entry |
| Dashboard Enhancements | `dashboard` | Campaign modal upgrade + video compressor |

Install all three (default), or just the ones you want:

```bash
sudo bash install.sh --modules=all
sudo bash install.sh --modules=import,sequences
sudo bash install.sh --modules=dashboard
```

## Usage

```
Usage: install.sh [options]

  --dry-run          Show the installation plan; make no changes.
  --uninstall        Remove chatwoot-power-tools (route, engine container, dashboard
                      script). The provisioned database role/schema is left in place —
                      a manual DROP is printed, never run automatically.
  --modules=LIST      Comma-separated: all | import,sequences,dashboard (default: all).
  --yes               Do not prompt for confirmation.
  -h, --help          Show this help.
```

Uninstalling is the same command with one flag:

```bash
sudo bash install.sh --uninstall
```

## Requirements

- A **self-hosted** Chatwoot instance on Docker Compose v2, on a Linux host you can
  access as root/sudo.
- Chatwoot v4.x (verified against v4.15.1 — the installer detects container and service
  names dynamically rather than assuming a fixed layout, so other v4.x releases are
  expected to work the same way).
- A reverse proxy in front of Chatwoot: Caddy or nginx get an automatic route; anything
  else (Traefik, etc.) gets a copy-paste config snippet printed instead.

## How it works

install.sh detects your environment, provisions a least-privilege database role +
schema, starts a small sidecar container (`cwpt-engine`) alongside Chatwoot's own
containers, adds one reverse-proxy route, and injects a dashboard script. Full technical
details — the database role's exact grants, the dashboard-script merge strategy, the
self-migrating engine — are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## FAQ

**Does this work with Chatwoot Cloud?**
No. See the callout above and [docs/hosting.md](docs/hosting.md).

**Is any of my data sent to a third party?**
No. The engine talks only to your own Chatwoot instance's API — Chatwoot itself then
relays WhatsApp sends to Meta, exactly as it already does for any WhatsApp Cloud API
channel — and to the public Hebcal API for Jewish holiday dates. No analytics, no
telemetry.

**What exactly does the installer touch on my server?**
One database role + schema (`drip_engine` / `drip`, least-privilege — see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)), one Docker container (`cwpt-engine`), one
reverse-proxy route (`/chatwoot-addons/*`), and one marked block inside Chatwoot's
`DASHBOARD_SCRIPTS` setting (any existing content there is preserved, not overwritten).

**Can I remove it cleanly?**
Yes — `sudo bash install.sh --uninstall` reverses all of the above. The database
role/schema is deliberately left in place (a manual `DROP` command is printed) since
destroying data automatically is not a call the installer should make for you.

**My reverse proxy isn't Caddy or nginx. Now what?**
The installer prints a ready-to-paste config block for your proxy instead of failing.

**Is this free?**
The software is free and MIT-licensed. Running it still costs whatever your server
already costs. See [docs/hosting.md](docs/hosting.md) for a transparent look at hosting
options, including a paid installation/maintenance service if you'd rather not run the
installer yourself.

## Contributing

Issues and pull requests are welcome — see the issue templates for bug reports and
feature requests. CI (`.github/workflows/ci.yml`) runs the full test suite (`node --test`
across all three modules, plus the `bats` suite for `install.sh`/`lib/`) on every push and
pull request.

## License

[MIT](LICENSE)

---

Built by [Achiya Automation](https://achiya-automation.com). This project's revenue
model is fully transparent — see [docs/hosting.md](docs/hosting.md) for the disclosed
referral links and the paid installation/maintenance service.
