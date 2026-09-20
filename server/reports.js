'use strict';
/**
 * Distribution Pro - reports engine
 * Every report returns { key, name, params, columns, rows, totals }
 * so the UI (and CSV export) can render it generically.
 */

const { db } = require('./db');
const U = require('./util');
const SVC = require('./services');

const M = 'money';
const Q = 'qty';
const D = 'date';
const T = 'text';

function money(key, label) {
  return { key, label, type: M };
}
function qty(key, label) {
  return { key, label, type: Q };
}
function text(key, label) {
  return { key, label, type: T };
}
function date(key, label) {
  return { key, label, type: D };
}
function pctCol(key, label) {
  return { key, label, type: 'pct' };
}

function tot(rows, key) {
  return rows.reduce((s, r) => s + U.int(r[key]), 0);
}

function R(key, name, params, columns, rows, extra) {
  const totals = {};
  if (rows && rows.length) {
    for (const c of columns) {
      if (c.type === M || c.type === Q) {
        if (c.total !== false) totals[c.key] = tot(rows, c.key);
      }
    }
  }
  return { key, name, params: params || [], columns, rows: rows || [], totals, ...(extra || {}) };
}

const REPORTS = {};
function def(key, name, params, fn) {
  REPORTS[key] = { key, name, params, fn };
}

/* ------------------------------------------------------------------ sales */
def('sales_register', 'Sales Register (Bill by Bill)', ['from', 'to', 'customer_id', 'salesman_id'], (p) => {
  const where = ["si.status<>'VOID'", 'si.date BETWEEN ? AND ?'];
  const args = [p.from, p.to];
  if (p.customer_id) {
    where.push('si.customer_id=?');
    args.push(U.int(p.customer_id));
  }
  if (p.salesman_id) {
    where.push('si.salesman_id=?');
    args.push(U.int(p.salesman_id));
  }
  const rows = db().all(
    `SELECT si.invoice_no, si.date, c.name AS customer, s.name AS salesman, r.name AS route, si.sale_type,
            si.subtotal_paisa, si.discount_paisa, si.tax_paisa, si.total_paisa, si.paid_paisa,
            (si.total_paisa - si.paid_paisa) AS balance_paisa, si.status, si.gross_profit_paisa
       FROM sales_invoices si
       LEFT JOIN customers c ON c.id=si.customer_id
       LEFT JOIN salesmen s ON s.id=si.salesman_id
       LEFT JOIN routes r ON r.id=si.route_id
      WHERE ${where.join(' AND ')} ORDER BY si.date, si.id`,
    ...args
  );
  return R('sales_register', 'Sales Register', ['from', 'to', 'customer_id', 'salesman_id'], [
    text('invoice_no', 'Bill No'),
    date('date', 'Date'),
    text('customer', 'Customer'),
    text('salesman', 'Salesman'),
    text('route', 'Route'),
    text('sale_type', 'Type'),
    money('subtotal_paisa', 'Sub Total'),
    money('discount_paisa', 'Discount'),
    money('tax_paisa', 'Tax'),
    money('total_paisa', 'Bill Total'),
    money('paid_paisa', 'Received'),
    money('balance_paisa', 'Balance'),
    money('gross_profit_paisa', 'Gross Profit'),
    text('status', 'Status'),
  ], rows);
});

def('sales_summary_product', 'Item wise Sales & Profit', ['from', 'to'], (p) => {
  const rows = db().all(
    `SELECT p.name AS product, p.sku, p.carton_size,
            SUM(CASE WHEN sl.is_free=0 THEN sl.qty ELSE 0 END) AS qty,
            SUM(CASE WHEN sl.is_free=1 THEN sl.qty ELSE 0 END) AS free_qty,
            SUM(sl.line_total_paisa) AS sales_paisa,
            SUM(sl.qty*sl.cost_paisa) AS cost_paisa,
            SUM(sl.line_total_paisa - sl.qty*sl.cost_paisa) AS profit_paisa
       FROM sales_lines sl JOIN sales_invoices si ON si.id=sl.invoice_id JOIN products p ON p.id=sl.product_id
      WHERE si.status<>'VOID' AND si.date BETWEEN ? AND ?
      GROUP BY p.id ORDER BY sales_paisa DESC`,
    p.from,
    p.to
  );
  return R('sales_summary_product', 'Item wise Sales & Profit', ['from', 'to'], [
    text('product', 'Item'),
    text('sku', 'SKU'),
    qty('qty', 'Qty Sold (pcs)'),
    qty('free_qty', 'Free Qty'),
    money('sales_paisa', 'Net Sales'),
    money('cost_paisa', 'Cost'),
    money('profit_paisa', 'Gross Profit'),
  ], rows);
});

def('sales_summary_customer', 'Customer wise Sales', ['from', 'to'], (p) => {
  const rows = db().all(
    `SELECT c.name AS customer, c.area, COUNT(si.id) AS bills, SUM(si.total_paisa) AS sales_paisa,
            SUM(si.total_paisa - si.paid_paisa) AS due_paisa, SUM(si.gross_profit_paisa) AS profit_paisa
       FROM sales_invoices si JOIN customers c ON c.id=si.customer_id
      WHERE si.status<>'VOID' AND si.date BETWEEN ? AND ?
      GROUP BY c.id ORDER BY sales_paisa DESC`,
    p.from,
    p.to
  );
  return R('sales_summary_customer', 'Customer wise Sales', ['from', 'to'], [
    text('customer', 'Customer'),
    text('area', 'Area'),
    qty('bills', 'Bills'),
    money('sales_paisa', 'Sales'),
    money('due_paisa', 'Outstanding'),
    money('profit_paisa', 'Gross Profit'),
  ], rows);
});

