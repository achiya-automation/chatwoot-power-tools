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
# own schema (`CREATE SCHEMA drip AUTHORIZATION drip_engine` below). Owner-only companion
# migrations (`*_role_grants.sql`) are applied later by apply_owner_migrations, after the
# engine has recorded its last ordinary migration. Keeping these phases separate avoids a
# clean-install race where a SECURITY DEFINER function is installed before the drip tables
# it uses exist, while still ensuring owner grants are never silently skipped. The
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

# Secret-safe env upsert used only for CWPT_DATABASE_URL. It never prints the value and
# keeps exactly one KEY= line, including when an import-only shrink intentionally blanked
# the credential before a later database-backed expansion repairs it.
_cwpt_db_upsert_env_var() {
  local file="$1" key="$2" value="$3" tmp
  tmp="$(mktemp)" || return 1
  if [ -f "$file" ]; then
    grep -v "^${key}=" "$file" > "$tmp" || true
  fi
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  if ! cat "$tmp" > "$file"; then
    rm -f "$tmp"
    return 1
  fi
  rm -f "$tmp"
}

# provision_db <compose_dir> [enabled_modules_csv]
#   Idempotent. Creates role `drip_engine` (random password via `openssl rand`, never
#   printed) + schema `drip` if the role doesn't already exist, then (re)applies the
#   least-privilege grants unconditionally (so a future added table just needs a re-run).
#   A healthy existing role keeps its URL untouched. A missing/blank URL is repaired by
#   resetting the unrecoverable role password and atomically rewriting the URL; a newly
#   created role also replaces any stale URL. Prints only non-secret status lines. Returns
#   0 on success, 1 if the postgres container or credentials can't be resolved, or a psql
#   step fails.
provision_db() {
  local compose_dir="$1"
  local enabled_modules_csv="${2:-import,sequences,enhancements}"
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
    local heal_env_file="${compose_dir}/.env" current_db_url=""
    current_db_url="$(read_env_var "$compose_dir" CWPT_DATABASE_URL)" || current_db_url=""
    if [ -z "$current_db_url" ]; then
      local heal_pw heal_url
      heal_pw="$(openssl rand -hex 24)"
      if "${psql[@]}" -v ON_ERROR_STOP=1 -c "ALTER ROLE drip_engine PASSWORD '${heal_pw}'" >/dev/null 2>&1; then
        heal_url="postgres://drip_engine:${heal_pw}@${pg_host}:${pg_port}/${pg_db}"
        if ! _cwpt_db_upsert_env_var "$heal_env_file" CWPT_DATABASE_URL "$heal_url"; then
          echo "provision_db: could not rewrite CWPT_DATABASE_URL after resetting the role password" >&2
          return 1
        fi
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
    local env_had_database_key=0
    grep -q '^CWPT_DATABASE_URL=' "$env_file" 2>/dev/null && env_had_database_key=1
    url="postgres://drip_engine:${pw}@${pg_host}:${pg_port}/${pg_db}"
    # The freshly-created role has a freshly-generated password, so every old/blank URL is
    # stale by definition. Replace it atomically instead of preserving a credential that can
    # only crash-loop the new database-backed engine.
    if ! _cwpt_db_upsert_env_var "$env_file" CWPT_DATABASE_URL "$url"; then
      echo "provision_db: could not write CWPT_DATABASE_URL for the newly-created role" >&2
      return 1
    fi
    if [ "$env_had_database_key" -eq 1 ]; then
      echo "env_rewritten (new role password replaced stale/blank credential)"
    else
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

  if [[ ",${enabled_modules_csv}," == *",sequences,"* ]]; then
    if ! "${psql[@]}" -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
GRANT USAGE ON SCHEMA public TO drip_engine;
GRANT SELECT ON public.conversations, public.messages, public.contacts,
                public.inboxes, public.contact_inboxes, public.channel_whatsapp TO drip_engine;
-- Presence is allowed only when a conversation-level bot is assigned or an active inbox bot
-- exists. Older Chatwoot releases without this table stay installable; supported 4.16+
-- releases grant the engine the one additional read-only table required by that proof.
DO $$
BEGIN
  IF to_regclass('public.agent_bot_inboxes') IS NOT NULL THEN
    GRANT SELECT ON public.agent_bot_inboxes TO drip_engine;
  END IF;
END $$;
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
-- WRITE to channel_whatsapp template columns: the engine updates message_templates and
-- message_templates_last_updated when syncing approved templates from Meta's API cache.
GRANT UPDATE (message_templates, message_templates_last_updated) ON public.channel_whatsapp TO drip_engine;
SQL
    then
      echo "provision_db: sequence grants failed" >&2
      return 1
    fi
  elif [[ ",${enabled_modules_csv}," == *",enhancements,"* ]]; then
    # Add the dashboard's read set before the new image boots. Do not revoke a previous
    # sequence install here: the old sequence engine is still live during the build, and a
    # later copy/build failure must leave it fully functional. finalize_db_module_privileges
    # performs the desired-state shrink only after the replacement runtime is up.
    if ! "${psql[@]}" -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
GRANT USAGE ON SCHEMA public TO drip_engine;
GRANT SELECT ON public.conversations, public.messages, public.contacts,
                public.inboxes, public.contact_inboxes, public.channel_whatsapp,
                public.campaigns, public.labels, public.tags, public.taggings TO drip_engine;
SQL
    then
      echo "provision_db: dashboard enhancement grants failed" >&2
      return 1
    fi
  fi
  echo "grants_applied"

  # Verify (informational only — no secrets in either query). `|| true`: a hiccup on this
  # purely cosmetic final check must never abort the script after grants already applied.
  "${psql[@]}" -tAc "SELECT 'role=' || rolname FROM pg_roles WHERE rolname='drip_engine'" 2>/dev/null || true
  "${psql[@]}" -tAc "SELECT 'schema=' || nspname || ' owner=' || pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='drip'" 2>/dev/null || true
  echo "PROVISION_DONE"
}

