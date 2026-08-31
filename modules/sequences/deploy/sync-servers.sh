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
# Pin one immutable commit for the whole run. Reading symbolic HEAD repeatedly permits a
# concurrent commit to produce a mixed deployment (archive from one commit, initializers
# from the next). Every git read below uses this object id; require_pinned_head aborts if
# the checkout moves before a server is changed.
DEPLOY_COMMIT=""
DEPLOY_ID=""
# כל קובצי ה-.rb שמחויבים ב-HEAD מועמדים לפריסה — initializer חדש בריפו מצטרף מעצמו, וקובץ
# שקיים רק על הדיסק אינו מועמד כלל. נכתבים בפועל רק קבצים שחסרים בשרת או שגרסתם שם ישנה של
# הברנץ' הזה; גרסה מברנץ' אחר מדולגת (known_in_ref). הנתיב יחסי-לריפו בכוונה — כל הגישה
# לקבצים כאן היא דרך git, לא דרך הדיסק.
PATCH_REL_DIR="modules/sequences/deploy/chatwoot-initializers"
PATCH_DEST_DIR="/opt/chatwoot/custom-initializers"
ALLOWED_SERVERS=(chatwoot chatwoot_admon)
SERVERS=("${ALLOWED_SERVERS[@]}")

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
    --server)
      [[ $# -ge 2 ]] || { echo "--server requires a value" >&2; exit 2; }
      ONLY_SERVER="$2"; shift 2 ;;
    -h|--help) sed -n '2,45p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
if [[ -n "$ONLY_SERVER" ]]; then
  case "$ONLY_SERVER" in
    chatwoot|chatwoot_admon) SERVERS=("$ONLY_SERVER") ;;
    *) echo "unknown server: $ONLY_SERVER (allowed: chatwoot, chatwoot_admon)" >&2; exit 2 ;;
  esac
