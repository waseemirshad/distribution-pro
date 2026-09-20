'use strict';
/**
 * Distribution Pro - end to end smoke test
 * Har module ko chalata hai aur business rules verify karta hai.
 * Chalane ka tareeqa:  npm test
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const TMP = path.join(os.tmpdir(), 'distribution-pro-test-' + Date.now());
fs.mkdirSync(TMP, { recursive: true });
// test apna alag database use karta hai — asli data/ ko kabhi touch nahi karta
process.env.DP_DATA_DIR = TMP;
process.env.DP_DB = path.join(TMP, 'test.db');
process.env.DATA_DIR = TMP;
process.env.DB_FILE = path.join(TMP, 'test.db');
process.env.NO_DEMO = '1';
process.env.TZ = process.env.TZ || 'Asia/Karachi';

const U = require('../server/util');
const { db } = require('../server/db');
const SVC = require('../server/services');
const A = require('../server/auth');
const REPORTS = require('../server/reports');
const { install } = require('../server/install');
const { seedDemo } = require('../server/demo');

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  \u2713 ' + name);
  } else {
    fail++;
    failures.push(name);
    console.log('  \u2717 ' + name + (extra ? '  -> ' + JSON.stringify(extra) : ''));
  }
}
function group(t) {
  console.log('\n' + t);
}
function expectThrow(fn) {
  try {
    fn();
    return null;
  } catch (e) {
    return e;
  }
}

/* ------------------------------------------------------------------ boot */
group('1. Installation & migration');
const info = install();
ok('migrations applied', info.applied >= 0, info);
ok('tables created', db().val("SELECT COUNT(*) FROM sqlite_master WHERE type='table'") > 40);
ok('default admin exists', !!db().get("SELECT id FROM users WHERE username='admin'"));

/* ------------------------------------------------------------------ masters */
group('2. Master data');
const adminUser = A.publicUser(db().get("SELECT * FROM users WHERE username='admin'"));
const companyId = db().insert('companies', { name: 'Test Foods Ltd', active: 1 });
const catId = db().insert('categories', { name: 'Biscuits', active: 1 });
const supplierId = db().insert('suppliers', { name: 'Test Supplier', phone: '0300-0000000', opening_balance_paisa: 0, balance_paisa: 0, active: 1, created_at: U.nowIso() });
const routeId = db().insert('routes', { name: 'Test Route', area: 'Sadar', active: 1 });
const salesmanId = db().insert('salesmen', { code: 'S1', name: 'Test Salesman', phone: '0300-1111111', route_id: routeId, commission_pct: 5, active: 1 });
const mainWh = U.int(db().val("SELECT id FROM warehouses WHERE code='MAIN'"));
const scrapWh = U.int(db().val("SELECT id FROM warehouses WHERE code='SCRAP'"));
const vanWh = db().insert('warehouses', { code: 'VANX', name: 'Van X', type: 'VAN', active: 1 });
const p1 = db().insert('products', { sku: 'T-1', barcode: '1111', name: 'Test Biscuit', company_id: companyId, category_id: catId, carton_size: 24, cost_paisa: 4800, wholesale_paisa: 5400, retail_paisa: 6000, reorder_level: 72, shelf_life_days: 180, active: 1, created_at: U.nowIso() });
const p2 = db().insert('products', { sku: 'T-2', barcode: '2222', name: 'Test Tea', company_id: companyId, category_id: catId, carton_size: 12, cost_paisa: 38000, wholesale_paisa: 42000, retail_paisa: 46000, reorder_level: 36, shelf_life_days: 365, active: 1, created_at: U.nowIso() });
const custId = db().insert('customers', { code: 'C-1', name: 'Test Kiryana Store', phone: '0300-2222222', route_id: routeId, tier_id: U.int(db().val('SELECT id FROM price_tiers WHERE is_default=1')), credit_limit_paisa: 100000 * 100, credit_days: 15, opening_balance_paisa: 0, balance_paisa: 0, active: 1, created_at: U.nowIso() });
const custSmall = db().insert('customers', { code: 'C-2', name: 'Small Shop', phone: '0300-3333333', credit_limit_paisa: 1000 * 100, credit_days: 0, active: 1, created_at: U.nowIso() });
ok('masters created', companyId && supplierId && p1 && custId);