def('sales_by_route', 'Route / Beat wise Sales', ['from', 'to'], (p) => {
  const rows = db().all(
    `SELECT IFNULL(r.name,'No Route') AS route, COUNT(si.id) AS bills, COUNT(DISTINCT si.customer_id) AS shops,
            SUM(si.total_paisa) AS sales_paisa, SUM(si.total_paisa - si.paid_paisa) AS due_paisa
       FROM sales_invoices si LEFT JOIN routes r ON r.id=si.route_id
      WHERE si.status<>'VOID' AND si.date BETWEEN ? AND ? GROUP BY r.id ORDER BY sales_paisa DESC`,
    p.from,
    p.to
  );
  return R('sales_by_route', 'Route wise Sales', ['from', 'to'], [
    text('route', 'Route'),
    qty('shops', 'Shops'),
    qty('bills', 'Bills'),
    money('sales_paisa', 'Sales'),
    money('due_paisa', 'Outstanding'),
  ], rows);
});

def('salesman_performance', 'Salesman Performance', ['from', 'to'], (p) => {
  const rows = db().all(
    `SELECT s.name AS salesman, s.phone,
            (SELECT COUNT(*) FROM sales_invoices si WHERE si.salesman_id=s.id AND si.date BETWEEN ? AND ? AND si.status<>'VOID') AS bills,
            (SELECT COALESCE(SUM(si.total_paisa),0) FROM sales_invoices si WHERE si.salesman_id=s.id AND si.date BETWEEN ? AND ? AND si.status<>'VOID') AS sales_paisa,
            (SELECT COALESCE(SUM(r.amount_paisa),0) FROM receipts r WHERE r.salesman_id=s.id AND r.date BETWEEN ? AND ? AND r.status='POSTED') AS recovery_paisa,
            (SELECT COUNT(DISTINCT si.customer_id) FROM sales_invoices si WHERE si.salesman_id=s.id AND si.date BETWEEN ? AND ?) AS shops,
            (SELECT COUNT(*) FROM visits v WHERE v.salesman_id=s.id AND date(v.at) BETWEEN ? AND ?) AS market_visits
       FROM salesmen s WHERE s.active=1 ORDER BY sales_paisa DESC`,
    p.from, p.to, p.from, p.to, p.from, p.to, p.from, p.to, p.from, p.to
  );
  return R('salesman_performance', 'Salesman Performance (Sales vs Recovery)', ['from', 'to'], [
    text('salesman', 'Salesman'),
    text('phone', 'Phone'),
    qty('shops', 'Shops Covered'),
    qty('bills', 'Bills'),
    qty('market_visits', 'Market Visits'),
    money('sales_paisa', 'Sales'),
    money('recovery_paisa', 'Cash Recovered'),
  ], rows);
});

def('daily_sales_summary', 'Daily Sales Summary', ['from', 'to'], (p) => {
  const rows = db().all(
    `SELECT si.date,
            COUNT(*) AS bills,
            SUM(CASE WHEN si.sale_type='CASH' THEN si.total_paisa ELSE 0 END) AS cash_sales_paisa,
            SUM(CASE WHEN si.sale_type='CREDIT' THEN si.total_paisa ELSE 0 END) AS credit_sales_paisa,
            SUM(si.total_paisa) AS total_paisa,
            SUM(si.gross_profit_paisa) AS profit_paisa,
            (SELECT COALESCE(SUM(e.amount_paisa),0) FROM expenses e WHERE e.date=si.date) AS expenses_paisa,
            (SELECT COALESCE(SUM(r.amount_paisa),0) FROM receipts r WHERE r.date=si.date AND r.status='POSTED') AS recovery_paisa
       FROM sales_invoices si WHERE si.status<>'VOID' AND si.date BETWEEN ? AND ?
      GROUP BY si.date ORDER BY si.date`,
    p.from,
    p.to
  );
  return R('daily_sales_summary', 'Daily Sales Summary (Rozana Hisaab)', ['from', 'to'], [
    date('date', 'Date'),
    qty('bills', 'Bills'),
    money('cash_sales_paisa', 'Cash Sale'),
    money('credit_sales_paisa', 'Udhaar Sale'),
    money('total_paisa', 'Total Sale'),
    money('recovery_paisa', 'Recovery'),
    money('profit_paisa', 'Gross Profit'),
    money('expenses_paisa', 'Expenses'),
  ], rows);
});

def('profit_report', 'Profit & Loss (Munafa Report)', ['from', 'to'], (p) => {
  const d = db();
  const sales = d.get(
    `SELECT COALESCE(SUM(total_paisa),0) AS total, COALESCE(SUM(subtotal_paisa),0) AS subtotal,
            COALESCE(SUM(discount_paisa),0) AS discount, COALESCE(SUM(scheme_discount_paisa),0) AS scheme,
            COALESCE(SUM(tax_paisa),0) AS tax, COALESCE(SUM(cost_total_paisa),0) AS cost,
            COALESCE(SUM(gross_profit_paisa),0) AS gp
       FROM sales_invoices WHERE status<>'VOID' AND date BETWEEN ? AND ?`,
    p.from,
    p.to
  );
  const returns = d.get('SELECT COALESCE(SUM(total_paisa),0) AS total FROM sales_returns WHERE date BETWEEN ? AND ?', p.from, p.to);
  const expRows = d.all(
    `SELECT IFNULL(h.name,'Other') AS head, COALESCE(SUM(e.amount_paisa),0) AS amount
       FROM expenses e LEFT JOIN expense_heads h ON h.id=e.head_id
      WHERE e.date BETWEEN ? AND ? GROUP BY e.head_id ORDER BY amount DESC`,
    p.from,
    p.to
  );
  const expTotal = expRows.reduce((s, r) => s + U.int(r.amount), 0);
  const shortQtyLoss = U.int(
    d.val(
      `SELECT COALESCE(SUM(debit_paisa),0) FROM ledger_entries WHERE party_type='STOCK_LOSS' AND date BETWEEN ? AND ?`,
      p.from,
      p.to
    )
  );
  const rows = [];
  rows.push({ head: 'Gross Sales (Total Bills)', amount_paisa: U.int(sales.subtotal) });
  rows.push({ head: 'Less: Discount', amount_paisa: -U.int(sales.discount) });
  rows.push({ head: 'Less: Scheme / Free Goods Value', amount_paisa: -U.int(sales.scheme) });
  rows.push({ head: 'Net Sales', amount_paisa: U.int(sales.total) - U.int(sales.tax) });
  rows.push({ head: 'Less: Cost of Goods Sold (COGS)', amount_paisa: -U.int(sales.cost) });
  rows.push({ head: 'GROSS PROFIT', amount_paisa: U.int(sales.gp) });
  rows.push({ head: 'Sales Returns (Wapsi)', amount_paisa: -U.int(returns.total) });
  rows.push({ head: 'Stock Shortage / Leakage / Damage', amount_paisa: -shortQtyLoss });
  for (const e of expRows) rows.push({ head: 'Expense: ' + e.head, amount_paisa: -U.int(e.amount) });
  const net = U.int(sales.gp) - U.int(returns.total) - shortQtyLoss - expTotal;
  rows.push({ head: 'NET PROFIT (Saaf Munafa)', amount_paisa: net });
  const report = R('profit_report', 'Profit & Loss', ['from', 'to'], [text('head', 'Description'), money('amount_paisa', 'Amount')], rows);
  report.net_profit_paisa = net;
  report.expenses_total_paisa = expTotal;
  return report;
});

