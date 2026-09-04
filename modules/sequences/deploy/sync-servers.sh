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
#                            managed:   .../chatwoot-power-tools/.cwpt-runtime/modules/...
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
# This fleet sync owns the complete historical sequences stack and its Rails initializers.
# A modular subset must be updated with install.sh; sync refuses it before drift checks or
# writes so it cannot silently re-enable code that the installer deliberately removed.
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
# כל קובצי ה-.rb שמחויבים ישירות בשורש תיקיית ה-initializers ב-HEAD מועמדים לפריסה —
# initializer חדש בריפו מצטרף מעצמו, אבל קובצי בדיקה בתיקיות משנה לעולם אינם נטענים לתוך
# Rails. קובץ שקיים רק על הדיסק אינו מועמד כלל. נכתבים בפועל רק קבצים שחסרים בשרת או
# שגרסתם שם ישנה של הברנץ' הזה; גרסה מברנץ' אחר מדולגת (known_in_ref).
PATCH_REL_DIR="modules/sequences/deploy/chatwoot-initializers"
PATCH_DEST_DIR="/opt/chatwoot/custom-initializers"
ALLOWED_SERVERS=(chatwoot chatwoot_admon)

# ‏sync-servers תומך רק בסט המלא (ראה assert_full_module_selection), אז הרשימה קבועה.
CWPT_MODULES="import sequences enhancements"
# ‏_cwpt_module_parts — הקאנון של החלקים המוזרקים, אותו מקור שההזרקה עצמה משתמשת בו.
# מותנה בכוונה: הבדיקות מעתיקות את הסקריפט לתיקייה זמנית, ושם REPO_ROOT אינו checkout —
# ‏source קשיח היה מפיל אותן תחת set -e עוד לפני שנקראה פונקציה אחת.
# shellcheck source=../../../lib/assemble-dashboard-script.sh
[[ -r "$REPO_ROOT/lib/assemble-dashboard-script.sh" ]] \
  && source "$REPO_ROOT/lib/assemble-dashboard-script.sh"
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

sha256_stdin() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  else
    shasum -a 256 | awk '{print $1}'
  fi
}

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

# A deploy swaps complete directories, so two sentinel files cannot prove that the rest of
# the tree is safe to overwrite. These manifests cover every regular file in the exact
# managed payload. Paths are validated and sorted; symlinks/special files fail closed.
payload_manifest_script() {
  cat <<'CWPT_PAYLOAD_MANIFEST'
set -Eeuo pipefail
layout="$1"
root="$2"
case "$layout" in flat|modular|modular-managed) ;; *) exit 2 ;; esac
[[ "$root" == /* && "$root" != *$'\n'* && "$root" != *$'\t'* ]] || exit 2

manifest_tmp="$(mktemp /tmp/cwpt-manifest.XXXXXXXX)"
cleanup_manifest() {
  find "$manifest_tmp" -maxdepth 0 -type f -delete 2>/dev/null || true
}
trap cleanup_manifest EXIT HUP INT TERM

valid_rel() {
  local rel="$1"
  [[ "$rel" =~ ^[A-Za-z0-9_./@+-]+$ \
     && "$rel" != /* && "$rel" != ".." && "$rel" != ../* \
     && "$rel" != */../* && "$rel" != */.. ]]
}

emit_file() {
  local file="$1" rel="$2" digest
  [[ -f "$file" && ! -L "$file" ]] || exit 3
  valid_rel "$rel" || exit 3
  digest="$(sha256sum "$file" | awk '{print $1}')"
  [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || exit 3
  printf '%s\t%s\n' "$digest" "$rel" >> "$manifest_tmp"
}

emit_tree() {
  local dir="$1" prefix="$2" bad file rel
  [[ -d "$dir" && ! -L "$dir" ]] || exit 3
  bad="$(find -P "$dir" -mindepth 1 \( -type l -o \( ! -type f ! -type d \) \) -print -quit)"
  [[ -z "$bad" ]] || exit 3
  while IFS= read -r -d '' file; do
    rel="${file#"$dir"/}"
    valid_rel "$rel" || exit 3
    emit_file "$file" "$prefix/$rel"
  done < <(find -P "$dir" -type f -print0)
}

if [[ "$layout" == flat ]]; then
  emit_tree "$root/engine/src" engine/src
  emit_tree "$root/engine/migrations" engine/migrations
  emit_tree "$root/webapp/dist" webapp/dist
else
  emit_tree "$root/modules" modules
  emit_file "$root/docker-compose.addons.yml" docker-compose.addons.yml
fi
[[ -s "$manifest_tmp" ]] || exit 3
LC_ALL=C sort -t $'\t' -k2,2 "$manifest_tmp"
CWPT_PAYLOAD_MANIFEST
}

