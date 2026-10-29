const readline = require('node:readline/promises');
const bcrypt = require('bcryptjs');
const db = require('../src/database/db');
(async () => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const email = (await rl.question('Administrator email: ')).trim().toLowerCase();
    const password = await rl.question('Password (minimum 12 characters): ');
    if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 12) throw new Error('Use a valid email and a password of at least 12 characters.');
    const hash = await bcrypt.hash(password, 12);
    await db.run('INSERT INTO administrators(email,password_hash,role) VALUES (?,?,?)', [email, hash, 'admin']);
    console.log(`Administrator ${email} created.`);
  } catch (e) { console.error(e.message); process.exitCode = 1; }
  finally { rl.close(); db.raw.close(); }
})();
