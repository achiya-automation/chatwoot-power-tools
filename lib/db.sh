#!/usr/bin/env bash
# lib/db.sh
#
# Provisions the least-privilege `drip_engine` Postgres role + `drip` schema inside
# Chatwoot's OWN Postgres container, and writes the connection string install.sh's other
# steps need into Chatwoot's .env. Ported from the already production-proven
# deploy/provision-db-role.sh — role/schema/grants are IDENTICAL; only the hardcoded
# container name, DB user/name, and .env path are replaced with lib/detect.sh calls
# (detect_service_container, read_env_var), so this works unmodified on any self-hosted
# Chatwoot layout.
#
# provision_db intentionally does NOT run any table-level schema migration file itself:
# the cwpt-engine container self-migrates its own drip.* tables on startup
# (modules/sequences/engine/src/migrate.js), using the drip_engine role's ownership of its
# own schema (`CREATE SCHEMA drip AUTHORIZATION drip_engine` below). The
# modules/sequences/db/*.sql files are pre-sidecar Supabase-era artifacts (see their own
# header comments — "מבודד ... מ-Chatwoot ומשאר הפרויקטים ב-Supabase") carried over by the
# Phase 2 `git mv db modules/sequences/db` and are not part of this installer's schema path.
#
# Meant to be sourced (`source lib/db.sh`), not executed directly. No top-level `set -e` —
# see lib/detect.sh for why.

_cwpt_db_root() { (cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd); }

# Defensive self-sufficiency: works whether or not the caller already sourced detect.sh.
if ! declare -f detect_service_container >/dev/null 2>&1; then
  # shellcheck source=lib/detect.sh
  source "$(_cwpt_db_root)/lib/detect.sh"
fi

