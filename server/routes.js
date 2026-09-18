'use strict';
/**
 * Distribution Pro - HTTP API + static file server (no external dependency)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const url = require('url');

const { db, closeDb, reopenDb, dbPath } = require('./db');
const U = require('./util');
const A = require('./auth');
const SVC = require('./services');
const REPORTS = require('./reports');
const { getSettingsMap, setSetting, invalidate } = require('./settings');
const { install } = require('./install');

const WEB_DIR = path.join(__dirname, '..', 'web');
const BACKUP_DIR = path.join(path.dirname(dbPath()), 'backups');

/* ------------------------------------------------------------------ helpers */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function sendJson(res, code, data) {
  const body = JSON.stringify(data === undefined ? null : data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendFile(res, file, download) {
  if (!fs.existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }
  const ext = path.extname(file).toLowerCase();
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
  if (download) headers['Content-Disposition'] = `attachment; filename="${path.basename(file)}"`;
  headers['Content-Length'] = fs.statSync(file).size;
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}

function sendCsv(res, filename, csv) {
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': Buffer.byteLength(csv),
  });
  res.end(csv);
}

function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function need(user, perm) {
  if (!user) {
    const e = new Error('Login zaroori hai');
    e.code = 'UNAUTHORIZED';
    throw e;
  }
  if (!A.can(user, perm)) {
    const e = new Error('Is kaam ki ijazat nahi hai');
    e.code = 'FORBIDDEN';
    throw e;
  }
}

function canSeeCosts(user) {
  return A.can(user, 'cost.view');
}
function stripCost(obj) {
  if (!obj) return obj;
  const clone = { ...obj };
  for (const k of ['cost_paisa', 'cost_total_paisa', 'gross_profit_paisa', 'profit_paisa', 'cost']) delete clone[k];
  return clone;
}
function stripCostRows(rows, user) {
  if (canSeeCosts(user)) return rows;
  return (rows || []).map(stripCost);
}

