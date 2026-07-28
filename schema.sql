CREATE TABLE IF NOT EXISTS commands (id TEXT PRIMARY KEY, command TEXT, status TEXT DEFAULT 'pending', result TEXT DEFAULT '', created_at INTEGER);