# provision_db <compose_dir>
#   Idempotent. Creates role `drip_engine` (random password via `openssl rand`, never
#   printed) + schema `drip` if the role doesn't already exist, then (re)applies the
#   least-privilege grants unconditionally (so a future added table just needs a re-run).
#   Only on first creation does it append CWPT_DATABASE_URL to <compose_dir>/.env — if the
#   role already exists, .env is left untouched (the password is not recoverable). Prints
#   only non-secret status lines. Returns 0 on success, 1 if the postgres container or
#   credentials can't be resolved, or a psql step fails.
provision_db() {
  local compose_dir="$1"
  [ -n "$compose_dir" ] || { echo "provision_db: compose_dir required" >&2; return 1; }

  local pg_container
  pg_container="$(detect_service_container "$compose_dir" postgres)" || {
    echo "provision_db: could not detect the postgres container" >&2
    return 1
  }

  # Read the same critical, cross-deployment .env keys confirmed present on both discovery
  # hosts (docs/superpowers/discovery-2026-07-03.md); safe neutral fallbacks if somehow
  # absent, never a private hostname/IP.
  local pg_user pg_db pg_host pg_port
  pg_user="$(read_env_var "$compose_dir" POSTGRES_USERNAME)" || pg_user="postgres"
  pg_db="$(read_env_var "$compose_dir" POSTGRES_DATABASE)" || pg_db="chatwoot"
  pg_host="$(read_env_var "$compose_dir" POSTGRES_HOST)" || pg_host="postgres"
  pg_port="$(read_env_var "$compose_dir" POSTGRES_PORT)" || pg_port="5432"

  local psql=(docker exec -i "$pg_container" psql -U "$pg_user" -d "$pg_db")

  # `|| true`: sourced into install.sh (`set -e -o pipefail`) — if psql itself fails here
  # (e.g. a transient connection hiccup), treat it as "not confirmed to exist" and fall
  # into the create-role branch below, which fails loudly and clearly on its own if the
  # connection is really down, instead of a raw, unhelpful `set -e` abort right here.
  local exists
  exists="$("${psql[@]}" -tAc "SELECT 1 FROM pg_roles WHERE rolname='drip_engine'" 2>/dev/null | tr -d '[:space:]')" || true

  if [ "$exists" = "1" ]; then
    echo "role_already_exists"
    # Self-heal: the role exists but .env may be missing CWPT_DATABASE_URL — e.g. a first
    # run interrupted between CREATE ROLE and the .env append, or a hand-edited .env. The
    # old password is unrecoverable (openssl rand, never stored), so reset it and rewrite
    # the URL. Without this, re-running install.sh could never repair a role-exists /
    # url-missing state, and the engine would crash-loop on "DATABASE_URL required".
    local heal_env_file="${compose_dir}/.env"
    if ! grep -q '^CWPT_DATABASE_URL=' "$heal_env_file" 2>/dev/null; then
      local heal_pw heal_url
      heal_pw="$(openssl rand -hex 24)"
      if "${psql[@]}" -v ON_ERROR_STOP=1 -c "ALTER ROLE drip_engine PASSWORD '${heal_pw}'" >/dev/null 2>&1; then
        heal_url="postgres://drip_engine:${heal_pw}@${pg_host}:${pg_port}/${pg_db}"
        printf 'CWPT_DATABASE_URL=%s\n' "$heal_url" >> "$heal_env_file"
        echo "env_self_healed (role existed but .env lacked CWPT_DATABASE_URL — reset password + rewrote)"
      else
        echo "provision_db: could not reset drip_engine password to self-heal .env" >&2
        return 1
      fi
    fi
  else
    local pw url env_file
    pw="$(openssl rand -hex 24)"
    if ! printf "CREATE ROLE drip_engine LOGIN PASSWORD '%s';\nCREATE SCHEMA IF NOT EXISTS drip AUTHORIZATION drip_engine;\n" "$pw" \
        | "${psql[@]}" -v ON_ERROR_STOP=1 >/dev/null; then
      echo "provision_db: role/schema creation failed" >&2
      return 1
    fi
    echo "role_created"

    env_file="${compose_dir}/.env"
    if grep -q '^CWPT_DATABASE_URL=' "$env_file" 2>/dev/null; then
      echo "env_already_present (role recreated — update .env manually if password changed)"
    else
      url="postgres://drip_engine:${pw}@${pg_host}:${pg_port}/${pg_db}"
      printf 'CWPT_DATABASE_URL=%s\n' "$url" >> "$env_file"
      echo "env_appended"
    fi
  fi

  # Grants — always (re)applied, so adding a table here and re-running install.sh suffices.
  # READS the engine needs from Chatwoot's tables:
  #   conversations/messages/contacts — enroll, delivery tracking, contact params, opt-out
  #   inboxes/contact_inboxes         — lazy conversation creation (resolve the WA source_id)
  #   channel_whatsapp                — read approved templates from the DB (the AgentBot
  #                                     token cannot list inboxes via API; the engine reads
  #                                     templates here instead)
  # WRITE: contacts (custom_attributes only) — the dashboard "assign to sequence" action
  #   sets the contact-level `sequence` attribute; the AgentBot token cannot PUT /contacts,
  #   so the engine writes that one attribute directly.
  #
  # CREATE on the database: the engine's migrate.js runs `CREATE SCHEMA IF NOT EXISTS drip`
  # on every boot, and Postgres checks the database-level CREATE privilege BEFORE the
  # IF-NOT-EXISTS short-circuit — so even though we (as superuser) already created the
  # schema above, drip_engine would crash-loop with "permission denied for database" without
  # this. Scoped to CREATE (schema creation) only — the role stays SELECT-only on Chatwoot's
  # own tables. (Verified: chatwoot's live drip_engine already has this; a clean host does
  # not, which is exactly the portability gap this line closes.) $pg_db is a %I-style
  # identifier, hence the quoting; it comes from the operator's own POSTGRES_DATABASE.
  if ! "${psql[@]}" -v ON_ERROR_STOP=1 -c "GRANT CREATE ON DATABASE \"${pg_db}\" TO drip_engine" >/dev/null 2>&1; then
    echo "provision_db: grant CREATE on database failed" >&2
    return 1
  fi

  if ! "${psql[@]}" -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
GRANT USAGE ON SCHEMA public TO drip_engine;
GRANT SELECT ON public.conversations, public.messages, public.contacts,
                public.inboxes, public.contact_inboxes, public.channel_whatsapp TO drip_engine;
-- accounts — friendly names for the dashboard account switcher (super-admin manages many).
GRANT SELECT ON public.accounts TO drip_engine;
-- active_storage_* — read the Chatwoot account's own attachment storage (storage_usage).
GRANT SELECT ON public.active_storage_attachments, public.active_storage_blobs TO drip_engine;
-- campaigns dashboard: read campaign definitions + audience labels (contact tags).
GRANT SELECT ON public.campaigns, public.labels, public.tags, public.taggings TO drip_engine;
-- WRITE scoped to the ONE column the engine owns (custom_attributes.sequence). Column-level
-- least-privilege: even a bug in the engine can't rewrite a contact's name/phone/email.
-- REVOKE clears any prior table-wide UPDATE from an earlier provision (idempotent tightening).
REVOKE UPDATE ON public.contacts FROM drip_engine;
GRANT UPDATE (custom_attributes) ON public.contacts TO drip_engine;
SQL
  then
    echo "provision_db: grants failed" >&2
    return 1
  fi
  echo "grants_applied"

  # ── Auto-onboarding of new accounts ──────────────────────────────────────────
  # The engine's loop iterates drip.account_tokens. Registering an account there used to be
  # a MANUAL step, and forgetting it is the worst kind of failure: the sequence is built, the
  # leads are enrolled, the switches are on — and nothing sends, with no error anywhere.
  #
  # So the engine now asks "who has a sequence?" and onboards whoever is missing, by calling
  # this function. It is SECURITY DEFINER and created HERE, by the superuser, on purpose:
  # minting a Chatwoot API token is the one thing the engine must be able to do without
  # holding INSERT on public.access_tokens (which would let it mint tokens for anything).
  # Idempotent, and applied on every provision run, so an existing install gains it too.
  if ! "${psql[@]}" -v ON_ERROR_STOP=1 >/dev/null 2>&1 \
       -f /dev/stdin < "$(dirname "${BASH_SOURCE[0]}")/../modules/sequences/engine/migrations/024_auto_onboard_role_grants.sql"
  then
    echo "provision_db: auto-onboard function failed (חשבונות חדשים לא יתחברו לבד)" >&2
    return 1
  fi
  echo "auto_onboard_ready"

  # Verify (informational only — no secrets in either query). `|| true`: a hiccup on this
  # purely cosmetic final check must never abort the script after grants already applied.
  "${psql[@]}" -tAc "SELECT 'role=' || rolname FROM pg_roles WHERE rolname='drip_engine'" 2>/dev/null || true
  "${psql[@]}" -tAc "SELECT 'schema=' || nspname || ' owner=' || pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='drip'" 2>/dev/null || true
  echo "PROVISION_DONE"
}
