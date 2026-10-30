CREATE TABLE IF NOT EXISTS event_classification_reviews (
  event_id BIGINT PRIMARY KEY REFERENCES scan_events(id),
  prior_classification TEXT NOT NULL,
  classification TEXT NOT NULL CHECK(classification IN ('unclassified','likely_automated','possible_human','confirmed_human')),
  basis TEXT NOT NULL,
  reviewed_by BIGINT NOT NULL REFERENCES administrators(id),
  reviewed_at TEXT NOT NULL DEFAULT (to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