/* ------------------------------------------------------------------ purchases */
def('purchase_register', 'Purchase Register', ['from', 'to', 'supplier_id'], (p) => {
  const where = ['pu.date BETWEEN ? AND ?'];
  const args = [p.from, p.to];
  if (p.supplier_id) {
    where.push('pu.supplier_id=?');
    args.push(U.int(p.supplier_id));
  }
  const rows = db().all(
    `SELECT pu.invoice_no, pu.date, s.name AS supplier, w.name AS warehouse, pu.subtotal_paisa, pu.freight_paisa,
            pu.total_paisa, pu.paid_paisa, (pu.total_paisa-pu.paid_paisa) AS balance_paisa, pu.status
       FROM purchases pu LEFT JOIN suppliers s ON s.id=pu.supplier_id LEFT JOIN warehouses w ON w.id=pu.warehouse_id
      WHERE ${where.join(' AND ')} ORDER BY pu.date, pu.id`,
    ...args
  );
  return R('purchase_register', 'Purchase Register', ['from', 'to', 'supplier_id'], [
    text('invoice_no', 'Bill No'),
    date('date', 'Date'),
    text('supplier', 'Supplier'),
    text('warehouse', 'Godown'),
    money('subtotal_paisa', 'Sub Total'),
    money('freight_paisa', 'Freight'),
    money('total_paisa', 'Total'),
    money('paid_paisa', 'Paid'),
    money('balance_paisa', 'Balance'),
  ], rows);
});

def('purchase_summary_supplier', 'Supplier wise Purchases', ['from', 'to'], (p) => {
  const rows = db().all(
    `SELECT s.name AS supplier, COUNT(pu.id) AS bills, COALESCE(SUM(pu.total_paisa),0) AS purchase_paisa,
            COALESCE(SUM(pu.total_paisa-pu.paid_paisa),0) AS payable_paisa, s.balance_paisa AS current_payable_paisa
       FROM purchases pu JOIN suppliers s ON s.id=pu.supplier_id
      WHERE pu.date BETWEEN ? AND ? GROUP BY s.id ORDER BY purchase_paisa DESC`,
    p.from,
    p.to
  );
  return R('purchase_summary_supplier', 'Supplier wise Purchases', ['from', 'to'], [
    text('supplier', 'Supplier'),
    qty('bills', 'Bills'),
    money('purchase_paisa', 'Purchases'),
    money('payable_paisa', 'Period Balance'),
    money('current_payable_paisa', 'Total Payable (Aaj)'),
  ], rows);
});

/* ------------------------------------------------------------------ stock */
def('stock_summary', 'Stock Summary (Godown wise)', ['warehouse_id', 'q'], (p) => {
  const args = [];
  const where = ['p.active=1'];
  if (p.warehouse_id) where.push('b.warehouse_id=' + U.int(p.warehouse_id));
  if (p.q) {
    where.push('(p.name LIKE ? OR p.sku LIKE ?)');
    args.push('%' + p.q + '%', '%' + p.q + '%');
  }
  const rows = db().all(
    `SELECT p.name AS product, p.sku, p.carton_size, w.name AS warehouse,
            COALESCE(SUM(b.qty_remaining),0) AS qty,
            COALESCE(SUM(b.qty_remaining*b.cost_paisa),0) AS value_paisa,
            COALESCE(SUM(b.qty_remaining*p.retail_paisa),0) AS retail_value_paisa,
            p.reorder_level
       FROM batches b JOIN products p ON p.id=b.product_id JOIN warehouses w ON w.id=b.warehouse_id
      WHERE ${where.join(' AND ')}
      GROUP BY p.id, b.warehouse_id HAVING qty <> 0 ORDER BY w.id, p.name`,
    ...args
  );
  return R('stock_summary', 'Stock Summary', ['warehouse_id', 'q'], [
    text('product', 'Item'),
    text('sku', 'SKU'),
    text('warehouse', 'Godown'),
    qty('qty', 'Qty (pcs)'),
    qty('reorder_level', 'Reorder Lvl'),
    money('value_paisa', 'Stock Value (Cost)'),
    money('retail_value_paisa', 'Value (Retail)'),
  ], rows);
});

