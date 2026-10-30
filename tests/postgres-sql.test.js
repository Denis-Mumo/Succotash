const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { convert } = require('../src/database/postgres-sql');

test('PostgreSQL SQL adapter preserves bound values while converting SQLite placeholders and dates', () => {
  const sql = convert("SELECT id FROM administrators WHERE email=? COLLATE NOCASE AND created_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  assert.equal(sql, `SELECT id FROM administrators WHERE lower(email)=lower($1) AND created_at <= to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);
});

test('PostgreSQL migrations include awareness, scan IP indexes and durable session storage', () => {
  const folder = path.join(__dirname, '../src/database/postgres-migrations');
  const migrations = fs.readdirSync(folder).sort().map(name => fs.readFileSync(path.join(folder, name), 'utf8')).join('\n');
  assert.match(migrations, /CREATE TABLE IF NOT EXISTS awareness_assessments/);
  assert.match(migrations, /source_ip TEXT NOT NULL DEFAULT 'unknown'/);
  assert.match(migrations, /scan_events_source_ip ON scan_events\(source_ip\)/);
  assert.match(migrations, /CREATE TABLE IF NOT EXISTS web_sessions/);
  assert.doesNotMatch(migrations, /strftime\(|COLLATE NOCASE|PRAGMA/i);
});

test('PostgreSQL adapter converts SQLite conflict, text-search and boolean aggregate expressions', () => {
  assert.equal(convert('INSERT OR IGNORE INTO migrations(name) VALUES (?)'), 'INSERT INTO migrations(name) VALUES ($1) ON CONFLICT DO NOTHING');
  assert.equal(convert('SELECT instr(lower(a.staff_number),lower(?))>0 FROM awareness_assessments a'), 'SELECT position(lower($1) in lower(a.staff_number))>0 FROM awareness_assessments a');
  assert.equal(convert("SELECT sum(e.classification='confirmed_human') FROM scan_events e"), "SELECT sum((e.classification='confirmed_human')::int) FROM scan_events e");
});