fi

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[33m  ⚠ %s\033[0m\n' "$*"; }
ok() { printf '\033[32m  ✓ %s\033[0m\n' "$*"; }
die() { printf '\033[31m  ✗ %s\033[0m\n' "$*" >&2; exit 1; }

remote_md5() { ssh -n "$1" "sudo md5sum '$2' 2>/dev/null | awk '{print \$1}'"; }

init_deploy_commit() {
  DEPLOY_COMMIT="$(git -C "$REPO_ROOT" rev-parse --verify 'HEAD^{commit}')" \
    || die "cannot resolve repository HEAD"
  [[ "$DEPLOY_COMMIT" =~ ^[0-9a-f]{40}$ ]] \
    || die "unexpected git object id: $DEPLOY_COMMIT"
  # Timestamp prevents a long-lived backup from colliding when the OS later reuses a PID
  # for another deployment of the same commit.
  DEPLOY_ID="${DEPLOY_COMMIT:0:12}-$(date -u +%Y%m%d%H%M%S)-$$"
}

# One deployment runs at a time inside this process. These globals let the top-level EXIT
# trap clean local and remote transport files even when scp/ssh is interrupted halfway.
# Remote removal is allowed only for a path returned by our tightly-scoped mktemp pattern.
LOCAL_DEPLOY_TMP=""
REMOTE_DEPLOY_SERVER=""
REMOTE_DEPLOY_TMP=""

cleanup_deploy_temps() {
  local status=$?
  if [[ -n "$REMOTE_DEPLOY_TMP" \
        && "$REMOTE_DEPLOY_TMP" =~ ^/tmp/cwpt-sync\.[A-Za-z0-9]+$ \
        && ( "$REMOTE_DEPLOY_SERVER" == chatwoot || "$REMOTE_DEPLOY_SERVER" == chatwoot_admon ) ]]; then
    ssh "$REMOTE_DEPLOY_SERVER" "docker exec chatwoot-rails-1 rm -f -- '/tmp/cwpt-patch-$DEPLOY_ID.rb' >/dev/null 2>&1 || true; \
      rm -rf -- '$REMOTE_DEPLOY_TMP'" >/dev/null 2>&1 || true
  fi
  REMOTE_DEPLOY_SERVER=""
  REMOTE_DEPLOY_TMP=""
  if [[ -n "$LOCAL_DEPLOY_TMP" ]]; then
    rm -f -- "$LOCAL_DEPLOY_TMP" 2>/dev/null || true
  fi
  LOCAL_DEPLOY_TMP=""
  return "$status"
}

require_pinned_head() {
  local current
  current="$(git -C "$REPO_ROOT" rev-parse --verify 'HEAD^{commit}')" \
    || die "cannot resolve repository HEAD"
  [[ "$current" == "$DEPLOY_COMMIT" ]] \
    || die "HEAD moved during deployment ($DEPLOY_COMMIT -> $current); start again"
}

# md5 of a repo-relative path AS COMMITTED. Every "does the server match git?" comparison
# goes through this, so a green --check means the server matches the HEAD pinned at start — not "matches
# whatever happens to be on my disk right now". There is deliberately no working-tree
# equivalent left in this file: one existed, and it is what let the tree reach production.
# Missing in HEAD is fatal by design — silently comparing against an empty blob is how you
# deploy an empty file.
# (pipefail is what makes the failing git show propagate through the md5 pipe.)
head_md5() {
  local out
  out="$(cd "$REPO_ROOT" && git show "$DEPLOY_COMMIT:$1" 2>/dev/null | md5_stdin)" \
    || die "$1 is not committed in $DEPLOY_COMMIT — commit it, or it cannot be deployed"
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
      if known_in_ref "$DEPLOY_COMMIT" "$rel_patch" "$have"; then
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
        warn "  review before overwriting:  ssh $server 'sudo cat $dest' | diff - <(git show $DEPLOY_COMMIT:$rel_patch)"
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
  done < <(cd "$REPO_ROOT" && git ls-tree -r --name-only "$DEPLOY_COMMIT" -- "$PATCH_REL_DIR" | grep '\.rb$')
  [[ $patch_ok -eq 1 ]] && ok "Rails patches match git"

  # Engine + webapp ship as one tar — all-or-nothing — so an other-branch version here
  # blocks the whole server instead of skipping a single file.
  for f in campaigns.js campaignCsv.js; do
    want="$(head_md5 "modules/sequences/engine/src/$f")"
    have="$(remote_md5 "$server" "$remote_src/$f")"
    [[ "$want" == "$have" ]] && continue
    if [[ -z "$have" ]] || known_in_ref "$DEPLOY_COMMIT" "modules/sequences/engine/src/$f" "$have"; then
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
    if ! known_in_ref "$DEPLOY_COMMIT" "modules/sequences/webapp/dist/index.html" "$have" \
       && known_in_ref --all "modules/sequences/webapp/dist/index.html" "$have"; then
      warn "webapp dist on $server was deployed from ANOTHER branch — merge it into this branch first (or --force)"
      blocking=1
    else
      behind=1
    fi
  fi

  # The modular server consumes this file at rebuild time. Treat it as deployed state,
  # not as an incidental transport file: unknown/server-only edits block, an older version
  # of this branch is updated, and a sibling branch is never silently replaced.
  if [[ "$layout" == modular ]]; then
    local compose_rel="docker-compose.addons.yml"
    local compose_dest="/opt/chatwoot/chatwoot-power-tools/docker-compose.addons.yml"
    want="$(head_md5 "$compose_rel")"
    have="$(remote_md5 "$server" "$compose_dest")"
    if [[ -z "$have" ]]; then
      warn "docker-compose.addons.yml missing on $server — will be installed"
      behind=1
    elif [[ "$want" != "$have" ]]; then
      if known_in_ref "$DEPLOY_COMMIT" "$compose_rel" "$have"; then
        warn "docker-compose.addons.yml on $server is older than the pinned commit — will be updated"
        behind=1
      elif known_in_ref --all "$compose_rel" "$have"; then
        warn "docker-compose.addons.yml on $server comes from ANOTHER branch — merge it first (or --force)"
        blocking=1
      else
        warn "docker-compose.addons.yml on $server matches no commit — edited in place"
        blocking=1
      fi
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

archive_has_member() {
  # Read the full listing instead of grep -q: under pipefail an early grep exit can SIGPIPE
  # tar on the real (large) modular archive and turn a valid payload into a false failure.
  tar -tzf "$1" | awk -v want="$2" '$0 == want { found=1 } END { exit !found }'
}

build_deploy_archive() {
  local layout="$1" archive="$2"
  case "$layout" in
    modular)
      git -C "$REPO_ROOT" archive --format=tar.gz -o "$archive" "$DEPLOY_COMMIT" \
        modules docker-compose.addons.yml
      archive_has_member "$archive" 'modules/sequences/engine/src/campaigns.js' \
        || die "committed modular archive has no sequences engine"
      archive_has_member "$archive" 'modules/sequences/webapp/dist/index.html' \
        || die "committed modular archive has no webapp build"
      archive_has_member "$archive" 'docker-compose.addons.yml' \
        || die "committed modular archive has no docker-compose.addons.yml"
      ;;
    flat)
      git -C "$REPO_ROOT" archive --format=tar.gz -o "$archive" \
        "$DEPLOY_COMMIT:modules/sequences" engine/src engine/migrations webapp/dist
      archive_has_member "$archive" 'engine/src/campaigns.js' \
        || die "committed flat archive has no sequences engine"
      archive_has_member "$archive" 'webapp/dist/index.html' \
        || die "committed flat archive has no webapp build"
      ;;
    *) die "refusing unknown deployment layout: $layout" ;;
  esac

  # git archive cannot emit working-tree junk, but a mistakenly committed AppleDouble file
  # is still a repository error and must not enter an image.
  if tar -tzf "$archive" | awk -F/ '$NF ~ /^\._/ { found=1 } END { exit !found }'; then
    die "committed archive contains AppleDouble files (._*)"
  fi
}