/* ------------------------------------------------------------------ router */
const routes = [];
function route(method, pattern, perm, handler) {
  const keys = [];
  const re = new RegExp(
    '^' +
      pattern
        .split('/')
        .map((seg) => {
          if (seg.startsWith(':')) {
            keys.push(seg.slice(1));
            return '([^/]+)';
          }
          return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('/') +
      '$'
  );
  routes.push({ method, re, keys, perm, handler });
}

/* ------------------------------------------------------------------ crud config */
const CRUD = {
  warehouses: { perm: 'masters', label: 'Godown', table: 'warehouses', search: ['name', 'code'], order: 'id', ints: [], bools: ['active'], fields: ['code', 'name', 'type', 'address', 'active'] },
  companies: { perm: 'masters', label: 'Company', table: 'companies', search: ['name', 'city'], order: 'name', ints: [], bools: ['active'], fields: ['name', 'contact_person', 'phone', 'email', 'address', 'city', 'ntn', 'active'] },
  categories: { perm: 'masters', label: 'Category', table: 'categories', search: ['name'], order: 'name', ints: ['parent_id'], bools: ['active'], fields: ['name', 'parent_id', 'active'] },
  price_tiers: { perm: 'masters', label: 'Price Tier', table: 'price_tiers', search: ['name'], order: 'id', reals: ['discount_pct'], bools: ['is_default'], fields: ['name', 'discount_pct', 'is_default'] },
  expense_heads: { perm: 'masters', label: 'Expense Head', table: 'expense_heads', search: ['name'], order: 'name', bools: ['is_cogs', 'active'], fields: ['name', 'is_cogs', 'active'] },
  routes: { perm: 'masters', label: 'Route', table: 'routes', search: ['name', 'area'], order: 'name', bools: ['active'], fields: ['name', 'area', 'weekday', 'note', 'active'] },
  route_customers: { perm: 'masters', label: 'Route Shop', table: 'route_customers', search: [], order: 'id', ints: ['route_id', 'customer_id', 'seq'], bools: [], fields: ['route_id', 'customer_id', 'seq'] },
  salesmen: { perm: 'masters', label: 'Salesman', table: 'salesmen', search: ['name', 'phone', 'code'], order: 'name', ints: ['route_id', 'basic_salary_paisa'], reals: ['commission_pct'], bools: ['active'], fields: ['code', 'name', 'phone', 'route_id', 'vehicle_no', 'commission_pct', 'basic_salary_paisa', 'joined_at', 'active'] },
  suppliers: { perm: 'suppliers', label: 'Supplier', table: 'suppliers', search: ['name', 'phone', 'city'], order: 'name', ints: ['company_id', 'opening_balance_paisa'], bools: ['active'], fields: ['name', 'contact_person', 'phone', 'email', 'address', 'city', 'ntn', 'company_id', 'opening_balance_paisa', 'active', 'notes'] },
  customers: {
    perm: 'customers',
    label: 'Customer',
    table: 'customers',
    search: ['name', 'phone', 'code', 'area', 'owner_name'],
    order: 'name',
    ints: ['route_id', 'tier_id', 'credit_limit_paisa', 'credit_days', 'opening_balance_paisa'],
    reals: ['lat', 'lng'],
    bools: ['active'],
    fields: ['code', 'name', 'owner_name', 'phone', 'whatsapp', 'address', 'area', 'city', 'shop_type', 'route_id', 'tier_id', 'credit_limit_paisa', 'credit_days', 'opening_balance_paisa', 'ntn', 'gst_no', 'lat', 'lng', 'active', 'notes'],
  },
  products: {
    perm: 'products',
    label: 'Product',
    table: 'products',
    search: ['name', 'sku', 'barcode'],
    order: 'name',
    ints: ['company_id', 'category_id', 'carton_size', 'cost_paisa', 'wholesale_paisa', 'retail_paisa', 'reorder_level', 'shelf_life_days'],
    reals: ['tax_pct'],
    bools: ['active'],
    fields: ['sku', 'barcode', 'name', 'company_id', 'category_id', 'unit', 'carton_size', 'cost_paisa', 'wholesale_paisa', 'retail_paisa', 'tax_pct', 'reorder_level', 'shelf_life_days', 'active', 'notes'],
  },
  product_prices: { perm: 'products', label: 'Tier Price', table: 'product_prices', search: [], order: 'id', ints: ['product_id', 'tier_id', 'price_paisa'], bools: [], fields: ['product_id', 'tier_id', 'price_paisa'] },
  schemes: {
    perm: 'schemes',
    label: 'Scheme',
    table: 'schemes',
    search: ['name'],
    order: 'id',
    ints: ['product_id', 'category_id', 'company_id', 'buy_qty', 'free_qty', 'slab_min_qty', 'claimable'],
    reals: ['discount_pct'],
    bools: ['active'],
    fields: ['name', 'type', 'product_id', 'category_id', 'company_id', 'buy_qty', 'free_qty', 'slab_min_qty', 'discount_pct', 'start_date', 'end_date', 'claimable', 'active', 'notes'],
  },
  targets: { perm: 'targets', label: 'Target', table: 'targets', search: ['period'], order: 'id', ints: ['salesman_id', 'target_sales_paisa', 'target_recovery_paisa', 'target_new_outlets'], bools: [], fields: ['salesman_id', 'period', 'target_sales_paisa', 'target_recovery_paisa', 'target_new_outlets', 'note'] },
};

function coerceCrud(cfg, body) {
  const out = {};
  for (const f of cfg.fields) {
    if (!(f in body)) continue;
    let v = body[f];
    if ((cfg.ints || []).includes(f)) v = v === null || v === '' ? null : U.int(v);
    else if ((cfg.bools || []).includes(f)) v = v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0;
    else if ((cfg.reals || []).includes(f)) v = v === null || v === '' ? 0 : U.num(v);
    else if (v === '') v = null;
    out[f] = v;
  }
  return out;
}

/* ------------------------------------------------------------------ auth */
route('POST', '/api/auth/login', null, ({ body, res }) => {
  const out = A.login(body.username, body.password);
  res.setHeader('Set-Cookie', `dp_token=${out.token}; Path=/; Max-Age=2592000; SameSite=Lax`);
  SVC.audit(out.user, 'LOGIN', 'user', out.user.id, null);
  return out;
});
route('POST', '/api/auth/logout', null, ({ user, res, token }) => {
  A.logout(token);
  res.setHeader('Set-Cookie', 'dp_token=; Path=/; Max-Age=0');
  if (user) SVC.audit(user, 'LOGOUT', 'user', user.id, null);
  return { ok: true };
});
route('GET', '/api/auth/me', 'dashboard.view', ({ user }) => ({ user }));
route('POST', '/api/auth/change-password', 'dashboard.view', ({ user, body }) => {
  const me = db().get('SELECT * FROM users WHERE id=?', user.id);
  if (!U.verifyPassword(body.old_password, me.password_hash)) throw new Error('Purana password ghalat hai');
  if (!body.new_password || String(body.new_password).length < 4) throw new Error('Naya password chhota hai (4+)');
  A.setPassword(user.id, body.new_password);
  SVC.audit(user, 'CHANGE_PASSWORD', 'user', user.id, null);
  return { ok: true };
});

/* ------------------------------------------------------------------ users */
route('GET', '/api/users', 'users.manage', () =>
  db()
    .all('SELECT id, username, full_name, role, salesman_id, phone, active, last_login, created_at FROM users ORDER BY id')
    .map((u) => ({ ...u, role_label: A.ROLE_LABELS[u.role] || u.role }))
);
route('POST', '/api/users', 'users.manage', ({ user, body }) => {
  const created = A.createUser(body);
  SVC.audit(user, 'CREATE', 'user', created.id, { username: created.username, role: created.role });
  return created;
});
route('PUT', '/api/users/:id', 'users.manage', ({ user, body, params }) => {
  const id = U.int(params.id);
  const patch = {};
  for (const f of ['full_name', 'role', 'salesman_id', 'phone', 'active', 'username']) {
    if (f in body) patch[f] = f === 'active' ? (body[f] ? 1 : 0) : body[f];
  }
  if (body.password) A.setPassword(id, body.password);
  if (Object.keys(patch).length) db().update('users', id, patch);
  SVC.audit(user, 'UPDATE', 'user', id, { fields: Object.keys(patch).concat(body.password ? ['password'] : []) });
  return db().get('SELECT id, username, full_name, role, salesman_id, phone, active FROM users WHERE id=?', id);
});
route('DELETE', '/api/users/:id', 'users.manage', ({ user, params }) => {
  const id = U.int(params.id);
  if (id === user.id) throw new Error('Apna hi account delete nahi kar sakte');
  db().run('DELETE FROM users WHERE id=?', id);
  SVC.audit(user, 'DELETE', 'user', id, null);
  return { ok: true };
});
route('GET', '/api/roles', 'users.manage', () =>
  Object.keys(A.ROLE_PERMISSIONS).map((r) => ({ role: r, label: A.ROLE_LABELS[r], permissions: A.ROLE_PERMISSIONS[r] }))
);

/* ------------------------------------------------------------------ settings */
route('GET', '/api/settings', 'dashboard.view', () => getSettingsMap(true));
route('PUT', '/api/settings', 'settings.manage', ({ user, body }) => {
  for (const [k, v] of Object.entries(body || {})) setSetting(k, v);
  invalidate();
  SVC.audit(user, 'UPDATE', 'settings', null, { keys: Object.keys(body || {}) });
  return getSettingsMap(true);
});

/* ------------------------------------------------------------------ dashboard / alerts */
route('GET', '/api/dashboard', 'dashboard.view', ({ query }) => SVC.dashboard(query.date));

route('GET', '/api/alerts', 'dashboard.view', () => {
  const d = db();
  const today = U.today();
  const out = { items: [] };
  const low = d.all(
    `SELECT * FROM (
        SELECT p.name, p.reorder_level, (SELECT COALESCE(SUM(b.qty_remaining),0) FROM batches b WHERE b.product_id=p.id) AS stock
          FROM products p WHERE p.active=1 AND p.reorder_level>0)
      WHERE stock <= reorder_level ORDER BY stock ASC LIMIT 20`
  );
  for (const l of low) out.items.push({ type: 'LOW_STOCK', level: U.int(l.stock) <= 0 ? 'danger' : 'warn', title: `Stock kam: ${l.name}`, detail: `Mojood ${l.stock} pcs, reorder level ${l.reorder_level}` });
  const exp = d.all(
    `SELECT p.name, b.batch_no, b.expiry_date, b.qty_remaining, CAST(julianday(b.expiry_date)-julianday(?) AS INTEGER) AS days_left
       FROM batches b JOIN products p ON p.id=b.product_id
      WHERE b.qty_remaining>0 AND b.expiry_date IS NOT NULL AND b.expiry_date<>'' AND julianday(b.expiry_date)-julianday(?) <= 60
      ORDER BY b.expiry_date ASC LIMIT 20`,
    today,
    today
  );
  for (const e of exp) out.items.push({ type: 'EXPIRY', level: U.int(e.days_left) < 0 ? 'danger' : U.int(e.days_left) <= 30 ? 'danger' : 'warn', title: `${e.name} expiry ${e.days_left < 0 ? 'GAYI' : 'qareeb'} (${e.expiry_date})`, detail: `Batch ${e.batch_no || '-'} — ${e.qty_remaining} pcs. Push sale karein.` });
  const overdue = d.all(
    `SELECT c.id, c.name, COALESCE(SUM(si.total_paisa-si.paid_paisa),0) AS due, MIN(si.date) AS oldest,
            CAST(julianday(?)-julianday(MIN(si.date)) AS INTEGER) AS days
       FROM sales_invoices si JOIN customers c ON c.id=si.customer_id
      WHERE si.status IN ('UNPAID','PARTIAL') AND si.total_paisa>si.paid_paisa AND si.date <= date(?, '-30 day')
      GROUP BY c.id ORDER BY due DESC LIMIT 20`,
    today,
    today
  );
  for (const o of overdue) out.items.push({ type: 'OVERDUE', level: U.int(o.days) > 60 ? 'danger' : 'warn', title: `${o.name} ka udhaar ${o.days} din purana`, detail: `Baqaya ${U.fmtMoney(o.due)} — recovery karein` });
  const cheques = d.all(
    `SELECT r.cheque_no, r.cheque_date, r.amount_paisa, c.name AS customer FROM receipts r LEFT JOIN customers c ON c.id=r.customer_id
      WHERE r.method='CHEQUE' AND r.cheque_status IN ('RECEIVED','IN_CLEARING') AND r.cheque_date <= date(?, '+3 day') ORDER BY r.cheque_date LIMIT 10`,
    today
  );
  for (const c of cheques) out.items.push({ type: 'CHEQUE', level: 'info', title: `Cheque ${c.cheque_no} — ${c.customer || ''}`, detail: `${U.fmtMoney(c.amount_paisa)} — date ${c.cheque_date}` });
  const claims = d.get("SELECT COUNT(*) AS cnt, COALESCE(SUM(value_paisa),0) AS val FROM claims WHERE status='PENDING'");
  if (U.int(claims.cnt)) out.items.push({ type: 'CLAIM', level: 'info', title: `${claims.cnt} scheme claim pending`, detail: `Company se ${U.fmtMoney(claims.val)} wapsi leni hai` });
  const openVan = d.all("SELECT load_no, vehicle_no, date FROM van_loads WHERE status='OPEN'");
  for (const v of openVan) out.items.push({ type: 'VAN', level: 'warn', title: `Van load ${v.load_no} settle nahi hua`, detail: `${v.vehicle_no || ''} — ${v.date}` });
  out.counts = out.items.reduce((acc, i) => ((acc[i.type] = (acc[i.type] || 0) + 1), acc), {});
  return out;
});

/* ------------------------------------------------------------------ lookups */
// sab logged-in users ke liye basic reference data (dropdowns ke liye) — koi cost nahi
route('GET', '/api/lookups', null, ({ user }) => {
  if (!user) {
    const e = new Error('Login zaroori hai');
    e.code = 'UNAUTHORIZED';
    throw e;
  }
  const d = db();
  const out = {
    warehouses: d.all('SELECT * FROM warehouses WHERE active=1 ORDER BY id'),
    tiers: d.all('SELECT * FROM price_tiers ORDER BY id'),
    salesmen: d.all('SELECT id, name, code, phone, route_id, commission_pct, active FROM salesmen WHERE active=1 ORDER BY name'),
    routes: d.all('SELECT id, name, area, weekday FROM routes WHERE active=1 ORDER BY name'),
    companies: d.all('SELECT id, name, city FROM companies WHERE active=1 ORDER BY name'),
    categories: d.all('SELECT id, name, parent_id FROM categories WHERE active=1 ORDER BY name'),
    heads: d.all('SELECT id, name, is_cogs FROM expense_heads WHERE active=1 ORDER BY name'),
  };
  if (A.can(user, 'suppliers.view')) out.suppliers = d.all('SELECT id, name, phone, city FROM suppliers WHERE active=1 ORDER BY name');
  return out;
});

route('GET', '/api/lookup/products', 'products.view', ({ query, user }) => {
  const q = '%' + (query.q || '') + '%';
  const rows = db().all(
    `SELECT p.id, p.name, p.sku, p.barcode, p.carton_size, p.wholesale_paisa, p.retail_paisa, p.cost_paisa, p.tax_pct,
            p.company_id, p.category_id, (SELECT name FROM companies c WHERE c.id=p.company_id) AS company_name,
            (SELECT COALESCE(SUM(b.qty_remaining),0) FROM batches b WHERE b.product_id=p.id ${query.warehouse_id ? 'AND b.warehouse_id=' + U.int(query.warehouse_id) : ''}) AS stock,
            p.reorder_level
       FROM products p WHERE p.active=1 AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)
      ORDER BY p.name LIMIT ?`,
    q,
    q,
    q,
    U.int(query.limit) || 30
  );
  return stripCostRows(rows, user);
});
route('GET', '/api/lookup/barcode/:code', 'products.view', ({ params, user }) => {
  const p = db().get('SELECT * FROM products WHERE barcode=? AND active=1', params.code);
  if (!p) return { found: false };
  const row = db().get(
    `SELECT p.id, p.name, p.sku, p.barcode, p.carton_size, p.wholesale_paisa, p.retail_paisa, p.cost_paisa, p.tax_pct,
            (SELECT COALESCE(SUM(b.qty_remaining),0) FROM batches b WHERE b.product_id=p.id) AS stock
       FROM products p WHERE p.id=?`,
    p.id
  );
  return { found: true, product: canSeeCosts(user) ? row : stripCost(row) };
});
route('GET', '/api/lookup/customers', 'customers.view', ({ query }) => {
  const q = '%' + (query.q || '') + '%';
  return db().all(
    `SELECT c.id, c.name, c.phone, c.whatsapp, c.area, c.route_id, c.tier_id, c.credit_limit_paisa, c.credit_days,
            c.balance_paisa, c.address, (SELECT name FROM routes r WHERE r.id=c.route_id) AS route_name,
            (SELECT name FROM price_tiers t WHERE t.id=c.tier_id) AS tier_name
       FROM customers c WHERE c.active=1 AND (c.name LIKE ? OR c.phone LIKE ? OR c.code LIKE ?) ORDER BY c.name LIMIT ?`,
    q,
    q,
    q,
    U.int(query.limit) || 30
  );
});
route('GET', '/api/lookup/suppliers', 'suppliers.view', ({ query }) =>
  db().all('SELECT id, name, phone, balance_paisa FROM suppliers WHERE active=1 AND name LIKE ? ORDER BY name LIMIT 50', '%' + (query.q || '') + '%')
);
route('GET', '/api/lookup/salesmen', 'masters.view', () =>
  db().all('SELECT s.*, r.name AS route_name FROM salesmen s LEFT JOIN routes r ON r.id=s.route_id WHERE s.active=1 ORDER BY s.name')
);
route('GET', '/api/lookup/warehouses', 'masters.view', () => db().all('SELECT * FROM warehouses WHERE active=1 ORDER BY id'));
route('GET', '/api/lookup/tiers', 'masters.view', () => db().all('SELECT * FROM price_tiers ORDER BY id'));
route('GET', '/api/lookup/expense-heads', 'masters.view', () => db().all('SELECT * FROM expense_heads WHERE active=1 ORDER BY name'));
route('GET', '/api/lookup/companies', 'masters.view', () => db().all('SELECT * FROM companies WHERE active=1 ORDER BY name'));
route('GET', '/api/lookup/categories', 'masters.view', () => db().all('SELECT * FROM categories WHERE active=1 ORDER BY name'));
route('GET', '/api/lookup/routes', 'masters.view', () => db().all('SELECT * FROM routes WHERE active=1 ORDER BY name'));
route('GET', '/api/lookup/heads', 'masters.view', () => db().all('SELECT * FROM expense_heads ORDER BY name'));

/* ------------------------------------------------------------------ generic CRUD */
route('GET', '/api/crud/:table', null, ({ params, query, user }) => {
  const cfg = CRUD[params.table];
  if (!cfg) throw new Error('Unknown table: ' + params.table);
  need(user, cfg.perm + '.view');
  const where = [];
  const args = [];
  if (query.q && cfg.search.length) {
    where.push('(' + cfg.search.map((f) => `${f} LIKE ?`).join(' OR ') + ')');
    cfg.search.forEach(() => args.push('%' + query.q + '%'));
  }
  for (const col of Object.keys(query)) {
    if (['q', 'limit', 'offset', 'sort', 'order'].includes(col)) continue;
    if (cfg.fields.includes(col)) {
      where.push(`${col}=?`);
      args.push(query[col] === 'null' ? null : query[col]);
    }
  }
  const sql = `SELECT * FROM ${cfg.table} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${query.sort && cfg.fields.includes(query.sort) ? query.sort : cfg.order} LIMIT ? OFFSET ?`;
  args.push(U.int(query.limit) || 500, U.int(query.offset) || 0);
  let rows = db().all(sql, ...args);
  if (cfg.table === 'customers' || cfg.table === 'suppliers') rows = rows.map((r) => ({ ...r }));
  if (!canSeeCosts(user)) rows = stripCostRows(rows, user);
  return rows;
});

route('POST', '/api/crud/:table', null, ({ params, body, user }) => {
  const cfg = CRUD[params.table];
  if (!cfg) throw new Error('Unknown table');
  need(user, cfg.perm + '.manage');
  const data = coerceCrud(cfg, body);
  if (cfg.table === 'customers' && !data.name) throw new Error('Customer ka naam zaroori hai');
  if (cfg.table === 'products' && !data.name) throw new Error('Product ka naam zaroori hai');
  if (cfg.table === 'price_tiers' && data.is_default) db().run('UPDATE price_tiers SET is_default=0');
  const id = db().insert(cfg.table, data);
  if (cfg.table === 'suppliers' || cfg.table === 'customers') SVC.refreshBalance(cfg.table === 'customers' ? 'CUSTOMER' : 'SUPPLIER', id);
  SVC.audit(user, 'CREATE', cfg.table, id, data);
  return db().get(`SELECT * FROM ${cfg.table} WHERE id=?`, id);
});

route('PUT', '/api/crud/:table/:id', null, ({ params, body, user }) => {
  const cfg = CRUD[params.table];
  if (!cfg) throw new Error('Unknown table');
  need(user, cfg.perm + '.manage');
  const id = U.int(params.id);
  const data = coerceCrud(cfg, body);
  if (cfg.table === 'price_tiers' && data.is_default) db().run('UPDATE price_tiers SET is_default=0');
  db().update(cfg.table, id, data);
  if (cfg.table === 'suppliers' || cfg.table === 'customers') {
    SVC.refreshBalance(cfg.table === 'customers' ? 'CUSTOMER' : 'SUPPLIER', id);
  }
  SVC.audit(user, 'UPDATE', cfg.table, id, data);
  return db().get(`SELECT * FROM ${cfg.table} WHERE id=?`, id);
});

route('DELETE', '/api/crud/:table/:id', null, ({ params, user }) => {
  const cfg = CRUD[params.table];
  if (!cfg) throw new Error('Unknown table');
  need(user, cfg.perm + '.manage');
  const id = U.int(params.id);
  try {
    db().run(`DELETE FROM ${cfg.table} WHERE id=?`, id);
  } catch (e) {
    // referenced elsewhere -> deactivate instead of delete
    if (cfg.fields.includes('active')) {
      db().run(`UPDATE ${cfg.table} SET active=0 WHERE id=?`, id);
      SVC.audit(user, 'DEACTIVATE', cfg.table, id, { reason: 'referenced' });
      return { ok: true, deactivated: true };
    }
    throw new Error('Yeh record kahin use ho raha hai, delete nahi ho sakta');
  }
  SVC.audit(user, 'DELETE', cfg.table, id, null);
  return { ok: true };
});

/* enriched list helpers */
route('GET', '/api/products', 'products.view', ({ query, user }) => {
  const where = ['p.active=1'];
  const args = [];
  if (query.q) {
    where.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)');
    args.push('%' + query.q + '%', '%' + query.q + '%', '%' + query.q + '%');
  }
  if (query.company_id) {
    where.push('p.company_id=?');
    args.push(U.int(query.company_id));
  }
  if (query.category_id) {
    where.push('p.category_id=?');
    args.push(U.int(query.category_id));
  }
  args.push(U.int(query.limit) || 5000);
  const rows = db().all(
    `SELECT p.*, co.name AS company_name, cat.name AS category_name,
            (SELECT COALESCE(SUM(b.qty_remaining),0) FROM batches b WHERE b.product_id=p.id) AS stock,
            (SELECT COALESCE(SUM(b.qty_remaining*p2.retail_paisa),0) FROM batches b JOIN products p2 ON p2.id=b.product_id WHERE b.product_id=p.id) AS stock_retail_value_paisa
       FROM products p LEFT JOIN companies co ON co.id=p.company_id LEFT JOIN categories cat ON cat.id=p.category_id
      WHERE ${where.join(' AND ')} ORDER BY p.name LIMIT ?`,
    ...args
  );
  return canSeeCosts(user) ? rows : stripCostRows(rows, user);
});

route('GET', '/api/products/:id', 'products.view', ({ params, user }) => {
  const p = db().get('SELECT * FROM products WHERE id=?', U.int(params.id));
  if (!p) throw new Error('Product nahi mila');
  const batches = db().all(
    `SELECT b.*, w.name AS warehouse_name, CASE WHEN b.expiry_date IS NULL OR b.expiry_date='' THEN NULL
            ELSE CAST(julianday(b.expiry_date)-julianday(?) AS INTEGER) END AS days_left
       FROM batches b JOIN warehouses w ON w.id=b.warehouse_id WHERE b.product_id=? AND b.qty_remaining<>0 ORDER BY b.expiry_date`,
    U.today(),
    p.id
  );
  const prices = db().all('SELECT pp.*, t.name AS tier_name FROM product_prices pp JOIN price_tiers t ON t.id=pp.tier_id WHERE pp.product_id=?', p.id);
  const recent = db().all(
    `SELECT sm.at, sm.qty, sm.type, w.name AS warehouse FROM stock_moves sm JOIN warehouses w ON w.id=sm.warehouse_id
      WHERE sm.product_id=? ORDER BY sm.id DESC LIMIT 25`,
    p.id
  );
  return canSeeCosts(user) ? { ...p, batches, prices, recent } : { ...stripCost(p), batches: batches.map(stripCost), prices, recent };
});

route('GET', '/api/customers', 'customers.view', ({ query, user }) => {
  const where = ['c.active=1'];
  const args = [];
  if (query.q) {
    where.push('(c.name LIKE ? OR c.phone LIKE ? OR c.code LIKE ? OR c.area LIKE ?)');
    args.push('%' + query.q + '%', '%' + query.q + '%', '%' + query.q + '%', '%' + query.q + '%');
  }
  if (query.route_id) {
    where.push('c.route_id=?');
    args.push(U.int(query.route_id));
  }
  if (query.due === '1') where.push('c.balance_paisa > 0');
  args.push(U.int(query.limit) || 1000);
  const rows = db().all(
    `SELECT c.*, r.name AS route_name, t.name AS tier_name,
            (SELECT COUNT(*) FROM sales_invoices si WHERE si.customer_id=c.id AND si.status<>'VOID') AS invoice_count,
            (SELECT MAX(si.date) FROM sales_invoices si WHERE si.customer_id=c.id) AS last_sale,
            (SELECT COALESCE(SUM(si.total_paisa-si.paid_paisa),0) FROM sales_invoices si WHERE si.customer_id=c.id AND si.status IN ('UNPAID','PARTIAL')) AS open_due_paisa
       FROM customers c LEFT JOIN routes r ON r.id=c.route_id LEFT JOIN price_tiers t ON t.id=c.tier_id
      WHERE ${where.join(' AND ')} ORDER BY c.name LIMIT ?`,
    ...args
  );
  return rows;
});

route('GET', '/api/customers/:id/profile', 'customers.view', ({ params }) => {
  const id = U.int(params.id);
  const c = db().get('SELECT * FROM customers WHERE id=?', id);
  if (!c) throw new Error('Customer nahi mila');
  const credit = SVC.creditStatus(id);
  const invoices = db().all(
    `SELECT id, invoice_no, date, due_date, total_paisa, paid_paisa, (total_paisa-paid_paisa) AS balance_paisa, status, sale_type
       FROM sales_invoices WHERE customer_id=? ORDER BY id DESC LIMIT 50`,
    id
  );
  const receipts = db().all('SELECT id, receipt_no, date, method, amount_paisa, cheque_no, cheque_status, allocated_paisa FROM receipts WHERE customer_id=? ORDER BY id DESC LIMIT 30', id);
  const topItems = db().all(
    `SELECT p.name, SUM(sl.qty) AS qty, SUM(sl.line_total_paisa) AS total FROM sales_lines sl
       JOIN sales_invoices si ON si.id=sl.invoice_id JOIN products p ON p.id=sl.product_id
      WHERE si.customer_id=? AND si.status<>'VOID' GROUP BY p.id ORDER BY total DESC LIMIT 10`,
    id
  );
  const monthly = db().all(
    `SELECT substr(date,1,7) AS month, COALESCE(SUM(total_paisa),0) AS total FROM sales_invoices
      WHERE customer_id=? AND status<>'VOID' GROUP BY month ORDER BY month DESC LIMIT 12`,
    id
  );
  return { customer: c, credit, invoices, receipts, top_items: topItems, monthly };
});

route('GET', '/api/customers/:id/credit', 'customers.view', ({ params }) => SVC.creditStatus(U.int(params.id)));

route('GET', '/api/customers/:id/statement', 'reports.view', ({ params, query }) =>
  REPORTS.run('customer_statement', { customer_id: U.int(params.id), from: query.from || U.monthStart(U.monthOf(U.today())), to: query.to || U.today() })
);

route('GET', '/api/suppliers/:id/profile', 'suppliers.view', ({ params }) => {
  const id = U.int(params.id);
  const s = db().get('SELECT * FROM suppliers WHERE id=?', id);
  if (!s) throw new Error('Supplier nahi mila');
  const purchases = db().all(
    'SELECT id, invoice_no, date, total_paisa, paid_paisa, (total_paisa-paid_paisa) AS balance_paisa, status FROM purchases WHERE supplier_id=? ORDER BY id DESC LIMIT 40',
    id
  );
  const payments = db().all('SELECT id, payment_no, date, method, amount_paisa, cheque_no FROM payments WHERE supplier_id=? ORDER BY id DESC LIMIT 30', id);
  const items = db().all(
    `SELECT p.name, SUM(pl.qty) AS qty, SUM(pl.line_total_paisa) AS total FROM purchase_lines pl
       JOIN purchases pu ON pu.id=pl.purchase_id JOIN products p ON p.id=pl.product_id
      WHERE pu.supplier_id=? GROUP BY p.id ORDER BY total DESC LIMIT 10`,
    id
  );
  return { supplier: s, purchases, payments, items };
});

route('GET', '/api/suppliers/:id/statement', 'reports.view', ({ params, query }) =>
  REPORTS.run('supplier_statement', { supplier_id: U.int(params.id), from: query.from || U.monthStart(U.monthOf(U.today())), to: query.to || U.today() })
);

/* ------------------------------------------------------------------ stock */
route('GET', '/api/stock/summary', 'stock.view', ({ query, user }) =>
  REPORTS.run('stock_summary', { warehouse_id: query.warehouse_id || '', q: query.q || '' })
);

route('GET', '/api/stock/by-warehouse', 'stock.view', ({ query, user }) => {
  const rows = db().all(
    `SELECT p.id AS product_id, p.name AS product, p.sku, p.carton_size, p.wholesale_paisa, p.retail_paisa, p.cost_paisa,
            w.id AS warehouse_id, w.name AS warehouse, w.type AS warehouse_type,
            COALESCE(SUM(b.qty_remaining),0) AS qty, COALESCE(SUM(b.qty_remaining*b.cost_paisa),0) AS value_paisa
       FROM batches b JOIN products p ON p.id=b.product_id JOIN warehouses w ON w.id=b.warehouse_id
      WHERE (b.qty_remaining <> 0) ${query.warehouse_id ? 'AND b.warehouse_id=' + U.int(query.warehouse_id) : ''} ${query.product_id ? 'AND b.product_id=' + U.int(query.product_id) : ''}
      GROUP BY p.id, w.id ORDER BY w.id, p.name`
  );
  return canSeeCosts(user) ? rows : stripCostRows(rows, user);
});

route('GET', '/api/stock/batches', 'stock.view', ({ query, user }) => {
  const where = ['b.qty_remaining <> 0'];
  const args = [];
  if (query.product_id) {
    where.push('b.product_id=?');
    args.push(U.int(query.product_id));
  }
  if (query.warehouse_id) {
    where.push('b.warehouse_id=?');
    args.push(U.int(query.warehouse_id));
  }
  if (query.expiring) where.push("b.expiry_date IS NOT NULL AND b.expiry_date<>'' AND julianday(b.expiry_date)-julianday('now') <= " + U.int(query.expiring));
  args.push(U.today());
  const rows = db().all(
    `SELECT b.*, p.name AS product_name, p.carton_size, p.wholesale_paisa, p.retail_paisa, w.name AS warehouse_name,
            CASE WHEN b.expiry_date IS NULL OR b.expiry_date='' THEN NULL ELSE CAST(julianday(b.expiry_date)-julianday(?) AS INTEGER) END AS days_left
       FROM batches b JOIN products p ON p.id=b.product_id JOIN warehouses w ON w.id=b.warehouse_id
      WHERE ${where.join(' AND ')} ORDER BY (b.expiry_date IS NULL OR b.expiry_date=''), b.expiry_date, p.name`,
    ...args
  );
  return canSeeCosts(user) ? rows : stripCostRows(rows, user);
});

route('GET', '/api/stock/moves', 'stock.view', ({ query }) =>
  db().all(
    `SELECT sm.*, p.name AS product_name, w.name AS warehouse_name, u.username
       FROM stock_moves sm JOIN products p ON p.id=sm.product_id JOIN warehouses w ON w.id=sm.warehouse_id
       LEFT JOIN users u ON u.id=sm.user_id
      WHERE sm.at >= ? ORDER BY sm.id DESC LIMIT ?`,
    (query.from || U.dateAdd(U.today(), -7)) + ' 00:00:00',
    U.int(query.limit) || 300
  )
);

route('POST', '/api/stock/adjust', 'stock.adjust', ({ user, body }) => {
  const product = db().get('SELECT * FROM products WHERE id=?', U.int(body.product_id));
  if (!product) throw new Error('Product nahi mila');
  const warehouse_id = U.int(body.warehouse_id) || U.int(SVC.S('default_warehouse_id'));
  const delta = U.int(body.qty_delta);
  if (!delta) throw new Error('Qty likhein (+ ya -)');
  return db().tx(() => {
    if (delta > 0) {
      SVC.addStock({
        product_id: product.id,
        warehouse_id,
        qty: delta,
        batch_no: body.batch_no || 'ADJ',
        expiry_date: body.expiry_date || null,
        cost_paisa: U.int(body.cost_paisa) || U.int(product.cost_paisa),
        ref_type: 'ADJUST',
        note: body.reason || 'Manual stock adjustment',
        user_id: user.id,
      });
    } else {
      SVC.consumeFEFO({
        product_id: product.id,
        warehouse_id,
        qty: -delta,
        ref_type: 'ADJUST',
        note: body.reason || 'Manual stock adjustment',
        user_id: user.id,
      });
      if (body.reason && /damage|scrap|toot|kharab/i.test(String(body.reason))) {
        const val = -delta * (U.int(body.cost_paisa) || U.int(product.cost_paisa));
        SVC.ledgerAdd({
          date: U.today(),
          ref_type: 'DAMAGE',
          ref_id: product.id,
          note: `Damage/scrap: ${product.name} — ${body.reason}`,
          user_id: user.id,
          entries: [
            { party_type: 'STOCK_LOSS', party_id: 0, debit_paisa: val },
            { party_type: 'INVENTORY', party_id: 0, credit_paisa: val },
          ],
        });
      }
    }
    SVC.audit(user, 'ADJUST', 'stock', product.id, { delta, warehouse_id, reason: body.reason });
    return { ok: true, stock: SVC.stockQty(product.id, warehouse_id) };
  });
});

route('POST', '/api/stock/opening', 'stock.adjust', ({ user, body }) => {
  const lines = body.lines || [];
  const warehouse_id = U.int(body.warehouse_id) || U.int(SVC.S('default_warehouse_id'));
  return db().tx(() => {
    let count = 0;
    let value = 0;
    for (const l of lines) {
      const qty = U.int(l.qty);
      if (!qty) continue;
      const cost = U.int(l.cost_paisa);
      SVC.addStock({
        product_id: U.int(l.product_id),
        warehouse_id,
        qty,
        batch_no: l.batch_no || 'OPENING',
        expiry_date: l.expiry_date || null,
        cost_paisa: cost,
        ref_type: 'OPENING',
        note: 'Opening stock',
        user_id: user.id,
      });
      count++;
      value += qty * cost;
    }
    if (value) {
      SVC.ledgerAdd({
        date: body.date || U.today(),
        ref_type: 'OPENING_STOCK',
        ref_id: null,
        note: 'Opening stock value',
        user_id: user.id,
        entries: [
          { party_type: 'INVENTORY', party_id: 0, debit_paisa: value },
          { party_type: 'CAPITAL', party_id: 0, credit_paisa: value },
        ],
      });
    }
    SVC.audit(user, 'OPENING_STOCK', 'stock', null, { count, value });
    return { ok: true, count, value_paisa: value };
  });
});

/* ------------------------------------------------------------------ invoices */
route('GET', '/api/invoices', 'invoices.view', ({ query, user }) => {
  const where = ["si.status<>'VOID'"];
  const args = [];
  if (query.from) {
    where.push('si.date>=?');
    args.push(query.from);
  }
  if (query.to) {
    where.push('si.date<=?');
    args.push(query.to);
  }
  if (query.status && query.status !== 'ALL') {
    where.push('si.status=?');
    args.push(query.status);
  }
  if (query.customer_id) {
    where.push('si.customer_id=?');
    args.push(U.int(query.customer_id));
  }
  if (query.salesman_id) {
    where.push('si.salesman_id=?');
    args.push(U.int(query.salesman_id));
  }
  if (query.sale_type) {
    where.push('si.sale_type=?');
    args.push(query.sale_type);
  }
  if (query.q) {
    where.push('(si.invoice_no LIKE ? OR c.name LIKE ?)');
    args.push('%' + query.q + '%', '%' + query.q + '%');
  }
  if (user.role === 'SALESMAN' && user.salesman_id) {
    where.push('si.salesman_id=?');
    args.push(U.int(user.salesman_id));
  }
  args.push(U.int(query.limit) || 200, U.int(query.offset) || 0);
  const rows = db().all(
    `SELECT si.id, si.invoice_no, si.date, si.due_date, c.name AS customer_name, c.phone AS customer_phone, s.name AS salesman_name,
            w.name AS warehouse_name, si.sale_type, si.total_paisa, si.paid_paisa, (si.total_paisa-si.paid_paisa) AS balance_paisa,
            si.gross_profit_paisa, si.status, si.notes
       FROM sales_invoices si LEFT JOIN customers c ON c.id=si.customer_id
       LEFT JOIN salesmen s ON s.id=si.salesman_id LEFT JOIN warehouses w ON w.id=si.warehouse_id
      WHERE ${where.join(' AND ')} ORDER BY si.date DESC, si.id DESC LIMIT ? OFFSET ?`,
    ...args
  );
  return canSeeCosts(user) ? rows : stripCostRows(rows, user);
});

route('GET', '/api/invoices/:id', 'invoices.view', ({ params }) => SVC.getInvoice(U.int(params.id)));
route('POST', '/api/invoices', 'invoices.create', ({ user, body }) => SVC.createInvoice(user, body));
route('POST', '/api/invoices/:id/void', 'invoices.void', ({ user, body, params }) =>
  SVC.voidInvoice(user, U.int(params.id), body.reason, body.pin || body.override_pin)
);
route('GET', '/api/invoices/:id/print', 'invoices.view', ({ params }) => {
  const inv = SVC.getInvoice(U.int(params.id));
  return { invoice: inv, settings: getSettingsMap(true) };
});

/* ------------------------------------------------------------------ sales returns */
route('GET', '/api/sales-returns', 'returns.view', ({ query, user }) => {
  const where = [];
  const args = [];
  if (query.from) {
    where.push('sr.date>=?');
    args.push(query.from);
  }
  if (query.to) {
    where.push('sr.date<=?');
    args.push(query.to);
  }
  if (query.customer_id) {
    where.push('sr.customer_id=?');
    args.push(U.int(query.customer_id));
  }
  args.push(U.int(query.limit) || 200);
  return db().all(
    `SELECT sr.*, c.name AS customer_name, w.name AS warehouse_name, u.username
       FROM sales_returns sr LEFT JOIN customers c ON c.id=sr.customer_id
       LEFT JOIN warehouses w ON w.id=sr.warehouse_id LEFT JOIN users u ON u.id=sr.user_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY sr.id DESC LIMIT ?`,
    ...args
  );
});
route('GET', '/api/sales-returns/:id', 'returns.view', ({ params }) =>
  db().get('SELECT * FROM sales_returns WHERE id=?', U.int(params.id))
);
route('POST', '/api/sales-returns', 'returns.create', ({ user, body }) => SVC.createSalesReturn(user, body));

/* ------------------------------------------------------------------ purchases */
route('GET', '/api/purchases', 'purchases.view', ({ query }) => {
  const where = [];
  const args = [];
  if (query.from) {
    where.push('pu.date>=?');
    args.push(query.from);
  }
  if (query.to) {
    where.push('pu.date<=?');
    args.push(query.to);
  }
  if (query.supplier_id) {
    where.push('pu.supplier_id=?');
    args.push(U.int(query.supplier_id));
  }
  if (query.q) {
    where.push('(pu.invoice_no LIKE ? OR s.name LIKE ?)');
    args.push('%' + query.q + '%', '%' + query.q + '%');
  }
  args.push(U.int(query.limit) || 200);
  return db().all(
    `SELECT pu.*, s.name AS supplier_name, w.name AS warehouse_name,
            (pu.total_paisa-pu.paid_paisa) AS balance_paisa
       FROM purchases pu LEFT JOIN suppliers s ON s.id=pu.supplier_id LEFT JOIN warehouses w ON w.id=pu.warehouse_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY pu.id DESC LIMIT ?`,
    ...args
  );
});
route('GET', '/api/purchases/:id', 'purchases.view', ({ params }) => SVC.getPurchase(U.int(params.id)));
route('POST', '/api/purchases', 'purchases.create', ({ user, body }) => SVC.createPurchase(user, body));

route('GET', '/api/purchase-returns', 'purchase_returns.view', ({ query }) =>
  db().all(
    `SELECT pr.*, s.name AS supplier_name FROM purchase_returns pr LEFT JOIN suppliers s ON s.id=pr.supplier_id
      WHERE pr.date BETWEEN ? AND ? ORDER BY pr.id DESC LIMIT 300`,
    query.from || U.dateAdd(U.today(), -90),
    query.to || U.today()
  )
);
route('POST', '/api/purchase-returns', 'purchase_returns.create', ({ user, body }) => SVC.createPurchaseReturn(user, body));

/* ------------------------------------------------------------------ receipts / payments */
route('GET', '/api/receipts', 'receipts.view', ({ query, user }) => {
  const where = [];
  const args = [];
  if (query.from) {
    where.push('r.date>=?');
    args.push(query.from);
  }
  if (query.to) {
    where.push('r.date<=?');
    args.push(query.to);
  }
  if (query.customer_id) {
    where.push('r.customer_id=?');
    args.push(U.int(query.customer_id));
  }
  if (query.method) {
    where.push('r.method=?');
    args.push(query.method);
  }
  if (query.cheque_status) {
    where.push('r.cheque_status=?');
    args.push(query.cheque_status);
  }
  if (user.role === 'SALESMAN' && user.salesman_id) {
    where.push('r.salesman_id=?');
    args.push(U.int(user.salesman_id));
  }
  args.push(U.int(query.limit) || 200);
  return db().all(
    `SELECT r.*, c.name AS customer_name, c.phone AS customer_phone, s.name AS salesman_name
       FROM receipts r LEFT JOIN customers c ON c.id=r.customer_id LEFT JOIN salesmen s ON s.id=r.salesman_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.id DESC LIMIT ?`,
    ...args
  );
});
route('POST', '/api/receipts', 'receipts.create', ({ user, body }) => SVC.createReceipt(user, body));
route('POST', '/api/receipts/:id/cheque', 'receipts.cheque', ({ user, body, params }) =>
  SVC.setChequeStatus(user, U.int(params.id), body.status, body)
);
route('GET', '/api/receipts/cheques', 'receipts.view', ({ query }) =>
  db().all(
    `SELECT r.*, c.name AS customer_name FROM receipts r LEFT JOIN customers c ON c.id=r.customer_id
      WHERE r.method='CHEQUE' ${query.status ? "AND r.cheque_status='" + String(query.status).replace(/'/g, '') + "'" : ''}
      ORDER BY r.cheque_date LIMIT 500`
  )
);

route('GET', '/api/payments', 'payments.view', ({ query }) =>
  db().all(
    `SELECT p.*, s.name AS supplier_name FROM payments p LEFT JOIN suppliers s ON s.id=p.supplier_id
      WHERE p.date BETWEEN ? AND ? ORDER BY p.id DESC LIMIT 300`,
    query.from || U.dateAdd(U.today(), -90),
    query.to || U.today()
  )
);
route('POST', '/api/payments', 'payments.create', ({ user, body }) => SVC.createPayment(user, body));

/* ------------------------------------------------------------------ expenses / cash */
route('GET', '/api/expenses', 'expenses.view', ({ query }) =>
  db().all(
    `SELECT e.*, h.name AS head_name, s.name AS salesman_name, w.name AS warehouse_name
       FROM expenses e LEFT JOIN expense_heads h ON h.id=e.head_id LEFT JOIN salesmen s ON s.id=e.salesman_id
       LEFT JOIN warehouses w ON w.id=e.warehouse_id
      WHERE e.date BETWEEN ? AND ? ORDER BY e.id DESC LIMIT 500`,
    query.from || U.monthStart(U.monthOf(U.today())),
    query.to || U.today()
  )
);
route('POST', '/api/expenses', 'expenses.create', ({ user, body }) => SVC.createExpense(user, body));
route('DELETE', '/api/expenses/:id', 'expenses.create', ({ user, params }) => {
  const id = U.int(params.id);
  const exp = db().get('SELECT * FROM expenses WHERE id=?', id);
  if (!exp) throw new Error('Expense nahi mila');
  return db().tx(() => {
    SVC.ledgerAdd({
      date: exp.date,
      ref_type: 'EXPENSE_DELETE',
      ref_id: id,
      note: 'Expense deleted',
      user_id: user.id,
      entries: [
        { party_type: exp.method === 'BANK' ? 'BANK' : 'CASH', party_id: 0, debit_paisa: U.int(exp.amount_paisa) },
        { party_type: 'EXPENSE', party_id: U.int(exp.head_id), credit_paisa: U.int(exp.amount_paisa) },
      ],
    });
    db().run('DELETE FROM expenses WHERE id=?', id);
    SVC.audit(user, 'DELETE', 'expense', id, null);
    return { ok: true };
  });
});

route('GET', '/api/cash/position', 'closing.view', ({ query }) => SVC.cashPosition(query.date || U.today()));
route('GET', '/api/cash/closings', 'closing.view', ({ query }) =>
  db().all(
    `SELECT cc.*, u.username, u.full_name FROM cash_closings cc LEFT JOIN users u ON u.id=cc.user_id
      WHERE cc.date BETWEEN ? AND ? ORDER BY cc.id DESC LIMIT 100`,
    query.from || U.dateAdd(U.today(), -30),
    query.to || U.today()
  )
);
route('POST', '/api/cash/closings', 'closing.create', ({ user, body }) => SVC.createCashClosing(user, body));

/* ------------------------------------------------------------------ orders */
route('GET', '/api/orders', 'orders.view', ({ query, user }) => {
  const where = [];
  const args = [];
  if (query.status) {
    where.push('o.status=?');
    args.push(query.status);
  }
  if (query.from) {
    where.push('o.date>=?');
    args.push(query.from);
  }
  if (query.to) {
    where.push('o.date<=?');
    args.push(query.to);
  }
  if (user.role === 'SALESMAN' && user.salesman_id) {
    where.push('o.salesman_id=?');
    args.push(U.int(user.salesman_id));
  }
  args.push(U.int(query.limit) || 200);
  return db().all(
    `SELECT o.*, c.name AS customer_name, s.name AS salesman_name, r.name AS route_name
       FROM orders o LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN salesmen s ON s.id=o.salesman_id
       LEFT JOIN routes r ON r.id=o.route_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY o.id DESC LIMIT ?`,
    ...args
  );
});
route('GET', '/api/orders/:id', 'orders.view', ({ params }) => SVC.getOrder(U.int(params.id)));
route('POST', '/api/orders', 'orders.create', ({ user, body }) => SVC.createOrder(user, body));
route('POST', '/api/orders/:id/convert', 'invoices.create', ({ user, body, params }) =>
  SVC.convertOrderToInvoice(user, U.int(params.id), body || {})
);
route('POST', '/api/orders/:id/cancel', 'orders.create', ({ user, body, params }) => SVC.cancelOrder(user, U.int(params.id), body.reason));

/* ------------------------------------------------------------------ van sales */
route('GET', '/api/van-loads', 'van.view', ({ query, user }) => {
  const where = [];
  const args = [];
  if (query.status) {
    where.push('v.status=?');
    args.push(query.status);
  }
  if (query.from) {
    where.push('v.date>=?');
    args.push(query.from);
  }
  if (query.to) {
    where.push('v.date<=?');
    args.push(query.to);
  }
  if (user.role === 'SALESMAN' && user.salesman_id) {
    where.push('v.salesman_id=?');
    args.push(U.int(user.salesman_id));
  }
  args.push(U.int(query.limit) || 200);
  return db().all(
    `SELECT v.*, s.name AS salesman_name, r.name AS route_name, w.name AS van_name
       FROM van_loads v LEFT JOIN salesmen s ON s.id=v.salesman_id LEFT JOIN routes r ON r.id=v.route_id
       LEFT JOIN warehouses w ON w.id=v.van_warehouse_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY v.id DESC LIMIT ?`,
    ...args
  );
});
route('GET', '/api/van-loads/:id', 'van.view', ({ params }) => SVC.getVanLoad(U.int(params.id)));
route('POST', '/api/van-loads', 'van.create', ({ user, body }) => SVC.createVanLoad(user, body));
route('POST', '/api/van-loads/:id/settle', 'van.settle', ({ user, body, params }) => SVC.settleVanLoad(user, U.int(params.id), body));
route('GET', '/api/van-loads/:id/report', 'van.view', ({ params }) => {
  const v = SVC.getVanLoad(U.int(params.id));
  return { van: v, settings: getSettingsMap(true) };
});

/* ------------------------------------------------------------------ transfers */
route('GET', '/api/transfers', 'transfers.view', ({ query }) =>
  db().all(
    `SELECT t.*, fw.name AS from_name, tw.name AS to_name FROM transfers t
      LEFT JOIN warehouses fw ON fw.id=t.from_warehouse_id LEFT JOIN warehouses tw ON tw.id=t.to_warehouse_id
      WHERE t.date BETWEEN ? AND ? ORDER BY t.id DESC LIMIT 300`,
    query.from || U.dateAdd(U.today(), -90),
    query.to || U.today()
  )
);
route('GET', '/api/transfers/:id', 'transfers.view', ({ params }) => SVC.getTransfer(U.int(params.id)));
route('POST', '/api/transfers', 'transfers.create', ({ user, body }) => SVC.createTransfer(user, body));
route('POST', '/api/transfers/:id/receive', 'transfers.receive', ({ user, body, params }) =>
  SVC.receiveTransfer(user, U.int(params.id), body || {})
);

/* ------------------------------------------------------------------ schemes / claims / commissions / targets */
route('GET', '/api/schemes', 'schemes.view', ({ query }) =>
  db().all(
    `SELECT s.*, p.name AS product_name, c.name AS company_name, cat.name AS category_name
       FROM schemes s LEFT JOIN products p ON p.id=s.product_id LEFT JOIN companies c ON c.id=s.company_id
       LEFT JOIN categories cat ON cat.id=s.category_id
      ${query.active === '1' ? 'WHERE s.active=1' : ''} ORDER BY s.active DESC, s.id DESC`
  )
);
route('GET', '/api/schemes/applicable', 'schemes.view', ({ query }) =>
  SVC.applicableSchemes(U.int(query.product_id), U.int(query.qty), query.date || U.today())
);
route('GET', '/api/claims', 'claims.view', ({ query }) =>
  db().all(
    `SELECT cl.*, co.name AS company_name, sc.name AS scheme_name, p.name AS product_name, si.invoice_no
       FROM claims cl LEFT JOIN companies co ON co.id=cl.company_id LEFT JOIN schemes sc ON sc.id=cl.scheme_id
       LEFT JOIN products p ON p.id=cl.product_id LEFT JOIN sales_invoices si ON si.id=cl.invoice_id
      WHERE cl.date BETWEEN ? AND ? ORDER BY cl.id DESC LIMIT 500`,
    query.from || U.dateAdd(U.today(), -180),
    query.to || U.today()
  )
);
route('POST', '/api/claims/:id/settle', 'claims.manage', ({ user, body, params }) => SVC.settleClaim(user, U.int(params.id), body || {}));

route('GET', '/api/commissions', 'commissions.view', ({ query, user }) => {
  const where = [];
  const args = [];
  if (query.from) {
    where.push('cm.period_from>=?');
    args.push(query.from);
  }
  if (query.to) {
    where.push('cm.period_to<=?');
    args.push(query.to);
  }
  if (user.role === 'SALESMAN' && user.salesman_id) {
    where.push('cm.salesman_id=?');
    args.push(U.int(user.salesman_id));
  }
  return db().all(
    `SELECT cm.*, s.name AS salesman_name FROM commissions cm JOIN salesmen s ON s.id=cm.salesman_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY cm.id DESC LIMIT 300`,
    ...args
  );
});
route('POST', '/api/commissions/generate', 'commissions.manage', ({ user, body }) => SVC.generateCommissions(user, body || {}));
route('POST', '/api/commissions/:id/pay', 'commissions.manage', ({ user, body, params }) => SVC.payCommission(user, U.int(params.id), body || {}));

route('GET', '/api/targets', 'targets.view', ({ query, user }) => {
  const period = query.period || U.monthOf(U.today());
  const where = ['t.period=?'];
  const args = [period];
  if (user.role === 'SALESMAN' && user.salesman_id) {
    where.push('t.salesman_id=?');
    args.push(U.int(user.salesman_id));
  }
  return db().all(
    `SELECT t.*, s.name AS salesman_name,
            (SELECT COALESCE(SUM(si.total_paisa),0) FROM sales_invoices si WHERE si.salesman_id=t.salesman_id AND substr(si.date,1,7)=t.period AND si.status<>'VOID') AS achieved_sales_paisa,
            (SELECT COALESCE(SUM(r.amount_paisa),0) FROM receipts r WHERE r.salesman_id=t.salesman_id AND substr(r.date,1,7)=t.period AND r.status='POSTED') AS achieved_recovery_paisa
       FROM targets t JOIN salesmen s ON s.id=t.salesman_id WHERE ${where.join(' AND ')} ORDER BY achieved_sales_paisa DESC`,
    ...args
  );
});

/* ------------------------------------------------------------------ visits */
route('GET', '/api/visits', 'visits.view', ({ query, user }) => {
  const where = ['date(v.at) BETWEEN ? AND ?'];
  const args = [query.from || U.today(), query.to || U.today()];
  if (user.role === 'SALESMAN' && user.salesman_id) {
    where.push('v.salesman_id=?');
    args.push(U.int(user.salesman_id));
  }
  return db().all(
    `SELECT v.*, c.name AS customer_name, s.name AS salesman_name FROM visits v
      LEFT JOIN customers c ON c.id=v.customer_id LEFT JOIN salesmen s ON s.id=v.salesman_id
      WHERE ${where.join(' AND ')} ORDER BY v.id DESC LIMIT 500`,
    ...args
  );
});
route('POST', '/api/visits/checkin', 'visits.create', ({ user, body }) => SVC.checkIn(user, body));

/* ------------------------------------------------------------------ reports */
route('GET', '/api/reports', 'reports.view', () => REPORTS.list());
route('GET', '/api/reports/:key', 'reports.view', ({ params, query, user, res }) => {
  const paramsForReport = {};
  for (const [k, v] of Object.entries(query)) if (k !== 'format' && k !== 'token') paramsForReport[k] = v;
  const report = REPORTS.run(params.key, paramsForReport);
  if (!canSeeCosts(user)) {
    report.columns = report.columns.filter((c) => !['profit_paisa', 'cost_paisa', 'value_paisa', 'cost_value_paisa', 'margin_potential_paisa', 'net_profit_paisa'].includes(c.key));
    report.rows = report.rows.map((r) => stripCost(r));
  }
  if (String(query.format).toLowerCase() === 'csv') {
    const csv = U.toCsv(report.rows, report.columns.map((c) => ({ key: c.key, title: c.label })));
    sendCsv(res, `${report.key}-${U.today()}.csv`, csv);
    return null;
  }
  return report;
});

/* ------------------------------------------------------------------ audit / backup / maintenance */
route('GET', '/api/audit', 'audit.view', ({ query }) =>
  db().all(
    'SELECT * FROM audit_log WHERE at >= ? ORDER BY id DESC LIMIT ?',
    (query.from || U.dateAdd(U.today(), -7)) + ' 00:00:00',
    U.int(query.limit) || 500
  )
);

route('GET', '/api/backup/download', 'backup.manage', ({ res }) => {
  db().checkpoint();
  sendFile(res, dbPath(), true);
  return null;
});
route('GET', '/api/backup/list', 'backup.manage', () => {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.db'))
    .map((f) => ({ name: f, size: fs.statSync(path.join(BACKUP_DIR, f)).size, at: fs.statSync(path.join(BACKUP_DIR, f)).mtime.toISOString() }))
    .sort((a, b) => (a.at < b.at ? 1 : -1));
});
route('POST', '/api/backup/create', 'backup.manage', ({ user }) => {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  db().checkpoint();
  const name = `distribution-pro-${U.today()}-${String(Date.now()).slice(-6)}.db`;
  fs.copyFileSync(dbPath(), path.join(BACKUP_DIR, name));
  SVC.audit(user, 'BACKUP', 'system', null, { name });
  return { ok: true, name };
});
route('POST', '/api/backup/restore', 'backup.manage', ({ user, body }) => {
  const name = String(body.name || '').replace(/[^a-zA-Z0-9_.-]/g, '');
  const src = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(src)) throw new Error('Backup file nahi mili');
  db().checkpoint();
  closeDb();
  fs.copyFileSync(src, dbPath());
  reopenDb();
  install();
  invalidate();
  SVC.audit(user, 'RESTORE', 'system', null, { name });
  return { ok: true, restored: name };
});

