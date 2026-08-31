-- Existing installations ran 034_presence.sql when its column defaults were permissive.
-- The application fallback has been fail-closed since 06.08.2026, but an INSERT that omits
-- these columns (manual SQL, an older dashboard, or a future integration) still inherited
-- read=true / typing=agent from PostgreSQL. Align the schema with the application default.
--
-- Do not UPDATE existing rows: an explicit per-inbox opt-in remains valid. This migration
-- changes only what a newly inserted row receives when the caller did not choose a value.

ALTER TABLE drip.presence_settings
  ALTER COLUMN read_receipts SET DEFAULT false,
  ALTER COLUMN typing_mode SET DEFAULT 'off';