container_manifest_script() {
  cat <<'CWPT_CONTAINER_MANIFEST'
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = process.argv[2] || '/app';
const rows = [];
const valid = rel => /^[A-Za-z0-9_./@+-]+$/.test(rel) &&
  !rel.startsWith('/') && !rel.split('/').includes('..');
function walk(dir, prefix) {
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unsafe managed directory');
  for (const name of fs.readdirSync(dir)) {
    const absolute = path.join(dir, name);
    const item = fs.lstatSync(absolute);
    const rel = `${prefix}/${name}`;
    if (!valid(rel) || item.isSymbolicLink()) throw new Error('unsafe managed path');
    if (item.isDirectory()) walk(absolute, rel);
    else if (item.isFile()) {
      const digest = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
      rows.push({ digest, rel });
    } else throw new Error('special file in managed tree');
  }
}
walk(path.join(root, 'src'), 'src');
walk(path.join(root, 'migrations'), 'migrations');
walk(path.join(root, 'webapp-dist'), 'webapp-dist');
if (!rows.length) throw new Error('empty managed tree');
rows.sort((a, b) => Buffer.compare(Buffer.from(a.rel), Buffer.from(b.rel)));
process.stdout.write(`${rows.map(row => `${row.digest}\t${row.rel}`).join('\n')}\n`);
CWPT_CONTAINER_MANIFEST
}

valid_committed_path() {
  [[ "$1" =~ ^[A-Za-z0-9_./@+-]+$ \
     && "$1" != /* && "$1" != ".." && "$1" != ../* \
     && "$1" != */../* && "$1" != */.. ]]
}

committed_payload_manifest() {
  local ref="$1" layout="$2" record metadata mode type path rel digest count=0
  local -a roots=()
  case "$layout" in
    flat)
      roots=(modules/sequences/engine/src modules/sequences/engine/migrations
             modules/sequences/webapp/dist)
      ;;
    modular|modular-managed) roots=(modules docker-compose.addons.yml) ;;
    *) return 2 ;;
  esac
  while IFS= read -r -d '' record; do
    metadata="${record%%$'\t'*}"
    path="${record#*$'\t'}"
    mode="${metadata%% *}"
    metadata="${metadata#* }"
    type="${metadata%% *}"
    [[ "$type" == blob && ( "$mode" == 100644 || "$mode" == 100755 ) ]] || return 2
    valid_committed_path "$path" || return 2
    digest="$(git -C "$REPO_ROOT" show "$ref:$path" 2>/dev/null | sha256_stdin)" || return 1
    [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || return 1
    if [[ "$layout" == flat ]]; then
      rel="${path#modules/sequences/}"
    else
      rel="$path"
    fi
    printf '%s\t%s\n' "$digest" "$rel"
    count=$((count + 1))
  done < <(git -C "$REPO_ROOT" ls-tree -r -z "$ref" -- "${roots[@]}")
  [[ $count -gt 0 ]]
}

