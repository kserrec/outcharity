-- Keep only daily, bot-filtered Cloudflare Web Analytics totals. No individual visit, IP address,
-- browser detail, or other visitor-level record is copied into Outcharity's database.
CREATE TABLE web_analytics_daily (
  day TEXT PRIMARY KEY NOT NULL CHECK (
    length(day) = 10
    AND day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  visits INTEGER NOT NULL CHECK (visits >= 0),
  fetched_at TEXT NOT NULL
);

-- A separate success marker distinguishes a real zero from analytics that have never synced.
CREATE TABLE web_analytics_sync (
  singleton INTEGER PRIMARY KEY NOT NULL DEFAULT 1 CHECK (singleton = 1),
  last_success_at TEXT NOT NULL
);
