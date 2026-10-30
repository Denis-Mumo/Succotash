CREATE TABLE IF NOT EXISTS web_sessions (
  sid varchar NOT NULL PRIMARY KEY,
  sess json NOT NULL,
  expire timestamp(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_web_sessions_expire ON web_sessions(expire);
