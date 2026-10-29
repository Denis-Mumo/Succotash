ALTER TABLE scan_events ADD COLUMN source_ip TEXT NOT NULL DEFAULT 'unknown';
CREATE INDEX IF NOT EXISTS scan_events_qr_code ON scan_events(qr_code_id);
CREATE INDEX IF NOT EXISTS scan_events_source_ip ON scan_events(source_ip);
