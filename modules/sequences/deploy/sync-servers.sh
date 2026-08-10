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
# That sentence used to be a promise the code did not keep: until 10.08.26 every path here
# read the working tree — `tar -C "$REPO_ROOT" modules` and an scp of the .rb straight off
# disk — so a half-finished edit from a parallel session rode a deploy into production, and
# .gitignored build output (modules/smart-import/dist) shipped to אדמון from no branch at
# all. Now packing goes through `git archive HEAD`, the initializers are read with
# `git show HEAD:`, and every "matches git" comparison uses head_md5. The working tree is
# no longer an input to a deploy — only to the warning that tells you to commit.
#
# Usage:
#   ./sync-servers.sh --check              # compare only, change nothing (start here)
#   ./sync-servers.sh                      # deploy committed state + restart + verify
#   ./sync-servers.sh --server chatwoot    # one server only
#   ./sync-servers.sh --force              # proceed despite drift (still deploys HEAD)
#
set -euo pipefail

# AppleDouble (._*) files must never reach the servers (30.07: they rode a deploy into the
# cwpt-engine image). git archive is the guard now — it emits tracked blobs only, so a ._
# file lying on the local disk (unzip/SMB/AirDrop leftover) cannot be picked up at all, and
# macOS tar is no longer in the path to invent one. A committed ._ file would still ship;
# nothing tracks one today, and it would be a repo problem, visible in review.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
# כל קובצי ה-.rb שמחויבים ב-HEAD מועמדים לפריסה — initializer חדש בריפו מצטרף מעצמו, וקובץ
# שקיים רק על הדיסק אינו מועמד כלל. נכתבים בפועל רק קבצים שחסרים בשרת או שגרסתם שם ישנה של
# הברנץ' הזה; גרסה מברנץ' אחר מדולגת (known_in_ref). הנתיב יחסי-לריפו בכוונה — כל הגישה
# לקבצים כאן היא דרך git, לא דרך הדיסק.
PATCH_REL_DIR="modules/sequences/deploy/chatwoot-initializers"
PATCH_DEST_DIR="/opt/chatwoot/custom-initializers"
SERVERS=(chatwoot chatwoot_admon)