def('stock_ledger', 'Stock Ledger (Item Movement)', ['from', 'to', 'product_id'], (p) => {
  const where = ['date(sm.at) BETWEEN ? AND ?'];
  const args = [p.from, p.to];
  if (p.product_id) {
    where.push('sm.product_id=?');
    args.push(U.int(p.product_id));
  }
  const rows = db().all(
    `SELECT sm.at, p.name AS product, w.name AS warehouse, sm.qty, sm.type, sm.ref_type, sm.ref_id,
            sm.unit_cost_paisa, sm.balance_after, IFNULL(sm.note,'') AS note
       FROM stock_moves sm JOIN products p ON p.id=sm.product_id JOIN warehouses w ON w.id=sm.warehouse_id
      WHERE ${where.join(' AND ')} ORDER BY sm.id DESC LIMIT 2000`,
    ...args
  );
  return R('stock_ledger', 'Stock Ledger', ['from', 'to', 'product_id'], [
    text('at', 'Time'),
    text('product', 'Item'),
    text('warehouse', 'Godown'),
    qty('qty', 'In/Out'),
    text('type', 'Type'),
    text('ref_type', 'Ref'),
    money('unit_cost_paisa', 'Unit Cost'),
    qty('balance_after', 'Balance'),
    text('note', 'Note'),
  ], rows);
});

def('batch_expiry', 'Batch & Expiry Report (FEFO / Push Sale)', ['days'], (p) => {
  const days = U.int(p.days) || 90;
  const rows = db().all(
    `SELECT p.name AS product, b.batch_no, b.expiry_date, w.name AS warehouse, b.qty_remaining,
            b.cost_paisa, (b.qty_remaining*b.cost_paisa) AS value_paisa,
            CAST(julianday(b.expiry_date) - julianday('now') AS INTEGER) AS days_left,
            CASE WHEN julianday(b.expiry_date) - julianday('now') < 0 THEN 'EXPIRED'
                 WHEN julianday(b.expiry_date) - julianday('now') <= 30 THEN 'URGENT (0-30 din)'
                 WHEN julianday(b.expiry_date) - julianday('now') <= 60 THEN 'SOON (31-60 din)'
                 ELSE 'OK (61-90 din)' END AS urgency
       FROM batches b JOIN products p ON p.id=b.product_id JOIN warehouses w ON w.id=b.warehouse_id
      WHERE b.qty_remaining > 0 AND b.expiry_date IS NOT NULL AND b.expiry_date <> ''
        AND julianday(b.expiry_date) - julianday('now') <= ?
      ORDER BY b.expiry_date ASC`,
    days
  );
  const report = R('batch_expiry', 'Batch & Expiry (Push Sale List)', ['days'], [
    text('product', 'Item'),
    text('batch_no', 'Batch'),
    date('expiry_date', 'Expiry'),
    text('warehouse', 'Godown'),
    qty('days_left', 'Days Left'),
    text('urgency', 'Urgency'),
    qty('qty_remaining', 'Qty'),
    money('cost_paisa', 'Unit Cost'),
    money('value_paisa', 'Value at Risk'),
  ], rows);
  report.at_risk_paisa = tot(rows, 'value_paisa');
  return report;
});

def('low_stock_reorder', 'Low Stock / Reorder List', [], () => {
  const rows = db().all(
    `SELECT * FROM (
        SELECT p.name AS product, p.sku, p.carton_size, p.reorder_level,
               (SELECT COALESCE(SUM(b.qty_remaining),0) FROM batches b WHERE b.product_id=p.id) AS stock,
               p.cost_paisa, p.wholesale_paisa,
               (SELECT IFNULL(s.name,'') FROM purchase_lines pl JOIN purchases pu ON pu.id=pl.purchase_id
                  JOIN suppliers s ON s.id=pu.supplier_id WHERE pl.product_id=p.id ORDER BY pu.id DESC LIMIT 1) AS last_supplier
          FROM products p WHERE p.active=1 AND p.reorder_level>0)
      WHERE stock <= reorder_level ORDER BY stock ASC`
  );
  return R('low_stock_reorder', 'Low Stock / Reorder', [], [
    text('product', 'Item'),
    text('sku', 'SKU'),
    qty('stock', 'Stock (pcs)'),
    qty('reorder_level', 'Reorder Level'),
    qty('carton_size', 'Carton Size'),
    text('last_supplier', 'Last Supplier'),
    money('cost_paisa', 'Cost'),
  ], rows);
});

def('item_movement', 'Fast / Slow / Dead Items', ['from', 'to'], (p) => {
  const rows = db().all(
    `SELECT p.name AS product,
            (SELECT COALESCE(SUM(sl.qty),0) FROM sales_lines sl JOIN sales_invoices si ON si.id=sl.invoice_id
              WHERE sl.product_id=p.id AND si.date BETWEEN ? AND ? AND si.status<>'VOID') AS sold_qty,
            (SELECT COALESCE(SUM(b.qty_remaining),0) FROM batches b WHERE b.product_id=p.id) AS stock_qty,
            (SELECT MAX(si.date) FROM sales_lines sl JOIN sales_invoices si ON si.id=sl.invoice_id WHERE sl.product_id=p.id) AS last_sold,
            CASE WHEN (SELECT COALESCE(SUM(sl.qty),0) FROM sales_lines sl JOIN sales_invoices si ON si.id=sl.invoice_id
                        WHERE sl.product_id=p.id AND si.date BETWEEN ? AND ? AND si.status<>'VOID') = 0
                 THEN 'DEAD / Band' ELSE 'MOVING' END AS status
       FROM products p WHERE p.active=1 ORDER BY sold_qty DESC`,
    p.from, p.to, p.from, p.to
  );
  return R('item_movement', 'Item Movement (Fast/Slow/Dead)', ['from', 'to'], [
    text('product', 'Item'),
    qty('sold_qty', 'Sold in Period'),
    qty('stock_qty', 'Current Stock'),
    date('last_sold', 'Last Sold'),
    text('status', 'Status'),
  ], rows);
});

