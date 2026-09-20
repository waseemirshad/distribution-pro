'use strict';
/**
 * Distribution Pro - database schema (SQLite, version 1)
 * Sab money columns INTEGER paisa me hain (float money kabhi nahi).
 * Sab qty columns INTEGER pieces me hain (carton sirf display ke liye).
 */

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS schema_versions (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS seq (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  at        TEXT NOT NULL,
  user_id   INTEGER,
  username  TEXT,
  action    TEXT NOT NULL,
  entity    TEXT,
  entity_id INTEGER,
  details   TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  full_name     TEXT,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL,
  salesman_id   INTEGER,
  phone         TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  last_login    TEXT,
  created_at    TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  created_at TEXT,
  expires_at TEXT NOT NULL,
  last_seen  TEXT
);

CREATE TABLE IF NOT EXISTS warehouses (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  code    TEXT,
  name    TEXT NOT NULL,
  type    TEXT NOT NULL DEFAULT 'MAIN',
  address TEXT,
  active  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS companies (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  contact_person TEXT,
  phone          TEXT,
  email          TEXT,
  address        TEXT,
  city           TEXT,
  ntn            TEXT,
  active         INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS categories (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL,
  parent_id INTEGER,
  active    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS price_tiers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  discount_pct REAL NOT NULL DEFAULT 0,
  is_default   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  sku            TEXT,
  barcode        TEXT,
  name           TEXT NOT NULL,
  company_id     INTEGER,
  category_id    INTEGER,
  unit           TEXT NOT NULL DEFAULT 'pcs',
  carton_size    INTEGER NOT NULL DEFAULT 1,
  cost_paisa     INTEGER NOT NULL DEFAULT 0,
  wholesale_paisa INTEGER NOT NULL DEFAULT 0,
  retail_paisa   INTEGER NOT NULL DEFAULT 0,
  tax_pct        REAL NOT NULL DEFAULT 0,
  reorder_level  INTEGER NOT NULL DEFAULT 0,
  shelf_life_days INTEGER,
  notes          TEXT,
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);

CREATE TABLE IF NOT EXISTS product_prices (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL,
  tier_id     INTEGER NOT NULL,
  price_paisa INTEGER NOT NULL,
  UNIQUE (product_id, tier_id)
);

CREATE TABLE IF NOT EXISTS suppliers (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  name                 TEXT NOT NULL,
  contact_person       TEXT,
  phone                TEXT,
  email                TEXT,
  address              TEXT,
  city                 TEXT,
  ntn                  TEXT,
  company_id           INTEGER,
  opening_balance_paisa INTEGER NOT NULL DEFAULT 0,
  balance_paisa        INTEGER NOT NULL DEFAULT 0,
  notes                TEXT,
  active               INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT
);

CREATE TABLE IF NOT EXISTS customers (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  code                  TEXT,
  name                  TEXT NOT NULL,
  owner_name            TEXT,
  phone                 TEXT,
  whatsapp              TEXT,
  address               TEXT,
  area                  TEXT,
  city                  TEXT,
  shop_type             TEXT,
  route_id              INTEGER,
  tier_id               INTEGER,
  credit_limit_paisa    INTEGER NOT NULL DEFAULT 0,
  credit_days           INTEGER NOT NULL DEFAULT 0,
  opening_balance_paisa INTEGER NOT NULL DEFAULT 0,
  balance_paisa         INTEGER NOT NULL DEFAULT 0,
  advance_paisa         INTEGER NOT NULL DEFAULT 0,
  ntn                   TEXT,
  gst_no                TEXT,
  lat                   REAL,
  lng                   REAL,
  notes                 TEXT,
  active                INTEGER NOT NULL DEFAULT 1,
  created_at            TEXT
);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
CREATE INDEX IF NOT EXISTS idx_customers_route ON customers(route_id);

CREATE TABLE IF NOT EXISTS routes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  area           TEXT,
  weekday        TEXT,
  note           TEXT,
  active         INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS route_customers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  route_id    INTEGER NOT NULL,
  customer_id INTEGER NOT NULL,
  seq         INTEGER NOT NULL DEFAULT 0,
  UNIQUE (route_id, customer_id)
);

CREATE TABLE IF NOT EXISTS salesmen (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  code               TEXT,
  name               TEXT NOT NULL,
  phone              TEXT,
  route_id           INTEGER,
  vehicle_no         TEXT,
  commission_pct     REAL NOT NULL DEFAULT 0,
  basic_salary_paisa INTEGER NOT NULL DEFAULT 0,
  joined_at          TEXT,
  active             INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS expense_heads (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  name    TEXT NOT NULL,
  is_cogs INTEGER NOT NULL DEFAULT 0,
  active  INTEGER NOT NULL DEFAULT 1
);

/* ------------------------------------------------ stock & batches (FEFO) */
CREATE TABLE IF NOT EXISTS batches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id    INTEGER NOT NULL,
  warehouse_id  INTEGER NOT NULL,
  batch_no      TEXT,
  mfg_date      TEXT,
  expiry_date   TEXT,
  cost_paisa    INTEGER NOT NULL DEFAULT 0,
  supplier_id   INTEGER,
  qty_in        INTEGER NOT NULL DEFAULT 0,
  qty_remaining INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_batches_fefo ON batches(product_id, warehouse_id, expiry_date);
CREATE INDEX IF NOT EXISTS idx_batches_expiry ON batches(expiry_date);

CREATE TABLE IF NOT EXISTS stock_moves (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  at              TEXT NOT NULL,
  product_id      INTEGER NOT NULL,
  warehouse_id    INTEGER NOT NULL,
  batch_id        INTEGER,
  qty             INTEGER NOT NULL,
  type            TEXT NOT NULL,
  ref_type        TEXT,
  ref_id          INTEGER,
  unit_cost_paisa INTEGER NOT NULL DEFAULT 0,
  balance_after   INTEGER,
  note            TEXT,
  user_id         INTEGER
);
CREATE INDEX IF NOT EXISTS idx_moves_prod ON stock_moves(product_id, warehouse_id);

/* ------------------------------------------------ purchases */
CREATE TABLE IF NOT EXISTS purchases (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no      TEXT NOT NULL,
  supplier_bill   TEXT,
  date            TEXT,
  supplier_id     INTEGER NOT NULL,
  warehouse_id    INTEGER NOT NULL,
  company_id      INTEGER,
  subtotal_paisa  INTEGER NOT NULL DEFAULT 0,
  discount_paisa  INTEGER NOT NULL DEFAULT 0,
  freight_paisa   INTEGER NOT NULL DEFAULT 0,
  tax_paisa       INTEGER NOT NULL DEFAULT 0,
  total_paisa     INTEGER NOT NULL DEFAULT 0,
  paid_paisa      INTEGER NOT NULL DEFAULT 0,
  balance_paisa   INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'UNPAID',
  notes           TEXT,
  user_id         INTEGER,
  created_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(date);
CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases(supplier_id);

CREATE TABLE IF NOT EXISTS purchase_lines (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id      INTEGER NOT NULL,
  product_id       INTEGER NOT NULL,
  batch_id         INTEGER,
  batch_no         TEXT,
  expiry_date      TEXT,
  cartons          INTEGER NOT NULL DEFAULT 0,
  loose            INTEGER NOT NULL DEFAULT 0,
  qty              INTEGER NOT NULL DEFAULT 0,
  unit_cost_paisa  INTEGER NOT NULL DEFAULT 0,
  discount_pct     REAL NOT NULL DEFAULT 0,
  line_total_paisa INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS purchase_returns (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  return_no    TEXT NOT NULL,
  date         TEXT,
  supplier_id  INTEGER NOT NULL,
  warehouse_id INTEGER,
  total_paisa  INTEGER NOT NULL DEFAULT 0,
  reason       TEXT,
  user_id      INTEGER,
  created_at   TEXT
);

CREATE TABLE IF NOT EXISTS purchase_return_lines (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id        INTEGER NOT NULL,
  product_id       INTEGER NOT NULL,
  batch_id         INTEGER,
  qty              INTEGER NOT NULL DEFAULT 0,
  unit_cost_paisa  INTEGER NOT NULL DEFAULT 0,
  line_total_paisa INTEGER NOT NULL DEFAULT 0,
  condition        TEXT NOT NULL DEFAULT 'GOOD'
);

/* ------------------------------------------------ sales */
CREATE TABLE IF NOT EXISTS sales_invoices (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no             TEXT NOT NULL,
  date                   TEXT,
  due_date               TEXT,
  customer_id            INTEGER NOT NULL,
  salesman_id            INTEGER,
  route_id               INTEGER,
  warehouse_id           INTEGER NOT NULL,
  order_id               INTEGER,
  sale_type              TEXT NOT NULL DEFAULT 'CREDIT',
  subtotal_paisa         INTEGER NOT NULL DEFAULT 0,
  discount_paisa         INTEGER NOT NULL DEFAULT 0,
  scheme_discount_paisa  INTEGER NOT NULL DEFAULT 0,
  tax_paisa              INTEGER NOT NULL DEFAULT 0,
  total_paisa            INTEGER NOT NULL DEFAULT 0,
  cost_total_paisa       INTEGER NOT NULL DEFAULT 0,
  gross_profit_paisa     INTEGER NOT NULL DEFAULT 0,
  paid_paisa             INTEGER NOT NULL DEFAULT 0,
  balance_paisa          INTEGER NOT NULL DEFAULT 0,
  status                 TEXT NOT NULL DEFAULT 'UNPAID',
  override_by            INTEGER,
  override_reason        TEXT,
  notes                  TEXT,
  user_id                INTEGER,
  created_at             TEXT
);
CREATE INDEX IF NOT EXISTS idx_inv_date ON sales_invoices(date);
CREATE INDEX IF NOT EXISTS idx_inv_customer ON sales_invoices(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_inv_status ON sales_invoices(status);

CREATE TABLE IF NOT EXISTS sales_lines (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id       INTEGER NOT NULL,
  product_id       INTEGER NOT NULL,
  batch_id         INTEGER,
  cartons          INTEGER NOT NULL DEFAULT 0,
  loose            INTEGER NOT NULL DEFAULT 0,
  qty              INTEGER NOT NULL DEFAULT 0,
  unit_price_paisa INTEGER NOT NULL DEFAULT 0,
  cost_paisa       INTEGER NOT NULL DEFAULT 0,
  discount_pct     REAL NOT NULL DEFAULT 0,
  discount_paisa   INTEGER NOT NULL DEFAULT 0,
  scheme_id        INTEGER,
  is_free          INTEGER NOT NULL DEFAULT 0,
  line_total_paisa INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_lines_invoice ON sales_lines(invoice_id);
CREATE INDEX IF NOT EXISTS idx_lines_product ON sales_lines(product_id);

/* kaun sa maal kis batch se nikla (audit + return-to-batch ke liye) */
CREATE TABLE IF NOT EXISTS invoice_batch_allocations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id  INTEGER NOT NULL,
  line_id     INTEGER,
  product_id  INTEGER NOT NULL,
  batch_id    INTEGER,
  qty         INTEGER NOT NULL DEFAULT 0,
  cost_paisa  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_iba_invoice ON invoice_batch_allocations(invoice_id);
CREATE INDEX IF NOT EXISTS idx_iba_batch ON invoice_batch_allocations(batch_id);

CREATE TABLE IF NOT EXISTS sales_returns (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  return_no    TEXT NOT NULL,
  date         TEXT,
  customer_id  INTEGER NOT NULL,
  invoice_id   INTEGER,
  warehouse_id INTEGER,
  salesman_id  INTEGER,
  kind         TEXT NOT NULL DEFAULT 'GOOD',
  total_paisa  INTEGER NOT NULL DEFAULT 0,
  reason       TEXT,
  user_id      INTEGER,
  created_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_sret_date ON sales_returns(date);

CREATE TABLE IF NOT EXISTS sales_return_lines (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id        INTEGER NOT NULL,
  product_id       INTEGER NOT NULL,
  batch_id         INTEGER,
  qty              INTEGER NOT NULL DEFAULT 0,
  unit_price_paisa INTEGER NOT NULL DEFAULT 0,
  line_total_paisa INTEGER NOT NULL DEFAULT 0,
  kind             TEXT NOT NULL DEFAULT 'GOOD'
);

/* ------------------------------------------------ order booking */
CREATE TABLE IF NOT EXISTS orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no       TEXT NOT NULL,
  date           TEXT,
  customer_id    INTEGER NOT NULL,
  salesman_id    INTEGER,
  route_id       INTEGER,
  subtotal_paisa INTEGER NOT NULL DEFAULT 0,
  discount_paisa INTEGER NOT NULL DEFAULT 0,
  total_paisa    INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'BOOKED',
  invoice_id     INTEGER,
  notes          TEXT,
  user_id        INTEGER,
  created_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(date);

CREATE TABLE IF NOT EXISTS order_lines (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id         INTEGER NOT NULL,
  product_id       INTEGER NOT NULL,
  cartons          INTEGER NOT NULL DEFAULT 0,
  loose            INTEGER NOT NULL DEFAULT 0,
  qty              INTEGER NOT NULL DEFAULT 0,
  unit_price_paisa INTEGER NOT NULL DEFAULT 0,
  discount_pct     REAL NOT NULL DEFAULT 0,
  line_total_paisa INTEGER NOT NULL DEFAULT 0
);

/* ------------------------------------------------ van sales */
CREATE TABLE IF NOT EXISTS van_loads (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  load_no             TEXT NOT NULL,
  date                TEXT,
  salesman_id         INTEGER,
  route_id            INTEGER,
  vehicle_no          TEXT,
  van_warehouse_id    INTEGER NOT NULL,
  source_warehouse_id INTEGER NOT NULL,
  status              TEXT NOT NULL DEFAULT 'OPEN',
  loaded_qty          INTEGER NOT NULL DEFAULT 0,
  sold_qty            INTEGER NOT NULL DEFAULT 0,
  returned_qty        INTEGER NOT NULL DEFAULT 0,
  short_qty           INTEGER NOT NULL DEFAULT 0,
  loaded_value_paisa  INTEGER NOT NULL DEFAULT 0,
  sold_value_paisa    INTEGER NOT NULL DEFAULT 0,
  returned_value_paisa INTEGER NOT NULL DEFAULT 0,
  shortage_value_paisa INTEGER NOT NULL DEFAULT 0,
  opened_at           TEXT,
  gate_pass_at        TEXT,
  settled_at          TEXT,
  notes               TEXT,
  user_id             INTEGER,
  created_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_van_date ON van_loads(date);

CREATE TABLE IF NOT EXISTS van_load_lines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  load_id       INTEGER NOT NULL,
  product_id    INTEGER NOT NULL,
  batch_id      INTEGER,
  qty_loaded    INTEGER NOT NULL DEFAULT 0,
  qty_sold      INTEGER NOT NULL DEFAULT 0,
  qty_returned  INTEGER NOT NULL DEFAULT 0,
  qty_short     INTEGER NOT NULL DEFAULT 0,
  unit_cost_paisa INTEGER NOT NULL DEFAULT 0,
  return_to     TEXT
);

/* ------------------------------------------------ godown transfers (STN) */
CREATE TABLE IF NOT EXISTS transfers (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  stn_no            TEXT NOT NULL,
  date              TEXT,
  from_warehouse_id INTEGER NOT NULL,
  to_warehouse_id   INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'DISPATCHED',
  notes             TEXT,
  user_id           INTEGER,
  created_at        TEXT,
  received_at       TEXT
);

CREATE TABLE IF NOT EXISTS transfer_lines (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_id  INTEGER NOT NULL,
  product_id   INTEGER NOT NULL,
  batch_id     INTEGER,
  qty_sent     INTEGER NOT NULL DEFAULT 0,
  qty_received INTEGER NOT NULL DEFAULT 0
);

/* ------------------------------------------------ money: receipts / cheques / payments */
CREATE TABLE IF NOT EXISTS receipts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_no       TEXT NOT NULL,
  date             TEXT,
  customer_id      INTEGER NOT NULL,
  salesman_id      INTEGER,
  route_id         INTEGER,
  method           TEXT NOT NULL DEFAULT 'CASH',
  amount_paisa     INTEGER NOT NULL DEFAULT 0,
  allocated_paisa  INTEGER NOT NULL DEFAULT 0,
  advance_paisa    INTEGER NOT NULL DEFAULT 0,
  cheque_no        TEXT,
  cheque_date      TEXT,
  bank_name        TEXT,
  cheque_status    TEXT,
  cheque_status_at TEXT,
  clearance_date   TEXT,
  bounce_charges_paisa INTEGER NOT NULL DEFAULT 0,
  auto_created     INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'ACTIVE',
  notes            TEXT,
  user_id          INTEGER,
  created_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_receipts_date ON receipts(date);
CREATE INDEX IF NOT EXISTS idx_receipts_customer ON receipts(customer_id);
CREATE INDEX IF NOT EXISTS idx_receipts_cheque ON receipts(cheque_status);

CREATE TABLE IF NOT EXISTS receipt_allocations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id  INTEGER NOT NULL,
  invoice_id  INTEGER NOT NULL,
  amount_paisa INTEGER NOT NULL DEFAULT 0,
  at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alloc_receipt ON receipt_allocations(receipt_id);
CREATE INDEX IF NOT EXISTS idx_alloc_invoice ON receipt_allocations(invoice_id);

CREATE TABLE IF NOT EXISTS payments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_no      TEXT NOT NULL,
  date            TEXT,
  supplier_id     INTEGER NOT NULL,
  method          TEXT NOT NULL DEFAULT 'CASH',
  amount_paisa    INTEGER NOT NULL DEFAULT 0,
  allocated_paisa INTEGER NOT NULL DEFAULT 0,
  cheque_no       TEXT,
  cheque_date     TEXT,
  bank_name       TEXT,
  cheque_status   TEXT,
  status          TEXT NOT NULL DEFAULT 'POSTED',
  notes           TEXT,
  user_id         INTEGER,
  created_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(date);
CREATE INDEX IF NOT EXISTS idx_payments_supplier ON payments(supplier_id);

CREATE TABLE IF NOT EXISTS payment_allocations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id   INTEGER NOT NULL,
  purchase_id  INTEGER NOT NULL,
  amount_paisa INTEGER NOT NULL DEFAULT 0,
  at           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expenses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  date         TEXT,
  head_id      INTEGER,
  amount_paisa INTEGER NOT NULL DEFAULT 0,
  method       TEXT NOT NULL DEFAULT 'CASH',
  warehouse_id INTEGER,
  salesman_id  INTEGER,
  vehicle_no   TEXT,
  payee        TEXT,
  note         TEXT,
  user_id      INTEGER,
  created_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);

CREATE TABLE IF NOT EXISTS cash_closings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  date           TEXT,
  user_id        INTEGER,
  opening_paisa  INTEGER NOT NULL DEFAULT 0,
  cash_in_paisa  INTEGER NOT NULL DEFAULT 0,
  cash_out_paisa INTEGER NOT NULL DEFAULT 0,
  expected_paisa INTEGER NOT NULL DEFAULT 0,
  counted_paisa  INTEGER NOT NULL DEFAULT 0,
  variance_paisa INTEGER NOT NULL DEFAULT 0,
  note           TEXT,
  created_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_closings_date ON cash_closings(date);

/* ------------------------------------------------ schemes / claims / commissions */
CREATE TABLE IF NOT EXISTS schemes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  type           TEXT NOT NULL DEFAULT 'FREE_QTY',
  product_id     INTEGER,
  category_id    INTEGER,
  company_id     INTEGER,
  buy_qty        INTEGER NOT NULL DEFAULT 0,
  free_qty       INTEGER NOT NULL DEFAULT 0,
  slab_min_qty   INTEGER NOT NULL DEFAULT 0,
  discount_pct   REAL NOT NULL DEFAULT 0,
  start_date     TEXT,
  end_date       TEXT,
  claimable      INTEGER NOT NULL DEFAULT 0,
  active         INTEGER NOT NULL DEFAULT 1,
  notes          TEXT,
  created_at     TEXT
);

CREATE TABLE IF NOT EXISTS claims (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  date         TEXT,
  company_id   INTEGER,
  scheme_id    INTEGER,
  invoice_id   INTEGER,
  product_id   INTEGER,
  qty_free     INTEGER NOT NULL DEFAULT 0,
  value_paisa  INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'OPEN',
  submitted_at TEXT,
  settled_at   TEXT,
  note         TEXT,
  created_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status);

CREATE TABLE IF NOT EXISTS commissions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  salesman_id  INTEGER NOT NULL,
  period_from  TEXT NOT NULL,
  period_to    TEXT NOT NULL,
  base_paisa   INTEGER NOT NULL DEFAULT 0,
  pct          REAL NOT NULL DEFAULT 0,
  amount_paisa INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'UNPAID',
  paid_at      TEXT,
  note         TEXT,
  created_at   TEXT
);

CREATE TABLE IF NOT EXISTS targets (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  salesman_id            INTEGER NOT NULL,
  period                 TEXT NOT NULL,
  target_sales_paisa     INTEGER NOT NULL DEFAULT 0,
  target_recovery_paisa  INTEGER NOT NULL DEFAULT 0,
  target_new_outlets     INTEGER NOT NULL DEFAULT 0,
  note                   TEXT,
  created_at             TEXT,
  UNIQUE (salesman_id, period)
);

CREATE TABLE IF NOT EXISTS visits (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL,
  customer_id INTEGER NOT NULL,
  salesman_id INTEGER,
  user_id     INTEGER,
  kind        TEXT NOT NULL DEFAULT 'CHECKIN',
  lat         REAL,
  lng         REAL,
  distance_m  INTEGER,
  notes       TEXT
);

/* ------------------------------------------------ party ledger (khata) */
CREATE TABLE IF NOT EXISTS ledger_entries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  at            TEXT NOT NULL,
  date          TEXT,
  party_type    TEXT NOT NULL,
  party_id      INTEGER NOT NULL,
  ref_type      TEXT,
  ref_id        INTEGER,
  debit_paisa   INTEGER NOT NULL DEFAULT 0,
  credit_paisa  INTEGER NOT NULL DEFAULT 0,
  balance_paisa INTEGER,
  note          TEXT,
  user_id       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ledger_party ON ledger_entries(party_type, party_id, id);
CREATE INDEX IF NOT EXISTS idx_ledger_date ON ledger_entries(date);
`;

const DEFAULT_SETTINGS = {
  /* document numbering */
  receipt_prefix: 'RCP',
  purchase_prefix: 'PUR',
  order_prefix: 'ORD',
  van_prefix: 'VL',
  transfer_prefix: 'STN',
  return_prefix: 'SR',
  purchase_return_prefix: 'PR',
  payment_prefix: 'PAY',
  /* credit rules */
  enforce_credit_days: '1',
  enable_geo_fence: '1',
  geo_fence_radius_m: '150',
  tax_enabled: '0',
  default_scrap_warehouse_id: '',
  company_name: 'Distribution Pro Traders',
  company_phone: '0300-0000000',
  company_address: 'Main Bazar, Karachi, Pakistan',
  company_ntn: '',
  currency: 'PKR',
  currency_symbol: 'Rs',
  print_paper: '80mm',
  invoice_prefix: 'INV',
  sales_tax_pct: '0',
  tax_inclusive: '0',
  enforce_credit_limit: '1',
  credit_grace_days: '7',
  aging_days: '30,60,90',
  expiry_warning_days: '90',
  expiry_block_days: '0',
  allow_negative_stock: '0',
  default_warehouse_id: '',
  default_tier_id: '',
  default_route_id: '',
  manager_pin: '',
  round_off: '1',
  low_stock_alerts: '1',
  whatsapp_country_code: '92',
  statement_footer: 'Shukriya! Maal wapas sirf 7 din me, bill ke sath.',
  invoice_footer: 'Maal ki wapsi 7 din ke andar bill ke sath. Shukriya!',
  backup_keep: '10',
  demo_seeded: '0',
  installed_at: '',
};

const DEFAULT_WAREHOUSES = [
  { code: 'MAIN', name: 'Main Godown', type: 'MAIN' },
  { code: 'COUNTER', name: 'Counter Stock', type: 'COUNTER' },
  { code: 'SCRAP', name: 'Scrap / Damage Godown', type: 'SCRAP' },
];

const DEFAULT_TIERS = [
  { name: 'Retail Rate', discount_pct: 0, is_default: 1 },
  { name: 'Wholesale', discount_pct: 3, is_default: 0 },
  { name: 'Distributor', discount_pct: 6, is_default: 0 },
  { name: 'Super Store', discount_pct: 9, is_default: 0 },
];

const DEFAULT_HEADS = [
  'Petrol / Fuel', 'Vehicle Repair', 'Salary', 'Rent', 'Electricity', 'Tea / Refreshment',
  'Loading / Labour', 'Packing Material', 'Bank Charges', 'Cheque Bounce Charges',
  'Market Expense', 'Mobile / Internet', 'Tax / Government', 'Freight Inward', 'Misc Expense',
];
const DEFAULT_EXPENSE_HEADS = DEFAULT_HEADS;

const DEFAULT_ROUTES = [
  { name: 'Route 1 - Saddar', area: 'Saddar', weekday: 'Monday' },
  { name: 'Route 2 - Nazimabad', area: 'Nazimabad', weekday: 'Tuesday' },
  { name: 'Route 3 - Gulshan', area: 'Gulshan', weekday: 'Wednesday' },
  { name: 'Route 4 - Korangi', area: 'Korangi', weekday: 'Thursday' },
];

module.exports = {
  SCHEMA_V1,
  DEFAULT_SETTINGS,
  DEFAULT_WAREHOUSES,
  DEFAULT_TIERS,
  DEFAULT_HEADS,
  DEFAULT_EXPENSE_HEADS,
  DEFAULT_ROUTES,
};