route('POST', '/api/maintenance/recalc', 'settings.manage', ({ user }) => {
  const out = SVC.recalcAllBalances();
  SVC.audit(user, 'RECALC', 'system', null, out);
  return { ok: true, ...out, gl: SVC.glCheck() };
});
route('POST', '/api/maintenance/clear-transactions', 'settings.manage', ({ user, body }) => {
  if (String(body.confirm || '') !== 'CLEAR') throw new Error('Confirm ke liye "CLEAR" likhein');
  const tables = [
    'invoice_batch_allocations', 'sales_lines', 'sales_invoices', 'sales_return_lines', 'sales_returns', 'order_lines', 'orders',
    'purchase_lines', 'purchases', 'purchase_return_lines', 'purchase_returns', 'receipt_allocations', 'receipts',
    'payment_allocations', 'payments', 'expenses', 'cash_closings', 'van_load_lines', 'van_loads', 'transfer_lines', 'transfers',
    'stock_moves', 'batches', 'claims', 'commissions', 'visits', 'ledger_entries', 'audit_log',
  ];
  return db().tx(() => {
    for (const t of tables) db().run(`DELETE FROM ${t}`);
    db().run('UPDATE customers SET balance_paisa=opening_balance_paisa, advance_paisa=0');
    db().run('UPDATE suppliers SET balance_paisa=opening_balance_paisa');
    db().run('DELETE FROM seq');
    SVC.recalcAllBalances();
    SVC.audit(user, 'CLEAR_TRANSACTIONS', 'system', null, null);
    return { ok: true, cleared: tables.length };
  });
});

