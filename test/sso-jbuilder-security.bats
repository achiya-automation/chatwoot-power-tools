#!/usr/bin/env bats

@test "dashboard SSO tickets stay on the exact panel origin and current tenant" {
  run ruby "$BATS_TEST_DIRNAME/sso_jbuilder_security_test.rb"

  [ "$status" -eq 0 ]
}
