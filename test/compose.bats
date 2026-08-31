#!/usr/bin/env bats
# Validates docker-compose.addons.yml is portable (no private literals) and fully env-driven.

@test "addons compose has no achiya/private literals" {
  run grep -c "achiya" docker-compose.addons.yml
  [ "$output" -eq 0 ]
}

@test "addons compose reads DATABASE_URL from CWPT_DATABASE_URL env" {
  run grep -q 'DATABASE_URL: ${CWPT_DATABASE_URL:-}' docker-compose.addons.yml
  [ "$status" -eq 0 ]
}

@test "addons compose passes the exact installer module selection" {
  run grep -q 'CWPT_ENABLED_MODULES: ${CWPT_ENABLED_MODULES:-import,sequences,enhancements}' docker-compose.addons.yml
  [ "$status" -eq 0 ]
}

@test "addons compose passes the per-install deployment identity" {
  grep -q 'CWPT_DEPLOY_ID: ${CWPT_DEPLOY_ID:-}' docker-compose.addons.yml
}

@test "addons compose sets PUBLIC_BASE_URL from env (WhatsApp media-url fix)" {
  run grep -q 'PUBLIC_BASE_URL: ${CWPT_PUBLIC_BASE_URL}' docker-compose.addons.yml
  [ "$status" -eq 0 ]
}

@test "external Journey intake secret is env-driven and independently named" {
  run grep -q 'JOURNEY_INTAKE_SECRET: ${CWPT_JOURNEY_INTAKE_SECRET:-}' docker-compose.addons.yml
  [ "$status" -eq 0 ]
}

@test "addons compose service is branded cwpt-engine" {
  run grep -q 'cwpt-engine' docker-compose.addons.yml
  [ "$status" -eq 0 ]
}

@test "addons compose keeps engine loopback-only" {
  run grep -q '127.0.0.1:3100:3100' docker-compose.addons.yml
  [ "$status" -eq 0 ]
}

@test "addons compose build context is overridable via CWPT_BUILD_CONTEXT" {
  run grep -qE 'context: \$\{CWPT_BUILD_CONTEXT' docker-compose.addons.yml
  [ "$status" -eq 0 ]
}
