#!/usr/bin/env bash
#
# sync-servers.sh — builds once and deploys the addon to every Chatwoot server.
#
# The two servers were installed differently and CANNOT be unified: the main server's
# container is named drip-engine, and both docker-compose (JOURNEY_HOOK_BASE:
# http://drip-engine:3100) and Caddy (handle_path /drip/*, /cw-import/*) are wired to that
# name and base path. Renaming it to match אדמון would break journeys, the panel route and
# the import button on a live production server. So instead of one layout, one script that
# knows both:
#
#   main server (chatwoot)   flat:      /opt/chatwoot/engine/{src,migrations}, webapp/dist
#                            container:  drip-engine        base: /drip
#   אדמון (chatwoot_admon)   modular:   /opt/chatwoot/chatwoot-power-tools/modules/...
#                            container:  cwpt-engine        base: /chatwoot-addons
#                            ⚠️ requires BOTH compose files or the build skips it silently
#
# Drift detection is the point as much as deployment. The Rails initializer lived only on
# the servers for months and quietly forked: the main server gained ledger writes and a
# delivery-status hook in July while אדמון stayed on a June build, and a later "fix"
# deployed to אדמון was actually a regression against the main server. Nobody could see it
# because nothing compared the two. This script refuses to overwrite a file that differs
# from git unless you say so explicitly — and, since the 5.8.26 downgrade, refuses to touch
# a file whose server version was deployed from ANOTHER branch: a deploy writes only files
# that are missing or older-on-this-branch, never siblings it does not own.
#
# What gets deployed is what is COMMITTED — the script does not build. Every webapp build
# stamps fresh timestamped asset names, so building here would ship a dist that exists on
# no branch, which is the same "running code nobody can trace" problem in a new costume.
# Build and commit first, then deploy.
#
# Usage:
#   ./sync-servers.sh --check              # compare only, change nothing (start here)
#   ./sync-servers.sh                      # deploy committed state + restart + verify
#   ./sync-servers.sh --server chatwoot    # one server only
#   ./sync-servers.sh --force              # proceed despite drift or a dirty tree
#
set -euo pipefail

# AppleDouble (._*) files must never reach the servers (30.07: they rode a deploy into the
# cwpt-engine image). Two mechanisms, two guards: COPYFILE_DISABLE stops macOS tar from
# emitting them as metadata sidecars, and --exclude='._*' on the tar calls below stops real
# ._ files lying on the local disk (unzip/SMB/AirDrop leftovers) from being archived.
export COPYFILE_DISABLE=1

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SEQ="$REPO_ROOT/modules/sequences"
PATCH_SRC="$SEQ/deploy/chatwoot-initializers/whatsapp_campaign_conversations.rb"
PATCH_DEST="/opt/chatwoot/custom-initializers/whatsapp_campaign_conversations.rb"
SERVERS=(chatwoot chatwoot_admon)

