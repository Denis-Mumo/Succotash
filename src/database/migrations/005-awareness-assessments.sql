CREATE TABLE IF NOT EXISTS awareness_assessments (
  id INTEGER PRIMARY KEY,
  scan_event_id INTEGER NOT NULL UNIQUE REFERENCES scan_events(id) ON DELETE CASCADE,
  staff_number TEXT NOT NULL,
  company TEXT CHECK(company IS NULL OR company IN ('SKL','CHRS','POL')),
  phone_number TEXT,
  qr_code_id INTEGER NOT NULL REFERENCES qr_codes(id),
  ip_address TEXT NOT NULL DEFAULT 'unknown',
  scanned_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'started' CHECK(status IN ('started','completed','needs_training')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS awareness_assessments_qr_code ON awareness_assessments(qr_code_id);
CREATE INDEX IF NOT EXISTS awareness_assessments_staff_number ON awareness_assessments(staff_number);
CREATE INDEX IF NOT EXISTS awareness_assessments_company ON awareness_assessments(company);
CREATE INDEX IF NOT EXISTS awareness_assessments_ip_address ON awareness_assessments(ip_address);
CREATE INDEX IF NOT EXISTS awareness_assessments_scanned_at ON awareness_assessments(scanned_at);
CREATE INDEX IF NOT EXISTS awareness_assessments_status ON awareness_assessments(status);
