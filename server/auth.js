'use strict';
/**
 * Distribution Pro - authentication, roles & permissions
 */

const { db } = require('./db');
const U = require('./util');

/* ------------------------------------------------------------------ roles */
const PERMISSIONS = [
  'dashboard.view',
  'pos.use',
  'invoices.view',
  'invoices.create',
  'invoices.void',
  'returns.view',
  'returns.create',
  'orders.view',
  'orders.create',
  'van.view',
  'van.create',
  'van.settle',
  'customers.view',
  'customers.manage',
  'products.view',
  'products.manage',
  'stock.view',
  'stock.adjust',
  'transfers.view',
  'transfers.create',
  'transfers.receive',
  'purchases.view',
  'purchases.create',
  'purchase_returns.view',
  'purchase_returns.create',
  'suppliers.view',
  'suppliers.manage',
  'receipts.view',
  'receipts.create',
  'receipts.cheque',
  'payments.view',
  'payments.create',
  'expenses.view',
  'expenses.create',
  'closing.view',
  'closing.create',
  'schemes.view',
  'schemes.manage',
  'claims.view',
  'claims.manage',
  'commissions.view',
  'commissions.manage',
  'targets.view',
  'targets.manage',
  'visits.view',
  'visits.create',
  'reports.view',
  'reports.profit',
  'masters.view',
  'masters.manage',
  'users.manage',
  'settings.manage',
  'audit.view',
  'backup.manage',
  'cost.view',
  'override.use',
];

const ALL = PERMISSIONS.slice();

const ROLE_PERMISSIONS = {
  ADMIN: ALL,
  MANAGER: ALL.filter(
    (p) => !['users.manage', 'backup.manage', 'settings.manage'].includes(p)
  ).concat(['settings.manage']),
  ACCOUNTANT: [
    'dashboard.view', 'invoices.view', 'returns.view', 'receipts.view', 'receipts.create', 'receipts.cheque',
    'payments.view', 'payments.create', 'expenses.view', 'expenses.create', 'closing.view', 'closing.create',
    'reports.view', 'reports.profit', 'masters.view', 'suppliers.view', 'customers.view', 'products.view',
    'stock.view', 'purchases.view', 'purchase_returns.view', 'claims.view', 'claims.manage',
    'commissions.view', 'commissions.manage', 'targets.view', 'audit.view', 'cost.view', 'orders.view', 'van.view',
  ],
  CASHIER: [
    'dashboard.view', 'pos.use', 'invoices.view', 'invoices.create', 'returns.view', 'returns.create',
    'receipts.view', 'receipts.create', 'customers.view', 'customers.manage', 'products.view', 'stock.view',
    'closing.view', 'closing.create', 'orders.view', 'orders.create', 'schemes.view', 'reports.view',
    'masters.view', 'purchases.view', 'targets.view',
  ],
  WAREHOUSE: [
    'dashboard.view', 'products.view', 'products.manage', 'suppliers.view', 'suppliers.manage', 'stock.view',
    'stock.adjust', 'purchases.view', 'purchases.create', 'purchase_returns.view', 'purchase_returns.create',
    'transfers.view', 'transfers.create', 'transfers.receive', 'van.view', 'van.create', 'van.settle',
    'invoices.view', 'reports.view', 'masters.view', 'customers.view', 'orders.view', 'cost.view', 'schemes.view',
  ],
  SALESMAN: [
    'dashboard.view', 'orders.view', 'orders.create', 'customers.view', 'customers.manage', 'products.view',
    'receipts.view', 'receipts.create', 'van.view', 'invoices.view', 'stock.view', 'targets.view',
    'commissions.view', 'visits.view', 'visits.create', 'schemes.view',
  ],
};

const ROLE_LABELS = {
  ADMIN: 'Admin / Malik',
  MANAGER: 'Manager',
  ACCOUNTANT: 'Accountant',
  CASHIER: 'Billing Operator',
  WAREHOUSE: 'Godown Keeper',
  SALESMAN: 'Salesman',
};

function permissionsOf(role) {
  return ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.CASHIER;
}
function can(user, perm) {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;
  const list = user.permissions || permissionsOf(user.role);
  if (list.includes(perm)) return true;
  // wildcard support e.g. invoices.*
  const [group] = String(perm).split('.');
  return list.includes(group + '.*');
}

/* ------------------------------------------------------------------ users */
function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    full_name: u.full_name,
    role: u.role,
    role_label: ROLE_LABELS[u.role] || u.role,
    salesman_id: u.salesman_id || null,
    phone: u.phone,
    permissions: permissionsOf(u.role),
  };
}

function createUser({ username, password, full_name, role, salesman_id, phone }) {
  const exists = db().get('SELECT id FROM users WHERE username=?', String(username).toLowerCase());
  if (exists) throw new Error('Yeh username pehle se mojood hai: ' + username);
  const id = db().insert('users', {
    username: String(username).toLowerCase(),
    full_name: full_name || username,
    password_hash: U.hashPassword(password || 'admin123'),
    role: role || 'CASHIER',
    salesman_id: salesman_id || null,
    phone: phone || null,
    active: 1,
    created_at: U.nowIso(),
  });
  return publicUser(db().get('SELECT * FROM users WHERE id=?', id));
}

function setPassword(userId, password) {
  db().run('UPDATE users SET password_hash=? WHERE id=?', U.hashPassword(password), userId);
}

function login(username, password) {
  const u = db().get('SELECT * FROM users WHERE username=?', String(username || '').toLowerCase().trim());
  if (!u || !u.active) throw new Error('Username ya password ghalat hai');
  if (!U.verifyPassword(password, u.password_hash)) throw new Error('Username ya password ghalat hai');
  const token = U.token(32);
  const now = U.nowIso();
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString().slice(0, 19).replace('T', ' ');
  db().run('INSERT INTO sessions (token,user_id,created_at,last_seen,expires_at) VALUES (?,?,?,?,?)', token, u.id, now, now, expires);
  db().run('UPDATE users SET last_login=? WHERE id=?', now, u.id);
  return { token, user: publicUser(u) };
}

function logout(token) {
  if (token) db().run('DELETE FROM sessions WHERE token=?', token);
}

function userFromToken(token) {
  if (!token) return null;
  const s = db().get('SELECT * FROM sessions WHERE token=?', token);
  if (!s) return null;
  if (String(s.expires_at) < U.nowIso()) {
    db().run('DELETE FROM sessions WHERE token=?', token);
    return null;
  }
  const u = db().get('SELECT * FROM users WHERE id=?', s.user_id);
  if (!u || !u.active) return null;
  db().run('UPDATE sessions SET last_seen=? WHERE token=?', U.nowIso(), token);
  if (!u.last_seen_tick || Date.now() - (u.last_seen_tick || 0) > 60000) u.last_seen_tick = Date.now();
  return publicUser(u);
}

function checkManagerPin(pin) {
  const row = db().get('SELECT value FROM settings WHERE key=?', 'manager_pin');
  const real = row ? row.value : '1234';
  return String(pin || '') === String(real || '1234');
}

module.exports = {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  ROLE_LABELS,
  permissionsOf,
  can,
  publicUser,
  createUser,
  setPassword,
  login,
  logout,
  userFromToken,
  checkManagerPin,
};