prepare_remote_tmp() {
  local server="$1" candidate
  candidate="$(ssh "$server" 'mktemp -d /tmp/cwpt-sync.XXXXXXXX')" \
    || die "$server: could not create a remote staging directory"
  [[ "$candidate" =~ ^/tmp/cwpt-sync\.[A-Za-z0-9]+$ ]] \
    || die "$server returned an unsafe staging path: $candidate"
  REMOTE_DEPLOY_SERVER="$server"
  REMOTE_DEPLOY_TMP="$candidate"
}

apply_remote_payload() {
  local server="$1" layout="$2" archive="$3"
  # The remote script accepts only a validated temporary archive, a hex/numeric deployment
  # id and one of two known layouts. All live and backup paths are hardcoded below; no
  # caller-controlled path can reach rm/mv. Existing state is MOVED into a durable backup
  # before replacement. Any error during the swap restores it and removes staging.
  ssh "$server" "sudo bash -s -- '$archive' '$DEPLOY_ID' '$layout'" <<'CWPT_REMOTE_APPLY'
set -Eeuo pipefail

archive="$1"
deploy_id="$2"
layout="$3"
[[ "$archive" =~ ^/tmp/cwpt-sync\.[A-Za-z0-9]+/payload\.tgz$ ]] || {
  echo "unsafe archive path" >&2; exit 2;
}
[[ "$deploy_id" =~ ^[0-9a-f]{12}-[0-9]{14}-[0-9]+$ ]] || {
  echo "unsafe deployment id" >&2; exit 2;
}
[[ "$layout" == modular || "$layout" == flat ]] || {
  echo "unknown layout" >&2; exit 2;
}

stage="/opt/chatwoot/.cwpt-stage-${deploy_id}"
backup="/opt/chatwoot/backups/cwpt-deploy-${deploy_id}"
[[ ! -e "$stage" && ! -L "$stage" ]] || { echo "staging path already exists" >&2; exit 2; }
[[ ! -e "$backup" && ! -L "$backup" ]] || { echo "backup path already exists" >&2; exit 2; }

declare -a targets staged names types touched
if [[ "$layout" == modular ]]; then
  target_root="/opt/chatwoot/chatwoot-power-tools"
  [[ -d "$target_root" && ! -L "$target_root" ]] || {
    echo "modular target root is missing or unsafe" >&2; exit 2;
  }
  targets=("$target_root/modules" "$target_root/docker-compose.addons.yml")
  staged=("$stage/modules" "$stage/docker-compose.addons.yml")
  names=(modules docker-compose.addons.yml)
  types=(dir file)
else
  target_root="/opt/chatwoot"
  [[ -d "$target_root/engine" && ! -L "$target_root/engine" \
     && -d "$target_root/webapp" && ! -L "$target_root/webapp" ]] || {
    echo "flat target roots are missing or unsafe" >&2; exit 2;
  }
  targets=("$target_root/engine/src" "$target_root/engine/migrations" "$target_root/webapp/dist")
  staged=("$stage/engine/src" "$stage/engine/migrations" "$stage/webapp/dist")
  names=(engine-src engine-migrations webapp-dist)
  types=(dir dir dir)
fi
touched=()

committed=0
rollback() {
  local status=$? i old
  trap - EXIT HUP INT TERM
  set +e
  if [[ $committed -eq 0 ]]; then
    for ((i=${#targets[@]}-1; i>=0; i--)); do
      old="$backup/${names[$i]}"
      if [[ -e "$old" || -L "$old" ]]; then
        rm -rf -- "${targets[$i]}"
        mv -- "$old" "${targets[$i]}"
      elif [[ "${touched[$i]:-0}" == 1 ]]; then
        rm -rf -- "${targets[$i]}"
      fi
    done
    rm -f -- "$backup/DEPLOYMENT"
    rmdir "$backup" 2>/dev/null || true
  fi
  rm -rf -- "$stage"
  exit "$status"
}
trap rollback EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

tar -tzf "$archive" >/dev/null
mkdir -m 700 "$stage"
tar -C "$stage" -xzf "$archive"

if [[ "$layout" == modular ]]; then
  [[ -d "$stage/modules/sequences/engine/src" && ! -L "$stage/modules" \
     && -f "$stage/modules/sequences/engine/src/campaigns.js" \
     && -f "$stage/modules/sequences/webapp/dist/index.html" \
     && -f "$stage/docker-compose.addons.yml" && ! -L "$stage/docker-compose.addons.yml" ]] || {
    echo "modular payload is incomplete" >&2; exit 1;
  }
  # Validate the exact staged compose file with the real base file and .env, without
  # printing expanded values. No live file has moved yet if this fails.
  (cd /opt/chatwoot && docker compose -f docker-compose.yml \
    -f "$stage/docker-compose.addons.yml" -p chatwoot config --quiet)
else
  [[ -d "$stage/engine/src" && ! -L "$stage/engine/src" \
     && -d "$stage/engine/migrations" && ! -L "$stage/engine/migrations" \
     && -d "$stage/webapp/dist" && ! -L "$stage/webapp/dist" \
     && -f "$stage/engine/src/campaigns.js" \
     && -f "$stage/webapp/dist/index.html" ]] || {
    echo "flat payload is incomplete" >&2; exit 1;
  }
fi

mkdir -p -m 700 /opt/chatwoot/backups
mkdir -m 700 "$backup"
printf 'commit=%s\nlayout=%s\n' "${deploy_id%%-*}" "$layout" > "$backup/DEPLOYMENT"

for ((i=0; i<${#targets[@]}; i++)); do
  [[ ! -L "${targets[$i]}" ]] || { echo "refusing symlink target: ${targets[$i]}" >&2; exit 2; }
  if [[ -e "${targets[$i]}" ]]; then
    if [[ "${types[$i]}" == dir ]]; then
      [[ -d "${targets[$i]}" ]] || { echo "expected directory: ${targets[$i]}" >&2; exit 2; }
    else
      [[ -f "${targets[$i]}" ]] || { echo "expected regular file: ${targets[$i]}" >&2; exit 2; }
    fi
    mv -- "${targets[$i]}" "$backup/${names[$i]}"
  fi
  touched[$i]=1
  mv -- "${staged[$i]}" "${targets[$i]}"
done

committed=1
echo "  backup: $backup"
CWPT_REMOTE_APPLY
}

deploy_engine() {
  local server="$1" layout="$2"
  require_pinned_head
  case "$server" in chatwoot|chatwoot_admon) ;; *) die "refusing unknown server: $server" ;; esac
  case "$layout" in modular|flat) ;; *) die "refusing unknown deployment layout: $layout" ;; esac

  LOCAL_DEPLOY_TMP="$(mktemp "${TMPDIR:-/tmp}/cwpt-sync.XXXXXX")" \
    || die "could not create local deployment archive"
  if ! build_deploy_archive "$layout" "$LOCAL_DEPLOY_TMP"; then
    cleanup_deploy_temps
    die "could not build committed deployment archive"
  fi
  prepare_remote_tmp "$server"
  if ! scp -q "$LOCAL_DEPLOY_TMP" "$server:$REMOTE_DEPLOY_TMP/payload.tgz"; then
    cleanup_deploy_temps
    die "$server: payload upload failed"
  fi
  if ! apply_remote_payload "$server" "$layout" "$REMOTE_DEPLOY_TMP/payload.tgz"; then
    cleanup_deploy_temps
    die "$server: staged deployment failed; live state was restored"
  fi
  cleanup_deploy_temps
  ok "engine + webapp copied from $DEPLOY_COMMIT with backup ($layout)"
}

deploy_patch() {
  local server="$1"
  local base dest
  if [[ -z "$DEPLOY_PATCHES" ]]; then
    ok "Rails initializers already match — nothing written"
    return 0
  fi
  require_pinned_head
  case "$server" in chatwoot|chatwoot_admon) ;; *) die "refusing unknown server: $server" ;; esac

  # Same rule as the engine tar: the bytes come from the pinned commit, never off disk.
  # One validated host staging directory is reused for this server and removed by the
  # EXIT trap on every success/failure path.
  LOCAL_DEPLOY_TMP="$(mktemp "${TMPDIR:-/tmp}/cwpt-patch.XXXXXX")" \
    || die "could not create initializer staging file"
  prepare_remote_tmp "$server"
  while IFS= read -r base; do
    [[ -z "$base" ]] && continue
    [[ "$base" =~ ^[A-Za-z0-9_]+\.rb$ ]] \
      || die "refusing unsafe initializer name: $base"
    dest="$PATCH_DEST_DIR/$base"
    git -C "$REPO_ROOT" show "$DEPLOY_COMMIT:$PATCH_REL_DIR/$base" > "$LOCAL_DEPLOY_TMP" \
      || die "$base is absent from pinned commit $DEPLOY_COMMIT — nothing installed"
    scp -q "$LOCAL_DEPLOY_TMP" "$server:$REMOTE_DEPLOY_TMP/$base" \
      || die "$server: upload failed for $base"
    # Syntax-check inside the real Rails image before it can break boot.
    ssh -n "$server" "docker cp '$REMOTE_DEPLOY_TMP/$base' 'chatwoot-rails-1:/tmp/cwpt-patch-$DEPLOY_ID.rb' >/dev/null \
      && docker exec chatwoot-rails-1 ruby -c '/tmp/cwpt-patch-$DEPLOY_ID.rb' >/dev/null" \
      || die "Ruby syntax check failed on $server ($base) — nothing installed"
    # Copy in place (not install/mv) so an existing Docker single-file bind mount keeps
    # seeing the new bytes even before containers are recreated. The pre-change file is
    # copied to the same durable backup set as engine/webapp; a failed write restores it.
    ssh "$server" "sudo bash -s -- '$REMOTE_DEPLOY_TMP/$base' '$DEPLOY_ID' '$base'" <<'CWPT_REMOTE_PATCH'
set -Eeuo pipefail
src="$1"
deploy_id="$2"
base="$3"
[[ "$src" =~ ^/tmp/cwpt-sync\.[A-Za-z0-9]+/[A-Za-z0-9_]+\.rb$ ]] || exit 2
[[ "$deploy_id" =~ ^[0-9a-f]{12}-[0-9]{14}-[0-9]+$ ]] || exit 2
[[ "$base" =~ ^[A-Za-z0-9_]+\.rb$ ]] || exit 2
dest="/opt/chatwoot/custom-initializers/$base"
backup_dir="/opt/chatwoot/backups/cwpt-deploy-${deploy_id}/initializers"
backup="$backup_dir/$base"
[[ ! -L "$dest" ]] || { echo "refusing initializer symlink" >&2; exit 2; }
mkdir -p -m 700 "$backup_dir"
had_old=0
if [[ -f "$dest" ]]; then
  cp -a -- "$dest" "$backup"
  had_old=1
elif [[ -e "$dest" ]]; then
  echo "initializer target is not a regular file" >&2
  exit 2
fi
committed=0
rollback() {
  local status=$?
  trap - EXIT HUP INT TERM
  set +e
  if [[ $committed -eq 0 ]]; then
    if [[ $had_old -eq 1 ]]; then cp -- "$backup" "$dest"; else rm -f -- "$dest"; fi
  fi
  exit "$status"
}
trap rollback EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
cp -- "$src" "$dest"
chown root:root "$dest"
chmod 0644 "$dest"
cmp -s -- "$src" "$dest"
committed=1
CWPT_REMOTE_PATCH
  done <<< "$DEPLOY_PATCHES"
  cleanup_deploy_temps
  ok "Rails initializers installed: $(printf '%s' "$DEPLOY_PATCHES" | tr '\n' ' ')"
}