def('inventory_valuation', 'Inventory Valuation', ['warehouse_id'], (p) => {
  const where = ['b.qty_remaining > 0'];
  if (p.warehouse_id) where.push('b.warehouse_id=' + U.int(p.warehouse_id));
  const rows = db().all(
    `SELECT w.name AS warehouse, p.name AS product, p.carton_size, SUM(b.qty_remaining) AS qty,
            COALESCE(SUM(b.qty_remaining*b.cost_paisa),0) AS cost_value_paisa,
            COALESCE(SUM(b.qty_remaining*p.wholesale_paisa),0) AS wholesale_value_paisa,
            COALESCE(SUM(b.qty_remaining*p.retail_paisa),0) AS retail_value_paisa
       FROM batches b JOIN products p ON p.id=b.product_id JOIN warehouses w ON w.id=b.warehouse_id
      WHERE ${where.join(' AND ')} GROUP BY w.id, p.id ORDER BY w.id, p.name`
  );
  const report = R('inventory_valuation', 'Inventory Valuation', ['warehouse_id'], [
    text('warehouse', 'Godown'),
    text('product', 'Item'),
    qty('qty', 'Qty (pcs)'),
    money('cost_value_paisa', 'Value at Cost'),
    money('wholesale_value_paisa', 'Value at Wholesale'),
    money('retail_value_paisa', 'Value at Retail'),
  ], rows);
  report.margin_potential_paisa = tot(rows, 'retail_value_paisa') - tot(rows, 'cost_value_paisa');
  return report;
});

/* ------------------------------------------------------------------ money */
def('receivables_aging', 'Receivables Aging (30/60/90)', ['as_on'], (p) => {
  const asOn = p.as_on || U.today();
  const rows = db().all(
    `SELECT c.name AS customer, c.phone, c.area, c.credit_limit_paisa, c.balance_paisa AS total_due_paisa,
        COALESCE(SUM(CASE WHEN CAST(julianday(?)-julianday(si.date) AS INTEGER) < 30 THEN si.total_paisa-si.paid_paisa ELSE 0 END),0) AS d0_30,
        COALESCE(SUM(CASE WHEN CAST(julianday(?)-julianday(si.date) AS INTEGER) BETWEEN 30 AND 59 THEN si.total_paisa-si.paid_paisa ELSE 0 END),0) AS d31_60,
        COALESCE(SUM(CASE WHEN CAST(julianday(?)-julianday(si.date) AS INTEGER) BETWEEN 60 AND 89 THEN si.total_paisa-si.paid_paisa ELSE 0 END),0) AS d61_90,
        COALESCE(SUM(CASE WHEN CAST(julianday(?)-julianday(si.date) AS INTEGER) >= 90 THEN si.total_paisa-si.paid_paisa ELSE 0 END),0) AS d90_plus
       FROM customers c LEFT JOIN sales_invoices si ON si.customer_id=c.id AND si.status IN ('UNPAID','PARTIAL') AND si.total_paisa>si.paid_paisa
      GROUP BY c.id HAVING total_due_paisa <> 0 ORDER BY total_due_paisa DESC`,
    asOn, asOn, asOn, asOn
  );
  const report = R('receivables_aging', 'Receivables Aging Report', ['as_on'], [
    text('customer', 'Customer'),
    text('phone', 'Phone'),
    text('area', 'Area'),
    money('credit_limit_paisa', 'Credit Limit'),
    money('d0_30', '0-30 Din'),
    money('d31_60', '31-60 Din'),
    money('d61_90', '61-90 Din'),
    money('d90_plus', '90+ Din'),
    money('total_due_paisa', 'Total Udhaar'),
  ], rows);
  report.total_due_paisa = tot(rows, 'total_due_paisa');
  report.over_60_paisa = tot(rows, 'd61_90') + tot(rows, 'd90_plus');
  return report;
});

def('payable_aging', 'Payables (Supplier Baqaya)', ['as_on'], (p) => {
  const asOn = p.as_on || U.today();
  const rows = db().all(
    `SELECT s.name AS supplier, s.phone, s.balance_paisa AS total_payable_paisa,
            COALESCE(SUM(CASE WHEN CAST(julianday(?)-julianday(pu.date) AS INTEGER) < 30 THEN pu.total_paisa-pu.paid_paisa ELSE 0 END),0) AS d0_30,
            COALESCE(SUM(CASE WHEN CAST(julianday(?)-julianday(pu.date) AS INTEGER) >= 30 THEN pu.total_paisa-pu.paid_paisa ELSE 0 END),0) AS d30_plus
       FROM suppliers s LEFT JOIN purchases pu ON pu.supplier_id=s.id AND pu.total_paisa>pu.paid_paisa
      GROUP BY s.id HAVING total_payable_paisa<>0 ORDER BY total_payable_paisa DESC`,
    asOn, asOn
  );
  return R('payable_aging', 'Supplier Payables', ['as_on'], [
    text('supplier', 'Supplier'),
    text('phone', 'Phone'),
    money('d0_30', '0-30 Din'),
    money('d30_plus', '30+ Din'),
    money('total_payable_paisa', 'Total Baqaya'),
  ], rows);
});

def('customer_statement', 'Customer Statement (Khata)', ['from', 'to', 'customer_id'], (p) => {
  const c = db().get('SELECT * FROM customers WHERE id=?', U.int(p.customer_id));
  if (!c) return R('customer_statement', 'Customer Statement', ['from', 'to', 'customer_id'], [], []);
  const opening = U.int(c.opening_balance_paisa) +
    (U.int(
      db().val(
        "SELECT COALESCE(SUM(debit_paisa),0)-COALESCE(SUM(credit_paisa),0) FROM ledger_entries WHERE party_type='CUSTOMER' AND party_id=? AND date < ?",
        c.id,
        p.from
      )
    ));
  const rows = db().all(
    `SELECT date, at, ref_type, ref_id, debit_paisa, credit_paisa, IFNULL(note,'') AS note
       FROM ledger_entries WHERE party_type='CUSTOMER' AND party_id=? AND date BETWEEN ? AND ?
      ORDER BY date, id`,
    c.id,
    p.from,
    p.to
  );
  let bal = opening;
  const out = rows.map((r) => {
    bal += U.int(r.debit_paisa) - U.int(r.credit_paisa);
    return {
      date: r.date,
      particular: (r.ref_type || '') + (r.note ? ' — ' + r.note : ''),
      debit_paisa: U.int(r.debit_paisa),
      credit_paisa: U.int(r.credit_paisa),
      balance_paisa: bal,
    };
  });
  const report = R('customer_statement', `Khata: ${c.name}`, ['from', 'to', 'customer_id'], [
    date('date', 'Date'),
    text('particular', 'Particulars'),
    money('debit_paisa', 'Debit (Bill)'),
    money('credit_paisa', 'Credit (Jama)'),
    money('balance_paisa', 'Balance'),
  ], out);
  report.opening_paisa = opening;
  report.closing_paisa = bal;
  report.party = { name: c.name, phone: c.phone, address: c.address, area: c.area };
  return report;
});

