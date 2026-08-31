#!/usr/bin/env bash
# Replace the complete managed Chatwoot Power Tools payload while preserving an exact,
# durable backup. sync-servers.sh streams this committed file to the remote root shell;
# the regression suite executes this same file against an isolated temporary root.
set -Eeuo pipefail

archive="${1:-}"
deploy_id="${2:-}"
layout="${3:-}"
base_root="${4:-/opt/chatwoot}"

[[ "$deploy_id" =~ ^[0-9a-f]{12}-[0-9]{14}-[0-9]+$ ]] || {
  echo "remote-swap-runtime: unsafe deployment id" >&2; exit 2;
}
case "$layout" in flat|modular|modular-managed) ;; *)
  echo "remote-swap-runtime: unknown layout" >&2; exit 2 ;;
esac
[[ "$base_root" == /* && "$base_root" != / \
   && "$base_root" != *$'\n'* && "$base_root" != *$'\t'* \
   && -d "$base_root" && ! -L "$base_root" ]] || {
  echo "remote-swap-runtime: unsafe base root" >&2; exit 2;
}
if [[ "$base_root" == /opt/chatwoot ]]; then
  [[ "$archive" =~ ^/tmp/cwpt-sync\.[A-Za-z0-9]+/payload\.tgz$ ]] || {
    echo "remote-swap-runtime: unsafe archive path" >&2; exit 2;
  }
else
  [[ "${CWPT_REMOTE_SWAP_TEST_MODE:-0}" == 1 && "$archive" == "$base_root"/* ]] || {
    echo "remote-swap-runtime: alternate root is test-only" >&2; exit 2;
  }
fi
[[ -f "$archive" && ! -L "$archive" ]] || {
  echo "remote-swap-runtime: archive not found or unsafe" >&2; exit 1;
}

stage="$base_root/.cwpt-stage-${deploy_id}"
backup="$base_root/backups/cwpt-deploy-${deploy_id}"
[[ ! -e "$stage" && ! -L "$stage" ]] || {
  echo "remote-swap-runtime: staging path already exists" >&2; exit 2;
}
[[ ! -e "$backup" && ! -L "$backup" ]] || {
  echo "remote-swap-runtime: backup path already exists" >&2; exit 2;
}

declare -a targets staged names types touched
target_root_created=0
if [[ "$layout" == modular || "$layout" == modular-managed ]]; then
  checkout_root="$base_root/chatwoot-power-tools"
  [[ -d "$checkout_root" && ! -L "$checkout_root" ]] || {
    echo "remote-swap-runtime: modular checkout root is missing or unsafe" >&2; exit 2;
  }
  if [[ "$layout" == modular-managed ]]; then
    target_root="$checkout_root/.cwpt-runtime"
    if [[ -e "$target_root" || -L "$target_root" ]]; then
      [[ -d "$target_root" && ! -L "$target_root" ]] || {
        echo "remote-swap-runtime: managed runtime root is unsafe" >&2; exit 2;
      }
    fi
  else
    target_root="$checkout_root"
  fi
  targets=("$target_root/modules" "$target_root/docker-compose.addons.yml")
  staged=("$stage/modules" "$stage/docker-compose.addons.yml")
  names=(modules docker-compose.addons.yml)
  types=(dir file)
else
  target_root="$base_root"
  [[ -d "$target_root/engine" && ! -L "$target_root/engine" \
     && -d "$target_root/webapp" && ! -L "$target_root/webapp" ]] || {
    echo "remote-swap-runtime: flat target roots are missing or unsafe" >&2; exit 2;
  }
  targets=("$target_root/engine/src" "$target_root/engine/migrations" "$target_root/webapp/dist")
  staged=("$stage/engine/src" "$stage/engine/migrations" "$stage/webapp/dist")
  names=(engine-src engine-migrations webapp-dist)
  types=(dir dir dir)
fi
touched=()

committed=0
rollback() {
  local status=$? i old rollback_failed=0
  trap - EXIT HUP INT TERM
  set +e
  if [[ $committed -eq 0 ]]; then
    for ((i=${#targets[@]}-1; i>=0; i--)); do
      old="$backup/${names[$i]}"
      if [[ -e "$old" || -L "$old" ]]; then
        if ! rm -rf -- "${targets[$i]}"; then
          rollback_failed=1
          continue
        fi
        if [[ "${CWPT_REMOTE_SWAP_TEST_MODE:-0}" == 1 \
              && "${CWPT_SWAP_FAIL_ROLLBACK_MOVE:-0}" == 1 ]]; then
          rollback_failed=1
          continue
        fi
        mv -- "$old" "${targets[$i]}" || rollback_failed=1
      elif [[ "${touched[$i]:-0}" == 1 ]]; then
        rm -rf -- "${targets[$i]}" || rollback_failed=1
      fi
    done
    if [[ $rollback_failed -eq 0 ]]; then
      rm -f -- "$backup/DEPLOYMENT"
      rmdir "$backup" 2>/dev/null || true
      if [[ $target_root_created -eq 1 ]]; then
        rmdir "$target_root" 2>/dev/null || true
      fi
    else
      echo "remote-swap-runtime: rollback incomplete; backup preserved at $backup" >&2
    fi
  fi
  rm -rf -- "$stage" || {
    echo "remote-swap-runtime: could not remove staging path $stage" >&2
    [[ $status -ne 0 ]] || status=1
  }
  exit "$status"
}
trap rollback EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

# Reject traversal and non-regular archive entries even if this helper is invoked outside
# the normal git-archive path. Committed manifests independently reject symlinks/gitlinks.
tar -tzf "$archive" | while IFS= read -r member; do
  [[ "$member" =~ ^[A-Za-z0-9_./@+-]+$ \
     && "$member" != /* && "$member" != ".." && "$member" != ../* \
     && "$member" != */../* && "$member" != */.. ]] || exit 3
