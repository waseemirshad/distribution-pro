'use strict';
/** Distribution Pro - settings accessor with in-process cache */

const { db } = require('./db');

let cache = null;

function getSettingsMap(force) {
  if (!cache || force) {
    const rows = db().all('SELECT key, value FROM settings');
    const m = {};
    for (const r of rows) m[r.key] = r.value;
    cache = m;
  }
  return cache;
}

function setSetting(key, value) {
  db().run(
    'INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    key,
    value === undefined || value === null ? '' : String(value)
  );
  cache = null;
}

function invalidate() {
  cache = null;
}

module.exports = { getSettingsMap, setSetting, invalidate };
