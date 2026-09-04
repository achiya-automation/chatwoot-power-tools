setup() { source lib/assemble-dashboard-script.sh; }

@test "assemble with only import excludes sequences nav" {
  run assemble_dashboard_script "/chatwoot-addons" import
  [[ "$output" == *"__CW_ADDONS_BASE=\"/chatwoot-addons\""* ]]
  [[ "$output" == *"import-button"* ]]
  # הסמן שה-assembler פולט לכל חלק — לא חיפוש שם-קובץ חופשי, שנתפס גם על אזכור בהערה
  [[ "$output" != *"// part: modules/sequences/inject/sequences-nav.js"* ]]
}

@test "assemble has no hardcoded achiya domain" {
  run assemble_dashboard_script "/chatwoot-addons" import sequences enhancements
  [[ "$output" != *"achiya"* ]]
}

@test "assemble enhancements bundles campaign-modal + campaign-stats" {
  run assemble_dashboard_script "/chatwoot-addons" enhancements
  [[ "$output" == *"campaign-modal"* ]]
  [[ "$output" == *"campaign-stats"* ]]
  [[ "$output" == *"__dripCampaignStats"* ]]  # the new injector's IIFE guard — confirms its body is inlined
}

@test "assemble enhancements bundles the whatsapp theme after the i18n overlay" {
  run assemble_dashboard_script "/chatwoot-addons" enhancements
  [[ "$output" == *"// part: modules/dashboard-enhancements/parts/whatsapp-theme.js"* ]]
  [[ "$output" == *"__cwptWaTheme"* ]]          # the IIFE guard — confirms its body is inlined
  [[ "$output" == *"cwpt-wa-theme"* ]]          # the style tag id the kill switch / watchdog can look for
  # order matters: the theme must come last so its <style> lands after every other part's styles
  local i18n theme
  i18n="${output%%// part: modules/dashboard-enhancements/parts/native-i18n-he.js*}"
  theme="${output%%// part: modules/dashboard-enhancements/parts/whatsapp-theme.js*}"
  [[ "${#i18n}" -lt "${#theme}" ]]
}

@test "assemble sequences bundles journeys nav + the self-gating launch pill" {
  run assemble_dashboard_script "/chatwoot-addons" sequences
  [[ "$output" == *"// part: modules/sequences/inject/journeys-nav.js"* ]]
  [[ "$output" == *"__jrnNav"* ]]
  # journey-launch is back in: it now renders only when the account has an active,
  # manually-launchable journey — see assemble-dashboard-script.sh for the rationale.
  [[ "$output" == *"__jrnLaunch"* ]]
}
