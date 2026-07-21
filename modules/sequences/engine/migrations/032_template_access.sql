-- 032: Template Studio access grants.
--
-- Administrators of the account always have access — that is decided from the Chatwoot
-- profile role on every request (api.js isTplAdmin), never stored here. This table only
-- names the NON-admin users an administrator explicitly let in, one row per user.
-- Deleting the row revokes access on the next request (no cache, no session to expire).
--
-- Managing the grants themselves stays administrator-only, so a granted agent can use the
-- studio but never widen access.
CREATE TABLE IF NOT EXISTS drip.template_access (
  account_id int  NOT NULL,
  user_id    int  NOT NULL,          -- Chatwoot users.id
  granted_by text,                   -- Chatwoot user id of the admin who granted it (audit)
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, user_id)
);
