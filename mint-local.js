'use strict';
const { DatabaseSync } = require('node:sqlite');

// Local adapter; no HTTP listener, account handling or production keys.
function openStorage(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000');
  return {
    exec(sql, ...bindings) { return db.prepare(sql).all(...bindings); },
    transactionSync(callback) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = callback();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    close() { db.close(); }
  };
}
module.exports = { openStorage };
