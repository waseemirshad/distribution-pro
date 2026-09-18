'use strict';
/**
 * Distribution Pro - installation / migrations / default data
 */

const { db } = require('./db');
const U = require('./util');
const A = require('./auth');
const { getSettingsMap, setSetting } = require('./settings');
const { SCHEMA_V1, DEFAULT_SETTINGS, DEFAULT_WAREHOUSES, DEFAULT_HEADS, DEFAULT_TIERS } = require('./schema');

const MIGRATIONS = [{ version: 1, name: 'initial schema', sql: SCHEMA_V1 }];

function applyMigrations() {
  const d = db();
  d.exec('CREATE TABLE IF NOT EXISTS schema_versions (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);');
  const done = d.all('SELECT version FROM schema_versions').map((r) => Number(r.version));
  for (const m of MIGRATIONS) {
    if (done.includes(m.version)) continue;
    d.tx(() => {
      d.exec(m.sql);
      d.insert('schema_versions', { version: m.version, applied_at: U.nowIso() });
    });
  }
  return done.length;
}

function settingsMap() {
  return getSettingsMap(true);
}

function seedDefaults() {
  const d = db();
  const existing = settingsMap();
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    if (!(k in existing)) setSetting(k, v);
  }

  if (!d.val('SELECT COUNT(*) FROM warehouses')) {
    for (const w of DEFAULT_WAREHOUSES) d.insert('warehouses', w);
  }
  if (!d.val('SELECT COUNT(*) FROM expense_heads')) {
    for (const h of DEFAULT_HEADS) d.insert('expense_heads', { name: h, is_cogs: h === 'Freight Inward' ? 1 : 0, active: 1 });
  }
  if (!d.val('SELECT COUNT(*) FROM price_tiers')) {
    for (const t of DEFAULT_TIERS) d.insert('price_tiers', t);
  }

  const main = d.get('SELECT id FROM warehouses WHERE code=?', 'MAIN') || d.get('SELECT id FROM warehouses ORDER BY id LIMIT 1');
  const scrap = d.get('SELECT id FROM warehouses WHERE code=?', 'SCRAP') || d.get('SELECT id FROM warehouses ORDER BY id DESC LIMIT 1');
  if (main && !settingsMap().default_warehouse_id) setSetting('default_warehouse_id', main.id);
  if (scrap && !settingsMap().default_scrap_warehouse_id) setSetting('default_scrap_warehouse_id', scrap.id);

  // default admin user
  if (!d.val('SELECT COUNT(*) FROM users')) {
    A.createUser({ username: 'admin', password: 'admin123', full_name: 'Malik / Owner', role: 'ADMIN' });
    A.createUser({ username: 'counter', password: 'counter123', full_name: 'Counter Billing', role: 'CASHIER' });
    A.createUser({ username: 'manager', password: 'manager123', full_name: 'Manager Sahab', role: 'MANAGER' });
    A.createUser({ username: 'godown', password: 'godown123', full_name: 'Godown Keeper', role: 'WAREHOUSE' });
    A.createUser({ username: 'accounts', password: 'accounts123', full_name: 'Accountant', role: 'ACCOUNTANT' });
  }
  return true;
}

/** full boot: migrate + defaults */
function install() {
  const applied = applyMigrations();
  seedDefaults();
  return { applied, backend: db().engine(), file: db().file };
}

module.exports = { MIGRATIONS, applyMigrations, seedDefaults, install, settingsMap, setSetting };
