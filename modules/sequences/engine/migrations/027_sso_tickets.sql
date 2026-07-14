-- Single-use ledger for the mobile sign-in tickets (see src/sso.js).
--
-- A ticket rides in the dashboard-app URL that Chatwoot hands the mobile app, so it necessarily
-- passes through places that persist URLs (the reverse proxy's access log, the app's store). This
-- table is what makes a leaked ticket worthless: the first request to present it wins the INSERT
-- and gets a session; every replay loses the primary-key race and is refused.
--
-- Rows are swept opportunistically on each successful burn (exp < now), so the table stays tiny.

CREATE TABLE IF NOT EXISTS drip.used_tickets (
  jti text PRIMARY KEY,
  exp bigint NOT NULL          -- epoch ms; the row is garbage once past this
);

CREATE INDEX IF NOT EXISTS used_tickets_exp_idx ON drip.used_tickets (exp);