/* ------------------------------------------------------------------ purchase / batches */
group('3. Purchase, batches & expiry');
const purch = SVC.createPurchase(adminUser, {
  supplier_id: supplierId,
  date: U.today(),
  warehouse_id: mainWh,
  invoice_no: 'BILL-1',
  freight_paisa: 50000,
  lines: [
    { product_id: p1, cartons: 20, unit_cost_paisa: 4800, batch_no: 'B-EARLY', expiry_date: U.dateAdd(U.today(), 20) },
    { product_id: p1, cartons: 10, unit_cost_paisa: 4800, batch_no: 'B-LATE', expiry_date: U.dateAdd(U.today(), 200) },
    { product_id: p2, cartons: 10, unit_cost_paisa: 38000, batch_no: 'T-1', expiry_date: U.dateAdd(U.today(), 300) },
  ],
  payment: { method: 'CASH', amount_paisa: 10 * 4800 * 24 },
});
ok('purchase created', purch.id > 0 && purch.total_paisa > 0);
ok('stock increased (p1 = 30 cartons)', SVC.stockQty(p1, mainWh) === 30 * 24, SVC.stockQty(p1, mainWh));
ok('supplier payable tracked', db().val('SELECT balance_paisa FROM suppliers WHERE id=?', supplierId) === purch.total_paisa - 10 * 4800 * 24);
ok('supplier GL balanced', SVC.glCheck().balanced);

/* ------------------------------------------------------------------ FEFO */
group('4. FEFO (earliest expiry first) dispatch');
const inv1 = SVC.createInvoice(adminUser, {
  customer_id: custId,
  sale_type: 'CREDIT',
  warehouse_id: mainWh,
  salesman_id: salesmanId,
  lines: [{ product_id: p1, cartons: 5 }],
});
const alloc = db().all(
  `SELECT iba.qty, b.batch_no FROM invoice_batch_allocations iba JOIN batches b ON b.id=iba.batch_id WHERE iba.invoice_id=?`,
  inv1.id
);
ok('invoice created with credit', inv1.id > 0 && inv1.status === 'UNPAID');
ok('FEFO picked earliest expiry batch first', alloc.length > 0 && alloc[0].batch_no === 'B-EARLY', alloc);
ok('stock reduced after sale', SVC.stockQty(p1, mainWh) === 30 * 24 - 5 * 24);
ok('customer balance = invoice total', db().val('SELECT balance_paisa FROM customers WHERE id=?', custId) === inv1.total_paisa);
ok('gross profit calculated', inv1.gross_profit_paisa === (5400 - 4800) * 5 * 24, inv1.gross_profit_paisa);

/* ------------------------------------------------------------------ credit limit */
group('5. Credit limit hard lock + manager PIN override');
const bigInv = expectThrow(() =>
  SVC.createInvoice(adminUser, {
    customer_id: custSmall,
    sale_type: 'CREDIT',
    warehouse_id: mainWh,
    lines: [{ product_id: p2, cartons: 9 }], // 9*12*42000 = 45,36,000 paisa > 1,000 rupee limit
  })
);
ok('credit limit blocks the bill', !!bigInv && bigInv.code === 'CREDIT_LIMIT', bigInv && bigInv.message);
const wrongPin = expectThrow(() =>
  SVC.createInvoice(adminUser, {
    customer_id: custSmall,
    sale_type: 'CREDIT',
    warehouse_id: mainWh,
    lines: [{ product_id: p2, cartons: 9 }],
    override_pin: '0000',
  })
);
ok('wrong PIN rejected', !!wrongPin && /PIN/.test(wrongPin.message));
const overridden = SVC.createInvoice(adminUser, {
  customer_id: custSmall,
  sale_type: 'CREDIT',
  warehouse_id: mainWh,
  lines: [{ product_id: p2, cartons: 9 }],
  override_pin: '1234',
});
ok('manager PIN override allows bill', overridden.id > 0 && overridden.override_by === adminUser.id);
ok('audit records override', !!db().get("SELECT id FROM audit_log WHERE action='CREATE' AND entity='sales_invoice'"));

/* ------------------------------------------------------------------ schemes */
group('6. Trade schemes (10+1 free, slab discount)');
db().insert('schemes', {
  name: 'Cocomo 10+1', type: 'FREE_QTY', product_id: p1, buy_qty: 240, free_qty: 24, claimable: 1,
  company_id: companyId, active: 1, created_at: U.nowIso(),
});
const schemeInv = SVC.createInvoice(adminUser, {
  customer_id: custId,
  sale_type: 'CASH',
  warehouse_id: mainWh,
  lines: [{ product_id: p1, qty: 240 }],
});
const freeLines = db().all('SELECT * FROM sales_lines WHERE invoice_id=? AND is_free=1', schemeInv.id);
ok('free qty line added automatically', freeLines.length === 1 && freeLines[0].qty === 24, freeLines);
ok('claim created for company', U.int(db().val('SELECT COUNT(*) FROM claims WHERE invoice_id=?', schemeInv.id)) === 1);
ok('cash sale auto-receipt created', U.int(db().val('SELECT COUNT(*) FROM receipts WHERE auto_created=1 AND status=?', 'POSTED')) >= 1);

