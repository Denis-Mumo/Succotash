PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS administrators (
  id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'admin' CHECK(role IN ('admin','privacy_admin')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), last_login_at TEXT
);
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', objective TEXT NOT NULL DEFAULT '',
  starts_at TEXT, ends_at TEXT, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','paused','completed')),
  methodology TEXT NOT NULL DEFAULT '', retention_days INTEGER NOT NULL DEFAULT 365,
  responsible_admin_id INTEGER REFERENCES administrators(id), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS qr_codes (
  id INTEGER PRIMARY KEY, campaign_id INTEGER NOT NULL REFERENCES campaigns(id), location_id INTEGER NOT NULL REFERENCES locations(id),
  token_hash TEXT NOT NULL UNIQUE, reference TEXT NOT NULL UNIQUE, label TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS placements (
  id INTEGER PRIMARY KEY, qr_code_id INTEGER NOT NULL REFERENCES qr_codes(id), campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
  location_id INTEGER NOT NULL REFERENCES locations(id), placed_at TEXT, removed_at TEXT, team TEXT NOT NULL DEFAULT '',
  assignment_batch TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_placement_per_code ON placements(qr_code_id) WHERE removed_at IS NULL;
CREATE TABLE IF NOT EXISTS scan_events (
  id INTEGER PRIMARY KEY, event_ref TEXT NOT NULL UNIQUE, campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
  qr_code_id INTEGER NOT NULL REFERENCES qr_codes(id), location_id INTEGER NOT NULL REFERENCES locations(id),
  occurred_at TEXT NOT NULL, classification TEXT NOT NULL DEFAULT 'unclassified' CHECK(classification IN ('unclassified','likely_automated','possible_human','confirmed_human')),
  method TEXT NOT NULL DEFAULT 'GET', user_agent_category TEXT NOT NULL DEFAULT 'unknown', session_ref TEXT,
  processing_status TEXT NOT NULL DEFAULT 'recorded' CHECK(processing_status IN ('recorded','processed','excluded'))
);
CREATE INDEX IF NOT EXISTS scan_events_time ON scan_events(occurred_at);
CREATE INDEX IF NOT EXISTS scan_events_campaign ON scan_events(campaign_id, occurred_at);
CREATE TABLE IF NOT EXISTS participant_records (
  id INTEGER PRIMARY KEY, participant_ref TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS participant_identity_mapping (
  participant_id INTEGER PRIMARY KEY REFERENCES participant_records(id), email TEXT NOT NULL, display_name TEXT NOT NULL DEFAULT '',
  imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), imported_by INTEGER REFERENCES administrators(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS participant_email_unique ON participant_identity_mapping(email COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS attribution_records (
  id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES scan_events(id), participant_id INTEGER NOT NULL REFERENCES participant_records(id),
  basis TEXT NOT NULL, confidence TEXT NOT NULL CHECK(confidence IN ('low','medium','high')),
  created_by INTEGER NOT NULL REFERENCES administrators(id), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY, administrator_id INTEGER REFERENCES administrators(id), action TEXT NOT NULL,
  entity_type TEXT NOT NULL, entity_id TEXT, details TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS audit_logs_time ON audit_logs(created_at);
CREATE TABLE IF NOT EXISTS assessment_reports (
  id INTEGER PRIMARY KEY, campaign_id INTEGER REFERENCES campaigns(id), title TEXT NOT NULL, content_json TEXT NOT NULL,
  generated_by INTEGER NOT NULL REFERENCES administrators(id), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