committed_container_manifest() {
  local ref="$1" record metadata mode type path rel digest count=0 manifest=""
  while IFS= read -r -d '' record; do
    metadata="${record%%$'\t'*}"
    path="${record#*$'\t'}"
    mode="${metadata%% *}"
    metadata="${metadata#* }"
    type="${metadata%% *}"
    [[ "$type" == blob && ( "$mode" == 100644 || "$mode" == 100755 ) ]] || return 2
    valid_committed_path "$path" || return 2
    digest="$(git -C "$REPO_ROOT" show "$ref:$path" 2>/dev/null | sha256_stdin)" || return 1
    [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || return 1
    case "$path" in
      modules/sequences/engine/src/*) rel="src/${path#modules/sequences/engine/src/}" ;;
      modules/sequences/engine/migrations/*) rel="migrations/${path#modules/sequences/engine/migrations/}" ;;
      modules/sequences/webapp/dist/*) rel="webapp-dist/${path#modules/sequences/webapp/dist/}" ;;
      *) return 2 ;;
    esac
    manifest+="${digest}"$'\t'"${rel}"$'\n'
    count=$((count + 1))
  done < <(git -C "$REPO_ROOT" ls-tree -r -z "$ref" -- \
    modules/sequences/engine/src modules/sequences/engine/migrations modules/sequences/webapp/dist)
  [[ $count -gt 0 ]] || return 1
  printf '%s' "$manifest" | LC_ALL=C sort -t $'\t' -k2,2
}

remote_payload_manifest() {
  local server="$1" layout="$2" root
  if is_modular_layout "$layout"; then root="$(remote_modular_root "$layout")"; else root=/opt/chatwoot; fi
  payload_manifest_script | ssh "$server" "sudo bash -s -- '$layout' '$root'"
}

remote_container_manifest() {
  local server="$1" container="$2"
  container_manifest_script | ssh "$server" "docker exec -i '$container' node - /app"
}

deployment_marker_path() {
  case "$1" in flat|modular|modular-managed) ;; *) return 2 ;; esac
  printf '/opt/chatwoot/.cwpt-state/deployment'
}

remote_deployment_marker() {
  local server="$1" layout="$2" marker output commit marker_layout digest
  marker="$(deployment_marker_path "$layout")"
  output="$(ssh -n "$server" "sudo bash -c '
    set -eu
    state=/opt/chatwoot/.cwpt-state
    marker=\"\$state/deployment\"
    [ -d \"\$state\" ] && [ ! -L \"\$state\" ]
    [ -f \"\$marker\" ] && [ ! -L \"\$marker\" ]
    [ \"\$(stat -c %u:%g:%a \"\$state\")\" = 0:0:700 ]
    [ \"\$(stat -c %u:%g:%a \"\$marker\")\" = 0:0:600 ]
    sed -n -E \"/^(commit=[0-9a-f]{40}|layout=(flat|modular|modular-managed)|manifest_sha256=[0-9a-f]{64})\$/p\" \"\$marker\"
  ' 2>/dev/null" || true)"
  commit="$(printf '%s\n' "$output" | awk -F= '$1=="commit" {print $2; exit}')"
  marker_layout="$(printf '%s\n' "$output" | awk -F= '$1=="layout" {print $2; exit}')"
  digest="$(printf '%s\n' "$output" | awk -F= '$1=="manifest_sha256" {print $2; exit}')"
  [[ "$commit" =~ ^[0-9a-f]{40}$ && "$marker_layout" == "$layout" \
     && "$digest" =~ ^[0-9a-f]{64}$ ]] || return 1
  printf '%s|%s' "$commit" "$digest"
}

write_deployment_marker() {
  local server="$1" layout="$2" manifest="$3" marker digest
  marker="$(deployment_marker_path "$layout")"
  digest="$(printf '%s\n' "$manifest" | sha256_stdin)"
  [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || return 1
  printf 'commit=%s\nlayout=%s\nmanifest_sha256=%s\n' "$DEPLOY_COMMIT" "$layout" "$digest" \
    | ssh "$server" "sudo bash -c '
      set -eu
      state=/opt/chatwoot/.cwpt-state
      [ ! -L \"\$state\" ]
      install -d -o root -g root -m 700 \"\$state\"
      [ \"\$(stat -c %u:%g:%a \"\$state\")\" = 0:0:700 ]
      install -o root -g root -m 600 /dev/stdin \"\$state/deployment\"
    '"
}

# Enumerate only production initializers committed directly under PATCH_REL_DIR. Tests
# deliberately live below test/ and end in .rb too; treating a recursive listing as the
# deploy set would either block preflight for a missing mount or boot test code in Rails.
head_initializer_paths() {
  git -C "$REPO_ROOT" ls-tree -r --name-only "$DEPLOY_COMMIT" -- "$PATCH_REL_DIR" |
    awk -v prefix="$PATCH_REL_DIR/" '
      index($0, prefix) == 1 {
        tail = substr($0, length(prefix) + 1)
        if (index(tail, "/") == 0 && tail ~ /\.rb$/) print $0
      }
    '
}

# Classify remote facts without guessing. CWPT_BUILD_CONTEXT is authoritative for a current
# modular install and can prove the managed layout even while a missing runtime is repaired.
# A source checkout at the legacy root is never classified as a writable runtime because a
# sync must not replace tracked source files in place.
classify_layout_facts() {
  local build_context="$1" checkout_exists="$2" managed_exists="$3" root_exists="$4" flat_exists="$5"
  local target="/opt/chatwoot/chatwoot-power-tools"
  local managed_context="${target}/.cwpt-runtime/modules/sequences"
  local root_context="${target}/modules/sequences"
  case "$build_context" in
    "$managed_context") echo modular-managed; return 0 ;;
    "$root_context")
      if [[ "$checkout_exists" == 1 || "$managed_exists" == 1 ]]; then
        echo "conflict:CWPT_BUILD_CONTEXT points at checkout source while a checkout/managed runtime exists"
      else
        echo modular
      fi
      return 0
      ;;
    "")
      if [[ "$managed_exists" == 1 ]]; then
        echo "conflict:managed runtime exists but CWPT_BUILD_CONTEXT is missing"
      elif [[ "$checkout_exists" == 1 ]]; then
        echo "conflict:source checkout exists at the deployment target without a managed build context"
      elif [[ "$root_exists" == 1 ]]; then
        echo modular
      elif [[ "$flat_exists" == 1 ]]; then
        echo flat
      else
        echo unknown
      fi
      return 0
      ;;
    *) echo "conflict:unrecognized CWPT_BUILD_CONTEXT"; return 0 ;;
  esac
}

detect_layout() {
  local facts="" build_context="" checkout_exists=0 managed_exists=0 root_exists=0 flat_exists=0
  facts="$(ssh -n "$1" 'target=/opt/chatwoot/chatwoot-power-tools
    build_context=$(sudo sed -n "s/^CWPT_BUILD_CONTEXT=//p" /opt/chatwoot/.env 2>/dev/null | tail -n 1)
    checkout=0; managed=0; root=0; flat=0
    { sudo test -e "$target/.git" || { sudo test -f "$target/install.sh" && sudo test -f "$target/README.md"; }; } && checkout=1
    sudo test -d "$target/.cwpt-runtime/modules/sequences" && managed=1
    sudo test -d "$target/modules/sequences" && root=1
    sudo test -d /opt/chatwoot/engine/src && flat=1
    printf "%s|%s|%s|%s|%s\n" "$build_context" "$checkout" "$managed" "$root" "$flat"')" || {
      echo unknown
      return 0
    }
  IFS='|' read -r build_context checkout_exists managed_exists root_exists flat_exists <<< "$facts"
  classify_layout_facts "$build_context" "$checkout_exists" "$managed_exists" "$root_exists" "$flat_exists"
}

is_modular_layout() { [[ "$1" == modular || "$1" == modular-managed ]]; }

engine_container() { is_modular_layout "$1" && echo cwpt-engine || echo drip-engine; }

remote_modular_root() {
  [[ "$1" == modular-managed ]] \
    && echo /opt/chatwoot/chatwoot-power-tools/.cwpt-runtime \
    || echo /opt/chatwoot/chatwoot-power-tools
}

remote_engine_src() {
  is_modular_layout "$1" \
    && echo "$(remote_modular_root "$1")/modules/sequences/engine/src" \
    || echo /opt/chatwoot/engine/src
}

remote_engine_migrations() {
  is_modular_layout "$1" \
    && echo "$(remote_modular_root "$1")/modules/sequences/engine/migrations" \
    || echo /opt/chatwoot/engine/migrations
}

# The legacy fleet sync deploys all three modules and initializers that are not independently
# gated. Refuse a subset before any drift check or copy rather than undoing install.sh's exact
# desired state. A pre-module legacy install is treated as the historical all-modules stack.
assert_sync_module_selection() {
  local server="$1" layout="$2" enabled_modules=""
  is_modular_layout "$layout" || return 0
  enabled_modules="$(ssh -n "$server" "sudo sed -n 's/^CWPT_ENABLED_MODULES=//p' /opt/chatwoot/.env 2>/dev/null | tail -n 1 | tr -d '[:space:]'")" \
    || die "$server: could not read CWPT_ENABLED_MODULES; refusing an ambiguous modular sync"
  if [[ -z "$enabled_modules" ]]; then
    [[ "$layout" == modular ]] \
      || die "$server: managed runtime is missing CWPT_ENABLED_MODULES; run install.sh to repair it"
    enabled_modules="import,sequences,enhancements"
  fi
  local -a enabled_parts=()
  local module="" import_count=0 sequences_count=0 enhancements_count=0
  IFS=',' read -r -a enabled_parts <<< "$enabled_modules"
  for module in "${enabled_parts[@]}"; do
    case "$module" in
      import) import_count=$((import_count + 1)) ;;
      sequences) sequences_count=$((sequences_count + 1)) ;;
      enhancements) enhancements_count=$((enhancements_count + 1)) ;;
      *) die "$server: invalid CWPT_ENABLED_MODULES value; use install.sh to repair it" ;;
    esac
  done
  [[ "${#enabled_parts[@]}" -eq 3 && "$import_count" -eq 1 \
     && "$sequences_count" -eq 1 && "$enhancements_count" -eq 1 ]] \
    || die "$server: sync-servers supports only the complete module set; '$enabled_modules' must be updated with install.sh"
  ok "module selection is the complete sync-managed stack"
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
        # ‏--force הבטיח "re-run with --force to overwrite" אבל הענף הזה מעולם לא הוסיף את
        # הקובץ ל-DEPLOY_PATCHES — כלומר הריצה המשיכה הלאה ודילגה עליו בשקט, ההפך ממה
        # שהאזהרה מבטיחה. נתפס 4.9.26 על whatsapp_campaign_feature_flag.rb.
        [[ $FORCE -eq 1 ]] && DEPLOY_PATCHES+="$base"$'\n'
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
  done < <(head_initializer_paths)
  [[ $patch_ok -eq 1 ]] && ok "Rails patches match git"

  # הסקריפטים המוזרקים לדשבורד — עד 4.9.26 לא נבדקו כאן כלל, ולכן חלק שנוסף או הוסר
  # בקוד יכול היה להיעדר משרת אחד ולהמשיך לרוץ בשני בלי שאף בדיקה תראה את זה.
  local want_parts have_parts
  want_parts="$(committed_parts)"
  have_parts="$(remote_injected_parts "$server")"
  if [[ -z "$have_parts" ]]; then
    warn "dashboard script on $server carries no recognizable parts — will be injected"
    behind=1
  elif [[ "$want_parts" != "$have_parts" ]]; then
    local only_git only_server
    only_git="$(comm -23 <(printf '%s\n' "$want_parts") <(printf '%s\n' "$have_parts") | xargs -n1 basename 2>/dev/null | tr '\n' ' ')"
    only_server="$(comm -13 <(printf '%s\n' "$want_parts") <(printf '%s\n' "$have_parts") | xargs -n1 basename 2>/dev/null | tr '\n' ' ')"
    [[ -n "$only_git" ]] && warn "dashboard parts missing on $server: $only_git"
    [[ -n "$only_server" ]] && warn "dashboard parts on $server that git no longer ships: $only_server"
    behind=1
  else
    ok "dashboard script matches git ($(printf '%s\n' "$want_parts" | wc -l | tr -d ' ') parts)"
  fi

  # The payload is swapped as complete directories, so drift is checked as a complete
  # path+SHA-256 manifest too. This catches a server-only auth.js fix, a missing migration,
  # a stale hashed asset, an extra file and unsafe symlinks — none can hide behind two
  # matching sentinels. A root-owned digest marker proves an intact prior deployment.
  # A pre-marker or manually changed tree is never guessed from expensive partial history:
  # it blocks unless the operator reviewed it and explicitly selected --force.
  local expected_manifest remote_manifest remote_digest marker marker_commit marker_digest
  expected_manifest="$(committed_payload_manifest "$DEPLOY_COMMIT" "$layout")" \
    || die "could not build committed payload manifest"
  if ! remote_manifest="$(remote_payload_manifest "$server" "$layout")"; then
    warn "$server managed payload cannot be inventoried safely (missing tree, symlink or special file)"
    blocking=1
  elif [[ "$expected_manifest" != "$remote_manifest" ]]; then
    remote_digest="$(printf '%s\n' "$remote_manifest" | sha256_stdin)"
    marker="$(remote_deployment_marker "$server" "$layout" || true)"
    marker_commit="${marker%%|*}"
    marker_digest="${marker#*|}"
    if [[ -n "$marker" && "$marker_digest" == "$remote_digest" \
          && "$marker_commit" =~ ^[0-9a-f]{40}$ ]] \
       && git -C "$REPO_ROOT" merge-base --is-ancestor \
            "$marker_commit" "$DEPLOY_COMMIT" 2>/dev/null; then
      warn "managed payload on $server is an intact older deployment — will be updated"
      behind=1
    elif [[ $FORCE -eq 1 ]]; then
      warn "--force: replacing a pre-marker, other-branch or manually changed managed payload on $server"
      behind=1
    else
      warn "managed payload on $server has no matching trusted deployment marker"
      warn "  review it first, then rerun with --force for this one-time adoption"
      blocking=1
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
  ok "complete managed payload matches git"
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
    modular|modular-managed)
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
  # Stream the helper from the pinned commit: deployment and rollback tests exercise the
  # exact same bytes. The payload itself was already uploaded to the validated temp path.
  git -C "$REPO_ROOT" show \
    "$DEPLOY_COMMIT:modules/sequences/deploy/remote-swap-runtime.sh" \
    | ssh "$server" "sudo bash -s -- '$archive' '$DEPLOY_ID' '$layout'"
}

deploy_engine() {
  local server="$1" layout="$2"
  require_pinned_head
  case "$server" in chatwoot|chatwoot_admon) ;; *) die "refusing unknown server: $server" ;; esac
  case "$layout" in modular|modular-managed|flat) ;; *) die "refusing unknown deployment layout: $layout" ;; esac

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
    die "$server: staged deployment failed; automatic restoration was attempted — inspect the remote backup/output before retrying"
  fi
  cleanup_deploy_temps
  ok "engine + webapp copied from $DEPLOY_COMMIT with backup ($layout)"
}

# Owner-only migrations cannot run as drip_engine. Apply and ledger them transactionally
# with the Chatwoot database owner after the committed migration files are copied but before
# an initializer is published or an engine image is rebuilt. Older engines ran some of these
# grants outside schema_migrations, so reapplying the idempotent SQL is the verified backfill.
apply_owner_migrations_remote() {
  local server="$1" layout="$2" migrations_dir
  migrations_dir="$(remote_engine_migrations "$layout")"
  if ! ssh "$server" bash -s -- "$migrations_dir" <<'CWPT_OWNER_MIGRATIONS'
set -euo pipefail
migrations_dir="$1"
pg_container="$(sudo docker ps -q --filter label=com.docker.compose.service=postgres | head -n 1)"
[[ -n "$pg_container" ]] || { echo "postgres container not found" >&2; exit 1; }

export LC_ALL=C
enabled_modules="$(sudo sed -n 's/^CWPT_ENABLED_MODULES=//p' /opt/chatwoot/.env 2>/dev/null | tail -n 1)"
enabled_modules="${enabled_modules:-import,sequences,enhancements}"
IFS=',' read -r -a enabled_parts <<< "$enabled_modules"
[[ "${#enabled_parts[@]}" -gt 0 ]] || { echo "empty CWPT_ENABLED_MODULES" >&2; exit 1; }
for module in "${enabled_parts[@]}"; do
  case "$module" in import|sequences|enhancements) ;; *) echo "unknown enabled module" >&2; exit 1 ;; esac
done

selected=0
for migration in "$migrations_dir"/*_role_grants.sql; do
  [[ -f "$migration" ]] || continue
  filename="${migration##*/}"
  case "$filename" in *[!A-Za-z0-9_.-]*) echo "unsafe migration filename" >&2; exit 1 ;; esac
  if [[ ",${enabled_modules}," == *",sequences,"* ]]; then
    : # Every owner migration is required by the complete sequences stack, including 053.
  elif [[ ",${enabled_modules}," == *",enhancements,"* \
          && ( "$filename" == 051_* || "$filename" == 054_* ) ]]; then
    : # Dashboard-only needs campaign analytics plus current mobile-membership proof.
  else
    continue
  fi
  selected=1
  {
    printf 'BEGIN;\n'
    sudo cat "$migration"
    printf "\nINSERT INTO drip.schema_migrations(version, applied_at) VALUES ('%s', now()) ON CONFLICT (version) DO UPDATE SET applied_at=EXCLUDED.applied_at;\n" "$filename"
    printf 'COMMIT;\n'
  } | sudo docker exec -i "$pg_container" sh -c \
      'exec psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-chatwoot}"' \
      >/dev/null