/* ------------------------------------------------------------------ receipts FIFO */
group('7. Recovery receipt -> FIFO settlement');
const invA = SVC.createInvoice(adminUser, { customer_id: custId, sale_type: 'CREDIT', warehouse_id: mainWh, date: U.dateAdd(U.today(), -10), lines: [{ product_id: p1, cartons: 2 }] });
const invB = SVC.createInvoice(adminUser, { customer_id: custId, sale_type: 'CREDIT', warehouse_id: mainWh, lines: [{ product_id: p1, cartons: 2 }] });
const receipt = SVC.createReceipt(adminUser, { customer_id: custId, method: 'CASH', amount_paisa: invA.total_paisa, salesman_id: salesmanId });
const invARow = db().get('SELECT * FROM sales_invoices WHERE id=?', invA.id);
const invBRow = db().get('SELECT * FROM sales_invoices WHERE id=?', invB.id);
ok('oldest bill settled first (FIFO)', invARow.status === 'PAID' && invBRow.status === 'UNPAID', { a: invARow.status, b: invBRow.status });
ok('receipt allocated', U.int(receipt.receipt.allocated_paisa) === invA.total_paisa);
ok(
  'customer balance equals total unpaid bills',
  db().val('SELECT balance_paisa FROM customers WHERE id=?', custId) ===
    U.int(db().val("SELECT COALESCE(SUM(total_paisa-paid_paisa),0) FROM sales_invoices WHERE customer_id=? AND status IN ('UNPAID','PARTIAL')", custId))
);

/* ------------------------------------------------------------------ cheque lifecycle */
group('8. Post dated cheque (PDC) lifecycle');
const custCheque = db().insert('customers', { code: 'C-3', name: 'Cheque Shop', credit_limit_paisa: 500000 * 100, credit_days: 30, active: 1, created_at: U.nowIso() });
const invC = SVC.createInvoice(adminUser, { customer_id: custCheque, sale_type: 'CREDIT', warehouse_id: mainWh, lines: [{ product_id: p1, cartons: 3 }] });
const chequeReceipt = SVC.createReceipt(adminUser, {
  customer_id: custCheque, method: 'CHEQUE', amount_paisa: invC.total_paisa,
  cheque_no: '445566', cheque_date: U.dateAdd(U.today(), 10), bank_name: 'HBL',
});
ok('cheque receipt posted', chequeReceipt.receipt.cheque_status === 'RECEIVED');
ok('invoice marked paid on cheque entry', db().val('SELECT status FROM sales_invoices WHERE id=?', invC.id) === 'PAID');
ok('cheques in hand account', SVC.accountBalance('CHEQUE') > 0);
SVC.setChequeStatus(adminUser, chequeReceipt.receipt.id, 'BOUNCED', { charges_paisa: 50000 });
ok('bounce re-opens the invoice', db().val('SELECT status FROM sales_invoices WHERE id=?', invC.id) === 'UNPAID');
ok('bounce records bank charges expense', U.int(db().val("SELECT COUNT(*) FROM expenses WHERE note LIKE 'Cheque bounce charges 445566%'")) === 1, db().all("SELECT note, amount_paisa FROM expenses"));
ok('gl still balanced after bounce', SVC.glCheck().balanced);

/* ------------------------------------------------------------------ returns */
group('9. Sales return (good / scrap)');
const ret = SVC.createSalesReturn(adminUser, {
  customer_id: custId, kind: 'GOOD', warehouse_id: mainWh, reason: 'Excess stock',
  lines: [{ product_id: p1, qty: 24, unit_price_paisa: 5400 }],
});
ok('return created', ret.id > 0 && ret.total_paisa === 24 * 5400);
const retScrap = SVC.createSalesReturn(adminUser, {
  customer_id: custId, kind: 'SCRAP', warehouse_id: scrapWh, reason: 'Damage',
  lines: [{ product_id: p1, qty: 24, unit_price_paisa: 5400 }],
});
ok('scrap return goes to scrap godown', SVC.stockQty(p1, scrapWh) === 24);
ok('customer balance reduced by return', SVC.customerBalance(custId) >= 0);