route('POST', '/api/maintenance/demo-data', 'settings.manage', ({ user }) => {
  const { seedDemo } = require('./demo');
  const out = seedDemo({ force: true });
  SVC.audit(user, 'LOAD_DEMO', 'system', null, out);
  return { ok: true, ...out };
});

/* ------------------------------------------------------------------ server info */
route('GET', '/api/server/info', null, ({ user }) => {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const list of Object.values(nets)) for (const n of list || []) if (n.family === 'IPv4' && !n.internal) ips.push(n.address);
  return {
    version: require('../package.json').version,
    node: process.version,
    engine: db().engine(),
    db_file: dbPath(),
    uptime_s: Math.round(process.uptime()),
    lan_ips: ips,
    port: process.env.PORT || 3000,
    timezone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
    today: U.today(),
    user: user || null,
  };
});

/* ------------------------------------------------------------------ dispatcher */
function getToken(req, query) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  if (query && query.token) return query.token;
  const cookie = req.headers.cookie || '';
  const m = /(?:^|;\s*)dp_token=([^;]+)/.exec(cookie);
  return m ? decodeURIComponent(m[1]) : null;
}

async function handle(req, res) {
  const parsed = url.parse(req.url, true);
  const pathname = decodeURIComponent(parsed.pathname);
  const query = parsed.query || {};

  if (pathname.startsWith('/api/')) {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      });
      res.end();
      return;
    }
    const token = getToken(req, query);
    const user = A.userFromToken(token);
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(pathname);
      if (!m) continue;
      try {
        const params = {};
        r.keys.forEach((k, i) => (params[k] = m[i + 1]));
        if (r.perm && !user) return sendJson(res, 401, { error: 'Login zaroori hai', code: 'UNAUTHORIZED' });
        if (r.perm && !A.can(user, r.perm)) return sendJson(res, 403, { error: 'Is kaam ki ijazat nahi hai', code: 'FORBIDDEN' });
        const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req);
        const out = await r.handler({ req, res, user, body, query, params, token });
        if (out === null) return; // handler already responded (file/csv)
        return sendJson(res, 200, out);
      } catch (err) {
        const code = err.code || 'ERROR';
        const status =
          code === 'CREDIT_LIMIT' || code === 'GEO_FENCE'
            ? 409
            : code === 'UNAUTHORIZED'
              ? 401
              : code === 'FORBIDDEN'
                ? 403
                : 400;
        return sendJson(res, status, {
          error: err.message || String(err),
          code,
          credit_status: err.credit_status || undefined,
          needs_pin: err.needs_pin || undefined,
          distance_m: err.distance_m || undefined,
        });
      }
    }
    return sendJson(res, 404, { error: 'API route nahi mila: ' + pathname });
  }

  // ---- static files (SPA)
  let file = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  if (file.includes('..')) file = 'index.html';
  const full = path.join(WEB_DIR, file);
  if (fs.existsSync(full) && fs.statSync(full).isFile()) return sendFile(res, full);
  return sendFile(res, path.join(WEB_DIR, 'index.html'));
}

module.exports = { handle, routes, CRUD };