done
[[ "$selected" -eq 1 ]] || [[ "$enabled_modules" == import ]] || {
  echo "no owner migrations selected" >&2
  exit 1
}
CWPT_OWNER_MIGRATIONS
  then
    die "$server: owner migrations failed — engine was not rebuilt"
  fi
  ok "owner migrations applied + ledgered before rebuild ($layout)"
}

# ── DASHBOARD_SCRIPTS ────────────────────────────────────────────────────────
# עד 4.9.26 הפריסה נגעה בכל דבר חוץ מהסקריפטים שמוזרקים לדשבורד: המנוע, ה-webapp
# וה-initializers סונכרנו ונבדקו מול גיט, וההזרקה נשארה פעולה ידנית של install.sh.
# מכאן שני הכשלים שנמצאו באותו יום: חלק שהוסר מהקוד המשיך לרוץ בשרת אחד, וחלק
# שנוסף לקוד לא הגיע לאף שרת — ואף בדיקה לא ראתה את זה, כי גם רשימת השומר קופאה.
#
# ההזרקה עצמה נשארת lib/inject.sh — הקוד הבדוק, עם הגיבוי, סמני CWPT וחתימת
# השלמות. אנחנו רק שולחים אותו לשרת ומריצים אותו שם, כי בפריסה השטוחה (chatwoot)
# אין עותק של המאגר בכלל.

