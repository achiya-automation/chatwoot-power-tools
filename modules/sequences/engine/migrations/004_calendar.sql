-- 004: Shabbat & yom-tov "no-send" windows.
-- Exact candle-lighting to havdalah windows sourced from Hebcal (Jerusalem),
-- refreshed by the engine. Replaces the hard-coded HOLIDAYS set + fixed 18:00.
CREATE TABLE IF NOT EXISTS drip.no_send_windows (
  starts_at timestamptz PRIMARY KEY,
  ends_at   timestamptz NOT NULL,
  kind      text NOT NULL DEFAULT 'shabbat'   -- 'shabbat' | 'yomtov' (metadata)
);
CREATE INDEX IF NOT EXISTS idx_nsw_range ON drip.no_send_windows (starts_at, ends_at);
