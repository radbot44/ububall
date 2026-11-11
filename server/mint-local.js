'use strict';
const { DatabaseSync } = require('node:sqlite');
const MAX_CACHE = 32;

// Local adapter; no HTTP listener, account handling or production keys.
function openStorage(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000');
  const statements = new Map();
  let depth = 0, nextSavepoint = 0;
  return {
    exec(sql, ...bindings) {
      if (/^\s*(ALTER|CREATE|DROP)\b/i.test(sql)) {
        statements.clear();
        return db.prepare(sql).all(...bindings);
      }
      let stmt = statements.get(sql);
      if (stmt) {
        statements.delete(sql);
      } else {
        if (statements.size >= MAX_CACHE) statements.delete(statements.keys().next().value);
        stmt = db.prepare(sql);
      }
      statements.set(sql, stmt);
      return stmt.all(...bindings);
    },
    transactionSync(callback) {
      if (depth === 0) {
        db.exec('BEGIN IMMEDIATE');
        depth = 1;
        try {
          const result = callback();
          db.exec('COMMIT');
          return result;
        } catch (error) {
          try { db.exec('ROLLBACK'); } catch {}
          throw error;
        } finally {
          depth = 0;
        }
      }
      const sp = `sp_${++nextSavepoint}`;
      db.exec(`SAVEPOINT ${sp}`);
      depth++;
      try {
        const result = callback();
        db.exec(`RELEASE SAVEPOINT ${sp}`);
        return result;
      } catch (error) {
        try { db.exec(`ROLLBACK TO SAVEPOINT ${sp}`); db.exec(`RELEASE SAVEPOINT ${sp}`); } catch {}
        throw error;
      } finally {
        depth--;
      }
    },
    close() {
      statements.clear();
      db.close();
    }
  };
}
module.exports = { openStorage };