# הבסיס שכל חלק מרכיב ממנו את הנתיבים שלו — נשמר פר-שרת (chatwoot: /drip,
# admon: /chatwoot-addons), ולכן נקרא ממה שכבר מוזרק ולא נקבע כאן.
remote_addons_base() {
  local server="$1" base
  base="$(ssh -n "$server" "docker exec chatwoot-rails-1 bundle exec rails runner \
    \"v = InstallationConfig.find_by(name: 'DASHBOARD_SCRIPTS')&.value.to_s; \
      m = v.match(/__CW_ADDONS_BASE=\\\"([^\\\"]+)\\\"/); print(m ? m[1] : '')\" 2>/dev/null" \
    2>/dev/null | tr -d '[:space:]')"
  printf '%s' "${base:-/chatwoot-addons}"
}

# רשימת החלקים שמוזרקים בפועל בשרת, לפי חותמות "// part:".
remote_injected_parts() {
  local server="$1"
  ssh -n "$server" "docker exec chatwoot-rails-1 bundle exec rails runner \
    \"InstallationConfig.find_by(name: 'DASHBOARD_SCRIPTS')&.value.to_s.scan(%r{// part: (\\S+)}).flatten.each { |p| puts p }\" 2>/dev/null" \
    2>/dev/null | grep -E '^modules/' | sort
}