CHECK_ONLY=0
FORCE=0
ONLY_SERVER=""
# Filled by check_drift per server: newline-separated basenames. deploy_patch writes ONLY
# DEPLOY_PATCHES; SKIP_PATCHES are other-branch versions it refuses to touch.
DEPLOY_PATCHES=""
SKIP_PATCHES=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) CHECK_ONLY=1; shift ;;
    --force) FORCE=1; shift ;;
    --server) ONLY_SERVER="$2"; shift 2 ;;
    -h|--help) sed -n '2,45p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$ONLY_SERVER" ]] && SERVERS=("$ONLY_SERVER")

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[33m  ⚠ %s\033[0m\n' "$*"; }
ok() { printf '\033[32m  ✓ %s\033[0m\n' "$*"; }
die() { printf '\033[31m  ✗ %s\033[0m\n' "$*" >&2; exit 1; }

remote_md5() { ssh "$1" "sudo md5sum '$2' 2>/dev/null | awk '{print \$1}'"; }

# md5 of a repo-relative path AS COMMITTED. Every "does the server match git?" comparison
# goes through this, so a green --check means the server matches HEAD — not "matches
# whatever happens to be on my disk right now". There is deliberately no working-tree
# equivalent left in this file: one existed, and it is what let the tree reach production.
# Missing in HEAD is fatal by design — silently comparing against an empty blob is how you
# deploy an empty file.
# (pipefail is what makes the failing git show propagate through the md5 pipe.)
head_md5() {
  local out
  out="$(cd "$REPO_ROOT" && git show "HEAD:$1" 2>/dev/null | md5_stdin)" \
    || die "$1 is not committed in HEAD — commit it, or it cannot be deployed"
  printf '%s' "$out"
}

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

# A dirty tree can no longer reach a server — the deploy reads HEAD. The hard stop stays
# for the opposite failure: you deploy, watch it succeed, and your uncommitted fix is not
# in it. Scope covers docker-compose.addons.yml too, since the modular deploy ships it.
require_clean_tree() {
  local dirty
  dirty="$(cd "$REPO_ROOT" && git status --porcelain -- modules docker-compose.addons.yml)"
  [[ -z "$dirty" ]] && { ok "working tree clean"; return 0; }

  warn "uncommitted changes in the deploy scope — these will NOT be deployed:"
  printf '%s\n' "$dirty" | head -8 | sed 's/^/      /'
  [[ $(printf '%s\n' "$dirty" | wc -l) -gt 8 ]] && echo "      …"
  [[ $FORCE -eq 1 ]] || die "commit first (or pass --force to deploy HEAD and leave them behind)"
  warn "--force given: deploying HEAD — the changes listed above stay on your disk"
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
  local server="$1" layout="$2" blocking=0 behind=0
  local remote_src; remote_src="$(remote_engine_src "$layout")"
  local rails_initializer_mounts sidekiq_initializer_mounts
  rails_initializer_mounts="$(ssh "$server" "docker inspect --format '{{range .Mounts}}{{println .Destination}}{{end}}' chatwoot-rails-1 2>/dev/null" || true)"
  sidekiq_initializer_mounts="$(ssh "$server" "docker inspect --format '{{range .Mounts}}{{println .Destination}}{{end}}' chatwoot-sidekiq-1 2>/dev/null" || true)"
  local want have patch_ok=1
  # Rebuilt per server. A file whose server copy already matches git is not listed at
  # all — deploy_patch leaves it completely untouched (no rewrite, no .bak).
  DEPLOY_PATCHES=""
  SKIP_PATCHES=""
  # Candidates come from HEAD, not from the directory listing: an uncommitted .rb sitting
  # in the deploy folder is not deployable, so it must not appear as one here either.
  while IFS= read -r rel_patch; do
    [[ -z "$rel_patch" ]] && continue
    local base dest mount_target
    base="${rel_patch##*/}"
    dest="$PATCH_DEST_DIR/$base"
    mount_target="/app/config/initializers/$base"
    want="$(head_md5 "$rel_patch")"
    have="$(remote_md5 "$server" "$dest")"
    if [[ -z "$have" ]]; then
      warn "Rails patch $base missing on $server — will be installed"
      behind=1; patch_ok=0; DEPLOY_PATCHES+="$base"$'\n'
    elif [[ "$want" != "$have" ]]; then
      if known_in_ref HEAD "$rel_patch" "$have"; then
        warn "Rails patch $base on $server is an older version of this branch — will be updated"
        behind=1; patch_ok=0; DEPLOY_PATCHES+="$base"$'\n'
      elif known_in_ref --all "$rel_patch" "$have"; then
        # 5.8.26: exactly this case downgraded whatsapp_campaign_conversations.rb in
        # production — a journey deploy from this branch "updated" the newer
        # codex/campaign-assignee version backwards. Not ours to overwrite.
        if [[ $FORCE -eq 1 ]]; then
          warn "--force: overwriting $base although $server runs another branch's version"
          behind=1; patch_ok=0; DEPLOY_PATCHES+="$base"$'\n'
        else
          warn "Rails patch $base on $server was deployed from ANOTHER branch — skipped (merge it into this branch, or --force)"
          patch_ok=0; SKIP_PATCHES+="$base"$'\n'
        fi
      else
        warn "Rails patch $base on $server matches NO commit — edited in place, and this is the only copy"
        warn "  review before overwriting:  ssh $server 'sudo cat $dest' | diff - <(git show HEAD:$rel_patch)"
        blocking=1; patch_ok=0
      fi
    fi
    if ! grep -Fqx "$mount_target" <<< "$rails_initializer_mounts"; then
      warn "Rails patch $base exists on $server but is not mounted into chatwoot-rails-1"
      warn "  add $dest:$mount_target:ro to the rails volumes before deploying"
      blocking=1; patch_ok=0
    fi
    if ! grep -Fqx "$mount_target" <<< "$sidekiq_initializer_mounts"; then
      warn "Rails patch $base exists on $server but is not mounted into chatwoot-sidekiq-1"
      warn "  add $dest:$mount_target:ro to the sidekiq volumes before deploying"
      blocking=1; patch_ok=0
    fi
  done < <(cd "$REPO_ROOT" && git ls-tree -r --name-only HEAD -- "$PATCH_REL_DIR" | grep '\.rb$')
  [[ $patch_ok -eq 1 ]] && ok "Rails patches match git"

  # Engine + webapp ship as one tar — all-or-nothing — so an other-branch version here
  # blocks the whole server instead of skipping a single file.
  for f in campaigns.js campaignCsv.js; do
    want="$(head_md5 "modules/sequences/engine/src/$f")"
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
  want="$(head_md5 "modules/sequences/webapp/dist/index.html")"
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
  elif [[ -n "$SKIP_PATCHES" ]]; then
    return 3
  fi
  ok "engine + webapp match git"
  return 0
}

deploy_engine() {
  local server="$1" layout="$2"
  local tgz; tgz="$(mktemp -t cwpt).tgz"

  # git archive, not tar: the archive is built from HEAD's tree, so nothing uncommitted and
  # nothing .gitignored can enter it. That also retires the old --exclude list — node_modules,
  # .preview and smart-import/dist are ignored files, absent from HEAD by construction.
  # Member paths are unchanged, so the remote extraction below still lands where it did.
  if [[ "$layout" == modular ]]; then
    git -C "$REPO_ROOT" archive --format=tar.gz -o "$tgz" HEAD modules docker-compose.addons.yml
    scp -q "$tgz" "$server:/tmp/cwpt-sync.tgz"
    ssh "$server" "sudo rm -rf /opt/chatwoot/chatwoot-power-tools/modules /opt/chatwoot/chatwoot-power-tools/docker-compose.addons.yml \
      && sudo tar -C /opt/chatwoot/chatwoot-power-tools -xzf /tmp/cwpt-sync.tgz modules docker-compose.addons.yml 2>/dev/null; rm -f /tmp/cwpt-sync.tgz"
  else
    git -C "$REPO_ROOT" archive --format=tar.gz -o "$tgz" HEAD:modules/sequences engine/src engine/migrations webapp/dist
    scp -q "$tgz" "$server:/tmp/cwpt-sync.tgz"
    ssh "$server" "sudo rm -rf /opt/chatwoot/engine/src /opt/chatwoot/webapp/dist \
      && sudo tar -C /opt/chatwoot -xzf /tmp/cwpt-sync.tgz 2>/dev/null; rm -f /tmp/cwpt-sync.tgz"
  fi
  rm -f "$tgz"
  ok "engine + webapp copied from HEAD ($layout)"
}

deploy_patch() {
  local server="$1"
  local base dest
  if [[ -z "$DEPLOY_PATCHES" ]]; then
    ok "Rails initializers already match — nothing written"
    return 0
  fi
  # Same rule as the engine tar: the bytes come from HEAD, never off the disk. Materialised
  # into a temp file because scp needs a path, not a stream.
  local staged; staged="$(mktemp -t cwpt-patch)"
  trap 'rm -f "$staged"' RETURN
  while IFS= read -r base; do
    [[ -z "$base" ]] && continue
    dest="$PATCH_DEST_DIR/$base"
    git -C "$REPO_ROOT" show "HEAD:$PATCH_REL_DIR/$base" > "$staged" \
      || die "$base vanished from HEAD between check and deploy — nothing installed"
    scp -q "$staged" "$server:/tmp/cwpt-patch.rb"
    # Syntax-check inside the real Rails image before it can break boot.
    ssh -n "$server" "docker cp /tmp/cwpt-patch.rb chatwoot-rails-1:/tmp/c.rb >/dev/null && docker exec chatwoot-rails-1 ruby -c /tmp/c.rb >/dev/null" \
      || die "Ruby syntax check failed on $server ($base) — nothing installed"
    ssh -n "$server" "sudo cp -n $dest ${dest}.bak-\$(date +%Y%m%d%H%M) 2>/dev/null; \
      sudo install -o root -g root -m 644 /tmp/cwpt-patch.rb $dest && rm -f /tmp/cwpt-patch.rb"
  done <<< "$DEPLOY_PATCHES"
  ok "Rails initializers installed: $(printf '%s' "$DEPLOY_PATCHES" | tr '\n' ' ')"
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
  local want have rel_patch base initializer_container
  want="$(head_md5 "modules/sequences/engine/src/campaigns.js")"
  have="$(ssh "$server" "docker exec $container md5sum /app/src/campaigns.js" 2>/dev/null | awk '{print $1}')"
  [[ "$want" == "$have" ]] || die "$server runs different engine code than HEAD ($have vs $want)"
  ok "running engine matches git"

  while IFS= read -r rel_patch; do
    [[ -z "$rel_patch" ]] && continue
    base="${rel_patch##*/}"
    want="$(head_md5 "$rel_patch")"
    for initializer_container in chatwoot-rails-1 chatwoot-sidekiq-1; do
      have="$(ssh "$server" "docker exec $initializer_container md5sum /app/config/initializers/$base 2>/dev/null" | awk '{print $1}')"
      [[ "$want" == "$have" ]] || die "$server: $base is not mounted from HEAD in $initializer_container"
    done
  done < <(cd "$REPO_ROOT" && git ls-tree -r --name-only HEAD -- "$PATCH_REL_DIR" | grep '\.rb$')
  ok "all repository initializers mounted in Rails + Sidekiq"

  # 4.17 enterprise-graft (native-first, 20.8.26): the prepend itself is the proof; the
  # signature check catches the next upstream reshape before it silently disables us again.
  ssh "$server" "docker exec chatwoot-sidekiq-1 bundle exec rails runner \"
    svc = Whatsapp::OneoffCampaignService
    raise 'patch not applied' unless svc.ancestors.include?(WhatsappCampaignGraft417)
    raise 'signature drift' unless svc.instance_method(:send_whatsapp_template_message).parameters.map(&:last) == [:recipient, :to, :template_params]
    analytics_controller = Api::V1::Accounts::Campaigns::AnalyticsController
    raise 'legacy analytics adapter not loaded' unless defined?(LegacyCampaignAnalytics417)
    raise 'legacy analytics controller patch not active' unless analytics_controller.ancestors.include?(LegacyCampaignAnalyticsController417)
  \"" >/dev/null 2>&1 || die "$server: campaign patch is not active"
  ok "campaign patch + legacy analytics adapter active"
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