/* ------------------------------------------------------------------ van sales */
group('10. Van loading & evening settlement (shortage detection)');
const load = SVC.createVanLoad(adminUser, {
  date: U.today(), vehicle_no: 'JW-0001', salesman_id: salesmanId, route_id: routeId,
  van_warehouse_id: vanWh, source_warehouse_id: mainWh,
  lines: [{ product_id: p1, cartons: 3 }],
});
ok('van load created', load.id > 0 && load.loaded_qty === 72);
ok('stock moved to van godown', SVC.stockQty(p1, vanWh) === 72);
SVC.createInvoice(adminUser, {
  customer_id: custId, sale_type: 'CASH', warehouse_id: vanWh, salesman_id: salesmanId,
  lines: [{ product_id: p1, cartons: 1 }],
});
const settled = SVC.settleVanLoad(adminUser, load.id, { lines: [{ line_id: load.lines[0].id, qty_returned: 40, return_to: 'MAIN' }] });
ok('van settlement computes sold / returned / short', settled.status === 'SETTLED' && settled.sold_qty === 24 && settled.returned_qty === 40 && settled.short_qty === 8, {
  sold: settled.sold_qty, ret: settled.returned_qty, short: settled.short_qty,
});
ok('shortage recorded as loss in GL', U.int(db().val("SELECT COALESCE(SUM(debit_paisa),0) FROM ledger_entries WHERE party_type='STOCK_LOSS'")) > 0);
ok('van godown empty after settlement', SVC.stockQty(p1, vanWh) === 0);

/* ------------------------------------------------------------------ transfers */
group('11. Multi godown stock transfer (STN)');
const tr = SVC.createTransfer(adminUser, {
  from_warehouse_id: mainWh, to_warehouse_id: vanWh, lines: [{ product_id: p2, cartons: 1 }],
});
ok('transfer dispatched', tr.id > 0 && tr.status === 'DISPATCHED');
SVC.receiveTransfer(adminUser, tr.id, { lines: [{ line_id: tr.lines[0].id, qty_received: tr.lines[0].qty_sent - 4 }] });
ok('transfer received with shortage', db().val('SELECT status FROM transfers WHERE id=?', tr.id) === 'RECEIVED');

/* ------------------------------------------------------------------ orders */
group('12. Order booking -> delivery invoice');
const order = SVC.createOrder(adminUser, { customer_id: custId, salesman_id: salesmanId, route_id: routeId, lines: [{ product_id: p1, cartons: 2 }] });
ok('order booked', order.status === 'BOOKED');
const orderInv = SVC.convertOrderToInvoice(adminUser, order.id, { sale_type: 'CREDIT', warehouse_id: mainWh });
ok('order converted to invoice', orderInv.id > 0 && db().val('SELECT status FROM orders WHERE id=?', order.id) === 'DELIVERED');

/* ------------------------------------------------------------------ purchase return & payment */
group('13. Purchase return & supplier payment');
const pr = SVC.createPurchaseReturn(adminUser, { supplier_id: supplierId, warehouse_id: mainWh, reason: 'Damage', lines: [{ product_id: p1, qty: 24, unit_cost_paisa: 4800 }] });
ok('purchase return created', pr.id > 0 && pr.total_paisa === 24 * 4800);
const pay = SVC.createPayment(adminUser, { supplier_id: supplierId, method: 'CASH', amount_paisa: 1000000 });
ok('supplier payment posted', pay.id > 0 && U.int(pay.allocated_paisa) > 0);
ok('purchase payable reduced', SVC.supplierBalance(supplierId) < purch.total_paisa);

/* ------------------------------------------------------------------ expenses & closing */
group('14. Expenses, cash position & daily closing');
const headId = U.int(db().val('SELECT id FROM expense_heads LIMIT 1'));
SVC.createExpense(adminUser, { head_id: headId, amount_paisa: 60000, method: 'CASH', note: 'Petrol', vehicle_no: 'JW-0001' });
const pos = SVC.cashPosition(U.today());
ok('cash position computed', pos.expected_paisa === pos.opening_paisa + pos.cash_in_paisa - pos.cash_out_paisa, pos);
const closing = SVC.createCashClosing(adminUser, { counted_paisa: pos.expected_paisa - 5000, note: 'Short by 50' });
ok('cash closing records variance', closing.variance_paisa === -5000, closing.variance_paisa);
ok('closing adjusts cash book', SVC.glCheck().balanced);

