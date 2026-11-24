import Database from 'better-sqlite3';

const db = new Database(process.env.DB_PATH || 'earnloop.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// All money is stored in paise (integers) to avoid floating point errors.
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','advertiser','admin')),
  balance_paise INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY,
  advertiser_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('ad','survey','offer')),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  questions TEXT NOT NULL DEFAULT '[]',
  payout_paise INTEGER NOT NULL,      -- what the shop pays per completion
  share_pct INTEGER NOT NULL,         -- % of payout the user receives
  max_completions INTEGER NOT NULL,
  min_seconds INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | active | paused | rejected | exhausted
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS starts (
  user_id INTEGER NOT NULL, campaign_id INTEGER NOT NULL, started_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, campaign_id)
);
CREATE TABLE IF NOT EXISTS completions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
  answers TEXT NOT NULL DEFAULT '[]',
  adv_paise INTEGER NOT NULL,
  user_paise INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, campaign_id)
);
CREATE TABLE IF NOT EXISTS topups (
  id INTEGER PRIMARY KEY,
  advertiser_id INTEGER NOT NULL REFERENCES users(id),
  amount_paise INTEGER NOT NULL,
  ref TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  upi TEXT NOT NULL,
  amount_paise INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | paid | rejected
  created_at INTEGER NOT NULL
);
`);

export default db;
