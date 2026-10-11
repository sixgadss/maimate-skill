CREATE TABLE IF NOT EXISTS preferences (
  user_id TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL,
  PRIMARY KEY(user_id, id)
) STRICT;
CREATE TABLE IF NOT EXISTS memory_events (
  user_id TEXT NOT NULL, kind TEXT NOT NULL, dedupe_key TEXT NOT NULL,
  id TEXT NOT NULL, payload TEXT NOT NULL,
  PRIMARY KEY(user_id, kind, dedupe_key)
) STRICT;
CREATE TABLE IF NOT EXISTS orders (
  user_id TEXT NOT NULL, provider TEXT NOT NULL, external_order_id TEXT NOT NULL,
  payload TEXT NOT NULL, learning_eligible INTEGER NOT NULL,
  PRIMARY KEY(user_id, provider, external_order_id)
) STRICT;
CREATE TABLE IF NOT EXISTS memory_settings (
  user_id TEXT PRIMARY KEY, payload TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE TABLE IF NOT EXISTS decisions (
  user_id TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL,
  selection TEXT,
  PRIMARY KEY(user_id, id)
) STRICT;
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY) STRICT;
INSERT OR IGNORE INTO schema_migrations(version) VALUES (1);