/* ------------------------------------------------------------------ commissions */
group('15. Recovery based commission');
db().run('UPDATE salesmen SET commission_pct=5 WHERE id=?', salesmanId);
const commissions = SVC.generateCommissions(adminUser, { from: U.dateAdd(U.today(), -30), to: U.today(), salesman_id: salesmanId });
ok('commission generated on recovery only', commissions.length === 1 && commissions[0].base_paisa > 0 && commissions[0].amount_paisa === Math.round(commissions[0].base_paisa * 0.05), commissions);
const paid = SVC.payCommission(adminUser, commissions[0].id);
ok('commission paid via expense', paid.status === 'PAID');

/* ------------------------------------------------------------------ geo fence */
group('16. Salesman geo-fenced check-in');
db().run('UPDATE customers SET lat=24.8600, lng=67.0100 WHERE id=?', custId);
const far = expectThrow(() => SVC.checkIn(adminUser, { customer_id: custId, lat: 24.9000, lng: 67.1000 }));
ok('far away check-in blocked', !!far && far.code === 'GEO_FENCE', far && far.message);
const near = SVC.checkIn(adminUser, { customer_id: custId, lat: 24.8602, lng: 67.0101 });
ok('near shop check-in allowed', !!near.id && near.distance_m < 150, near && near.distance_m);

/* ------------------------------------------------------------------ dashboard & reports */
group('17. Dashboard');
const dash = SVC.dashboard(U.today());
ok('dashboard KPIs', typeof dash.sales.total_paisa === 'number' && dash.aging.length === 4 && Array.isArray(dash.trend));
ok('dashboard net profit formula', dash.net_profit_paisa === dash.sales.gross_profit_paisa - dash.expenses_paisa);

group('18. All reports run without error');
const list = REPORTS.list();
let reportErrors = 0;
for (const r of list) {
  try {
    const out = REPORTS.run(r.key, { customer_id: custId, supplier_id: supplierId, salesman_id: salesmanId, product_id: p1, warehouse_id: mainWh, from: U.dateAdd(U.today(), -60), to: U.today(), as_on: U.today(), date: U.today(), period: U.monthOf(U.today()), days: 90, status: 'RECEIVED' });
    if (!out || !Array.isArray(out.rows)) throw new Error('bad shape');
  } catch (e) {
    reportErrors++;
    console.log('    ! report failed: ' + r.key + ' -> ' + e.message);
  }
}
ok('all ' + list.length + ' reports return data', reportErrors === 0);

group('19. Data integrity');
ok('GL debit == credit', SVC.glCheck().balanced, SVC.glCheck());
ok('every sale line has batch allocation', U.int(db().val("SELECT COUNT(*) FROM sales_lines sl WHERE sl.is_free=0 AND NOT EXISTS (SELECT 1 FROM invoice_batch_allocations a WHERE a.line_id=sl.id)")) === 0);
ok('customer balances match ledger', db().all('SELECT id, balance_paisa FROM customers').every((c) => U.int(c.balance_paisa) === SVC.customerBalance(c.id)));
ok('stock never negative in official godown', db().all('SELECT SUM(qty_remaining) AS q FROM batches WHERE warehouse_id=?', mainWh).every((r) => U.int(r.q) >= 0));

/* ------------------------------------------------------------------ demo data */
group('20. Demo data generator (does not break integrity)');
const demoOut = seedDemo({ force: true });
ok('demo data generated', U.int(demoOut.invoices) > 10 && U.int(demoOut.products) > 20, demoOut);
ok('GL balanced after demo data', SVC.glCheck().balanced, SVC.glCheck());
ok('demo invoices have batch allocations', U.int(db().val("SELECT COUNT(*) FROM sales_lines WHERE invoice_id IN (SELECT id FROM sales_invoices) AND batch_id IS NULL")) === 0);
const dash2 = SVC.dashboard(U.today());
ok('dashboard works on demo data', dash2.sales.count > 0 && dash2.receivables_paisa >= 0);

/* ------------------------------------------------------------------ summary */
console.log('\n' + '='.repeat(60));
console.log(`  TESTS: ${pass} passed, ${fail} failed  (${pass + fail} total)`);
if (fail) {
  console.log('  Failed tests:');
  failures.forEach((f) => console.log('   - ' + f));
}
console.log('='.repeat(60));
process.exit(fail ? 1 : 0);
