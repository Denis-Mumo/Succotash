const sqlite3 = require('sqlite3').verbose();
const config = require('../src/config/env');
const db = require('../src/database/db');

if (db.dialect !== 'postgres') throw new Error('Set DATABASE_URL to the Supabase database before importing.');
const source = new sqlite3.Database(config.databasePath, sqlite3.OPEN_READONLY);
const tables = [
  'administrators', 'campaigns', 'locations', 'qr_codes', 'placements', 'scan_events',
  'participant_records', 'participant_identity_mapping', 'event_classification_reviews',
  'attribution_records', 'audit_logs', 'assessment_reports', 'awareness_assessments',
];
const sqliteAll = sql => new Promise((resolve, reject) => source.all(sql, (error, rows) => error ? reject(error) : resolve(rows)));

async function main() {
  const initialized = await db.get('SELECT name FROM migrations LIMIT 1');
  if (!initialized) throw new Error('Run npm run migrate against Supabase before importing existing records.');
  for (const table of tables) {
    const count = await db.get(`SELECT count(*) total FROM ${table}`);
    if (Number(count.total) !== 0) throw new Error(`Supabase table ${table} is not empty; refusing to risk duplicate or mixed records.`);
  }
  await db.transaction(async () => {
    for (const table of tables) {
      const rows = await sqliteAll(`SELECT * FROM ${table}`);
      if (!rows.length) continue;
      const columns = Object.keys(rows[0]);
      const sql = `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`;
      for (const row of rows) {
        // db.run uses ? placeholders in both supported database modes.
        await db.run(sql, columns.map(column => row[column]));
      }
      if (columns.includes('id')) {
        await db.get(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1), EXISTS(SELECT 1 FROM ${table}))`);
      }
      console.log(`Imported ${rows.length} rows from ${table}.`);
    }
  });
  console.log('SQLite records imported. Existing SQLite database was opened read-only and left unchanged.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  await new Promise(resolve => source.close(resolve));
  await db.close();
});
