setup() { source lib/assemble-dashboard-script.sh; }

@test "assemble with only import excludes sequences nav" {
  run assemble_dashboard_script "/chatwoot-addons" import
  [[ "$output" == *"__CW_ADDONS_BASE=\"/chatwoot-addons\""* ]]
  [[ "$output" == *"import-button"* ]]
  [[ "$output" != *"sequences-nav"* ]]
}

@test "assemble has no hardcoded achiya domain" {
  run assemble_dashboard_script "/chatwoot-addons" import sequences enhancements
  [[ "$output" != *"achiya"* ]]
}
