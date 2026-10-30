const fs = require('node:fs');
const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');
const config = require('../config/env');

if (config.databaseUrl) {
  const { Pool } = require('pg');
  const { convert } = require('./postgres-sql');
  const context = new AsyncLocalStorage();
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 1,
    ssl: config.databaseSsl ? { rejectUnauthorized: true } : undefined,
  });
  const query = async (sql, params = []) => {
    if (/^\s*PRAGMA\b/i.test(sql)) return { rows: [], rowCount: 0 };
    const client = context.getStore() || pool;
    return client.query(convert(sql), params);
  };
  const run = async (sql, params = []) => {
    let statement = sql;
    const insert = /^\s*INSERT\b/i.test(statement);
    const hasGeneratedId = !/^\s*INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+(migrations|participant_identity_mapping|event_classification_reviews)\b/i.test(statement);
    if (insert && hasGeneratedId && !/\bRETURNING\b/i.test(statement)) statement += ' RETURNING id';
    const result = await query(statement, params);
    return { lastID: result.rows?.[0]?.id ?? undefined, changes: result.rowCount ?? 0 };
  };
  const get = async (sql, params = []) => (await query(sql, params)).rows[0];
  const all = async (sql, params = []) => (await query(sql, params)).rows;
  const exec = async (sql) => { if (!/^\s*PRAGMA\b/i.test(sql)) await query(sql); };
  const transaction = async (fn) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await context.run(client, fn);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  };
  module.exports = { run, get, all, exec, transaction, close: () => pool.end(), pool, raw: { close: () => pool.end() }, dialect: 'postgres' };
} else {
  const sqlite3 = module.require('sqlite3').verbose();
  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
  const raw = new sqlite3.Database(config.databasePath);
  raw.configure('busyTimeout', 5000);
  const run = (sql, params = []) => new Promise((resolve, reject) => raw.run(sql, params, function (err) { err ? reject(err) : resolve({ lastID: this.lastID, changes: this.changes }); }));
  const get = (sql, params = []) => new Promise((resolve, reject) => raw.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
  const all = (sql, params = []) => new Promise((resolve, reject) => raw.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows)));
  const exec = (sql) => new Promise((resolve, reject) => raw.exec(sql, err => err ? reject(err) : resolve()));
  const transaction = async (fn) => { await run('BEGIN IMMEDIATE'); try { const result = await fn(); await run('COMMIT'); return result; } catch (e) { await run('ROLLBACK'); throw e; } };
  module.exports = { raw, run, get, all, exec, transaction, close: () => new Promise((resolve,reject)=>raw.close(err=>err?reject(err):resolve())), dialect: 'sqlite' };
}
