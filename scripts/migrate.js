const fs = require('node:fs');
const path = require('node:path');
const db = require('../src/database/db');
async function main() {
  await db.exec('PRAGMA foreign_keys = ON');
  await db.exec("CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))");
  const folder = path.join(__dirname, '../src/database/migrations');
  const files=fs.readdirSync(folder).filter(name=>name.endsWith('.sql')).sort();
  let applied=0;
  for(const name of files){
    if(await db.get('SELECT name FROM migrations WHERE name = ?',[name]))continue;
    await db.exec(fs.readFileSync(path.join(folder,name),'utf8'));
    await db.run('INSERT OR IGNORE INTO migrations(name) VALUES (?)',[name]);
    console.log(`Applied ${name}`);applied++;
  }
  if(!applied)console.log('Database is up to date');
  db.raw.close();
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