rebuild_engine() {
  local server="$1" layout="$2"
  case "$server" in chatwoot|chatwoot_admon) ;; *) die "refusing unknown server: $server" ;; esac
  case "$layout" in modular|flat) ;; *) die "refusing unknown deployment layout: $layout" ;; esac
  local container; container="$(engine_container "$layout")"
  if [[ "$layout" == modular ]]; then
    # Both -f files are mandatory: cwpt-engine is defined in the addons file, and without it
    # compose silently ignores the service and reports success.
    local want_compose have_compose
    want_compose="$(head_md5 docker-compose.addons.yml)"
    have_compose="$(remote_md5 "$server" /opt/chatwoot/chatwoot-power-tools/docker-compose.addons.yml)"
    [[ "$want_compose" == "$have_compose" ]] \
      || die "$server: refusing build with docker-compose.addons.yml different from $DEPLOY_COMMIT"
    ssh "$server" "cd /opt/chatwoot \
      && sudo docker compose -f docker-compose.yml -f chatwoot-power-tools/docker-compose.addons.yml -p chatwoot config --quiet \
      && sudo docker compose -f docker-compose.yml -f chatwoot-power-tools/docker-compose.addons.yml -p chatwoot up -d --build --no-deps $container" \
      >/dev/null 2>&1 || die "$server: $container rebuild failed"
  else
    ssh "$server" "cd /opt/chatwoot \
      && sudo docker compose config --quiet \
      && sudo docker compose up -d --build --no-deps $container" \
      >/dev/null 2>&1 || die "$server: $container rebuild failed"
  fi
  ok "$container rebuilt"
}