committed_parts() {
  declare -f _cwpt_module_parts >/dev/null 2>&1 \
    || die "lib/assemble-dashboard-script.sh not found under $REPO_ROOT — cannot resolve the dashboard canon"
  local mod
  for mod in $CWPT_MODULES; do _cwpt_module_parts "$mod"; done | sort
}

deploy_dashboard_script() {
  local server="$1" base tgz
  base="$(remote_addons_base "$server")"
  tgz="$(mktemp -t cwptinj).tgz"
  # ‏git archive ולא tar: מקבע את אותו commit כמו שאר הפריסה, ובלי מאפייני xattr של macOS
  # ש-tar בלינוקס יוצא עליהם בקוד שגיאה (LIBARCHIVE.xattr.com.apple.provenance) ומפיל
  # את השרשרת אף שהחילוץ עצמו הצליח.
  git -C "$REPO_ROOT" archive --format=tar.gz -o "$tgz" "$DEPLOY_COMMIT" \
    lib modules/smart-import/inject modules/sequences/inject \
    modules/dashboard-enhancements/parts modules/sequences/webapp/dist/smart-import \
    || die "could not build the dashboard-script archive from $DEPLOY_COMMIT"
  archive_has_member "$tgz" 'lib/inject.sh' \
    || die "dashboard-script archive has no lib/inject.sh"
  scp -q "$tgz" "$server:/tmp/cwpt-inject.tgz"
  rm -f "$tgz"
  ssh -n "$server" "sudo rm -rf /opt/chatwoot/.cwpt-inject \
    && sudo mkdir -p /opt/chatwoot/.cwpt-inject \
    && sudo tar -C /opt/chatwoot/.cwpt-inject -xzf /tmp/cwpt-inject.tgz \
    && rm -f /tmp/cwpt-inject.tgz \
    && cd /opt/chatwoot/.cwpt-inject \
    && sudo bash -c 'source lib/inject.sh && inject_dashboard_script /opt/chatwoot \"$base\" $CWPT_MODULES'" \
    >/dev/null 2>&1 || die "$server: dashboard script injection failed"
  ssh -n "$server" "sudo rm -rf /opt/chatwoot/.cwpt-inject" >/dev/null 2>&1 || true
  ok "dashboard script injected (base $base)"
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

# ‏docker-compose.security.yml (הקשחת 31.8) נועץ כל שירות ל-image sha ומאפס build ל-null.
# התוצאה: `docker compose up -d --build` מדווח הצלחה בזמן שדוקר לא בונה כלום, וכל שינוי
# בקוד המנוע נשאר על הדיסק בלי להגיע לקונטיינר — בשקט מוחלט. נתפס 4.9.26: ה-image שרץ
# בייצור נבנה ב-31.8 והפריסות שאחריו לא שינו אותו.
#
# engine_build_is_pinned קובע אם אנחנו במצב הזה; repin_engine_image בונה עם קבצי ה-build
# בלבד, ואז מעדכן את ה-sha הנעוץ כדי שההקשחה תישאר בתוקף מול ה-image החדש.
#
# ⚠️ ההפעלה חייבת לקבל את אותם קבצי compose כמו הבנייה. ב-admon ‏COMPOSE_FILE כברירת
# מחדל אינו כולל את docker-compose.addons.yml, ו-`up` בלעדיו יצר שירות בלי
# ‏container_name ובלי ההגדרות שלו — הקונטיינר קם בשם אחר ומת מיד (4.9.26).
engine_build_is_pinned() {
  local server="$1" container="$2" answer
  answer="$(ssh -n "$server" "cd /opt/chatwoot && sudo docker compose -p chatwoot config --format json 2>/dev/null \
    | python3 -c \"import json,sys; print('build' in (json.load(sys.stdin)['services'].get('$container') or {}))\"" \
    2>/dev/null | tr -d '[:space:]')"
  # רק תשובה מפורשת False מוכיחה קיבוע. בדיקה שלא החזירה כלום (ssh נכשל, compose ישן,
  # python חסר) חייבת ליפול חזרה למסלול הרגיל — אחרת כל סביבה שלא עונה נשלחת לבנייה
  # וקיבוע מחדש בלי סיבה. נתפס בבדיקה 176 שנפלה ב-CI.
  [[ "$answer" == "False" ]]
}

