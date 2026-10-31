const config = require('./config/env');
const app = require('./app');
const db = require('./database/db');
async function start(){
  await db.exec('PRAGMA foreign_keys=ON');
  const migration=await db.get('SELECT name FROM migrations LIMIT 1');
  if(!migration) throw new Error('Database is not initialized. Run npm run migrate first.');
  app.listen(config.port,()=>console.log(`QR Security Assessment Platform listening on port ${config.port}`));
}
start().catch(e=>{console.error(e.message);process.exit(1);});