ensure_no_running_campaigns() {
  local server="$1"
  local running
  running="$(ssh "$server" "docker exec chatwoot-postgres-1 sh -c \"psql -U \\\$POSTGRES_USER -d chatwoot -Atc 'SELECT count(*) FROM campaigns WHERE campaign_status=2;'\"" 2>/dev/null | tr -d '[:space:]')"
  [[ "$running" =~ ^[0-9]+$ ]] \
    || die "$server: could not prove that no campaign is mid-run"
  [[ "$running" == "0" ]] || die "$server has $running campaign(s) mid-run — refusing deployment"
}

restart_rails() {
  local server="$1"
  # Re-check immediately before the interruption. force-recreate is intentional: Docker
  # restart keeps single-file bind mounts pinned to the old inode when a previously missing
  # initializer was installed. Compose also validates the actual server configuration
  # before either container is touched.
  ensure_no_running_campaigns "$server"
  ssh "$server" "cd /opt/chatwoot \
    && sudo docker compose -p chatwoot config --quiet \
    && sudo docker compose -p chatwoot up -d --force-recreate --no-deps rails sidekiq" \
    >/dev/null 2>&1 || die "$server: Rails/Sidekiq recreate failed"
  ok "rails + sidekiq recreated"
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

  want="$(head_md5 "modules/sequences/webapp/dist/index.html")"
  have="$(ssh "$server" "docker exec $container md5sum /app/webapp-dist/index.html 2>/dev/null" | awk '{print $1}')"
  [[ "$want" == "$have" ]] \
    || die "$server runs a webapp build different from $DEPLOY_COMMIT"
  if [[ "$layout" == modular ]]; then
    want="$(head_md5 docker-compose.addons.yml)"
    have="$(remote_md5 "$server" /opt/chatwoot/chatwoot-power-tools/docker-compose.addons.yml)"
    [[ "$want" == "$have" ]] \
      || die "$server has docker-compose.addons.yml different from $DEPLOY_COMMIT"
  fi
  ok "webapp + compose state match pinned commit"

  while IFS= read -r rel_patch; do
    [[ -z "$rel_patch" ]] && continue
    base="${rel_patch##*/}"
    want="$(head_md5 "$rel_patch")"
    for initializer_container in chatwoot-rails-1 chatwoot-sidekiq-1; do
      have="$(ssh -n "$server" "docker exec $initializer_container md5sum /app/config/initializers/$base 2>/dev/null" | awk '{print $1}')"
      [[ "$want" == "$have" ]] || die "$server: $base is not mounted from HEAD in $initializer_container"
    done
  done < <(cd "$REPO_ROOT" && git ls-tree -r --name-only "$DEPLOY_COMMIT" -- "$PATCH_REL_DIR" | grep '\.rb$')
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
trap cleanup_deploy_temps EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

init_deploy_commit
require_pinned_head
[[ $CHECK_ONLY -eq 0 ]] && require_clean_tree

FAILED=0
PREFLIGHT_FAILED=0
SERVER_LAYOUTS=()
SERVER_PATCH_SETS=()

# Phase 1 is read-only across EVERY selected server. A blocker on the second server must
# not be discovered after the first one was already changed; that used to leave the pair
# split across versions. Preserve each server's initializer plan for phase 2 because
# check_drift deliberately builds it per layout/server.
for ((server_index=0; server_index<${#SERVERS[@]}; server_index++)); do
  server="${SERVERS[$server_index]}"
  say "$server · preflight"
  require_pinned_head
  layout="$(detect_layout "$server")"
  case "$layout" in
    modular|flat) ;;
    *) die "$server: no recognizable addon install (reported: $layout)" ;;
  esac
  echo "  layout: $layout · container: $(engine_container "$layout")"

  set +e; check_drift "$server" "$layout"; drift_state=$?; set -e
  SERVER_LAYOUTS[$server_index]="$layout"
  SERVER_PATCH_SETS[$server_index]="$DEPLOY_PATCHES"

  # 0 = in sync · 1 = behind pinned commit · 2 = edited/other-branch server state
  # 3 = only other-branch initializer files differ; nothing this branch may deploy.
  case "$drift_state" in
    0) ;;
    1) [[ $CHECK_ONLY -eq 1 ]] && FAILED=1 ;;
    2)
      if [[ $FORCE -eq 1 && $CHECK_ONLY -eq 0 ]]; then
        warn "--force given: this server's reviewed drift will be overwritten"
      else
        FAILED=1; PREFLIGHT_FAILED=1
        warn "blocked — review the diff and merge it, or explicitly re-run with --force"
      fi
      ;;
    3)
      FAILED=1; PREFLIGHT_FAILED=1
      warn "blocked — merge the other branch into this commit before deployment"
      ;;
    *) die "$server: unexpected drift result $drift_state" ;;
  esac

  if [[ $CHECK_ONLY -eq 0 ]]; then
    # Still read-only; proving this for all servers before phase 2 prevents a campaign on
    # server B from being discovered only after server A was already restarted.
    ensure_no_running_campaigns "$server"
  fi
done

if [[ $CHECK_ONLY -eq 1 ]]; then
  if [[ $FAILED -eq 0 ]]; then say "All servers match $DEPLOY_COMMIT"
  else say "Drift found — see warnings above"
  fi
  exit "$FAILED"
fi
[[ $PREFLIGHT_FAILED -eq 0 ]] \
  || die "preflight failed; no selected server was changed"

# Phase 2 mutates one server at a time, using only the immutable commit and the exact plan
# captured above. The campaign guard is repeated immediately before each copy/restart.
for ((server_index=0; server_index<${#SERVERS[@]}; server_index++)); do
  server="${SERVERS[$server_index]}"
  layout="${SERVER_LAYOUTS[$server_index]}"
  DEPLOY_PATCHES="${SERVER_PATCH_SETS[$server_index]}"
  say "$server · deploy $DEPLOY_COMMIT"
  require_pinned_head
  ensure_no_running_campaigns "$server"
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

say "Done · $DEPLOY_COMMIT"
exit 0