def('supplier_statement', 'Supplier Statement', ['from', 'to', 'supplier_id'], (p) => {
  const s = db().get('SELECT * FROM suppliers WHERE id=?', U.int(p.supplier_id));
  if (!s) return R('supplier_statement', 'Supplier Statement', ['from', 'to', 'supplier_id'], [], []);
  const opening = U.int(s.opening_balance_paisa) +
    U.int(
      db().val(
        "SELECT COALESCE(SUM(credit_paisa),0)-COALESCE(SUM(debit_paisa),0) FROM ledger_entries WHERE party_type='SUPPLIER' AND party_id=? AND date < ?",
        s.id,
        p.from
      )
    );
  const rows = db().all(
    `SELECT date, ref_type, ref_id, debit_paisa, credit_paisa, IFNULL(note,'') AS note
       FROM ledger_entries WHERE party_type='SUPPLIER' AND party_id=? AND date BETWEEN ? AND ? ORDER BY date, id`,
    s.id,
    p.from,
    p.to
  );
  let bal = opening;
  const out = rows.map((r) => {
    bal += U.int(r.credit_paisa) - U.int(r.debit_paisa);
    return { date: r.date, particular: (r.ref_type || '') + (r.note ? ' — ' + r.note : ''), debit_paisa: U.int(r.debit_paisa), credit_paisa: U.int(r.credit_paisa), balance_paisa: bal };
  });
  const report = R('supplier_statement', `Supplier Khata: ${s.name}`, ['from', 'to', 'supplier_id'], [
    date('date', 'Date'),
    text('particular', 'Particulars'),
    money('credit_paisa', 'Credit (Purchase)'),
    money('debit_paisa', 'Debit (Paid)'),
    money('balance_paisa', 'Payable'),
  ], out);
  report.opening_paisa = opening;
  report.closing_paisa = bal;
  return report;
});

def('day_book', 'Day Book (Rozana Cash/Bank)', ['date'], (p) => {
  const rows = db().all(
    `SELECT id, date, party_type, party_id, ref_type, ref_id, debit_paisa, credit_paisa, IFNULL(note,'') AS note
       FROM ledger_entries WHERE date=? ORDER BY id`,
    p.date
  );
  return R('day_book', 'Day Book', ['date'], [
    date('date', 'Date'),
    text('ref_type', 'Voucher'),
    text('party_type', 'Account'),
    money('debit_paisa', 'Debit'),
    money('credit_paisa', 'Credit'),
    text('note', 'Detail'),
  ], rows);
});

def('account_balances', 'Account Balances (Trial Balance)', ['from', 'to'], (p) => {
  const rows = db().all(
    `SELECT party_type AS account, COALESCE(SUM(debit_paisa),0) AS debit_paisa, COALESCE(SUM(credit_paisa),0) AS credit_paisa,
            COALESCE(SUM(debit_paisa),0)-COALESCE(SUM(credit_paisa),0) AS balance_paisa
       FROM ledger_entries WHERE date BETWEEN ? AND ? GROUP BY party_type ORDER BY party_type`,
    p.from,
    p.to
  );
  const report = R('account_balances', 'Account Balances / Trial Balance', ['from', 'to'], [
    text('account', 'Account'),
    money('debit_paisa', 'Total Debit'),
    money('credit_paisa', 'Total Credit'),
    money('balance_paisa', 'Net Balance'),
  ], rows);
  report.gl = SVC.glCheck();
  return report;
});

def('cash_book', 'Cash Book', ['from', 'to'], (p) => {
  const opening = SVC.balanceBefore('CASH', p.from);
  const rows = db().all(
    `SELECT date, ref_type, ref_id, debit_paisa, credit_paisa, IFNULL(note,'') AS note
       FROM ledger_entries WHERE party_type='CASH' AND date BETWEEN ? AND ? ORDER BY date, id`,
    p.from,
    p.to
  );
  let bal = opening;
  const out = rows.map((r) => {
    bal += U.int(r.debit_paisa) - U.int(r.credit_paisa);
    return { date: r.date, particular: (r.ref_type || '') + (r.note ? ' — ' + r.note : ''), in_paisa: U.int(r.debit_paisa), out_paisa: U.int(r.credit_paisa), balance_paisa: bal };
  });
  const report = R('cash_book', 'Cash Book', ['from', 'to'], [
    date('date', 'Date'),
    text('particular', 'Particulars'),
    money('in_paisa', 'Cash In'),
    money('out_paisa', 'Cash Out'),
    money('balance_paisa', 'Balance'),
  ], out);
  report.opening_paisa = opening;
  report.closing_paisa = bal;
  return report;
});

def('expense_report', 'Expense Report', ['from', 'to'], (p) => {
  const rows = db().all(
    `SELECT e.date, IFNULL(h.name,'Other') AS head, e.amount_paisa, e.method, e.payee, IFNULL(e.note,'') AS note,
            IFNULL(s.name,'') AS salesman
       FROM expenses e LEFT JOIN expense_heads h ON h.id=e.head_id LEFT JOIN salesmen s ON s.id=e.salesman_id
      WHERE e.date BETWEEN ? AND ? ORDER BY e.date, e.id`,
    p.from,
    p.to
  );
  const report = R('expense_report', 'Expense Report', ['from', 'to'], [
    date('date', 'Date'),
    text('head', 'Expense Head'),
    text('payee', 'Payee'),
    text('salesman', 'Salesman'),
    text('method', 'Method'),
    money('amount_paisa', 'Amount'),
    text('note', 'Note'),
  ], rows);
  report.by_head = db().all(
    `SELECT IFNULL(h.name,'Other') AS head, COALESCE(SUM(e.amount_paisa),0) AS amount_paisa FROM expenses e
       LEFT JOIN expense_heads h ON h.id=e.head_id WHERE e.date BETWEEN ? AND ? GROUP BY e.head_id ORDER BY amount_paisa DESC`,
    p.from,
    p.to
  );
  return report;
});

