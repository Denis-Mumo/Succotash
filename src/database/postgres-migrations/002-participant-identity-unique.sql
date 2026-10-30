CREATE UNIQUE INDEX IF NOT EXISTS participant_email_unique ON participant_identity_mapping(lower(email));
