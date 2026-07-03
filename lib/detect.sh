#!/usr/bin/env bash
# lib/detect.sh
#
# Dynamic environment discovery for a self-hosted Chatwoot Docker Compose deployment.
# Every value here is discovered at run time — install.sh must never hardcode a compose
# directory, container name, project name, or reverse-proxy flavor. Verified against two
# independent Chatwoot hosts during Phase 0 (docs/superpowers/discovery-2026-07-03.md):
# both happened to agree on every value, but a third-party deployment easily won't, hence
# the multi-strategy detection below (docker compose ls -> common-path fallback for the
# directory, compose ps -> `docker ps` name-grep fallback for containers).
#
# Meant to be sourced (`source lib/detect.sh`), not executed directly. Deliberately has no
# top-level `set -e`/`set -u` — sourcing this into install.sh or a test must never change
# the calling shell's options; each function checks its own commands explicitly instead.

# Common self-hosted install locations, tried only when `docker compose ls` can't resolve
# a project (e.g. the stack is fully stopped, or the docker CLI has no `compose ls`).
_CWPT_COMMON_COMPOSE_DIRS=(/opt/chatwoot /root/chatwoot /srv/chatwoot /data/chatwoot)

# Chatwoot's official self-hosted docker-compose.yml always references this image — on both
# discovery hosts and in Chatwoot's own docs. It's the one safe, public signature to grep
# for when recognizing "this compose project is Chatwoot" among possibly many projects on
# the host. Not a private identifier: it is the open-source product's own image name.
_CWPT_IMAGE_SIGNATURE='chatwoot/chatwoot'

# _cwpt_compose_ls_objects
#   Prints one `docker compose ls --all --format json` project object per line. Dependency-
#   free (no jq): the fields Compose emits here are always simple strings, never nested, so
#   a naive `},{` boundary split safely turns the compact array into one object per line.
#   Prints nothing and returns 1 if docker/compose is unavailable or the call fails.
_cwpt_compose_ls_objects() {
  command -v docker >/dev/null 2>&1 || return 1
  local json
  json="$(docker compose ls --all --format json 2>/dev/null)" || return 1
  [ -n "$json" ] || return 1
  # Trailing \n matters: without it, `while read` silently drops the last (or only) object.
  printf '%s\n' "$json" | sed -E 's/^\[//; s/\]$//; s/\},\{/}\n{/g'
}

# _cwpt_json_field <json_object_line> <field>
#   Extracts a single top-level string field's value from one flat JSON object line.
#   Always exits 0 (even when the field is absent, e.g. no `grep` match) — the trailing
#   `|| true` matters: this is sourced into install.sh, which runs under
#   `set -e -o pipefail`, and an unguarded pipeline failure here would abort the whole
#   installer instead of falling through to this function's normal "field not found"
#   (empty output) case. (A `return 0` on its own following line would NOT be enough —
#   `set -e` aborts at the failing statement itself, before a later line ever runs.)
_cwpt_json_field() {
  printf '%s' "$1" | grep -o "\"$2\":\"[^\"]*\"" | head -n1 | sed -E "s/\"$2\":\"([^\"]*)\"/\1/" || true
}

# detect_compose_dir
#   Prints the absolute path to the directory holding Chatwoot's docker-compose.yml (and
#   .env). Exit 1, nothing printed, if no candidate is found.
detect_compose_dir() {
  local obj cfgs dir
  while IFS= read -r obj; do
    [ -n "$obj" ] || continue
    cfgs="$(_cwpt_json_field "$obj" ConfigFiles)"
    [ -n "$cfgs" ] || continue
    dir="$(dirname "${cfgs%%,*}")"
    if [ -f "${dir}/docker-compose.yml" ] && grep -q "$_CWPT_IMAGE_SIGNATURE" "${dir}/docker-compose.yml" 2>/dev/null; then
      printf '%s\n' "$dir"
      return 0
    fi
  done < <(_cwpt_compose_ls_objects)

  for dir in "${_CWPT_COMMON_COMPOSE_DIRS[@]}"; do
    if [ -f "${dir}/docker-compose.yml" ] && grep -q "$_CWPT_IMAGE_SIGNATURE" "${dir}/docker-compose.yml" 2>/dev/null; then
      printf '%s\n' "$dir"
      return 0
    fi
  done
  return 1
}