# finalize_db_module_privileges <compose_dir> <enabled_modules_csv>
#   Applies destructive privilege shrink only after the selected replacement engine has
#   started successfully. This ordering keeps the old sequence engine intact if copying,
#   building, or compose-up fails during a sequences -> dashboard/import transition.
finalize_db_module_privileges() {
  local compose_dir="$1" enabled_modules_csv="$2"
  [ -n "$compose_dir" ] || { echo "finalize_db_module_privileges: compose_dir required" >&2; return 1; }
  [[ ",${enabled_modules_csv}," != *",sequences,"* ]] || return 0

  local pg_container pg_user pg_db
  pg_container="$(detect_service_container "$compose_dir" postgres)" || {
    echo "finalize_db_module_privileges: could not detect the postgres container" >&2
    return 1
  }
  pg_user="$(read_env_var "$compose_dir" POSTGRES_USERNAME)" || pg_user="postgres"
  pg_db="$(read_env_var "$compose_dir" POSTGRES_DATABASE)" || pg_db="chatwoot"
  local psql=(docker exec -i "$pg_container" psql -U "$pg_user" -d "$pg_db")

  # A fresh import-only install never creates the role. Distinguish that safe no-op from a
  # failed owner query; a database error during a shrink must not be reported as success.
  if [[ ",${enabled_modules_csv}," != *",enhancements,"* ]]; then
    local role_exists=""
    if ! role_exists="$("${psql[@]}" -tAc "SELECT 1 FROM pg_roles WHERE rolname='drip_engine'" 2>/dev/null | tr -d '[:space:]')"; then
      echo "finalize_db_module_privileges: could not determine whether drip_engine exists" >&2
      return 1
    fi
    if [ "$role_exists" != "1" ]; then
      echo "import_privileges_already_absent"
      return 0
    fi

    if ! "${psql[@]}" -v ON_ERROR_STOP=1 -c \
      "REVOKE CREATE ON DATABASE \"${pg_db}\" FROM drip_engine" >/dev/null 2>&1; then
      echo "finalize_db_module_privileges: import-only database privilege shrink failed" >&2
      return 1
    fi
    if ! "${psql[@]}" -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
REVOKE ALL PRIVILEGES ON SCHEMA public FROM drip_engine;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM drip_engine;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM drip_engine;
-- Table-level REVOKE does not remove column grants.
REVOKE UPDATE (custom_attributes) ON public.contacts FROM drip_engine;
REVOKE UPDATE (message_templates, message_templates_last_updated) ON public.channel_whatsapp FROM drip_engine;
DO $$
BEGIN
  IF to_regprocedure('drip.ensure_account_bot(integer)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION drip.ensure_account_bot(integer) FROM drip_engine';
  END IF;
  IF to_regprocedure('drip.ensure_journey_webhook(integer,text)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION drip.ensure_journey_webhook(integer,text) FROM drip_engine';
  END IF;
END $$;
DO $$
BEGIN
  IF to_regclass('drip.schema_migrations') IS NOT NULL THEN
    DELETE FROM drip.schema_migrations
     WHERE version IN ('024_auto_onboard_role_grants.sql',
                       '033_journeys_role_grants.sql',
                       '051_campaign_recipients_role_grants.sql',
                       '053_presence_role_grants.sql');
  END IF;
END $$;
SQL
    then
      echo "finalize_db_module_privileges: import-only public privilege shrink failed" >&2
      return 1
    fi
    echo "import_privileges_finalized"
    return 0
  fi

  if ! "${psql[@]}" -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
-- Table-level REVOKE does not remove column-level grants in PostgreSQL.
REVOKE UPDATE (custom_attributes) ON public.contacts FROM drip_engine;
REVOKE UPDATE (message_templates, message_templates_last_updated) ON public.channel_whatsapp FROM drip_engine;
REVOKE SELECT ON public.accounts, public.active_storage_attachments,
                 public.active_storage_blobs FROM drip_engine;
DO $$
BEGIN
  IF to_regclass('public.agent_bot_inboxes') IS NOT NULL THEN
    EXECUTE 'REVOKE SELECT ON public.agent_bot_inboxes FROM drip_engine';
  END IF;
END $$;
DO $$
BEGIN
  IF to_regprocedure('drip.ensure_account_bot(integer)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION drip.ensure_account_bot(integer) FROM drip_engine';
  END IF;
  IF to_regprocedure('drip.ensure_journey_webhook(integer,text)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION drip.ensure_journey_webhook(integer,text) FROM drip_engine';
  END IF;
END $$;
-- Deleting these markers makes a later expansion wait until the functions are re-granted.
DO $$
BEGIN
  IF to_regclass('drip.schema_migrations') IS NOT NULL THEN
    DELETE FROM drip.schema_migrations
     WHERE version IN ('024_auto_onboard_role_grants.sql',
                       '033_journeys_role_grants.sql',
                       '053_presence_role_grants.sql');
  END IF;
END $$;
SQL
  then
    echo "finalize_db_module_privileges: dashboard privilege shrink failed" >&2
    return 1
  fi
  echo "dashboard_privileges_finalized"
}

# apply_owner_migrations <compose_dir> [enabled_modules_csv]
#   Applies each *_role_grants.sql required by the exact module selection as Chatwoot's
#   database owner, in bytewise filename order, only after the engine has finished its
#   selected ordinary schema migrations. Each successful
#   file is recorded in drip.schema_migrations, so migrate.js can distinguish "the installer
#   applied this owner migration" from "it was silently skipped" on every later boot.
#
#   The SQL files are deliberately idempotent. If the process is interrupted after SQL is
#   applied but before its marker is inserted, a rerun safely applies the file again and then
#   records it. Returns non-zero on readiness timeout, any SQL error, or marker-write error.
apply_owner_migrations() {
  local compose_dir="$1"
  local enabled_modules_csv="${2:-import,sequences,enhancements}"
  [ -n "$compose_dir" ] || { echo "apply_owner_migrations: compose_dir required" >&2; return 1; }

  local pg_container
  pg_container="$(detect_service_container "$compose_dir" postgres)" || {
    echo "apply_owner_migrations: could not detect the postgres container" >&2
    return 1
  }

  local pg_user pg_db
  pg_user="$(read_env_var "$compose_dir" POSTGRES_USERNAME)" || pg_user="postgres"
  pg_db="$(read_env_var "$compose_dir" POSTGRES_DATABASE)" || pg_db="chatwoot"
  local psql=(docker exec -i "$pg_container" psql -U "$pg_user" -d "$pg_db")

  local migrations_dir
  migrations_dir="$(_cwpt_db_root)/modules/sequences/engine/migrations"
  local -a owner_migrations=()
  local migration filename latest_engine=""

  # Glob order depends on locale. Explicit LC_ALL=C sort makes clean installs and upgrades
  # apply the same sequence everywhere, including hosts with a Hebrew locale.
  while IFS= read -r migration; do
    [ -n "$migration" ] || continue
    filename="$(basename "$migration")"
    if [[ ",${enabled_modules_csv}," == *",sequences,"* ]] ||
       { [[ ",${enabled_modules_csv}," == *",enhancements,"* ]] && [[ "$filename" == 051_* ]]; }; then
      owner_migrations+=("$migration")
    fi
  done < <(find "$migrations_dir" -maxdepth 1 -type f -name '*_role_grants.sql' -print | LC_ALL=C sort)
  if [ "${#owner_migrations[@]}" -eq 0 ]; then
    echo "apply_owner_migrations: no owner migrations found" >&2
    return 1
  fi

  if [[ ",${enabled_modules_csv}," == *",sequences,"* ]]; then
    while IFS= read -r filename; do
      [ -n "$filename" ] && latest_engine="$filename"
    done < <(find "$migrations_dir" -maxdepth 1 -type f -name '*.sql' ! -name '*_role_grants.sql' -exec basename {} \; | LC_ALL=C sort)
  elif [[ ",${enabled_modules_csv}," == *",enhancements,"* ]]; then
    latest_engine="048_campaign_resend_experiments.sql"
    [ -f "${migrations_dir}/${latest_engine}" ] || latest_engine=""
  fi
  if [ -z "$latest_engine" ]; then
    echo "apply_owner_migrations: no engine migrations found" >&2
    return 1
  fi

  local ready="" attempt
  local attempts="${CWPT_MIGRATION_WAIT_ATTEMPTS:-30}"
  local sleep_seconds="${CWPT_MIGRATION_WAIT_SLEEP_SECONDS:-2}"
  for ((attempt = 1; attempt <= attempts; attempt++)); do
    ready="$("${psql[@]}" -tAc "SELECT 1 FROM drip.schema_migrations WHERE version='${latest_engine}'" 2>/dev/null | tr -d '[:space:]')" || ready=""
    [ "$ready" = "1" ] && break
    if [ "$attempt" -lt "$attempts" ]; then
      sleep "$sleep_seconds"
    fi
  done
  if [ "$ready" != "1" ]; then
    echo "apply_owner_migrations: engine schema did not reach ${latest_engine} in time" >&2
    return 1
  fi

  for migration in "${owner_migrations[@]}"; do
    filename="$(basename "$migration")"
    [[ "$filename" =~ ^[A-Za-z0-9_.-]+$ ]] || {
      echo "apply_owner_migrations: unsafe migration filename" >&2
      return 1
    }
    if ! "${psql[@]}" -v ON_ERROR_STOP=1 -f /dev/stdin < "$migration" >/dev/null 2>&1; then
      echo "apply_owner_migrations: ${filename} failed" >&2
      return 1
    fi
    if ! "${psql[@]}" -v ON_ERROR_STOP=1 -c \
      "INSERT INTO drip.schema_migrations(version, applied_at) VALUES ('${filename}', now()) ON CONFLICT (version) DO UPDATE SET applied_at=EXCLUDED.applied_at" \
      >/dev/null 2>&1
    then
      echo "apply_owner_migrations: could not record ${filename}" >&2
      return 1
    fi
    echo "owner_migration_applied:${filename}"
  done

  echo "OWNER_MIGRATIONS_DONE"
}