CHECK_ONLY=0
FORCE=0
ONLY_SERVER=""
# Set by check_drift per server: 0 = the initializer must not be written (already matches
# git, or the server runs another branch's version).
PATCH_DEPLOY=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) CHECK_ONLY=1; shift ;;
    --force) FORCE=1; shift ;;
    --server) ONLY_SERVER="$2"; shift 2 ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$ONLY_SERVER" ]] && SERVERS=("$ONLY_SERVER")

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[33m  ⚠ %s\033[0m\n' "$*"; }
ok() { printf '\033[32m  ✓ %s\033[0m\n' "$*"; }
die() { printf '\033[31m  ✗ %s\033[0m\n' "$*" >&2; exit 1; }

md5_of() { md5 -q "$1" 2>/dev/null || md5sum "$1" | awk '{print $1}'; }
remote_md5() { ssh "$1" "sudo md5sum '$2' 2>/dev/null | awk '{print \$1}'"; }

# Flat install (main server) or modular install (אדמון)? Decided by what is on disk, not
# by hostname, so a re-installed server is handled correctly without editing this script.
detect_layout() {
  ssh "$1" "if sudo test -d /opt/chatwoot/chatwoot-power-tools/modules/sequences; then echo modular;
             elif sudo test -d /opt/chatwoot/engine/src; then echo flat;
             else echo unknown; fi"
}

engine_container() { [[ "$1" == modular ]] && echo cwpt-engine || echo drip-engine; }

remote_engine_src() {
  [[ "$1" == modular ]] \
    && echo /opt/chatwoot/chatwoot-power-tools/modules/sequences/engine/src \
    || echo /opt/chatwoot/engine/src
}

# Deploying an uncommitted tree puts code on a server that exists in no branch — exactly
# the drift this script is here to prevent, one step earlier in the chain.
require_clean_tree() {
  local dirty
  dirty="$(cd "$REPO_ROOT" && git status --porcelain -- modules)"
  [[ -z "$dirty" ]] && { ok "working tree clean"; return 0; }

  warn "uncommitted changes under modules/ — servers would run code that is not in git:"
  printf '%s\n' "$dirty" | head -8 | sed 's/^/      /'
  [[ $(printf '%s\n' "$dirty" | wc -l) -gt 8 ]] && echo "      …"
  [[ $FORCE -eq 1 ]] || die "commit first (or pass --force if you know what you are doing)"
  warn "--force given: deploying an uncommitted tree"
}

# Is this checksum some commit's version of the file, under a given ref? known_in_ref HEAD
# asks "an older state of THIS branch?" — safe to update. known_in_ref --all asks
# "committed anywhere?". The gap between those answers is the 5.8.26 incident: a file
# deployed from another branch is known to --all but not to HEAD, and overwriting it from
# here is a downgrade, not an update. Recent history only: a hand-edit is found
# immediately or not at all, and scanning further just costs time.
known_in_ref() {
  local ref="$1" path="$2" checksum="$3" sha
  while read -r sha; do
    [[ -z "$sha" ]] && continue
    if [[ "$(cd "$REPO_ROOT" && git show "$sha:$path" 2>/dev/null | md5_stdin)" == "$checksum" ]]; then
      return 0
    fi
  done < <(cd "$REPO_ROOT" && git log "$ref" --format=%H -n 50 -- "$path")
  return 1
}
md5_stdin() { md5 -q 2>/dev/null || md5sum | awk '{print $1}'; }

# Compares what git says against what the server actually runs. Only an UNRECOGNIZED
# version blocks: the file was edited on the server and the change exists nowhere else,
# so overwriting it would destroy the only copy.
check_drift() {
  local server="$1" layout="$2" blocking=0 behind=0 skipped=0
  local remote_src; remote_src="$(remote_engine_src "$layout")"
  local rel_patch="modules/sequences/deploy/chatwoot-initializers/whatsapp_campaign_conversations.rb"
  PATCH_DEPLOY=1

  local want have
  want="$(md5_of "$PATCH_SRC")"
  have="$(remote_md5 "$server" "$PATCH_DEST")"
  if [[ -z "$have" ]]; then
    warn "Rails patch missing on $server — will be installed"
    behind=1
  elif [[ "$want" != "$have" ]]; then
    if known_in_ref HEAD "$rel_patch" "$have"; then
      warn "Rails patch on $server is an older version of this branch — will be updated"
      behind=1
    elif known_in_ref --all "$rel_patch" "$have"; then
      # 5.8.26: overwriting an other-branch version is a downgrade, not an update.
      if [[ $FORCE -eq 1 ]]; then
        warn "--force: overwriting although $server runs another branch's version"
        behind=1
      else
        warn "Rails patch on $server was deployed from ANOTHER branch — skipped (merge it into this branch, or --force)"
        skipped=1; PATCH_DEPLOY=0
      fi
    else
      warn "Rails patch on $server matches NO commit — edited in place, and this is the only copy"
      warn "  review before overwriting:  ssh $server 'sudo cat $PATCH_DEST' | diff - $PATCH_SRC"
      blocking=1
    fi
  else
    ok "Rails patch matches git"
    PATCH_DEPLOY=0
  fi

  # Engine + webapp ship as one tar — all-or-nothing — so an other-branch version here
  # blocks the whole server instead of skipping a single file.
  for f in campaigns.js campaignCsv.js; do
    want="$(md5_of "$SEQ/engine/src/$f")"
    have="$(remote_md5 "$server" "$remote_src/$f")"
    [[ "$want" == "$have" ]] && continue
    if [[ -z "$have" ]] || known_in_ref HEAD "modules/sequences/engine/src/$f" "$have"; then
      behind=1
    elif known_in_ref --all "modules/sequences/engine/src/$f" "$have"; then
      warn "engine/src/$f on $server was deployed from ANOTHER branch — merge it into this branch first (or --force)"
      blocking=1
    else
      warn "engine/src/$f on $server matches no commit — edited in place"
      blocking=1
    fi
  done

  # dist is a build artifact with timestamped asset names, so it rarely matches across
  # builds — being behind is the normal pre-deploy state. But dist IS committed, so a
  # server dist matching ANOTHER branch's build means the panel was deployed from
  # elsewhere; replacing it from here would swap the feature set. Block, like engine.
  local container; container="$(engine_container "$layout")"
  want="$(md5_of "$SEQ/webapp/dist/index.html")"
  have="$(ssh "$server" "docker exec $container md5sum /app/webapp-dist/index.html 2>/dev/null" | awk '{print $1}')"
  if [[ -n "$have" && "$want" != "$have" ]]; then
    if ! known_in_ref HEAD "modules/sequences/webapp/dist/index.html" "$have" \
       && known_in_ref --all "modules/sequences/webapp/dist/index.html" "$have"; then
      warn "webapp dist on $server was deployed from ANOTHER branch — merge it into this branch first (or --force)"
      blocking=1
    else
      behind=1
    fi
  fi

  if [[ $blocking -eq 1 ]]; then
    return 2
  elif [[ $behind -eq 1 ]]; then
    echo "  server is behind git — will be updated"
    return 1
  elif [[ $skipped -eq 1 ]]; then
    return 3
  fi
  ok "engine + webapp match git"
  return 0
}

deploy_engine() {
  local server="$1" layout="$2"
  local tgz; tgz="$(mktemp -t cwpt).tgz"

  if [[ "$layout" == modular ]]; then
    tar --exclude=node_modules --exclude=.preview --exclude='._*' -czf "$tgz" -C "$REPO_ROOT" modules docker-compose.addons.yml
    scp -q "$tgz" "$server:/tmp/cwpt-sync.tgz"
    ssh "$server" "sudo rm -rf /opt/chatwoot/chatwoot-power-tools/modules /opt/chatwoot/chatwoot-power-tools/docker-compose.addons.yml \
      && sudo tar -C /opt/chatwoot/chatwoot-power-tools -xzf /tmp/cwpt-sync.tgz modules docker-compose.addons.yml 2>/dev/null; rm -f /tmp/cwpt-sync.tgz"
  else
    tar --exclude=node_modules --exclude='._*' -czf "$tgz" -C "$SEQ" engine/src engine/migrations webapp/dist
    scp -q "$tgz" "$server:/tmp/cwpt-sync.tgz"
    ssh "$server" "sudo rm -rf /opt/chatwoot/engine/src /opt/chatwoot/webapp/dist \
      && sudo tar -C /opt/chatwoot -xzf /tmp/cwpt-sync.tgz 2>/dev/null; rm -f /tmp/cwpt-sync.tgz"
  fi
  rm -f "$tgz"
  ok "engine + webapp copied ($layout)"
}

deploy_patch() {
  local server="$1"
  if [[ $PATCH_DEPLOY -eq 0 ]]; then
    ok "Rails initializer untouched"
    return 0
  fi
  scp -q "$PATCH_SRC" "$server:/tmp/cwpt-patch.rb"
  # Syntax-check inside the real Rails image before it can break boot.
  ssh "$server" "docker cp /tmp/cwpt-patch.rb chatwoot-rails-1:/tmp/c.rb >/dev/null && docker exec chatwoot-rails-1 ruby -c /tmp/c.rb >/dev/null" \
    || die "Ruby syntax check failed on $server — nothing installed"
  ssh "$server" "sudo cp -n $PATCH_DEST ${PATCH_DEST}.bak-\$(date +%Y%m%d%H%M) 2>/dev/null; \
    sudo install -o root -g root -m 644 /tmp/cwpt-patch.rb $PATCH_DEST && rm -f /tmp/cwpt-patch.rb"
  ok "Rails initializer installed"
}

rebuild_engine() {
  local server="$1" layout="$2"
  local container; container="$(engine_container "$layout")"
  if [[ "$layout" == modular ]]; then
    # Both -f files are mandatory: cwpt-engine is defined in the addons file, and without it
    # compose silently ignores the service and reports success.
    ssh "$server" "cd /opt/chatwoot && sudo docker compose -f docker-compose.yml -f chatwoot-power-tools/docker-compose.addons.yml -p chatwoot up -d --build $container" >/dev/null 2>&1
  else
    ssh "$server" "cd /opt/chatwoot && sudo docker compose up -d --build $container" >/dev/null 2>&1
  fi
  ok "$container rebuilt"
}

restart_rails() {
  local server="$1"
  # A campaign mid-flight would lose the rest of its audience to the restart.
  local running
  running="$(ssh "$server" "docker exec chatwoot-postgres-1 sh -c \"psql -U \\\$POSTGRES_USER -d chatwoot -Atc 'SELECT count(*) FROM campaigns WHERE campaign_status=2;'\"" 2>/dev/null | tr -d '[:space:]')"
  [[ "$running" == "0" ]] || die "$server has $running campaign(s) mid-run — refusing to restart Rails"
  ssh "$server" "sudo docker restart chatwoot-sidekiq-1 chatwoot-rails-1" >/dev/null 2>&1
  ok "rails + sidekiq restarted"
}

wait_healthy() {
  local server="$1" container="$2" tries=0
  until ssh "$server" "docker ps --filter name=$container --format '{{.Status}}' | grep -q healthy" 2>/dev/null; do
    tries=$((tries + 1)); [[ $tries -gt 60 ]] && die "$container on $server never became healthy"
    sleep 5
  done
  ok "$container healthy"
}

verify() {
  local server="$1" layout="$2"
  local container; container="$(engine_container "$layout")"
  local want have
  want="$(md5_of "$SEQ/engine/src/campaigns.js")"
  have="$(ssh "$server" "docker exec $container md5sum /app/src/campaigns.js" 2>/dev/null | awk '{print $1}')"
  [[ "$want" == "$have" ]] || die "$server runs different engine code than git ($have vs $want)"
  ok "running engine matches git"

  ssh "$server" "docker exec chatwoot-sidekiq-1 bundle exec rails runner \"
    svc = Whatsapp::OneoffCampaignService
    raise 'patch not applied' unless svc.instance_method(:send_whatsapp_template_message).parameters.map(&:last) == [:to, :template_params, :error_sink]
    raise 'status hook missing' unless Whatsapp::IncomingMessageBaseService.ancestors.include?(WhatsappCampaignIncomingStatusPatch)
    actions = AutomationRule.new.actions_attributes
    raise 'mobile bot assign action missing' unless actions.include?('assign_agent_bot_for_campaign_contact')
    raise 'mobile bot unassign action missing' unless actions.include?('remove_specific_agent_bot')
    raise 'automation action patch missing' unless AutomationRules::ActionService.ancestors.include?(WhatsappCampaignAutomationActionService)
    raise 'macro bot unassign action missing' unless Macro::ACTIONS_ATTRS.include?('remove_specific_agent_bot')
    raise 'macro action patch missing' unless Macros::ExecutionService.ancestors.include?(WhatsappCampaignAutomationActionService)
    raise 'macro assignee patch missing' unless Macros::ExecutionService.ancestors.include?(WhatsappCampaignMacroActionService)
  \"" >/dev/null 2>&1 || die "$server: campaign patch is not active"
  ok "campaign patch active"
}

# ── run ──────────────────────────────────────────────────────────────────────
[[ $CHECK_ONLY -eq 0 ]] && require_clean_tree

FAILED=0
for server in "${SERVERS[@]}"; do
  say "$server"
  layout="$(detect_layout "$server")"
  [[ "$layout" == unknown ]] && die "$server: no recognizable addon install"
  echo "  layout: $layout · container: $(engine_container "$layout")"

  set +e; check_drift "$server" "$layout"; drift_state=$?; set -e
  # 0 = in sync · 1 = behind git (normal, deploy fixes it) · 2 = edited on the server
  # 3 = only other-branch files differ — nothing this branch may deploy
  if [[ $drift_state -eq 2 ]]; then
    FAILED=1
    if [[ $FORCE -eq 0 ]]; then
      warn "skipping $server — re-run with --force to overwrite, after reviewing the diff above"
      continue
    fi
    warn "--force given: overwriting a server-only edit"
  fi
  if [[ $drift_state -eq 3 ]]; then
    FAILED=1
    [[ $CHECK_ONLY -eq 1 ]] && continue
    warn "skipping $server — only other-branch files differ; merge that branch here first (or --force)"
    continue
  fi
  if [[ $CHECK_ONLY -eq 1 ]]; then
    [[ $drift_state -eq 1 ]] && FAILED=1
    continue
  fi

  deploy_engine "$server" "$layout"
  deploy_patch "$server"
  rebuild_engine "$server" "$layout"
  wait_healthy "$server" "$(engine_container "$layout")"
  restart_rails "$server"
  # Both, and rails last: sidekiq goes healthy well before rails finishes booting, so
  # waiting only on sidekiq hands back a server that still answers 503 to the panel.
  wait_healthy "$server" chatwoot-sidekiq-1
  wait_healthy "$server" chatwoot-rails-1
  verify "$server" "$layout"
done

if [[ $CHECK_ONLY -eq 1 ]]; then
  [[ $FAILED -eq 0 ]] && say "All servers match git" || say "Drift found — see warnings above"
else
  say "Done"
fi
exit $FAILED
