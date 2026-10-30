const fs = require('node:fs');
const path = require('node:path');
const db = require('../src/database/db');
async function main() {
  await db.exec('PRAGMA foreign_keys = ON');
  const folder = path.join(__dirname, db.dialect === 'postgres' ? '../src/database/postgres-migrations' : '../src/database/migrations');
  if (db.dialect === 'postgres') await db.exec("CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')))");
  const files=fs.readdirSync(folder).filter(name=>name.endsWith('.sql')).sort();
  let applied=0;
  for(const name of files){
    if(await db.get('SELECT name FROM migrations WHERE name = ?',[name]))continue;
    await db.exec(fs.readFileSync(path.join(folder,name),'utf8'));
    await db.run('INSERT OR IGNORE INTO migrations(name) VALUES (?)',[name]);
    console.log(`Applied ${name}`);applied++;
  }
  if(!applied)console.log('Database is up to date');
  await db.close();
}
main().catch(async e => { console.error(e.message); process.exitCode = 1; await db.close().catch(()=>{}); });
