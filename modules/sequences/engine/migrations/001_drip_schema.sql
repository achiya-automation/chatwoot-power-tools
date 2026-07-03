CREATE SCHEMA IF NOT EXISTS drip;
CREATE TABLE IF NOT EXISTS drip.schema_migrations (version text PRIMARY KEY, applied_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS drip.sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id int NOT NULL, key text NOT NULL, display_name text NOT NULL,
  enabled boolean DEFAULT true, stop_on_reply boolean DEFAULT false,
  quiet_start time, quiet_end time, skip_shabbat boolean DEFAULT true,
  created_at timestamptz DEFAULT now(), UNIQUE(account_id, key));
CREATE TABLE IF NOT EXISTS drip.sequence_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id uuid NOT NULL REFERENCES drip.sequences(id) ON DELETE CASCADE,
  step_order int NOT NULL, template_name text NOT NULL, language text DEFAULT 'he',
  category text, delay_days int DEFAULT 0, delay_hours int DEFAULT 0, params jsonb DEFAULT '[]');
CREATE TABLE IF NOT EXISTS drip.enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id int NOT NULL, conversation_id int NOT NULL, contact_id int, phone text,
  sequence_id uuid REFERENCES drip.sequences(id) ON DELETE SET NULL,
  current_step int DEFAULT 0, next_send_at timestamptz,
  status text DEFAULT 'active', last_sent_at timestamptz, UNIQUE(account_id, conversation_id));
CREATE INDEX IF NOT EXISTS idx_enr_due ON drip.enrollments(status, next_send_at);
CREATE TABLE IF NOT EXISTS drip.account_tokens (
  account_id int PRIMARY KEY, chatwoot_token text NOT NULL, base_url text);
