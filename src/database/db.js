const sqlite3 = require('sqlite3').verbose();
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config/env');

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
const raw = new sqlite3.Database(config.databasePath);
raw.configure('busyTimeout', 5000);
const run = (sql, params = []) => new Promise((resolve, reject) => raw.run(sql, params, function (err) { err ? reject(err) : resolve({ lastID: this.lastID, changes: this.changes }); }));
const get = (sql, params = []) => new Promise((resolve, reject) => raw.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
const all = (sql, params = []) => new Promise((resolve, reject) => raw.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows)));
const exec = (sql) => new Promise((resolve, reject) => raw.exec(sql, err => err ? reject(err) : resolve()));
const transaction = async (fn) => { await run('BEGIN IMMEDIATE'); try { const result = await fn(); await run('COMMIT'); return result; } catch (e) { await run('ROLLBACK'); throw e; } };
module.exports = { raw, run, get, all, exec, transaction };
