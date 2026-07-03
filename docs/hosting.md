# Self-hosted vs. Chatwoot Cloud

chatwoot-power-tools only installs on a **self-hosted** Chatwoot (Docker Compose) — it
can't run on Chatwoot Cloud, since it needs shell and database access that Cloud doesn't
expose. That's a real constraint, not a sales pitch, so this page lays out both options
honestly: who each one actually suits, and — for the paths where it's relevant — the
disclosed referral links that support this project.

**Transparency rule:** every link on this page that could benefit the author financially
is labeled as such, right next to the link. There are no hidden redirects, no tracking
pixels, and no telemetry anywhere in chatwoot-power-tools itself (see
[docs/ARCHITECTURE.md](ARCHITECTURE.md) for exactly what network calls the installed
software makes — there's no analytics call among them).

## Chatwoot Cloud — if you don't want to run a server at all

Chatwoot's own managed offering. Chatwoot handles upgrades, backups, and uptime for you;
you pay a monthly subscription instead of running a server. This is the right call if you
don't want to own any server maintenance, or don't have anyone who can.

The trade-off: you can't install chatwoot-power-tools (or any other server-side
customization) on Cloud, and you're paying for the managed convenience.

🔗 **Referral link:** [Chatwoot Cloud](https://www.chatwoot.com/pricing) <!-- TODO(owner): replace with your affiliate link from cloud-partners.chatwoot.com --> — registered
through Chatwoot's own partner program at `cloud-partners.chatwoot.com`. Signing up through
this link gets you a discount on Chatwoot Cloud, and may earn the author a commission at no
extra cost to you.

## Self-hosted Chatwoot — if you want control, and you're comfortable with a server

Free (aside from server costs), fully under your own control, and the only option that lets
you install chatwoot-power-tools' modules. The trade-off is the opposite of Cloud's: you
(or someone you hire) are responsible for keeping the server, Docker, and Chatwoot itself
updated and backed up.

### Need a server to self-host on?

If you're going the self-hosted route and don't already have a VPS, these are disclosed
referral links to hosting providers — using them may earn the author a commission at no
extra cost to you:

- 🔗 [Hetzner](https://www.hetzner.com/cloud) <!-- TODO(owner): replace with your Hetzner referral link --> — referral link. Generally the best price/performance
  for running a small self-hosted Chatwoot instance.
- 🔗 [DigitalOcean](https://www.digitalocean.com) <!-- TODO(owner): replace with your DigitalOcean referral link --> — referral link. A solid alternative, particularly for
  US-based datacenters.

Either is enough to run Chatwoot plus chatwoot-power-tools' modules comfortably; pick
whichever region/pricing fits your situation.

### Want it installed and maintained for you?

Self-hosting gets you control, but someone still has to do the initial setup and the
ongoing maintenance. If you'd rather not do that yourself, [Achiya
Automation](https://achiya-automation.com) offers a paid installation and maintenance
service for Chatwoot and chatwoot-power-tools — this is a direct paid service, not a
referral link. [Get in touch](https://achiya-automation.com) if you're interested.
