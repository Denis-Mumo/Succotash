CREATE TABLE IF NOT EXISTS administrators (
  id BIGSERIAL PRIMARY KEY, email TEXT NOT NULL,
  password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'admin' CHECK(role IN ('admin','privacy_admin')),
  created_at TEXT NOT NULL DEFAULT (to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), last_login_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS administrators_email_unique ON administrators(lower(email));
CREATE TABLE IF NOT EXISTS campaigns (
  id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', objective TEXT NOT NULL DEFAULT '',
  starts_at TEXT, ends_at TEXT, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','paused','completed')),
  methodology TEXT NOT NULL DEFAULT '', retention_days INTEGER NOT NULL DEFAULT 365,
  responsible_admin_id BIGINT REFERENCES administrators(id), created_at TEXT NOT NULL DEFAULT (to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at TEXT NOT NULL DEFAULT (to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE TABLE IF NOT EXISTS locations (
  id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at TEXT NOT NULL DEFAULT (to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE TABLE IF NOT EXISTS qr_codes (
  id BIGSERIAL PRIMARY KEY, campaign_id BIGINT NOT NULL REFERENCES campaigns(id), location_id BIGINT NOT NULL REFERENCES locations(id),
  token_hash TEXT NOT NULL UNIQUE, reference TEXT NOT NULL UNIQUE, label TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at TEXT NOT NULL DEFAULT (to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS placements (
  id BIGSERIAL PRIMARY KEY, qr_code_id BIGINT NOT NULL REFERENCES qr_codes(id), campaign_id BIGINT NOT NULL REFERENCES campaigns(id),
  location_id BIGINT NOT NULL REFERENCES locations(id), placed_at TEXT, removed_at TEXT, team TEXT NOT NULL DEFAULT '',
  assignment_batch TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_placement_per_code ON placements(qr_code_id) WHERE removed_at IS NULL;
CREATE TABLE IF NOT EXISTS scan_events (
  id BIGSERIAL PRIMARY KEY, event_ref TEXT NOT NULL UNIQUE, campaign_id BIGINT NOT NULL REFERENCES campaigns(id),
  qr_code_id BIGINT NOT NULL REFERENCES qr_codes(id), location_id BIGINT NOT NULL REFERENCES locations(id),
  occurred_at TEXT NOT NULL, classification TEXT NOT NULL DEFAULT 'unclassified' CHECK(classification IN ('unclassified','likely_automated','possible_human','confirmed_human')),
  method TEXT NOT NULL DEFAULT 'GET', user_agent_category TEXT NOT NULL DEFAULT 'unknown', session_ref TEXT,
  processing_status TEXT NOT NULL DEFAULT 'recorded' CHECK(processing_status IN ('recorded','processed','excluded'))
);
CREATE INDEX IF NOT EXISTS scan_events_time ON scan_events(occurred_at);
CREATE INDEX IF NOT EXISTS scan_events_campaign ON scan_events(campaign_id, occurred_at);
CREATE TABLE IF NOT EXISTS participant_records (
  id BIGSERIAL PRIMARY KEY, participant_ref TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT (to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS participant_identity_mapping (
  participant_id BIGINT PRIMARY KEY REFERENCES participant_records(id), email TEXT NOT NULL, display_name TEXT NOT NULL DEFAULT '',
  imported_at TEXT NOT NULL DEFAULT (to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), imported_by BIGINT REFERENCES administrators(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS participant_email_unique ON participant_identity_mapping(lower(email));
CREATE TABLE IF NOT EXISTS attribution_records (
  id BIGSERIAL PRIMARY KEY, event_id BIGINT NOT NULL REFERENCES scan_events(id), participant_id BIGINT NOT NULL REFERENCES participant_records(id),
  basis TEXT NOT NULL, confidence TEXT NOT NULL CHECK(confidence IN ('low','medium','high')),
  created_by BIGINT NOT NULL REFERENCES administrators(id), created_at TEXT NOT NULL DEFAULT (to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY, administrator_id BIGINT REFERENCES administrators(id), action TEXT NOT NULL,
  entity_type TEXT NOT NULL, entity_id TEXT, details TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE INDEX IF NOT EXISTS audit_logs_time ON audit_logs(created_at);
CREATE TABLE IF NOT EXISTS assessment_reports (
  id BIGSERIAL PRIMARY KEY, campaign_id BIGINT REFERENCES campaigns(id), title TEXT NOT NULL, content_json TEXT NOT NULL,
  generated_by BIGINT NOT NULL REFERENCES administrators(id), created_at TEXT NOT NULL DEFAULT (to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));