def('cheque_register', 'Cheque Register (PDC)', ['from', 'to', 'status'], (p) => {
  const where = ['r.method=\'CHEQUE\'', 'r.date BETWEEN ? AND ?'];
  const args = [p.from, p.to];
  if (p.status) {
    where.push('r.cheque_status=?');
    args.push(String(p.status).toUpperCase());
  }
  const rows = db().all(
    `SELECT r.receipt_no, r.date, c.name AS customer, r.bank_name, r.cheque_no, r.cheque_date,
            CAST(julianday(r.cheque_date)-julianday('now') AS INTEGER) AS days_to_clear,
            r.amount_paisa, r.cheque_status, IFNULL(r.notes,'') AS note
       FROM receipts r LEFT JOIN customers c ON c.id=r.customer_id
      WHERE ${where.join(' AND ')} ORDER BY r.cheque_date`,
    ...args
  );
  const report = R('cheque_register', 'Cheque Register', ['from', 'to', 'status'], [
    text('receipt_no', 'Receipt'),
    date('date', 'Entry Date'),
    text('customer', 'Customer'),
    text('bank_name', 'Bank'),
    text('cheque_no', 'Cheque No'),
    date('cheque_date', 'Cheque Date'),
    qty('days_to_clear', 'Din Baqi'),
    money('amount_paisa', 'Amount'),
    text('cheque_status', 'Status'),
  ], rows);
  report.pending_paisa = rows.filter((r) => ['RECEIVED', 'IN_CLEARING'].includes(r.cheque_status)).reduce((s, r) => s + U.int(r.amount_paisa), 0);
  return report;
});

def('van_settlement', 'Van Loading & Settlement', ['from', 'to'], (p) => {
  const rows = db().all(
    `SELECT v.load_no, v.date, v.vehicle_no, s.name AS salesman, r.name AS route, v.status,
            v.loaded_qty, v.sold_qty, v.returned_qty, v.short_qty,
            v.loaded_value_paisa, v.shortage_value_paisa, v.settled_at
       FROM van_loads v LEFT JOIN salesmen s ON s.id=v.salesman_id LEFT JOIN routes r ON r.id=v.route_id
      WHERE v.date BETWEEN ? AND ? ORDER BY v.date DESC`,
    p.from,
    p.to
  );
  const report = R('van_settlement', 'Van Loading & Settlement', ['from', 'to'], [
    text('load_no', 'Load No'),
    date('date', 'Date'),
    text('vehicle_no', 'Vehicle'),
    text('salesman', 'Salesman'),
    text('route', 'Route'),
    qty('loaded_qty', 'Loaded'),
    qty('sold_qty', 'Sold'),
    qty('returned_qty', 'Returned'),
    qty('short_qty', 'Short'),
    money('loaded_value_paisa', 'Load Value'),
    money('shortage_value_paisa', 'Shortage Value'),
    text('status', 'Status'),
  ], rows);
  report.shortage_total_paisa = tot(rows, 'shortage_value_paisa');
  return report;
});

def('sale_returns_report', 'Sales Returns Report', ['from', 'to'], (p) => {
  const rows = db().all(
    `SELECT sr.return_no, sr.date, c.name AS customer, sr.kind, sr.total_paisa, IFNULL(sr.reason,'') AS reason,
            (SELECT GROUP_CONCAT(pr.name || ' x' || srl.qty, ', ') FROM sales_return_lines srl
               JOIN products pr ON pr.id=srl.product_id WHERE srl.return_id=sr.id) AS items
       FROM sales_returns sr LEFT JOIN customers c ON c.id=sr.customer_id
      WHERE sr.date BETWEEN ? AND ? ORDER BY sr.date DESC`,
    p.from,
    p.to
  );
  return R('sale_returns_report', 'Sales Returns (Wapsi)', ['from', 'to'], [
    text('return_no', 'Return No'),
    date('date', 'Date'),
    text('customer', 'Customer'),
    text('kind', 'Type'),
    text('items', 'Items'),
    money('total_paisa', 'Value'),
    text('reason', 'Reason'),
  ], rows);
});

def('purchase_returns_report', 'Purchase Returns Report', ['from', 'to'], (p) => {
  const rows = db().all(
    `SELECT pr.return_no, pr.date, s.name AS supplier, pr.total_paisa, IFNULL(pr.reason,'') AS reason
       FROM purchase_returns pr LEFT JOIN suppliers s ON s.id=pr.supplier_id
      WHERE pr.date BETWEEN ? AND ? ORDER BY pr.date DESC`,
    p.from,
    p.to
  );
  return R('purchase_returns_report', 'Purchase Returns', ['from', 'to'], [
    text('return_no', 'Return No'),
    date('date', 'Date'),
    text('supplier', 'Supplier'),
    money('total_paisa', 'Value'),
    text('reason', 'Reason'),
  ], rows);
});

def('scheme_claim_report', 'Trade Scheme & Claims Report', ['from', 'to'], (p) => {
  const rows = db().all(
    `SELECT cl.date, IFNULL(co.name,'—') AS company, IFNULL(sc.name,'—') AS scheme, p.name AS product,
            cl.qty_free, cl.value_paisa, cl.status, IFNULL(cl.note,'') AS note
       FROM claims cl LEFT JOIN companies co ON co.id=cl.company_id
       LEFT JOIN schemes sc ON sc.id=cl.scheme_id LEFT JOIN products p ON p.id=cl.product_id
      WHERE cl.date BETWEEN ? AND ? ORDER BY cl.date DESC`,
    p.from,
    p.to
  );
  const report = R('scheme_claim_report', 'Scheme Claims (Company se Wapsi)', ['from', 'to'], [
    date('date', 'Date'),
    text('company', 'Company'),
    text('scheme', 'Scheme'),
    text('product', 'Item'),
    qty('qty_free', 'Free Qty'),
    money('value_paisa', 'Claim Value'),
    text('status', 'Status'),
    text('note', 'Note'),
  ], rows);
  report.pending_paisa = rows.filter((r) => r.status !== 'SETTLED').reduce((s, r) => s + U.int(r.value_paisa), 0);
  return report;
});