repin_engine_image() {
  local server="$1" container="$2" build_files="$3"
  ssh -n "$server" "cd /opt/chatwoot \
    && sudo docker compose -p chatwoot $build_files build '$container' >/dev/null 2>&1 \
    && IMG=\$(sudo docker inspect --format '{{.Id}}' 'chatwoot-$container:latest' 2>/dev/null \
           || sudo docker inspect --format '{{.Id}}' 'chatwoot_$container:latest' 2>/dev/null) \
    && [ -n \"\$IMG\" ] \
    && sudo IMG=\"\$IMG\" python3 -c \"
import os, re, sys
p = '/opt/chatwoot/docker-compose.security.yml'
s = open(p, encoding='utf-8').read()
pat = re.compile(r'(^  $container:\n(?:(?!^  \S).*\n)*?^    image: )sha256:[0-9a-f]{64}', re.M)
s2, n = pat.subn(lambda m: m.group(1) + os.environ['IMG'], s, count=1)
sys.exit('pin line not found') if n != 1 else open(p, 'w', encoding='utf-8').write(s2)
\" \
    && sudo chown root:root /opt/chatwoot/docker-compose.security.yml \
    && sudo chmod 600 /opt/chatwoot/docker-compose.security.yml \
    && SEC=\$( [ -f docker-compose.security.yml ] && echo '-f docker-compose.security.yml' ) \
    && sudo docker compose -p chatwoot $build_files \$SEC config --quiet \
    && sudo docker compose -p chatwoot $build_files \$SEC up -d --force-recreate --no-deps '$container'" \
    >/dev/null 2>&1 || die "$server: $container build+repin failed"
  ok "$container built and re-pinned in docker-compose.security.yml"
}

