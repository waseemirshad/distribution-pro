'use strict';
/**
 * Distribution Pro - SQLite layer (patli wrapper)
 *  - Node 22.5+ ke built-in node:sqlite par chalta hai (koi npm install nahi)
 *  - agar node:sqlite na ho to better-sqlite3 (agar install ho) use hota hai
 *  - WAL mode + foreign keys ON  => ek hi file, multi-user LAN par bhi theek
 *  - tx() nesting-safe transactions, stmt cache, param normalization
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DP_DATA_DIR
  ? path.resolve(process.env.DP_DATA_DIR)
  : process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(ROOT, 'data');
const DB_FILE = process.env.DP_DB
  ? path.resolve(process.env.DP_DB)
  : process.env.DB_FILE
    ? path.resolve(process.env.DB_FILE)
    : path.join(DATA_DIR, 'distribution-pro.db');

let impl = null;
let loadError = null;
try {
  const sqlite = require('node:sqlite');
  if (sqlite && sqlite.DatabaseSync) impl = { kind: 'node:sqlite', Ctor: sqlite.DatabaseSync };
} catch (e) {
  loadError = e;
}
if (!impl) {
  try {
    const Better = require('better-sqlite3');
    impl = { kind: 'better-sqlite3', Ctor: Better };
  } catch (e) {
    loadError = loadError || e;
  }
}

function engineInfo() {
  if (!impl) {
    return {
      ok: false,
      error:
        'SQLite engine nahi mila. Node.js 22.5+ install karein (node:sqlite built-in hai) ' +
        "ya 'npm install better-sqlite3' chalayein. Node version: " + process.version,
    };
  }
  return { ok: true, kind: impl.kind, node: process.version };
}

function normalize(v) {
  if (v === undefined || v === null) return null;
  const t = typeof v;
  if (t === 'boolean') return v ? 1 : 0;
  if (t === 'number') return Number.isFinite(v) ? v : null;
  if (t === 'bigint') return Number(v);
  if (t === 'string') return v;
  if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' ');
  if (v instanceof Uint8Array || Buffer.isBuffer(v)) return v;
  if (t === 'object') return JSON.stringify(v);
  throw new Error('Is value ko SQLite me bind nahi kiya ja sakta: ' + String(v));
}

class Db {
  constructor(file) {
    if (!impl) {
      const e = new Error(engineInfo().error);
      e.code = 'NO_SQLITE';
      throw e;
    }
    const target = file || DB_FILE;
    if (target !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
    this.file = target;
    this.kind = impl.kind;
    this.raw = new impl.Ctor(target);
    this._depth = 0;
    this._cache = new Map();
    if (target !== ':memory:') {
      try {
        this.raw.exec('PRAGMA journal_mode = WAL');
      } catch (e) {
        /* memory db ya read-only fs */
      }
    }
    this.raw.exec('PRAGMA synchronous = NORMAL');
    this.raw.exec('PRAGMA foreign_keys = ON');
    this.raw.exec('PRAGMA busy_timeout = 10000');
  }

  _stmt(sql) {
    let s = this._cache.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      if (this._cache.size > 500) this._cache.clear();
      this._cache.set(sql, s);
    }
    return s;
  }

  exec(sql) {
    this.raw.exec(sql);
    return this;
  }

  /** returns {changes, lastId} */
  run(sql, ...params) {
    const r = this._stmt(sql).run(...params.map(normalize));
    return { changes: Number(r && r.changes ? r.changes : 0), lastId: Number(r && r.lastInsertRowid ? r.lastInsertRowid : 0) };
  }

  /**
   * insert('users', {username:'ali'})              -> naya row id
   * insert('INSERT INTO users (username) VALUES (?)', 'ali') -> naya row id
   */
  insert(tableOrSql, objOrParam, ...rest) {
    if (objOrParam && typeof objOrParam === 'object' && !Array.isArray(objOrParam) && !Buffer.isBuffer(objOrParam)) {
      const table = tableOrSql;
      const row = objOrParam;
      const cols = Object.keys(row).filter((k) => row[k] !== undefined);
      if (!cols.length) throw new Error('insert: koi column nahi mila (' + table + ')');
      const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
      return this.run(sql, ...cols.map((c) => row[c])).lastId;
    }
    return this.run(tableOrSql, objOrParam, ...rest).lastId;
  }

  /** update('users', 5, {full_name:'Ali'}) -> kitne rows change hue */
  update(table, id, patch) {
    if (!patch || typeof patch !== 'object') throw new Error('update: patch object chahiye');
    const cols = Object.keys(patch).filter((k) => patch[k] !== undefined);
    if (!cols.length) return 0;
    const sql = `UPDATE ${table} SET ${cols.map((c) => `${c}=?`).join(', ')} WHERE id=?`;
    return this.run(sql, ...cols.map((c) => patch[c]), id).changes;
  }

  get(sql, ...params) {
    const r = this._stmt(sql).get(...params.map(normalize));
    return r ? Object.assign({}, r) : null;
  }

  all(sql, ...params) {
    const rows = this._stmt(sql).all(...params.map(normalize));
    return rows.map((r) => Object.assign({}, r));
  }

  /** pehla column / scalar value */
  val(sql, ...params) {
    const r = this.get(sql, ...params);
    if (!r) return null;
    const k = Object.keys(r)[0];
    return r[k];
  }

  tx(fn) {
    if (this._depth > 0) return fn();
    this.raw.exec('BEGIN IMMEDIATE');
    this._depth++;
    try {
      const out = fn();
      this.raw.exec('COMMIT');
      return out;
    } catch (e) {
      try {
        this.raw.exec('ROLLBACK');
      } catch (e2) {
        /* ignore */
      }
      throw e;
    } finally {
      this._depth--;
    }
  }

  inTx() {
    return this._depth > 0;
  }

  engine() {
    return impl.kind;
  }

  checkpoint() {
    try {
      this.raw.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      return true;
    } catch (e) {
      return false;
    }
  }

  backupTo(file) {
    const target = path.resolve(file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    this.checkpoint();
    try {
      if (typeof this.raw.backup === 'function') {
        /* node:sqlite backup (async) - fallback neeche */
      }
    } catch (e) {
      /* ignore */
    }
    fs.copyFileSync(this.file, target);
    for (const ext of ['-wal', '-shm']) {
      if (fs.existsSync(this.file + ext)) fs.rmSync(this.file + ext, { force: true });
    }
    return target;
  }

  close() {
    try {
      this.checkpoint();
    } catch (e) {
      /* ignore */
    }
    try {
      this.raw.close();
    } catch (e) {
      /* ignore */
    }
  }
}

let singleton = null;

function db(file) {
  if (!singleton) singleton = new Db(file);
  return singleton;
}
function open(file) {
  return new Db(file);
}
function closeDb() {
  if (singleton) {
    singleton.close();
    singleton = null;
  }
}
function reopenDb() {
  closeDb();
  return db();
}
function dbPath() {
  return DB_FILE;
}
function fileSizeMb() {
  try {
    let total = fs.statSync(DB_FILE).size;
    for (const ext of ['-wal']) {
      const f = DB_FILE + ext;
      if (fs.existsSync(f)) total += fs.statSync(f).size;
    }
    return Math.round((total / 1048576) * 100) / 100;
  } catch (e) {
    return 0;
  }
}

module.exports = {
  Db,
  db,
  open,
  closeDb,
  reopenDb,
  dbPath,
  fileSizeMb,
  dataDir: DATA_DIR,
  DB_FILE,
  DATA_DIR,
  ROOT,
  normalize,
  engineInfo,
};