def('commission_report', 'Salesman Commission (Recovery based)', ['from', 'to'], (p) => {
  const rows = db().all(
    `SELECT s.name AS salesman, cm.period_from, cm.period_to, cm.base_paisa, cm.pct, cm.amount_paisa, cm.status,
            (SELECT COALESCE(SUM(si.total_paisa),0) FROM sales_invoices si WHERE si.salesman_id=s.id AND si.date BETWEEN ? AND ? AND si.status<>'VOID') AS sales_paisa
       FROM commissions cm JOIN salesmen s ON s.id=cm.salesman_id
      WHERE cm.period_from>=? AND cm.period_to<=? ORDER BY cm.id DESC`,
    p.from, p.to, p.from, p.to
  );
  return R('commission_report', 'Commission Report', ['from', 'to'], [
    text('salesman', 'Salesman'),
    date('period_from', 'From'),
    date('period_to', 'To'),
    money('sales_paisa', 'Sales'),
    money('base_paisa', 'Recovery Base'),
    pctCol('pct', 'Rate %'),
    money('amount_paisa', 'Commission'),
    text('status', 'Status'),
  ], rows);
});

def('target_achievement', 'Target vs Achievement', ['period'], (p) => {
  const period = p.period || U.monthOf(U.today());
  const rows = db().all(
    `SELECT s.name AS salesman, t.target_sales_paisa, t.target_recovery_paisa,
            (SELECT COALESCE(SUM(si.total_paisa),0) FROM sales_invoices si WHERE si.salesman_id=s.id AND substr(si.date,1,7)=? AND si.status<>'VOID') AS achieved_sales_paisa,
            (SELECT COALESCE(SUM(r.amount_paisa),0) FROM receipts r WHERE r.salesman_id=s.id AND substr(r.date,1,7)=? AND r.status='POSTED') AS achieved_recovery_paisa
       FROM targets t JOIN salesmen s ON s.id=t.salesman_id WHERE t.period=? ORDER BY achieved_sales_paisa DESC`,
    period, period, period
  );
  const out = rows.map((r) => ({
    ...r,
    sales_pct: U.pct(U.int(r.achieved_sales_paisa), U.int(r.target_sales_paisa)),
    recovery_pct: U.pct(U.int(r.achieved_recovery_paisa), U.int(r.target_recovery_paisa)),
  }));
  return R('target_achievement', 'Target vs Achievement', ['period'], [
    text('salesman', 'Salesman'),
    money('target_sales_paisa', 'Target Sale'),
    money('achieved_sales_paisa', 'Achieved Sale'),
    pctCol('sales_pct', '%'),
    money('target_recovery_paisa', 'Target Recovery'),
    money('achieved_recovery_paisa', 'Recovery'),
    pctCol('recovery_pct', '%'),
  ], out);
});

def('market_visits', 'Market Visits (Salesman Tracking)', ['from', 'to'], (p) => {
  const rows = db().all(
    `SELECT v.at, c.name AS customer, IFNULL(s.name,'—') AS salesman, v.kind, v.distance_m, IFNULL(v.notes,'') AS notes
       FROM visits v LEFT JOIN customers c ON c.id=v.customer_id LEFT JOIN salesmen s ON s.id=v.salesman_id
      WHERE date(v.at) BETWEEN ? AND ? ORDER BY v.at DESC LIMIT 1000`,
    p.from,
    p.to
  );
  return R('market_visits', 'Market Visits', ['from', 'to'], [
    text('at', 'Time'),
    text('customer', 'Shop'),
    text('salesman', 'Salesman'),
    text('kind', 'Type'),
    qty('distance_m', 'Distance (m)'),
    text('notes', 'Note'),
  ], rows);
});

def('open_orders', 'Booked Orders (Pending Delivery)', [], () => {
  const rows = db().all(
    `SELECT o.order_no, o.date, c.name AS customer, IFNULL(s.name,'—') AS salesman, o.total_paisa, IFNULL(o.notes,'') AS notes
       FROM orders o LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN salesmen s ON s.id=o.salesman_id
      WHERE o.status='BOOKED' ORDER BY o.date`
  );
  return R('open_orders', 'Pending Orders', [], [
    text('order_no', 'Order No'),
    date('date', 'Date'),
    text('customer', 'Customer'),
    text('salesman', 'Salesman'),
    money('total_paisa', 'Value'),
    text('notes', 'Note'),
  ], rows);
});

const PARAM_LABELS = {
  from: 'From Date',
  to: 'To Date',
  as_on: 'As On Date',
  date: 'Date',
  period: 'Month (YYYY-MM)',
  days: 'Din (Days)',
  customer_id: 'Customer',
  supplier_id: 'Supplier',
  salesman_id: 'Salesman',
  warehouse_id: 'Godown',
  product_id: 'Item',
  status: 'Status',
  q: 'Search',
};

function list() {
  return Object.values(REPORTS).map((r) => ({ key: r.key, name: r.name, params: r.params, param_labels: r.params.map((p) => PARAM_LABELS[p] || p) }));
}

function run(key, params) {
  const r = REPORTS[key];
  if (!r) throw new Error('Report nahi mili: ' + key);
  const p = { from: U.monthStart(U.monthOf(U.today())), to: U.today(), as_on: U.today(), date: U.today(), period: U.monthOf(U.today()), days: 90, ...(params || {}) };
  const out = r.fn(p);
  out.params_values = p;
  return out;
}

module.exports = { list, run, REPORTS, PARAM_LABELS };