rebuild_engine() {
  local server="$1" layout="$2"
  case "$server" in chatwoot|chatwoot_admon) ;; *) die "refusing unknown server: $server" ;; esac
  case "$layout" in modular|modular-managed|flat) ;; *) die "refusing unknown deployment layout: $layout" ;; esac
  local container; container="$(engine_container "$layout")"
  if is_modular_layout "$layout"; then
    # Both -f files are mandatory: cwpt-engine is defined in the addons file, and without it
    # compose silently ignores the service and reports success.
    local want_compose have_compose compose_root compose_rel
    compose_root="$(remote_modular_root "$layout")"
    compose_rel="${compose_root#/opt/chatwoot/}/docker-compose.addons.yml"
    want_compose="$(head_md5 docker-compose.addons.yml)"
    have_compose="$(remote_md5 "$server" "$compose_root/docker-compose.addons.yml")"
    [[ "$want_compose" == "$have_compose" ]] \
      || die "$server: refusing build with docker-compose.addons.yml different from $DEPLOY_COMMIT"
    if engine_build_is_pinned "$server" "$container"; then
      repin_engine_image "$server" "$container" "-f docker-compose.yml -f '$compose_rel'"
      return 0
    fi
    ssh "$server" "cd /opt/chatwoot \
      && sudo docker compose -f docker-compose.yml -f '$compose_rel' -p chatwoot config --quiet \
      && sudo docker compose -f docker-compose.yml -f '$compose_rel' -p chatwoot up -d --build --no-deps $container" \
      >/dev/null 2>&1 || die "$server: $container rebuild failed"
  else
    if engine_build_is_pinned "$server" "$container"; then
      repin_engine_image "$server" "$container" "-f docker-compose.yml -f docker-compose.override.yml"
      return 0
    fi
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
  local expected_host actual_host expected_container actual_container
  expected_host="$(committed_payload_manifest "$DEPLOY_COMMIT" "$layout")" \
    || die "could not build committed payload manifest during verification"
  actual_host="$(remote_payload_manifest "$server" "$layout")" \
    || die "$server managed payload cannot be inventoried after deployment"
  [[ "$expected_host" == "$actual_host" ]] \
    || die "$server host payload differs from pinned commit after deployment"

  expected_container="$(committed_container_manifest "$DEPLOY_COMMIT")" \
    || die "could not build committed container manifest"
  actual_container="$(remote_container_manifest "$server" "$container")" \
    || die "$server running container cannot be inventoried"
  [[ "$expected_container" == "$actual_container" ]] \
    || die "$server running engine/webapp differs from pinned commit"
  ok "complete host payload + running container match pinned commit"

  while IFS= read -r rel_patch; do
    [[ -z "$rel_patch" ]] && continue
    base="${rel_patch##*/}"
    want="$(head_md5 "$rel_patch")"
    for initializer_container in chatwoot-rails-1 chatwoot-sidekiq-1; do
      have="$(ssh -n "$server" "docker exec $initializer_container md5sum /app/config/initializers/$base 2>/dev/null" | awk '{print $1}')"
      [[ "$want" == "$have" ]] || die "$server: $base is not mounted from HEAD in $initializer_container"
    done
  done < <(head_initializer_paths)
  ok "all repository initializers mounted in Rails + Sidekiq"

  [[ "$(remote_injected_parts "$server")" == "$(committed_parts)" ]] \
    || die "$server: injected dashboard parts differ from the committed canon"
  ok "dashboard script matches the committed canon"

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

  write_deployment_marker "$server" "$layout" "$expected_host" \
    || die "$server: could not record verified deployment marker"
  ok "verified deployment marker recorded"
}

# ── run ──────────────────────────────────────────────────────────────────────
if [[ "${CWPT_SYNC_SERVERS_LIBRARY_ONLY:-0}" == 1 ]]; then
  return 0 2>/dev/null || exit 0
fi

trap cleanup_deploy_temps EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

init_deploy_commit
require_pinned_head
[[ $CHECK_ONLY -eq 0 ]] && require_clean_tree

FAILED=0
PREFLIGHT_FAILED=0
SERVER_LAYOUTS=()

# Phase 1 is read-only across EVERY selected server. A blocker on the second server must
# not be discovered after the first one was already changed; that used to leave the pair
# split across versions. The mutable initializer plan is intentionally rebuilt just before
# each copy in phase 2, so a server-side change after preflight cannot be overwritten unseen.
for ((server_index=0; server_index<${#SERVERS[@]}; server_index++)); do
  server="${SERVERS[$server_index]}"
  say "$server · preflight"
  require_pinned_head
  layout="$(detect_layout "$server")"
  case "$layout" in
    modular|modular-managed|flat) ;;
    conflict:*) die "$server: ${layout#conflict:} — run install.sh to repair/migrate the layout" ;;
    *) die "$server: no recognizable addon install (reported: $layout)" ;;
  esac
  echo "  layout: $layout · container: $(engine_container "$layout")"
  assert_sync_module_selection "$server" "$layout"

  set +e; check_drift "$server" "$layout"; drift_state=$?; set -e
  SERVER_LAYOUTS[$server_index]="$layout"

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

# Phase 2 mutates one server at a time, using only the immutable commit. Drift is checked
# again immediately before the copy to close the preflight-to-deploy race; the campaign
# guard is repeated immediately before each copy/restart too.
for ((server_index=0; server_index<${#SERVERS[@]}; server_index++)); do
  server="${SERVERS[$server_index]}"
  layout="${SERVER_LAYOUTS[$server_index]}"
  say "$server · deploy $DEPLOY_COMMIT"
  require_pinned_head
  current_layout="$(detect_layout "$server")"
  [[ "$current_layout" == "$layout" ]] \
    || die "$server layout changed after preflight ($layout -> $current_layout); no bytes were copied"
  assert_sync_module_selection "$server" "$layout"
  set +e; check_drift "$server" "$layout"; drift_state=$?; set -e
  case "$drift_state" in
    0|1) ;;
    2)
      [[ $FORCE -eq 1 ]] \
        || die "$server changed after preflight; no bytes were copied to this server"
      warn "--force: overwriting drift re-confirmed immediately before copy"
      ;;
    *) die "$server changed to a non-deployable state after preflight" ;;
  esac
  ensure_no_running_campaigns "$server"
  deploy_engine "$server" "$layout"
  apply_owner_migrations_remote "$server" "$layout"
  # Publish Rails code only after the owner-side schema/grants have been proven. A failed
  # owner migration therefore cannot become active on an unrelated future Rails restart.
  deploy_patch "$server"
  deploy_dashboard_script "$server"
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