done
if tar -tvzf "$archive" | awk 'substr($1,1,1) != "-" && substr($1,1,1) != "d" { bad=1 } END { exit !bad }'; then
  echo "remote-swap-runtime: archive contains a symlink or special entry" >&2
  exit 3
fi

mkdir -m 700 "$stage"
tar -C "$stage" -xzf "$archive"

if [[ "$layout" == modular || "$layout" == modular-managed ]]; then
  [[ -d "$stage/modules/sequences/engine/src" && ! -L "$stage/modules" \
     && -f "$stage/modules/sequences/engine/src/index.js" \
     && -f "$stage/modules/sequences/engine/src/campaigns.js" \
     && -d "$stage/modules/sequences/engine/migrations" \
     && -f "$stage/modules/sequences/webapp/dist/index.html" \
     && -f "$stage/docker-compose.addons.yml" && ! -L "$stage/docker-compose.addons.yml" ]] || {
    echo "remote-swap-runtime: modular payload is incomplete" >&2; exit 1;
  }
  if [[ "$base_root" == /opt/chatwoot ]]; then
    (cd "$base_root" && docker compose -f docker-compose.yml \
      -f "$stage/docker-compose.addons.yml" -p chatwoot config --quiet)
  fi
else
  [[ -d "$stage/engine/src" && ! -L "$stage/engine/src" \
     && -f "$stage/engine/src/index.js" \
     && -f "$stage/engine/src/campaigns.js" \
     && -d "$stage/engine/migrations" && ! -L "$stage/engine/migrations" \
     && -d "$stage/webapp/dist" && ! -L "$stage/webapp/dist" \
     && -f "$stage/webapp/dist/index.html" ]] || {
    echo "remote-swap-runtime: flat payload is incomplete" >&2; exit 1;
  }
fi

[[ ! -L "$base_root/backups" \
   && ( ! -e "$base_root/backups" || -d "$base_root/backups" ) ]] || {
  echo "remote-swap-runtime: backup root is unsafe" >&2; exit 2;
}
install -d -m 700 "$base_root/backups"
mkdir -m 700 "$backup"
printf 'commit=%s\nlayout=%s\n' "${deploy_id%%-*}" "$layout" > "$backup/DEPLOYMENT"

if [[ "$layout" == modular-managed && ! -d "$target_root" ]]; then
  mkdir -m 755 "$target_root"
  target_root_created=1
fi

for ((i=0; i<${#targets[@]}; i++)); do
  [[ ! -L "${targets[$i]}" ]] || {
    echo "remote-swap-runtime: refusing symlink target" >&2; exit 2;
  }
  if [[ -e "${targets[$i]}" ]]; then
    if [[ "${types[$i]}" == dir ]]; then
      [[ -d "${targets[$i]}" ]] || {
        echo "remote-swap-runtime: expected directory" >&2; exit 2;
      }
    else
      [[ -f "${targets[$i]}" ]] || {
        echo "remote-swap-runtime: expected regular file" >&2; exit 2;
      }
    fi
    mv -- "${targets[$i]}" "$backup/${names[$i]}"
  fi
  touched[$i]=1
  mv -- "${staged[$i]}" "${targets[$i]}"
  if [[ "${CWPT_SWAP_FAIL_UNHANDLED_DURING_INSTALL:-0}" == 1 && $i -eq 0 ]]; then
    false
  fi
done

committed=1
echo "  backup: $backup"