# _cwpt_detect_compose_project <compose_dir>
#   Prints the live docker-compose project name for <compose_dir> (from `docker compose
#   ls` — the authoritative source, matching whatever name the stack was originally
#   brought up with), falling back to the directory's basename (Compose's own default
#   naming rule) when the project can't be resolved (stack down, docker missing, etc).
#   Not part of the Task 3.1 public interface — a small install.sh-only helper so
#   `docker compose -p <project> up` joins the SAME project/network as the already-running
#   Chatwoot stack instead of a guessed name.
_cwpt_detect_compose_project() {
  local compose_dir="$1" obj cfgs dir name
  while IFS= read -r obj; do
    [ -n "$obj" ] || continue
    cfgs="$(_cwpt_json_field "$obj" ConfigFiles)"
    [ -n "$cfgs" ] || continue
    dir="$(dirname "${cfgs%%,*}")"
    if [ "$dir" = "$compose_dir" ]; then
      name="$(_cwpt_json_field "$obj" Name)"
      if [ -n "$name" ]; then
        printf '%s\n' "$name"
        return 0
      fi
    fi
  done < <(_cwpt_compose_ls_objects)
  basename "$compose_dir"
}

# detect_service_container <compose_dir> <service>
#   Prints the full container name (no leading slash) running compose service <service>
#   (e.g. "rails", "postgres") inside <compose_dir>'s project. Exit 1 if none found.
detect_service_container() {
  local compose_dir="$1" service="$2"
  [ -n "$compose_dir" ] && [ -n "$service" ] || return 1

  # Every pipeline below ends in `|| true`: this runs under install.sh's `set -e
  # -o pipefail`, and a "no match" (e.g. grep/head finding nothing) must fall through to
  # the next detection strategy, not abort the whole installer.
  local cid name
  cid="$(docker compose --project-directory "$compose_dir" ps -q "$service" 2>/dev/null | head -n1)" || true
  if [ -n "$cid" ]; then
    name="$(docker inspect --format '{{.Name}}' "$cid" 2>/dev/null)" || true
    if [ -n "$name" ]; then
      printf '%s\n' "${name#/}"
      return 0
    fi
  fi

  # Fallback: the project couldn't be resolved (e.g. an incomplete .env at detect-time) but
  # the container may already be running — match it by name directly against `docker ps`.
  name="$(docker ps --format '{{.Names}}' 2>/dev/null | grep -Ei "(^|[-_])${service}([-_0-9]|\$)" | head -n1)" || true
  if [ -n "$name" ]; then
    printf '%s\n' "$name"
    return 0
  fi
  return 1
}

# read_env_var <compose_dir> <VAR>
#   Prints the value of VAR from <compose_dir>/.env to stdout (first match, unquoted). The
#   caller is responsible for not echoing the result when VAR holds a secret. Exit 1 if the
#   file or the variable is missing.
read_env_var() {
  local compose_dir="$1" var="$2" file line value
  [ -n "$compose_dir" ] && [ -n "$var" ] || return 1
  file="${compose_dir}/.env"
  [ -f "$file" ] || return 1

  line="$(grep -m1 -E "^${var}=" "$file" 2>/dev/null)" || return 1
  [ -n "$line" ] || return 1
  value="${line#*=}"
  value="${value%\"}"; value="${value#\"}"
  value="${value%\'}"; value="${value#\'}"
  printf '%s\n' "$value"
}

# detect_reverse_proxy
#   Prints one of: caddy-host | caddy-docker | nginx | traefik | none. Always exits 0.
detect_reverse_proxy() {
  if command -v caddy >/dev/null 2>&1; then
    echo "caddy-host"
    return 0
  fi

  local images=""
  if command -v docker >/dev/null 2>&1; then
    images="$(docker ps --format '{{.Image}}' 2>/dev/null)" || true
  fi
  if printf '%s' "$images" | grep -qi 'caddy'; then
    echo "caddy-docker"
  elif printf '%s' "$images" | grep -qi 'traefik'; then
    echo "traefik"
  elif printf '%s' "$images" | grep -qi 'nginx'; then
    echo "nginx"
  else
    echo "none"
  fi
}
