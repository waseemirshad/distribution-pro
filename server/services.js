'use strict';
/**
 * Distribution Pro - core business services
 * Sales / Purchases / Stock (FEFO batches) / Van Sales / Receipts (FIFO) /
 * Cheques (PDC) / Returns / Schemes / Claims / Commissions / Expenses / Closing / GL
 */

const { db } = require('./db');
const U = require('./util');
const { getSettingsMap } = require('./settings');

/* ================================================================== settings */
function settings() {
  return getSettingsMap();
}
function S(key, def) {
  const map = settings();
  const v = map[key];
  return v === undefined || v === null || v === '' ? def : v;
}
function Sb(key, def = false) {
  const v = String(S(key, def ? '1' : '0')).toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(v);
}
function Sn(key, def = 0) {
  return U.num(S(key, def), def);
}

/* ================================================================== audit */
function audit(user, action, entity, entity_id, details) {
  try {
    db().insert('audit_log', {
      at: U.nowIso(),
      user_id: user ? user.id : null,
      username: user ? user.username : 'system',
      action,
      entity: entity || null,
      entity_id: entity_id || null,
      details: details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null,
    });
  } catch (e) {
    /* audit must never break a transaction */
  }
}

/* ================================================================== numbering */
function nextNumber(name, prefix, pad = 6) {
  return db().tx(() => {
    const row = db().get('SELECT value FROM seq WHERE name=?', name);
    const v = (row ? Number(row.value) : 0) + 1;
    if (row) db().run('UPDATE seq SET value=? WHERE name=?', v, name);
    else db().run('INSERT INTO seq (name,value) VALUES (?,?)', name, v);
    return `${prefix}-${U.pad(v, pad)}`;
  });
}
const num = {
  invoice: (p) => nextNumber('invoice', p || S('invoice_prefix', 'INV')),
  receipt: (p) => nextNumber('receipt', p || S('receipt_prefix', 'RCP')),
  purchase: (p) => nextNumber('purchase', p || S('purchase_prefix', 'PUR')),
  order: (p) => nextNumber('order', p || S('order_prefix', 'ORD')),
  van: (p) => nextNumber('van', p || S('van_prefix', 'VL')),
  transfer: (p) => nextNumber('transfer', p || S('transfer_prefix', 'STN')),
  salesReturn: (p) => nextNumber('sales_return', p || S('return_prefix', 'SR')),
  purchaseReturn: (p) => nextNumber('purchase_return', p || S('purchase_return_prefix', 'PR')),
  payment: (p) => nextNumber('payment', p || S('payment_prefix', 'PAY')),
};

/* ================================================================== ledger / GL */
function ledgerAdd({ date, ref_type, ref_id, note, user_id, entries }) {
  const d = db();
  if (!entries || !entries.length) return;
  const debit = entries.reduce((s, e) => s + U.int(e.debit_paisa), 0);
  const credit = entries.reduce((s, e) => s + U.int(e.credit_paisa), 0);
  if (debit !== credit) {
    throw new Error(
      `GL entry balanced nahi hai (${ref_type || 'entry'}): debit ${U.fmtMoney(debit)} vs credit ${U.fmtMoney(credit)}`
    );
  }
  const at = U.nowIso();
  const parties = new Set();
  for (const e of entries) {
    d.insert('ledger_entries', {
      at,
      date: date || U.today(),
      party_type: e.party_type,
      party_id: U.int(e.party_id),
      ref_type: ref_type || null,
      ref_id: ref_id || null,
      debit_paisa: U.int(e.debit_paisa),
      credit_paisa: U.int(e.credit_paisa),
      note: e.note || note || null,
      user_id: user_id || null,
    });
    parties.add(e.party_type + ':' + U.int(e.party_id));
  }
  for (const key of parties) {
    const [pt, pid] = key.split(':');
    refreshBalance(pt, U.int(pid));
  }
}

function customerBalance(id) {
  const c = db().get('SELECT opening_balance_paisa FROM customers WHERE id=?', U.int(id));
  const m = db().get(
    "SELECT COALESCE(SUM(debit_paisa),0) AS d, COALESCE(SUM(credit_paisa),0) AS c FROM ledger_entries WHERE party_type='CUSTOMER' AND party_id=?",
    U.int(id)
  );
  return U.int(c ? c.opening_balance_paisa : 0) + U.int(m.d) - U.int(m.c);
}
function supplierBalance(id) {
  const s = db().get('SELECT opening_balance_paisa FROM suppliers WHERE id=?', U.int(id));
  const m = db().get(
    "SELECT COALESCE(SUM(debit_paisa),0) AS d, COALESCE(SUM(credit_paisa),0) AS c FROM ledger_entries WHERE party_type='SUPPLIER' AND party_id=?",
    U.int(id)
  );
  return U.int(s ? s.opening_balance_paisa : 0) + U.int(m.c) - U.int(m.d);
}
/** asset/liability style accounts: CASH, BANK, CHEQUE, SALES, PURCHASE, EXPENSE ... */
function accountBalance(party_type, party_id = 0) {
  const m = db().get(
    'SELECT COALESCE(SUM(debit_paisa),0) AS d, COALESCE(SUM(credit_paisa),0) AS c FROM ledger_entries WHERE party_type=? AND party_id=?',
    party_type,
    U.int(party_id)
  );
  return U.int(m.d) - U.int(m.c);
}
function balanceBefore(party_type, date, party_id = 0) {
  const m = db().get(
    'SELECT COALESCE(SUM(debit_paisa),0) AS d, COALESCE(SUM(credit_paisa),0) AS c FROM ledger_entries WHERE party_type=? AND party_id=? AND date < ?',
    party_type,
    U.int(party_id),
    date
  );
  return U.int(m.d) - U.int(m.c);
}
function refreshBalance(party_type, party_id) {
  if (party_type === 'CUSTOMER' && party_id) {
    db().run('UPDATE customers SET balance_paisa=? WHERE id=?', customerBalance(party_id), party_id);
  } else if (party_type === 'SUPPLIER' && party_id) {
    db().run('UPDATE suppliers SET balance_paisa=? WHERE id=?', supplierBalance(party_id), party_id);
  }
}
function recalcAllBalances() {
  return db().tx(() => {
    const cs = db().all('SELECT id FROM customers');
    for (const c of cs) refreshBalance('CUSTOMER', c.id);
    const ss = db().all('SELECT id FROM suppliers');
    for (const s of ss) refreshBalance('SUPPLIER', s.id);
    return { customers: cs.length, suppliers: ss.length };
  });
}
/** GL integrity check: total debit must equal total credit */
function glCheck() {
  const r = db().get('SELECT COALESCE(SUM(debit_paisa),0) AS d, COALESCE(SUM(credit_paisa),0) AS c FROM ledger_entries');
  return { debit: U.int(r.d), credit: U.int(r.c), balanced: U.int(r.d) === U.int(r.c) };
}

/* ================================================================== stock */
function stockQty(product_id, warehouse_id) {
  return U.int(
    db().val(
      'SELECT COALESCE(SUM(qty_remaining),0) FROM batches WHERE product_id=? AND warehouse_id=?',
      U.int(product_id),
      U.int(warehouse_id)
    )
  );
}
function stockValueCost() {
  return U.int(db().val('SELECT COALESCE(SUM(qty_remaining*cost_paisa),0) FROM batches'));
}

function stockMove({ product_id, batch_id, warehouse_id, qty, type, ref_type, ref_id, unit_cost_paisa, note, user_id, at }) {
  const d = db();
  const balance = stockQty(product_id, warehouse_id);
  return d.insert('stock_moves', {
    at: at || U.nowIso(),
    product_id: U.int(product_id),
    batch_id: batch_id || null,
    warehouse_id: U.int(warehouse_id),
    qty: U.int(qty),
    type,
    ref_type: ref_type || null,
    ref_id: ref_id || null,
    unit_cost_paisa: U.int(unit_cost_paisa),
    balance_after: balance,
    note: note || null,
    user_id: user_id || null,
  });
}

function addStock({
  product_id,
  warehouse_id,
  qty,
  batch_no,
  mfg_date,
  expiry_date,
  cost_paisa,
  supplier_id,
  ref_type,
  ref_id,
  note,
  user_id,
  at,
}) {
  const d = db();
  const q = U.int(qty);
  if (q <= 0) return null;
  const wh = U.int(warehouse_id);
  const pid = U.int(product_id);
  const cost = U.int(cost_paisa);
  let batch = null;
  if (batch_no || expiry_date) {
    batch = d.get(
      'SELECT * FROM batches WHERE product_id=? AND warehouse_id=? AND IFNULL(batch_no,\'\')=IFNULL(?,\'\') AND IFNULL(expiry_date,\'\')=IFNULL(?,\'\') AND cost_paisa=? ORDER BY id LIMIT 1',
      pid,
      wh,
      batch_no || '',
      expiry_date || '',
      cost
    );
  }
  let batchId;
  if (batch) {
    d.run('UPDATE batches SET qty_in=qty_in+?, qty_remaining=qty_remaining+?, cost_paisa=? WHERE id=?', q, q, cost, batch.id);
    batchId = batch.id;
  } else {
    batchId = d.insert('batches', {
      product_id: pid,
      warehouse_id: wh,
      batch_no: batch_no || null,
      mfg_date: mfg_date || null,
      expiry_date: expiry_date || null,
      cost_paisa: cost,
      qty_in: q,
      qty_remaining: q,
      supplier_id: supplier_id || null,
      created_at: U.nowIso(),
    });
  }
  stockMove({ product_id: pid, batch_id: batchId, warehouse_id: wh, qty: q, type: 'IN', ref_type, ref_id, unit_cost_paisa: cost, note, user_id, at });
  return batchId;
}

/**
 * FEFO consumption: batches with earliest expiry leave first.
 * Returns [{batch_id, batch_no, expiry_date, qty, cost_paisa}]
 */
function consumeFEFO({
  product_id,
  warehouse_id,
  qty,
  ref_type,
  ref_id,
  note,
  user_id,
  at,
  allowNegative,
  fallbackCost,
}) {
  const d = db();
  let need = U.int(qty);
  if (need <= 0) return [];
  const pid = U.int(product_id);
  const wh = U.int(warehouse_id);
  const allocs = [];
  const rows = d.all(
    `SELECT * FROM batches
      WHERE product_id=? AND warehouse_id=? AND qty_remaining>0
      ORDER BY (expiry_date IS NULL OR expiry_date='') ASC, expiry_date ASC, id ASC`,
    pid,
    wh
  );
  for (const b of rows) {
    if (need <= 0) break;
    const take = Math.min(need, U.int(b.qty_remaining));
    if (take <= 0) continue;
    d.run('UPDATE batches SET qty_remaining = qty_remaining - ? WHERE id=?', take, b.id);
    allocs.push({ batch_id: b.id, batch_no: b.batch_no, expiry_date: b.expiry_date, qty: take, cost_paisa: U.int(b.cost_paisa) });
    stockMove({ product_id: pid, batch_id: b.id, warehouse_id: wh, qty: -take, type: 'OUT', ref_type, ref_id, unit_cost_paisa: U.int(b.cost_paisa), note, user_id, at });
    need -= take;
  }
  if (need > 0) {
    const allow = allowNegative !== undefined ? allowNegative : Sb('allow_negative_stock', false);
    if (!allow) {
      const p = d.get('SELECT name FROM products WHERE id=?', pid);
      const available = U.int(qty) - need;
      throw new Error(
        `Stock kam hai: "${p ? p.name : 'item'}" — available ${available}, chahiye ${U.int(qty)}. ` +
          `Pehle purchase/transfer karein ya Settings me negative stock allow karein.`
      );
    }
    const cost = U.int(fallbackCost) || U.int(d.val('SELECT COALESCE(MAX(cost_paisa),0) FROM batches WHERE product_id=?', pid));
    allocs.push({ batch_id: null, batch_no: 'NEG', expiry_date: null, qty: need, cost_paisa: cost });
    stockMove({ product_id: pid, batch_id: null, warehouse_id: wh, qty: -need, type: 'OUT', ref_type, ref_id, unit_cost_paisa: cost, note: (note || '') + ' (negative stock)', user_id, at });
  }
  return allocs;
}

/** move stock between warehouses keeping the same batch identity (van loading / STN) */
function moveStock({ product_id, from_warehouse_id, to_warehouse_id, qty, ref_type, ref_id, note, user_id, at }) {
  const allocs = consumeFEFO({
    product_id,
    warehouse_id: from_warehouse_id,
    qty,
    ref_type: ref_type || 'TRANSFER',
    ref_id,
    note: note || 'Transfer out',
    user_id,
    at,
  });
  for (const a of allocs) {
    addStock({
      product_id,
      warehouse_id: to_warehouse_id,
      qty: a.qty,
      batch_no: a.batch_no === 'NEG' ? null : a.batch_no,
      expiry_date: a.expiry_date,
      cost_paisa: a.cost_paisa,
      ref_type: ref_type || 'TRANSFER',
      ref_id,
      note: note || 'Transfer in',
      user_id,
      at,
    });
  }
  return allocs;
}

function stockReturnToBatch({ batch_id, product_id, warehouse_id, qty, ref_type, ref_id, note, user_id }) {
  const d = db();
  const b = batch_id ? d.get('SELECT * FROM batches WHERE id=?', batch_id) : null;
  return addStock({
    product_id,
    warehouse_id,
    qty,
    batch_no: b ? b.batch_no : null,
    expiry_date: b ? b.expiry_date : null,
    cost_paisa: b ? b.cost_paisa : U.int(d.val('SELECT cost_paisa FROM products WHERE id=?', U.int(product_id))),
    ref_type,
    ref_id,
    note,
    user_id,
  });
}

/* ================================================================== pricing / schemes */
function priceFor(product, customer) {
  const d = db();
  if (customer && customer.tier_id) {
    const pp = d.get('SELECT price_paisa FROM product_prices WHERE product_id=? AND tier_id=?', product.id, customer.tier_id);
    if (pp && U.int(pp.price_paisa) > 0) return U.int(pp.price_paisa);
    const tier = d.get('SELECT discount_pct FROM price_tiers WHERE id=?', customer.tier_id);
    if (tier && U.num(tier.discount_pct) > 0) {
      return Math.round(U.int(product.wholesale_paisa) * (1 - U.num(tier.discount_pct) / 100));
    }
  }
  return U.int(product.wholesale_paisa) || U.int(product.retail_paisa) || U.int(product.cost_paisa);
}

function activeSchemes(product, date) {
  const d = U.parseDate(date || U.today());
  const list = db().all(
    `SELECT * FROM schemes WHERE active=1
      AND (product_id IS NULL OR product_id=? OR product_id=0)
      AND (category_id IS NULL OR category_id=? OR category_id=0)
      AND (company_id IS NULL OR company_id=? OR company_id=0)`,
    U.int(product.id),
    U.int(product.category_id),
    U.int(product.company_id)
  );
  return list.filter((s) => {
    const sd = s.start_date ? U.parseDate(s.start_date) : null;
    const ed = s.end_date ? U.parseDate(s.end_date) : null;
    if (sd && d < sd) return false;
    if (ed && d > ed) return false;
    // a scheme must target something (product/category/company) or be global
    return true;
  });
}

function schemeForLine(product, qty, date) {
  const q = U.int(qty);
  let best = { free_qty: 0, discount_pct: 0, scheme: null };
  for (const s of activeSchemes(product, date)) {
    if (s.type === 'FREE_QTY') {
      const buy = U.int(s.buy_qty);
      const free = U.int(s.free_qty);
      if (buy > 0 && free > 0 && q >= buy) {
        const times = Math.floor(q / buy);
        const total = times * free;
        if (total > best.free_qty) best = { free_qty: total, discount_pct: best.discount_pct, scheme: s };
      }
    } else if (s.type === 'SLAB_DISCOUNT') {
      const min = U.int(s.slab_min_qty);
      if (min > 0 && q >= min && U.num(s.discount_pct) > best.discount_pct) {
        best = { free_qty: best.free_qty, discount_pct: U.num(s.discount_pct), scheme: s };
      }
    } else if (s.type === 'CASH_DISCOUNT') {
      if (U.num(s.discount_pct) > best.discount_pct) {
        best = { free_qty: best.free_qty, discount_pct: U.num(s.discount_pct), scheme: s };
      }
    }
  }
  return best;
}

function applicableSchemes(product_id, qty, date) {
  const p = db().get('SELECT * FROM products WHERE id=?', U.int(product_id));
  if (!p) return [];
  return activeSchemes(p, date).map((s) => ({ ...s, calc: schemeForLine(p, qty, date) }));
}

/* ================================================================== credit control */
function creditStatus(customer_id) {
  const d = db();
  const c = d.get('SELECT * FROM customers WHERE id=?', U.int(customer_id));
  if (!c) throw new Error('Customer nahi mila');
  const balance = customerBalance(c.id);
  const overdue = d.get(
    `SELECT COUNT(*) AS cnt, COALESCE(SUM(total_paisa - paid_paisa),0) AS amt, MIN(date) AS oldest
       FROM sales_invoices
      WHERE customer_id=? AND status IN ('UNPAID','PARTIAL') AND total_paisa > paid_paisa
        AND due_date IS NOT NULL AND due_date < ?`,
    c.id,
    U.today()
  );
  const oldest = overdue.oldest || null;
  const daysOverdue = oldest ? Math.max(0, U.daysBetween(oldest, U.today())) : 0;
  return {
    customer_id: c.id,
    name: c.name,
    balance_paisa: balance,
    credit_limit_paisa: U.int(c.credit_limit_paisa),
    available_paisa: U.int(c.credit_limit_paisa) - balance,
    credit_days: U.int(c.credit_days),
    overdue_count: U.int(overdue.cnt),
    overdue_paisa: U.int(overdue.amt),
    oldest_due_date: oldest,
    days_overdue: daysOverdue,
    limit_exceeded: U.int(c.credit_limit_paisa) > 0 && balance > U.int(c.credit_limit_paisa),
    aging_days: U.int(c.credit_days),
    aging_exceeded: U.int(c.credit_days) > 0 && daysOverdue > U.int(c.credit_days) + Sn('credit_grace_days', 3),
  };
}

const A = require('./auth');

function checkCredit(customer, newTotal, payload) {
  const status = creditStatus(customer.id);
  const problems = [];
  const enforceLimit = Sb('enforce_credit_limit', true);
  const enforceDays = Sb('enforce_credit_days', true);
  if (enforceLimit && status.credit_limit_paisa > 0 && status.balance_paisa + newTotal > status.credit_limit_paisa) {
    problems.push(
      `Credit limit khatam: limit ${U.fmtMoney(status.credit_limit_paisa)}, mojooda udhaar ${U.fmtMoney(
        status.balance_paisa
      )}, naya bill ${U.fmtMoney(newTotal)}`
    );
  }
  if (enforceDays && status.aging_exceeded) {
    problems.push(
      `Purana udhaar ${status.days_overdue} din se pending hai (${status.oldest_due_date}). Credit days ${status.credit_days} + grace ${Sn(
        'credit_grace_days',
        3
      )} din.`
    );
  }
  if (!problems.length) return { ok: true, status };
  // needs manager override
  if (payload && payload.override_pin) {
    if (!A.checkManagerPin(payload.override_pin)) throw new Error('Manager PIN ghalat hai');
    return { ok: true, status, override: true, reason: problems.join(' | ') };
  }
  const err = new Error(problems.join('\n'));
  err.code = 'CREDIT_LIMIT';
  err.credit_status = status;
  err.needs_pin = true;
  throw err;
}

/* ================================================================== SALES INVOICE */
function buildLines(customer, rawLines, date, warehouse_id) {
  const d = db();
  const built = [];
  let subtotal = 0;
  let discountTotal = 0;
  let schemeTotal = 0;
  let taxTotal = 0;
  for (const raw of rawLines) {
    const product = d.get('SELECT * FROM products WHERE id=?', U.int(raw.product_id));
    if (!product) throw new Error('Product nahi mila (id: ' + raw.product_id + ')');
    const cartonSize = U.int(product.carton_size, 1) || 1;
    let qty = U.int(raw.qty);
    if (!qty) qty = U.int(raw.cartons) * cartonSize + U.int(raw.loose);
    if (qty <= 0) continue;
    const cartons = U.int(raw.cartons) || Math.floor(qty / cartonSize);
    const loose = U.int(raw.loose) || qty % cartonSize;
    const hasPrice = raw.unit_price_paisa !== undefined && raw.unit_price_paisa !== null && raw.unit_price_paisa !== '';
    const unit_price = hasPrice ? U.int(raw.unit_price_paisa) : priceFor(product, customer);
    const scheme = schemeForLine(product, qty, date);
    let disc_pct = U.num(raw.discount_pct, 0);
    if (scheme.discount_pct > disc_pct) disc_pct = scheme.discount_pct;
    const gross = qty * unit_price;
    const disc = Math.round((gross * disc_pct) / 100);
    const line_total = gross - disc;
    const tax_pct = Sb('tax_enabled', false) ? U.num(product.tax_pct, 0) : 0;
    const tax = Math.round((line_total * tax_pct) / 100);
    const free_qty = U.int(raw.free_qty) || scheme.free_qty;
    built.push({
      product,
      cartons,
      loose,
      qty,
      unit_price_paisa: unit_price,
      discount_pct: disc_pct,
      discount_paisa: disc,
      line_total_paisa: line_total,
      tax_paisa: tax,
      is_free: 0,
      scheme_id: scheme.scheme ? scheme.scheme.id : null,
      free_qty,
      scheme_name: scheme.scheme ? scheme.scheme.name : null,
    });
    subtotal += gross;
    discountTotal += disc;
    taxTotal += tax;
    if (free_qty > 0) {
      const freePrice = unit_price;
      schemeTotal += free_qty * freePrice;
    }
  }
  return { lines: built, subtotal, discountTotal, schemeTotal, taxTotal };
}

function createInvoice(user, payload) {
  const d = db();
  const date = payload.date || U.today();
  const sale_type = String(payload.sale_type || 'CREDIT').toUpperCase() === 'CASH' ? 'CASH' : 'CREDIT';
  const warehouse_id = U.int(payload.warehouse_id) || U.int(S('default_warehouse_id'));
  if (!warehouse_id) throw new Error('Warehouse set nahi hai (Settings dekhein)');
  const customer = d.get('SELECT * FROM customers WHERE id=?', U.int(payload.customer_id));
  if (!customer) throw new Error('Customer select karein');
  const rawLines = (payload.lines || []).filter((l) => U.int(l.product_id));
  if (!rawLines.length) throw new Error('Kam az kam ek item add karein');

  const prepared = buildLines(customer, rawLines, date, warehouse_id);
  if (!prepared.lines.length) throw new Error('Koi valid item nahi mila');

  const headerDiscount = U.int(payload.discount_paisa);
  const total = prepared.subtotal - prepared.discountTotal - headerDiscount + prepared.taxTotal;
  if (total < 0) throw new Error('Discount bill se ziada nahi ho sakta');

  // ---- credit control (before touching stock)
  let override = null;
  if (sale_type === 'CREDIT') {
    const res = checkCredit(customer, total, payload);
    if (res.override) override = res;
  }

  return d.tx(() => {
    const invoice_no = num.invoice();
    const due_date =
      payload.due_date || (U.int(customer.credit_days) > 0 ? U.dateAdd(date, U.int(customer.credit_days)) : null);
    const invoiceId = d.insert('sales_invoices', {
      invoice_no,
      date,
      due_date,
      customer_id: customer.id,
      salesman_id: U.int(payload.salesman_id) || null,
      route_id: U.int(payload.route_id) || customer.route_id || null,
      warehouse_id,
      order_id: U.int(payload.order_id) || null,
      sale_type,
      subtotal_paisa: prepared.subtotal,
      discount_paisa: prepared.discountTotal + headerDiscount,
      scheme_discount_paisa: prepared.schemeTotal,
      tax_paisa: prepared.taxTotal,
      total_paisa: total,
      cost_total_paisa: 0,
      gross_profit_paisa: 0,
      paid_paisa: sale_type === 'CASH' ? total : 0,
      status: sale_type === 'CASH' ? 'PAID' : 'UNPAID',
      override_by: override ? user.id : null,
      override_reason: override ? override.reason : null,
      notes: payload.notes || null,
      user_id: user.id,
      created_at: U.nowIso(),
    });

    let costTotal = 0;
    for (const line of prepared.lines) {
      const allocs = consumeFEFO({
        product_id: line.product.id,
        warehouse_id,
        qty: line.qty,
        ref_type: 'SALE',
        ref_id: invoiceId,
        note: `${invoice_no} sale`,
        user_id: user.id,
        at: date + ' ' + U.nowIso().slice(11),
      });
      const lineCost = allocs.reduce((s, a) => s + a.qty * a.cost_paisa, 0);
      costTotal += lineCost;
      const lineId = d.insert('sales_lines', {
        invoice_id: invoiceId,
        product_id: line.product.id,
        batch_id: allocs.length ? allocs[0].batch_id : null,
        qty: line.qty,
        cartons: line.cartons,
        loose: line.loose,
        unit_price_paisa: line.unit_price_paisa,
        cost_paisa: line.qty ? Math.round(lineCost / line.qty) : 0,
        discount_pct: line.discount_pct,
        discount_paisa: line.discount_paisa,
        line_total_paisa: line.line_total_paisa,
        is_free: 0,
        scheme_id: line.scheme_id,
      });
      for (const a of allocs) {
        d.insert('invoice_batch_allocations', {
          invoice_id: invoiceId,
          line_id: lineId,
          product_id: line.product.id,
          batch_id: a.batch_id,
          qty: a.qty,
          cost_paisa: a.cost_paisa,
          created_at: U.nowIso(),
        });
      }
      // free goods (scheme)
      if (line.free_qty > 0) {
        const freeAllocs = consumeFEFO({
          product_id: line.product.id,
          warehouse_id,
          qty: line.free_qty,
          ref_type: 'SALE_FREE',
          ref_id: invoiceId,
          note: `${invoice_no} scheme free`,
          user_id: user.id,
        });
        const freeCost = freeAllocs.reduce((s, a) => s + a.qty * a.cost_paisa, 0);
        costTotal += freeCost;
        const freeLineId = d.insert('sales_lines', {
          invoice_id: invoiceId,
          product_id: line.product.id,
          batch_id: freeAllocs.length ? freeAllocs[0].batch_id : null,
          qty: line.free_qty,
          cartons: 0,
          loose: line.free_qty,
          unit_price_paisa: 0,
          cost_paisa: freeAllocs.length ? Math.round(freeCost / line.free_qty) : 0,
          discount_pct: 0,
          discount_paisa: 0,
          line_total_paisa: 0,
          is_free: 1,
          scheme_id: line.scheme_id,
        });
        for (const a of freeAllocs) {
          d.insert('invoice_batch_allocations', {
            invoice_id: invoiceId,
            line_id: freeLineId,
            product_id: line.product.id,
            batch_id: a.batch_id,
            qty: a.qty,
            cost_paisa: a.cost_paisa,
            created_at: U.nowIso(),
          });
        }
        // claim from principal company (scheme cost recovery)
        if (line.scheme_id) {
          const scheme = d.get('SELECT * FROM schemes WHERE id=?', line.scheme_id);
          if (scheme && U.int(scheme.claimable)) {
            d.insert('claims', {
              date,
              company_id: scheme.company_id || line.product.company_id || null,
              scheme_id: scheme.id,
              invoice_id: invoiceId,
              product_id: line.product.id,
              qty_free: line.free_qty,
              value_paisa: line.free_qty * line.unit_price_paisa,
              status: 'PENDING',
              created_at: U.nowIso(),
              note: scheme.name,
            });
          }
        }
      }
    }

    const gp = prepared.subtotal - prepared.discountTotal - headerDiscount - costTotal;
    d.run('UPDATE sales_invoices SET cost_total_paisa=?, gross_profit_paisa=? WHERE id=?', costTotal, gp, invoiceId);

    // ---- ledger
    const netSales = prepared.subtotal - prepared.discountTotal - headerDiscount;
    const entries = [];
    if (sale_type === 'CASH') {
      entries.push({ party_type: 'CASH', party_id: 0, debit_paisa: total });
    } else {
      entries.push({ party_type: 'CUSTOMER', party_id: customer.id, debit_paisa: total });
    }
    entries.push({ party_type: 'SALES', party_id: 0, credit_paisa: netSales });
    if (prepared.taxTotal) entries.push({ party_type: 'TAX', party_id: 0, credit_paisa: prepared.taxTotal });
    ledgerAdd({
      date,
      ref_type: 'SALE_INVOICE',
      ref_id: invoiceId,
      note: invoice_no,
      user_id: user.id,
      entries,
    });

    // ---- auto receipt for cash sale (shows in cash closing & day book)
    if (sale_type === 'CASH') {
      const receipt_no = num.receipt();
      const rid = d.insert('receipts', {
        receipt_no,
        date,
        customer_id: customer.id,
        salesman_id: U.int(payload.salesman_id) || null,
        route_id: U.int(payload.route_id) || customer.route_id || null,
        method: 'CASH',
        amount_paisa: total,
        allocated_paisa: total,
        advance_paisa: 0,
        status: 'POSTED',
        auto_created: 1,
        notes: `Cash sale ${invoice_no}`,
        user_id: user.id,
        created_at: U.nowIso(),
      });
      d.insert('receipt_allocations', { receipt_id: rid, invoice_id: invoiceId, amount_paisa: total, at: U.nowIso() });
    }

    // ---- order link
    if (U.int(payload.order_id)) {
      d.run("UPDATE orders SET status='DELIVERED', invoice_id=? WHERE id=?", invoiceId, U.int(payload.order_id));
    }

    audit(user, 'CREATE', 'sales_invoice', invoiceId, { invoice_no, total, sale_type, customer: customer.name });
    return getInvoice(invoiceId);
  });
}

function getInvoice(id) {
  const d = db();
  const inv = d.get(
    `SELECT i.*, c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address, c.whatsapp AS customer_whatsapp,
            c.balance_paisa AS customer_balance, c.ntn AS customer_ntn,
            s.name AS salesman_name, r.name AS route_name, w.name AS warehouse_name, u.username AS created_by
       FROM sales_invoices i
       LEFT JOIN customers c ON c.id=i.customer_id
       LEFT JOIN salesmen s ON s.id=i.salesman_id
       LEFT JOIN routes r ON r.id=i.route_id
       LEFT JOIN warehouses w ON w.id=i.warehouse_id
       LEFT JOIN users u ON u.id=i.user_id
      WHERE i.id=?`,
    U.int(id)
  );
  if (!inv) throw new Error('Invoice nahi mili');
  const lines = d.all(
    `SELECT sl.*, p.name AS product_name, p.sku, p.carton_size, b.batch_no, b.expiry_date
       FROM sales_lines sl
       LEFT JOIN products p ON p.id=sl.product_id
       LEFT JOIN batches b ON b.id=sl.batch_id
      WHERE sl.invoice_id=?
      ORDER BY sl.id`,
    U.int(id)
  );
  const allocations = d.all('SELECT * FROM receipt_allocations WHERE invoice_id=?', U.int(id));
  const receipts = allocations.map((a) =>
    d.get('SELECT receipt_no, date, method, amount_paisa, cheque_no, cheque_status FROM receipts WHERE id=?', a.receipt_id)
  );
  return { ...inv, lines, receipts: receipts.filter(Boolean) };
}

function voidInvoice(user, id, reason, pin) {
  const d = db();
  const inv = d.get('SELECT * FROM sales_invoices WHERE id=?', U.int(id));
  if (!inv) throw new Error('Invoice nahi mili');
  if (inv.status === 'VOID') throw new Error('Yeh invoice pehle hi void hai');
  if (!A.checkManagerPin(pin)) throw new Error('Void karne ke liye Manager PIN zaroori hai');
  const allocated = U.int(d.val('SELECT COALESCE(SUM(amount_paisa),0) FROM receipt_allocations WHERE invoice_id=?', inv.id));
  if (allocated > 0) throw new Error('Is invoice par payment ho chuki hai — pehle payment reverse karein');

  return d.tx(() => {
    // 1. stock wapas usi batch me
    const allocs = d.all('SELECT * FROM invoice_batch_allocations WHERE invoice_id=?', inv.id);
    for (const a of allocs) {
      if (a.batch_id) {
        d.run('UPDATE batches SET qty_remaining = qty_remaining + ? WHERE id=?', U.int(a.qty), a.batch_id);
        stockMove({
          product_id: a.product_id,
          batch_id: a.batch_id,
          warehouse_id: inv.warehouse_id,
          qty: U.int(a.qty),
          type: 'IN',
          ref_type: 'VOID',
          ref_id: inv.id,
          unit_cost_paisa: a.cost_paisa,
          note: 'Invoice void — stock wapsi',
          user_id: user.id,
        });
      }
    }
    // 2. GL reverse
    const netSales = U.int(inv.subtotal_paisa) - U.int(inv.discount_paisa);
    const entries = [];
    entries.push(
      inv.sale_type === 'CASH'
        ? { party_type: 'CASH', party_id: 0, credit_paisa: U.int(inv.total_paisa) }
        : { party_type: 'CUSTOMER', party_id: inv.customer_id, credit_paisa: U.int(inv.total_paisa) }
    );
    entries.push({ party_type: 'SALES', party_id: 0, debit_paisa: netSales });
    if (U.int(inv.tax_paisa)) entries.push({ party_type: 'TAX', party_id: 0, debit_paisa: U.int(inv.tax_paisa) });
    ledgerAdd({ date: U.today(), ref_type: 'VOID', ref_id: inv.id, note: `Void ${inv.invoice_no}`, user_id: user.id, entries });
    // 3. void auto receipt
    d.run("UPDATE receipts SET status='VOID' WHERE auto_created=1 AND id IN (SELECT receipt_id FROM receipt_allocations WHERE invoice_id=?)", inv.id);
    d.run('DELETE FROM receipt_allocations WHERE invoice_id=?', inv.id);
    d.run('DELETE FROM claims WHERE invoice_id=?', inv.id);
    d.run("UPDATE sales_invoices SET status='VOID', paid_paisa=0, notes=IFNULL(notes,'') || ' | VOID: ' || ? WHERE id=?", String(reason || ''), inv.id);
    audit(user, 'VOID', 'sales_invoice', inv.id, { invoice_no: inv.invoice_no, reason });
    return getInvoice(inv.id);
  });
}

/* ================================================================== SALES RETURN */
function createSalesReturn(user, payload) {
  const d = db();
  const date = payload.date || U.today();
  const customer = d.get('SELECT * FROM customers WHERE id=?', U.int(payload.customer_id));
  if (!customer) throw new Error('Customer select karein');
  const kind = String(payload.kind || 'GOOD').toUpperCase() === 'SCRAP' ? 'SCRAP' : 'GOOD';
  const warehouse_id =
    U.int(payload.warehouse_id) ||
    (kind === 'SCRAP' ? U.int(S('default_scrap_warehouse_id')) : U.int(S('default_warehouse_id')));
  const invoice = U.int(payload.invoice_id) ? d.get('SELECT * FROM sales_invoices WHERE id=?', U.int(payload.invoice_id)) : null;
  const lines = (payload.lines || []).filter((l) => U.int(l.product_id));
  if (!lines.length) throw new Error('Kam az kam ek item wapsi ke liye chunein');

  return d.tx(() => {
    const return_no = num.salesReturn();
    const rid = d.insert('sales_returns', {
      return_no,
      date,
      customer_id: customer.id,
      invoice_id: invoice ? invoice.id : null,
      warehouse_id,
      kind,
      total_paisa: 0,
      reason: payload.reason || null,
      user_id: user.id,
      created_at: U.nowIso(),
    });
    let total = 0;
    for (const raw of lines) {
      const product = d.get('SELECT * FROM products WHERE id=?', U.int(raw.product_id));
      if (!product) throw new Error('Product nahi mila');
      const cartonSize = U.int(product.carton_size, 1) || 1;
      let qty = U.int(raw.qty) || U.int(raw.cartons) * cartonSize + U.int(raw.loose);
      if (qty <= 0) continue;
      let price = U.int(raw.unit_price_paisa);
      if (!price && invoice) {
        const invLine = d.get(
          'SELECT unit_price_paisa FROM sales_lines WHERE invoice_id=? AND product_id=? AND is_free=0 ORDER BY id LIMIT 1',
          invoice.id,
          product.id
        );
        if (invLine) price = U.int(invLine.unit_price_paisa);
      }
      if (!price) price = priceFor(product, customer);
      const lineTotal = qty * price;
      let batch_id = U.int(raw.batch_id) || null;
      if (!batch_id && invoice) {
        const a = d.get(
          'SELECT batch_id FROM invoice_batch_allocations WHERE invoice_id=? AND product_id=? LIMIT 1',
          invoice.id,
          product.id
        );
        if (a) batch_id = a.batch_id;
      }
      stockReturnToBatch({
        batch_id,
        product_id: product.id,
        warehouse_id,
        qty,
        ref_type: 'SALES_RETURN',
        ref_id: rid,
        note: `${return_no} ${kind === 'SCRAP' ? 'damage/scrap' : 'return'} (${customer.name})`,
        user_id: user.id,
      });
      d.insert('sales_return_lines', {
        return_id: rid,
        product_id: product.id,
        batch_id,
        qty,
        unit_price_paisa: price,
        line_total_paisa: lineTotal,
      });
      total += lineTotal;
    }
    d.run('UPDATE sales_returns SET total_paisa=? WHERE id=?', total, rid);

    // ledger: reduce customer receivable
    const entries = [{ party_type: 'SALES_RETURN', party_id: 0, debit_paisa: total }, { party_type: 'CUSTOMER', party_id: customer.id, credit_paisa: total }];
    const refundMethod = String(payload.refund_method || '').toUpperCase();
    if (refundMethod === 'CASH' || refundMethod === 'BANK') {
      entries.push({ party_type: 'CUSTOMER', party_id: customer.id, debit_paisa: total });
      entries.push({ party_type: refundMethod, party_id: 0, credit_paisa: total });
    }
    ledgerAdd({ date, ref_type: 'SALES_RETURN', ref_id: rid, note: return_no, user_id: user.id, entries });
    audit(user, 'CREATE', 'sales_return', rid, { return_no, total, customer: customer.name, kind });
    return d.get('SELECT * FROM sales_returns WHERE id=?', rid);
  });
}

/* ================================================================== PURCHASE */
function createPurchase(user, payload) {
  const d = db();
  const date = payload.date || U.today();
  const supplier = d.get('SELECT * FROM suppliers WHERE id=?', U.int(payload.supplier_id));
  if (!supplier) throw new Error('Supplier select karein');
  const warehouse_id = U.int(payload.warehouse_id) || U.int(S('default_warehouse_id'));
  const lines = (payload.lines || []).filter((l) => U.int(l.product_id));
  if (!lines.length) throw new Error('Kam az kam ek item add karein');

  return d.tx(() => {
    const invoice_no = payload.invoice_no || num.purchase();
    const freight = U.int(payload.freight_paisa);
    const headerDiscount = U.int(payload.discount_paisa);
    const purchaseId = d.insert('purchases', {
      invoice_no,
      supplier_id: supplier.id,
      date,
      warehouse_id,
      subtotal_paisa: 0,
      discount_paisa: headerDiscount,
      tax_paisa: U.int(payload.tax_paisa),
      freight_paisa: freight,
      total_paisa: 0,
      paid_paisa: 0,
      balance_paisa: 0,
      status: 'RECEIVED',
      notes: payload.notes || null,
      user_id: user.id,
      created_at: U.nowIso(),
    });
    let subtotal = 0;
    let lineDiscount = 0;
    for (const raw of lines) {
      const product = d.get('SELECT * FROM products WHERE id=?', U.int(raw.product_id));
      if (!product) throw new Error('Product nahi mila');
      const cartonSize = U.int(product.carton_size, 1) || 1;
      let qty = U.int(raw.qty) || U.int(raw.cartons) * cartonSize + U.int(raw.loose);
      if (qty <= 0) continue;
      const cost = U.int(raw.unit_cost_paisa) || U.int(product.cost_paisa);
      const disc_pct = U.num(raw.discount_pct, 0);
      const gross = qty * cost;
      const disc = Math.round((gross * disc_pct) / 100);
      const lineTotal = gross - disc;
      const mfg = raw.mfg_date || null;
      let expiry = raw.expiry_date || null;
      if (!expiry && product.shelf_life_days && (mfg || date)) {
        expiry = U.dateAdd(mfg || date, U.int(product.shelf_life_days));
      }
      const batchId = addStock({
        product_id: product.id,
        warehouse_id,
        qty,
        batch_no: raw.batch_no || null,
        mfg_date: mfg,
        expiry_date: expiry,
        cost_paisa: cost,
        supplier_id: supplier.id,
        ref_type: 'PURCHASE',
        ref_id: purchaseId,
        note: `${invoice_no} purchase (${supplier.name})`,
        user_id: user.id,
      });
      d.insert('purchase_lines', {
        purchase_id: purchaseId,
        product_id: product.id,
        batch_id: batchId,
        batch_no: raw.batch_no || null,
        expiry_date: expiry,
        qty,
        cartons: U.int(raw.cartons) || Math.floor(qty / cartonSize),
        loose: U.int(raw.loose) || qty % cartonSize,
        unit_cost_paisa: cost,
        discount_pct: disc_pct,
        line_total_paisa: lineTotal,
      });
      subtotal += gross;
      lineDiscount += disc;
      if (cost > 0) d.run('UPDATE products SET cost_paisa=? WHERE id=?', cost, product.id);
    }
    const discount = lineDiscount + headerDiscount;
    const total = subtotal - discount + U.int(payload.tax_paisa) + freight;
    d.run(
      'UPDATE purchases SET subtotal_paisa=?, discount_paisa=?, total_paisa=?, balance_paisa=? WHERE id=?',
      subtotal,
      discount,
      total,
      total,
      purchaseId
    );

    const entries = [];
    entries.push({ party_type: 'PURCHASE', party_id: 0, debit_paisa: subtotal - discount });
    if (freight) {
      let head = d.get("SELECT id FROM expense_heads WHERE name LIKE 'Freight%' LIMIT 1");
      if (!head) {
        const hid = d.insert('expense_heads', { name: 'Freight Inward', is_cogs: 1, active: 1 });
        head = { id: hid };
      }
      entries.push({ party_type: 'EXPENSE', party_id: head.id, debit_paisa: freight });
    }
    if (U.int(payload.tax_paisa)) entries.push({ party_type: 'TAX', party_id: 0, debit_paisa: U.int(payload.tax_paisa) });
    entries.push({ party_type: 'SUPPLIER', party_id: supplier.id, credit_paisa: total });
    ledgerAdd({ date, ref_type: 'PURCHASE', ref_id: purchaseId, note: invoice_no, user_id: user.id, entries });

    let payment = null;
    if (payload.payment && U.int(payload.payment.amount_paisa) > 0) {
      payment = createPayment(user, {
        supplier_id: supplier.id,
        date,
        method: payload.payment.method || 'CASH',
        amount_paisa: U.int(payload.payment.amount_paisa),
        cheque_no: payload.payment.cheque_no,
        cheque_date: payload.payment.cheque_date,
        bank_name: payload.payment.bank_name,
        purchase_id: purchaseId,
        notes: 'Purchase payment ' + invoice_no,
        _inner: true,
      });
    }
    audit(user, 'CREATE', 'purchase', purchaseId, { invoice_no, total, supplier: supplier.name });
    return getPurchase(purchaseId);
  });
}

function getPurchase(id) {
  const d = db();
  const p = d.get(
    `SELECT p.*, s.name AS supplier_name, s.phone AS supplier_phone, w.name AS warehouse_name, s.balance_paisa AS supplier_balance
       FROM purchases p LEFT JOIN suppliers s ON s.id=p.supplier_id LEFT JOIN warehouses w ON w.id=p.warehouse_id WHERE p.id=?`,
    U.int(id)
  );
  if (!p) throw new Error('Purchase nahi mili');
  const lines = d.all(
    `SELECT pl.*, pr.name AS product_name, pr.carton_size, pr.sku
       FROM purchase_lines pl LEFT JOIN products pr ON pr.id=pl.product_id WHERE pl.purchase_id=? ORDER BY pl.id`,
    U.int(id)
  );
  return { ...p, lines };
}

/* ================================================================== PURCHASE RETURN */
function createPurchaseReturn(user, payload) {
  const d = db();
  const date = payload.date || U.today();
  const supplier = d.get('SELECT * FROM suppliers WHERE id=?', U.int(payload.supplier_id));
  if (!supplier) throw new Error('Supplier select karein');
  const warehouse_id = U.int(payload.warehouse_id) || U.int(S('default_warehouse_id'));
  const lines = (payload.lines || []).filter((l) => U.int(l.product_id));
  if (!lines.length) throw new Error('Kam az kam ek item chunein');

  return d.tx(() => {
    const return_no = num.purchaseReturn();
    const rid = d.insert('purchase_returns', {
      return_no,
      supplier_id: supplier.id,
      date,
      warehouse_id,
      total_paisa: 0,
      reason: payload.reason || null,
      user_id: user.id,
      created_at: U.nowIso(),
    });
    let total = 0;
    for (const raw of lines) {
      const product = d.get('SELECT * FROM products WHERE id=?', U.int(raw.product_id));
      if (!product) throw new Error('Product nahi mila');
      const cartonSize = U.int(product.carton_size, 1) || 1;
      const qty = U.int(raw.qty) || U.int(raw.cartons) * cartonSize + U.int(raw.loose);
      if (qty <= 0) continue;
      const cost = U.int(raw.unit_cost_paisa) || U.int(product.cost_paisa);
      const lineTotal = qty * cost;
      const allocs = consumeFEFO({
        product_id: product.id,
        warehouse_id,
        qty,
        ref_type: 'PURCHASE_RETURN',
        ref_id: rid,
        note: `${return_no} supplier return`,
        user_id: user.id,
      });
      d.insert('purchase_return_lines', {
        return_id: rid,
        product_id: product.id,
        batch_id: allocs.length ? allocs[0].batch_id : null,
        qty,
        unit_cost_paisa: cost,
        line_total_paisa: lineTotal,
        condition: String(raw.condition || 'GOOD').toUpperCase(),
      });
      total += lineTotal;
    }
    d.run('UPDATE purchase_returns SET total_paisa=? WHERE id=?', total, rid);
    ledgerAdd({
      date,
      ref_type: 'PURCHASE_RETURN',
      ref_id: rid,
      note: return_no,
      user_id: user.id,
      entries: [
        { party_type: 'SUPPLIER', party_id: supplier.id, debit_paisa: total },
        { party_type: 'PURCHASE_RETURN', party_id: 0, credit_paisa: total },
      ],
    });
    audit(user, 'CREATE', 'purchase_return', rid, { return_no, total, supplier: supplier.name });
    return d.get('SELECT * FROM purchase_returns WHERE id=?', rid);
  });
}

/* ================================================================== RECEIPTS */
function allocateToInvoices(receipt) {
  const d = db();
  let left = U.int(receipt.amount_paisa);
  const allocations = [];
  const invoices = d.all(
    `SELECT * FROM sales_invoices
      WHERE customer_id=? AND status IN ('UNPAID','PARTIAL') AND total_paisa > paid_paisa
      ORDER BY date ASC, id ASC`,
    receipt.customer_id
  );
  for (const inv of invoices) {
    if (left <= 0) break;
    const due = U.int(inv.total_paisa) - U.int(inv.paid_paisa);
    if (due <= 0) continue;
    const take = Math.min(left, due);
    d.insert('receipt_allocations', { receipt_id: receipt.id, invoice_id: inv.id, amount_paisa: take, at: U.nowIso() });
    const paid = U.int(inv.paid_paisa) + take;
    const status = paid >= U.int(inv.total_paisa) ? 'PAID' : 'PARTIAL';
    d.run('UPDATE sales_invoices SET paid_paisa=?, status=? WHERE id=?', paid, status, inv.id);
    allocations.push({ invoice_id: inv.id, invoice_no: inv.invoice_no, amount_paisa: take });
    left -= take;
  }
  return { allocations, unallocated: left };
}

function createReceipt(user, payload) {
  const d = db();
  const date = payload.date || U.today();
  const customer = d.get('SELECT * FROM customers WHERE id=?', U.int(payload.customer_id));
  if (!customer) throw new Error('Customer select karein');
  const amount = U.int(payload.amount_paisa);
  if (amount <= 0) throw new Error('Amount 0 se ziada hona chahiye');
  let method = String(payload.method || 'CASH').toUpperCase();
  if (!['CASH', 'CHEQUE', 'BANK', 'ONLINE'].includes(method)) method = 'CASH';
  if (method === 'ONLINE') method = 'BANK';
  if (method === 'CHEQUE' && !payload.cheque_no) throw new Error('Cheque number likhein');
  if (method === 'CHEQUE' && !payload.cheque_date) throw new Error('Cheque ki date likhein');

  return d.tx(() => {
    const receipt_no = num.receipt();
    const rid = d.insert('receipts', {
      receipt_no,
      date,
      customer_id: customer.id,
      salesman_id: U.int(payload.salesman_id) || customer.route_id ? U.int(payload.salesman_id) || null : null,
      route_id: U.int(payload.route_id) || customer.route_id || null,
      method,
      amount_paisa: amount,
      allocated_paisa: 0,
      advance_paisa: 0,
      cheque_no: payload.cheque_no || null,
      cheque_date: payload.cheque_date || null,
      bank_name: payload.bank_name || null,
      cheque_status: method === 'CHEQUE' ? 'RECEIVED' : null,
      cheque_status_at: method === 'CHEQUE' ? U.nowIso() : null,
      status: 'POSTED',
      auto_created: 0,
      notes: payload.notes || null,
      user_id: user.id,
      created_at: U.nowIso(),
    });

    // ledger: money in (cash / bank / cheque-in-hand) vs customer receivable down
    const debitAccount = method === 'CHEQUE' ? 'CHEQUE' : method === 'BANK' ? 'BANK' : 'CASH';
    ledgerAdd({
      date,
      ref_type: 'RECEIPT',
      ref_id: rid,
      note: receipt_no + (payload.bank_name ? ' (' + payload.bank_name + ')' : ''),
      user_id: user.id,
      entries: [
        { party_type: debitAccount, party_id: 0, debit_paisa: amount },
        { party_type: 'CUSTOMER', party_id: customer.id, credit_paisa: amount },
      ],
    });

    const receipt = d.get('SELECT * FROM receipts WHERE id=?', rid);
    let alloc = { allocations: [], unallocated: amount };
    if (U.int(payload.invoice_id)) {
      const inv = d.get('SELECT * FROM sales_invoices WHERE id=?', U.int(payload.invoice_id));
      if (inv && inv.customer_id === customer.id) {
        const due = U.int(inv.total_paisa) - U.int(inv.paid_paisa);
        const take = Math.min(amount, Math.max(0, due));
        if (take > 0) {
          d.insert('receipt_allocations', { receipt_id: rid, invoice_id: inv.id, amount_paisa: take, at: U.nowIso() });
          const paid = U.int(inv.paid_paisa) + take;
          d.run('UPDATE sales_invoices SET paid_paisa=?, status=? WHERE id=?', paid, paid >= U.int(inv.total_paisa) ? 'PAID' : 'PARTIAL', inv.id);
          alloc.allocations.push({ invoice_id: inv.id, invoice_no: inv.invoice_no, amount_paisa: take });
          alloc.unallocated = amount - take;
        }
      }
    }
    if (!U.int(payload.invoice_id) || alloc.unallocated > 0) {
      // FIFO settlement of oldest unpaid bills
      const fifo = allocateToInvoices({ ...receipt, amount_paisa: alloc.unallocated });
      alloc.allocations = alloc.allocations.concat(fifo.allocations);
      alloc.unallocated = fifo.unallocated;
    }
    const allocated = alloc.allocations.reduce((s, a) => s + a.amount_paisa, 0);
    d.run('UPDATE receipts SET allocated_paisa=?, advance_paisa=? WHERE id=?', allocated, alloc.unallocated, rid);
    if (!payload._inner) {
      audit(user, 'CREATE', 'receipt', rid, { receipt_no, amount, method, customer: customer.name, allocated, advance: alloc.unallocated });
    }
    return { receipt: d.get('SELECT * FROM receipts WHERE id=?', rid), ...alloc };
  });
}

function setChequeStatus(user, receipt_id, status, opts = {}) {
  const d = db();
  const r = d.get('SELECT * FROM receipts WHERE id=?', U.int(receipt_id));
  if (!r) throw new Error('Receipt nahi mila');
  if (r.method !== 'CHEQUE') throw new Error('Yeh receipt cheque nahi hai');
  const st = String(status || '').toUpperCase();
  if (!['IN_CLEARING', 'CLEARED', 'BOUNCED', 'RETURNED'].includes(st)) throw new Error('Cheque status ghalat hai');
  const amount = U.int(r.amount_paisa);

  return d.tx(() => {
    if (st === 'CLEARED') {
      ledgerAdd({
        date: opts.date || U.today(),
        ref_type: 'CHEQUE_CLEARED',
        ref_id: r.id,
        note: `Cheque cleared ${r.cheque_no}`,
        user_id: user.id,
        entries: [
          { party_type: 'BANK', party_id: 0, debit_paisa: amount },
          { party_type: 'CHEQUE', party_id: 0, credit_paisa: amount },
        ],
      });
    } else if (st === 'BOUNCED') {
      // reverse allocations -> invoices become unpaid again
      const allocs = d.all('SELECT * FROM receipt_allocations WHERE receipt_id=?', r.id);
      for (const a of allocs) {
        const inv = d.get('SELECT * FROM sales_invoices WHERE id=?', a.invoice_id);
        if (!inv) continue;
        const paid = Math.max(0, U.int(inv.paid_paisa) - U.int(a.amount_paisa));
        d.run('UPDATE sales_invoices SET paid_paisa=?, status=? WHERE id=?', paid, paid <= 0 ? 'UNPAID' : 'PARTIAL', inv.id);
      }
      d.run('DELETE FROM receipt_allocations WHERE receipt_id=?', r.id);
      d.run("UPDATE receipts SET status='BOUNCED', allocated_paisa=0, advance_paisa=0 WHERE id=?", r.id);
      ledgerAdd({
        date: opts.date || U.today(),
        ref_type: 'CHEQUE_BOUNCED',
        ref_id: r.id,
        note: `Cheque bounce ${r.cheque_no}`,
        user_id: user.id,
        entries: [
          { party_type: 'CUSTOMER', party_id: r.customer_id, debit_paisa: amount },
          { party_type: 'CHEQUE', party_id: 0, credit_paisa: amount },
        ],
      });
      if (U.int(opts.charges_paisa) > 0) {
        createExpense(user, {
          date: opts.date || U.today(),
          head_id: opts.head_id || null,
          amount_paisa: U.int(opts.charges_paisa),
          method: 'BANK',
          payee: opts.bank_name || r.bank_name || 'Bank',
          note: 'Cheque bounce charges ' + (r.cheque_no || ''),
        });
      }
    }
    d.run('UPDATE receipts SET cheque_status=?, cheque_status_at=? WHERE id=?', st, U.nowIso(), r.id);
    audit(user, 'CHEQUE_' + st, 'receipt', r.id, { cheque_no: r.cheque_no, amount });
    return d.get('SELECT * FROM receipts WHERE id=?', r.id);
  });
}

/* ================================================================== PAYMENTS */
function allocateToPurchases(payment) {
  const d = db();
  let left = U.int(payment.amount_paisa);
  const out = [];
  const purchases = d.all(
    `SELECT * FROM purchases WHERE supplier_id=? AND status IN ('RECEIVED','PARTIAL') AND total_paisa > paid_paisa ORDER BY date ASC, id ASC`,
    payment.supplier_id
  );
  for (const p of purchases) {
    if (left <= 0) break;
    const due = U.int(p.total_paisa) - U.int(p.paid_paisa);
    const take = Math.min(left, due);
    d.insert('payment_allocations', { payment_id: payment.id, purchase_id: p.id, amount_paisa: take, at: U.nowIso() });
    const paid = U.int(p.paid_paisa) + take;
    d.run(
      'UPDATE purchases SET paid_paisa=?, balance_paisa=?, status=? WHERE id=?',
      paid,
      U.int(p.total_paisa) - paid,
      paid >= U.int(p.total_paisa) ? 'PAID' : 'PARTIAL',
      p.id
    );
    out.push({ purchase_id: p.id, invoice_no: p.invoice_no, amount_paisa: take });
    left -= take;
  }
  return { allocations: out, unallocated: left };
}

function createPayment(user, payload) {
  const d = db();
  const date = payload.date || U.today();
  const supplier = d.get('SELECT * FROM suppliers WHERE id=?', U.int(payload.supplier_id));
  if (!supplier) throw new Error('Supplier select karein');
  const amount = U.int(payload.amount_paisa);
  if (amount <= 0) throw new Error('Amount 0 se ziada hona chahiye');
  let method = String(payload.method || 'CASH').toUpperCase();
  if (method === 'ONLINE') method = 'BANK';

  return d.tx(() => {
    const payment_no = num.payment();
    const pid = d.insert('payments', {
      payment_no,
      date,
      supplier_id: supplier.id,
      method,
      amount_paisa: amount,
      allocated_paisa: 0,
      cheque_no: payload.cheque_no || null,
      cheque_date: payload.cheque_date || null,
      bank_name: payload.bank_name || null,
      cheque_status: method === 'CHEQUE' ? 'ISSUED' : null,
      status: 'POSTED',
      notes: payload.notes || null,
      user_id: user.id,
      created_at: U.nowIso(),
    });
    const creditAccount = method === 'CHEQUE' ? 'BANK' : method === 'BANK' ? 'BANK' : 'CASH';
    ledgerAdd({
      date,
      ref_type: 'PAYMENT',
      ref_id: pid,
      note: payment_no + ' ' + supplier.name,
      user_id: user.id,
      entries: [
        { party_type: 'SUPPLIER', party_id: supplier.id, debit_paisa: amount },
        { party_type: creditAccount, party_id: 0, credit_paisa: amount },
      ],
    });
    let allocated = 0;
    if (U.int(payload.purchase_id)) {
      const p = d.get('SELECT * FROM purchases WHERE id=?', U.int(payload.purchase_id));
      if (p && p.supplier_id === supplier.id) {
        const due = U.int(p.total_paisa) - U.int(p.paid_paisa);
        const take = Math.min(amount, Math.max(0, due));
        if (take > 0) {
          d.insert('payment_allocations', { payment_id: pid, purchase_id: p.id, amount_paisa: take, at: U.nowIso() });
          const paid = U.int(p.paid_paisa) + take;
          d.run('UPDATE purchases SET paid_paisa=?, balance_paisa=?, status=? WHERE id=?', paid, U.int(p.total_paisa) - paid, paid >= U.int(p.total_paisa) ? 'PAID' : 'PARTIAL', p.id);
          allocated = take;
        }
      }
    }
    if (amount - allocated > 0) {
      const fifo = allocateToPurchases({ id: pid, supplier_id: supplier.id, amount_paisa: amount - allocated });
      allocated += fifo.allocations.reduce((s, a) => s + a.amount_paisa, 0);
    }
    d.run('UPDATE payments SET allocated_paisa=? WHERE id=?', allocated, pid);
    if (!payload._inner) audit(user, 'CREATE', 'payment', pid, { payment_no, amount, supplier: supplier.name });
    return d.get('SELECT * FROM payments WHERE id=?', pid);
  });
}

/* ================================================================== EXPENSES / CASH */
function createExpense(user, payload) {
  const d = db();
  const date = payload.date || U.today();
  const amount = U.int(payload.amount_paisa);
  if (amount <= 0) throw new Error('Amount 0 se ziada hona chahiye');
  const method = String(payload.method || 'CASH').toUpperCase();
  return d.tx(() => {
    const id = d.insert('expenses', {
      date,
      head_id: U.int(payload.head_id) || null,
      amount_paisa: amount,
      method,
      warehouse_id: U.int(payload.warehouse_id) || null,
      salesman_id: U.int(payload.salesman_id) || null,
      vehicle_no: payload.vehicle_no || null,
      payee: payload.payee || null,
      note: payload.note || null,
      user_id: user.id,
      created_at: U.nowIso(),
    });
    ledgerAdd({
      date,
      ref_type: 'EXPENSE',
      ref_id: id,
      note: (payload.note || 'Expense') + (payload.payee ? ' — ' + payload.payee : ''),
      user_id: user.id,
      entries: [
        { party_type: 'EXPENSE', party_id: U.int(payload.head_id), debit_paisa: amount },
        { party_type: method === 'BANK' ? 'BANK' : 'CASH', party_id: 0, credit_paisa: amount },
      ],
    });
    audit(user, 'CREATE', 'expense', id, { amount, head_id: payload.head_id });
    return d.get('SELECT * FROM expenses WHERE id=?', id);
  });
}

function cashPosition(date) {
  const d = db();
  const opening = balanceBefore('CASH', date);
  const cashIn = U.int(
    d.val("SELECT COALESCE(SUM(amount_paisa),0) FROM receipts WHERE date=? AND method='CASH' AND status='POSTED'", date)
  );
  const cashOutReceipts = 0;
  const cashExpenses = U.int(d.val("SELECT COALESCE(SUM(amount_paisa),0) FROM expenses WHERE date=? AND method='CASH'", date));
  const cashPayments = U.int(d.val("SELECT COALESCE(SUM(amount_paisa),0) FROM payments WHERE date=? AND method='CASH' AND status='POSTED'", date));
  const cashSales = U.int(
    d.val("SELECT COALESCE(SUM(amount_paisa),0) FROM receipts WHERE date=? AND method='CASH' AND auto_created=1 AND status='POSTED'", date)
  );
  const cashRefunds = U.int(
    d.val("SELECT COALESCE(SUM(total_paisa),0) FROM sales_returns WHERE date=? AND kind='GOOD'", date)
  );
  return {
    date,
    opening_paisa: opening,
    cash_in_paisa: cashIn,
    cash_in_sales_paisa: cashSales,
    cash_in_recovery_paisa: cashIn - cashSales,
    cash_out_expenses_paisa: cashExpenses,
    cash_out_payments_paisa: cashPayments,
    cash_out_paisa: cashExpenses + cashPayments + cashOutReceipts,
    expected_paisa: opening + cashIn - cashExpenses - cashPayments,
    cash_in_hand_paisa: accountBalance('CASH'),
    bank_paisa: accountBalance('BANK'),
    cheques_in_hand_paisa: accountBalance('CHEQUE'),
    returns_today_paisa: cashRefunds,
  };
}

function createCashClosing(user, payload) {
  const d = db();
  const date = payload.date || U.today();
  const pos = cashPosition(date);
  const counted = U.int(payload.counted_paisa);
  const variance = counted - pos.expected_paisa;
  const id = d.insert('cash_closings', {
    date,
    user_id: user.id,
    opening_paisa: pos.opening_paisa,
    cash_in_paisa: pos.cash_in_paisa,
    cash_out_paisa: pos.cash_out_paisa,
    expected_paisa: pos.expected_paisa,
    counted_paisa: counted,
    variance_paisa: variance,
    note: payload.note || null,
    created_at: U.nowIso(),
  });
  if (variance !== 0) {
    // record the difference as cash adjustment so books stay tallied
    ledgerAdd({
      date,
      ref_type: 'CASH_DIFF',
      ref_id: id,
      note: variance > 0 ? 'Cash closing surplus' : 'Cash closing shortage',
      user_id: user.id,
      entries:
        variance > 0
          ? [
              { party_type: 'CASH', party_id: 0, debit_paisa: variance },
              { party_type: 'STOCK_LOSS', party_id: 0, credit_paisa: variance },
            ]
          : [
              { party_type: 'STOCK_LOSS', party_id: 0, debit_paisa: -variance },
              { party_type: 'CASH', party_id: 0, credit_paisa: -variance },
            ],
    });
  }
  audit(user, 'CREATE', 'cash_closing', id, { date, counted, expected: pos.expected_paisa, variance });
  return d.get('SELECT * FROM cash_closings WHERE id=?', id);
}

/* ================================================================== ORDERS */
function createOrder(user, payload) {
  const d = db();
  const date = payload.date || U.today();
  const customer = d.get('SELECT * FROM customers WHERE id=?', U.int(payload.customer_id));
  if (!customer) throw new Error('Customer select karein');
  const lines = (payload.lines || []).filter((l) => U.int(l.product_id));
  if (!lines.length) throw new Error('Kam az kam ek item add karein');
  return d.tx(() => {
    const order_no = num.order();
    const id = d.insert('orders', {
      order_no,
      date,
      customer_id: customer.id,
      salesman_id: U.int(payload.salesman_id) || null,
      route_id: U.int(payload.route_id) || customer.route_id || null,
      status: 'BOOKED',
      subtotal_paisa: 0,
      discount_paisa: U.int(payload.discount_paisa),
      total_paisa: 0,
      notes: payload.notes || null,
      user_id: user.id,
      created_at: U.nowIso(),
    });
    let subtotal = 0;
    for (const raw of lines) {
      const product = d.get('SELECT * FROM products WHERE id=?', U.int(raw.product_id));
      if (!product) throw new Error('Product nahi mila');
      const cartonSize = U.int(product.carton_size, 1) || 1;
      const qty = U.int(raw.qty) || U.int(raw.cartons) * cartonSize + U.int(raw.loose);
      if (qty <= 0) continue;
      const price = U.int(raw.unit_price_paisa) || priceFor(product, customer);
      const lineTotal = qty * price;
      d.insert('order_lines', {
        order_id: id,
        product_id: product.id,
        qty,
        cartons: U.int(raw.cartons) || Math.floor(qty / cartonSize),
        loose: U.int(raw.loose) || qty % cartonSize,
        unit_price_paisa: price,
        discount_pct: U.num(raw.discount_pct, 0),
        line_total_paisa: lineTotal,
      });
      subtotal += lineTotal;
    }
    d.run('UPDATE orders SET subtotal_paisa=?, total_paisa=? WHERE id=?', subtotal, subtotal - U.int(payload.discount_paisa), id);
    audit(user, 'CREATE', 'order', id, { order_no, customer: customer.name });
    return getOrder(id);
  });
}

function getOrder(id) {
  const d = db();
  const o = d.get(
    `SELECT o.*, c.name AS customer_name, c.phone AS customer_phone, s.name AS salesman_name, r.name AS route_name
       FROM orders o LEFT JOIN customers c ON c.id=o.customer_id
       LEFT JOIN salesmen s ON s.id=o.salesman_id LEFT JOIN routes r ON r.id=o.route_id WHERE o.id=?`,
    U.int(id)
  );
  if (!o) throw new Error('Order nahi mila');
  o.lines = d.all(
    'SELECT ol.*, p.name AS product_name, p.carton_size FROM order_lines ol LEFT JOIN products p ON p.id=ol.product_id WHERE ol.order_id=? ORDER BY ol.id',
    U.int(id)
  );
  return o;
}

function convertOrderToInvoice(user, orderId, opts = {}) {
  const d = db();
  const o = getOrder(orderId);
  if (o.status !== 'BOOKED') throw new Error('Yeh order pehle ' + o.status + ' ho chuka hai');
  const customer = d.get('SELECT * FROM customers WHERE id=?', o.customer_id);
  const invoice = createInvoice(user, {
    date: opts.date || U.today(),
    customer_id: o.customer_id,
    sale_type: opts.sale_type || 'CREDIT',
    salesman_id: o.salesman_id,
    route_id: o.route_id,
    warehouse_id: opts.warehouse_id || U.int(S('default_warehouse_id')),
    order_id: o.id,
    discount_paisa: U.int(o.discount_paisa),
    lines: o.lines.map((l) => ({ product_id: l.product_id, qty: l.qty, unit_price_paisa: l.unit_price_paisa, discount_pct: l.discount_pct })),
  });
  audit(user, 'CONVERT', 'order', o.id, { order_no: o.order_no, invoice_no: invoice.invoice_no });
  return invoice;
}

function cancelOrder(user, orderId, reason) {
  const o = getOrder(orderId);
  if (o.status !== 'BOOKED') throw new Error('Sirf BOOKED order cancel ho sakta hai');
  db().run("UPDATE orders SET status='CANCELLED', notes=IFNULL(notes,'') || ' | Cancel: ' || ? WHERE id=?", String(reason || ''), o.id);
  audit(user, 'CANCEL', 'order', o.id, { order_no: o.order_no, reason });
  return getOrder(o.id);
}

/* ================================================================== VAN SALES */
function createVanLoad(user, payload) {
  const d = db();
  const date = payload.date || U.today();
  const van = d.get('SELECT * FROM warehouses WHERE id=?', U.int(payload.van_warehouse_id));
  if (!van) throw new Error('Van (mobile godown) select karein');
  const source_id = U.int(payload.source_warehouse_id) || U.int(S('default_warehouse_id'));
  const lines = (payload.lines || []).filter((l) => U.int(l.product_id));
  if (!lines.length) throw new Error('Loading sheet khali hai');

  return d.tx(() => {
    const load_no = num.van();
    const loadId = d.insert('van_loads', {
      load_no,
      date,
      vehicle_no: payload.vehicle_no || null,
      salesman_id: U.int(payload.salesman_id) || null,
      route_id: U.int(payload.route_id) || null,
      van_warehouse_id: van.id,
      source_warehouse_id: source_id,
      status: 'OPEN',
      opened_at: U.nowIso(),
      notes: payload.notes || null,
      user_id: user.id,
    });
    let loadedQty = 0;
    let loadedValue = 0;
    for (const raw of lines) {
      const product = d.get('SELECT * FROM products WHERE id=?', U.int(raw.product_id));
      if (!product) throw new Error('Product nahi mila');
      const cartonSize = U.int(product.carton_size, 1) || 1;
      const qty = U.int(raw.qty) || U.int(raw.cartons) * cartonSize + U.int(raw.loose);
      if (qty <= 0) continue;
      const allocs = moveStock({
        product_id: product.id,
        from_warehouse_id: source_id,
        to_warehouse_id: van.id,
        qty,
        ref_type: 'VAN_LOAD',
        ref_id: loadId,
        note: `${load_no} van loading`,
        user_id: user.id,
      });
      const cost = allocs.length ? allocs[0].cost_paisa : U.int(product.cost_paisa);
      d.insert('van_load_lines', {
        load_id: loadId,
        product_id: product.id,
        batch_id: allocs.length ? allocs[0].batch_id : null,
        qty_loaded: qty,
        qty_sold: 0,
        qty_returned: 0,
        qty_short: 0,
        unit_cost_paisa: cost,
      });
      loadedQty += qty;
      loadedValue += qty * cost;
    }
    d.run('UPDATE van_loads SET loaded_qty=?, loaded_value_paisa=? WHERE id=?', loadedQty, loadedValue, loadId);
    audit(user, 'CREATE', 'van_load', loadId, { load_no, vehicle: payload.vehicle_no, loadedQty });
    return getVanLoad(loadId);
  });
}

function getVanLoad(id) {
  const d = db();
  const v = d.get(
    `SELECT v.*, s.name AS salesman_name, r.name AS route_name, w.name AS van_name, sw.name AS source_name
       FROM van_loads v LEFT JOIN salesmen s ON s.id=v.salesman_id LEFT JOIN routes r ON r.id=v.route_id
       LEFT JOIN warehouses w ON w.id=v.van_warehouse_id LEFT JOIN warehouses sw ON sw.id=v.source_warehouse_id
      WHERE v.id=?`,
    U.int(id)
  );
  if (!v) throw new Error('Van load nahi mila');
  v.lines = d.all(
    `SELECT vl.*, p.name AS product_name, p.carton_size, p.wholesale_paisa,
            (SELECT COALESCE(SUM(sl.qty),0) FROM sales_lines sl JOIN sales_invoices si ON si.id=sl.invoice_id
              WHERE si.status<>'VOID' AND si.warehouse_id=? AND si.date>=? AND sl.product_id=vl.product_id) AS qty_sold_now
       FROM van_load_lines vl LEFT JOIN products p ON p.id=vl.product_id
      WHERE vl.load_id=? ORDER BY vl.id`,
    v.van_warehouse_id,
    v.date,
    U.int(id)
  );
  return v;
}

function settleVanLoad(user, id, payload = {}) {
  const d = db();
  const v = getVanLoad(U.int(id));
  if (v.status === 'SETTLED') throw new Error('Yeh van load pehle settle ho chuka hai');

  return d.tx(() => {
    const inputLines = payload.lines || [];
    let returnedQty = 0;
    let returnedValue = 0;
    let shortQty = 0;
    let shortValue = 0;
    let soldQty = 0;
    let soldValue = 0;

    for (const line of v.lines) {
      const inp = inputLines.find((l) => U.int(l.line_id) === line.id) || {};
      // how much was actually sold from this van (same product, same day, non-void invoices)
      const sold = U.int(
        d.val(
          `SELECT COALESCE(SUM(sl.qty),0) FROM sales_lines sl JOIN sales_invoices si ON si.id=sl.invoice_id
            WHERE si.status<>'VOID' AND si.warehouse_id=? AND si.date>=? AND sl.product_id=?`,
          v.van_warehouse_id,
          v.date,
          line.product_id
        )
      );
      const expectedBack = Math.max(0, U.int(line.qty_loaded) - sold);
      const returned = inp.qty_returned !== undefined ? U.int(inp.qty_returned) : expectedBack;
      const short = Math.max(0, expectedBack - returned);
      const toScrap = String(inp.return_to || 'MAIN').toUpperCase() === 'SCRAP';
      const targetWh = toScrap ? U.int(S('default_scrap_warehouse_id')) : v.source_warehouse_id;

      if (returned > 0) {
        moveStock({
          product_id: line.product_id,
          from_warehouse_id: v.van_warehouse_id,
          to_warehouse_id: targetWh,
          qty: returned,
          ref_type: 'VAN_RETURN',
          ref_id: v.id,
          note: `${v.load_no} van return${toScrap ? ' (damaged)' : ''}`,
          user_id: user.id,
        });
      }
      if (short > 0) {
        consumeFEFO({
          product_id: line.product_id,
          warehouse_id: v.van_warehouse_id,
          qty: short,
          ref_type: 'VAN_SHORT',
          ref_id: v.id,
          note: `${v.load_no} van shortage`,
          user_id: user.id,
        });
        const shortVal = short * U.int(line.unit_cost_paisa);
        shortValue += shortVal;
        ledgerAdd({
          date: v.date,
          ref_type: 'VAN_SHORT',
          ref_id: v.id,
          note: `${v.load_no} short/leak (${line.product_name})`,
          user_id: user.id,
          entries: [
            { party_type: 'STOCK_LOSS', party_id: 0, debit_paisa: shortVal },
            { party_type: 'INVENTORY', party_id: 0, credit_paisa: shortVal },
          ],
        });
      }
      d.run('UPDATE van_load_lines SET qty_sold=?, qty_returned=?, qty_short=? WHERE id=?', sold, returned, short, line.id);
      returnedQty += returned;
      returnedValue += returned * U.int(line.unit_cost_paisa);
      shortQty += short;
      soldQty += sold;
      soldValue += sold * U.int(line.unit_price_paisa || line.wholesale_paisa || 0);
    }

    d.run(
      `UPDATE van_loads SET status='SETTLED', sold_qty=?, returned_qty=?, short_qty=?, sold_value_paisa=?, returned_value_paisa=?, shortage_value_paisa=?, settled_at=?, notes=IFNULL(notes,'') || IFNULL(?,'') WHERE id=?`,
      soldQty,
      returnedQty,
      shortQty,
      soldValue,
      returnedValue,
      shortValue,
      U.nowIso(),
      payload.notes ? ' | ' + payload.notes : '',
      v.id
    );
    audit(user, 'SETTLE', 'van_load', v.id, { load_no: v.load_no, soldQty, returnedQty, shortQty });
    return getVanLoad(v.id);
  });
}

/* ================================================================== TRANSFERS */
function createTransfer(user, payload) {
  const d = db();
  const from = U.int(payload.from_warehouse_id);
  const to = U.int(payload.to_warehouse_id);
  if (!from || !to || from === to) throw new Error('From aur To warehouse theek select karein');
  const lines = (payload.lines || []).filter((l) => U.int(l.product_id));
  if (!lines.length) throw new Error('Kam az kam ek item add karein');
  return d.tx(() => {
    const stn_no = num.transfer();
    const id = d.insert('transfers', {
      stn_no,
      date: payload.date || U.today(),
      from_warehouse_id: from,
      to_warehouse_id: to,
      status: 'DISPATCHED',
      notes: payload.notes || null,
      user_id: user.id,
      created_at: U.nowIso(),
    });
    for (const raw of lines) {
      const product = d.get('SELECT * FROM products WHERE id=?', U.int(raw.product_id));
      if (!product) throw new Error('Product nahi mila');
      const cartonSize = U.int(product.carton_size, 1) || 1;
      const qty = U.int(raw.qty) || U.int(raw.cartons) * cartonSize + U.int(raw.loose);
      if (qty <= 0) continue;
      const allocs = moveStock({
        product_id: product.id,
        from_warehouse_id: from,
        to_warehouse_id: to,
        qty,
        ref_type: 'STN',
        ref_id: id,
        note: `${stn_no} stock transfer`,
        user_id: user.id,
      });
      d.insert('transfer_lines', {
        transfer_id: id,
        product_id: product.id,
        batch_id: allocs.length ? allocs[0].batch_id : null,
        qty_sent: qty,
        qty_received: 0,
      });
    }
    audit(user, 'CREATE', 'transfer', id, { stn_no });
    return getTransfer(id);
  });
}

function getTransfer(id) {
  const d = db();
  const t = d.get(
    `SELECT t.*, fw.name AS from_name, tw.name AS to_name FROM transfers t
      LEFT JOIN warehouses fw ON fw.id=t.from_warehouse_id LEFT JOIN warehouses tw ON tw.id=t.to_warehouse_id WHERE t.id=?`,
    U.int(id)
  );
  if (!t) throw new Error('Transfer nahi mila');
  t.lines = d.all(
    'SELECT tl.*, p.name AS product_name, p.carton_size FROM transfer_lines tl LEFT JOIN products p ON p.id=tl.product_id WHERE tl.transfer_id=? ORDER BY tl.id',
    U.int(id)
  );
  return t;
}

function receiveTransfer(user, id, payload = {}) {
  const d = db();
  const t = getTransfer(U.int(id));
  if (t.status === 'RECEIVED') throw new Error('Yeh transfer pehle receive ho chuka hai');
  return d.tx(() => {
    const inputs = payload.lines || [];
    for (const line of t.lines) {
      const inp = inputs.find((l) => U.int(l.line_id) === line.id) || {};
      const received = inp.qty_received !== undefined ? U.int(inp.qty_received) : U.int(line.qty_sent);
      const short = U.int(line.qty_sent) - received;
      if (short > 0) {
        // shortage in transit -> loss
        const cost = U.int(d.val('SELECT cost_paisa FROM products WHERE id=?', line.product_id));
        consumeFEFO({
          product_id: line.product_id,
          warehouse_id: t.to_warehouse_id,
          qty: short,
          ref_type: 'STN_SHORT',
          ref_id: t.id,
          note: `${t.stn_no} transit shortage`,
          user_id: user.id,
        });
        ledgerAdd({
          date: U.today(),
          ref_type: 'STN_SHORT',
          ref_id: t.id,
          note: `${t.stn_no} shortage (${line.product_name})`,
          user_id: user.id,
          entries: [
            { party_type: 'STOCK_LOSS', party_id: 0, debit_paisa: short * cost },
            { party_type: 'INVENTORY', party_id: 0, credit_paisa: short * cost },
          ],
        });
      }
      d.run('UPDATE transfer_lines SET qty_received=? WHERE id=?', received, line.id);
    }
    d.run("UPDATE transfers SET status='RECEIVED', received_at=? WHERE id=?", U.nowIso(), t.id);
    audit(user, 'RECEIVE', 'transfer', t.id, { stn_no: t.stn_no });
    return getTransfer(t.id);
  });
}

/* ================================================================== SCHEMES / CLAIMS / COMMISSIONS */
function settleClaim(user, id, payload = {}) {
  const d = db();
  const c = d.get('SELECT * FROM claims WHERE id=?', U.int(id));
  if (!c) throw new Error('Claim nahi mila');
  const status = String(payload.status || 'SUBMITTED').toUpperCase();
  d.run('UPDATE claims SET status=?, submitted_at=IFNULL(submitted_at,?), settled_at=? , note=IFNULL(?, note) WHERE id=?', status, U.nowIso(), status === 'SETTLED' ? U.nowIso() : null, payload.note || null, c.id);
  audit(user, 'CLAIM_' + status, 'claim', c.id, { value: c.value_paisa });
  return d.get('SELECT * FROM claims WHERE id=?', c.id);
}

function commissionBase(from, to, salesman_id) {
  const d = db();
  const rows = d.all(
    `SELECT COALESCE(SUM(r.amount_paisa),0) AS amount, COUNT(*) AS cnt
       FROM receipts r
      WHERE r.status='POSTED' AND r.date BETWEEN ? AND ?
        AND (r.method <> 'CHEQUE' OR r.cheque_status = 'CLEARED')
        ${salesman_id ? 'AND r.salesman_id = ?' : ''}`,
    ...(salesman_id ? [from, to, U.int(salesman_id)] : [from, to])
  );
  const row = rows[0] || { amount: 0, cnt: 0 };
  return { base: U.int(row.amount), count: U.int(row.cnt) };
}

function generateCommissions(user, payload = {}) {
  const d = db();
  const from = payload.from || U.monthStart(U.monthOf(U.today()));
  const to = payload.to || U.today();
  const salesmen = payload.salesman_id
    ? d.all('SELECT * FROM salesmen WHERE id=?', U.int(payload.salesman_id))
    : d.all('SELECT * FROM salesmen WHERE active=1');
  const created = [];
  for (const s of salesmen) {
    const { base, count } = commissionBase(from, to, s.id);
    if (base <= 0) continue;
    const pct = U.num(s.commission_pct, 0);
    const amount = Math.round((base * pct) / 100);
    d.run("DELETE FROM commissions WHERE salesman_id=? AND period_from=? AND period_to=? AND status='PENDING'", s.id, from, to);
    const id = d.insert('commissions', {
      salesman_id: s.id,
      period_from: from,
      period_to: to,
      base_paisa: base,
      pct,
      amount_paisa: amount,
      status: 'PENDING',
      note: `${count} recoveries`,
      created_at: U.nowIso(),
    });
    created.push(d.get('SELECT * FROM commissions WHERE id=?', id));
  }
  audit(user, 'GENERATE', 'commission', null, { from, to, count: created.length });
  return created;
}

function payCommission(user, id, payload = {}) {
  const d = db();
  const c = d.get('SELECT * FROM commissions WHERE id=?', U.int(id));
  if (!c) throw new Error('Commission record nahi mila');
  if (c.status === 'PAID') throw new Error('Yeh commission pehle paid hai');
  let head = d.get('SELECT id FROM expense_heads WHERE name LIKE ?', 'Salesman Commission%');
  if (!head) {
    const hid = d.insert('expense_heads', { name: 'Salesman Commission', is_cogs: 0, active: 1 });
    head = { id: hid };
  }
  const method = String(payload.method || 'CASH').toUpperCase();
  const exp = createExpense(user, {
    date: payload.date || U.today(),
    head_id: head.id,
    amount_paisa: U.int(c.amount_paisa),
    method,
    salesman_id: c.salesman_id,
    note: `Commission ${c.period_from} se ${c.period_to}`,
  });
  d.run("UPDATE commissions SET status='PAID', paid_at=? WHERE id=?", U.nowIso(), c.id);
  audit(user, 'PAY', 'commission', c.id, { amount: c.amount_paisa, expense_id: exp.id });
  return d.get('SELECT * FROM commissions WHERE id=?', c.id);
}

/* ================================================================== VISITS (geo fence) */
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

function checkIn(user, payload) {
  const d = db();
  const customer = d.get('SELECT * FROM customers WHERE id=?', U.int(payload.customer_id));
  if (!customer) throw new Error('Customer nahi mila');
  const lat = payload.lat === undefined || payload.lat === null ? null : Number(payload.lat);
  const lng = payload.lng === undefined || payload.lng === null ? null : Number(payload.lng);
  let distance = null;
  if (lat !== null && lng !== null && customer.lat && customer.lng) {
    distance = haversine(Number(customer.lat), Number(customer.lng), lat, lng);
  }
  const radius = Sn('geo_fence_radius_m', 150);
  const enforce = Sb('enable_geo_fence', true);
  const outside = distance !== null && enforce && distance > radius && !payload.force;
  if (outside) {
    const err = new Error(
      `Aap dukan se ${distance} meter door hain (allowed ${radius} m). Check-in band hai — qareeb pohnch kar try karein.`
    );
    err.code = 'GEO_FENCE';
    err.distance_m = distance;
    throw err;
  }
  const id = d.insert('visits', {
    at: U.nowIso(),
    customer_id: customer.id,
    salesman_id: U.int(payload.salesman_id) || user.salesman_id || null,
    user_id: user.id,
    lat,
    lng,
    distance_m: distance,
    kind: String(payload.kind || 'CHECKIN').toUpperCase(),
    notes: payload.notes || null,
  });
  audit(user, 'CHECKIN', 'visit', id, { customer: customer.name, distance });
  return { ...d.get('SELECT * FROM visits WHERE id=?', id), customer_name: customer.name, radius_m: radius };
}

/* ================================================================== DASHBOARD */
function dashboard(date) {
  const d = db();
  const day = date || U.today();
  const month = U.monthOf(day);
  const salesRow = d.get(
    `SELECT COUNT(*) AS invoices, COALESCE(SUM(total_paisa),0) AS total, COALESCE(SUM(gross_profit_paisa),0) AS gp,
            COALESCE(SUM(discount_paisa),0) AS disc, COALESCE(SUM(scheme_discount_paisa),0) AS scheme
       FROM sales_invoices WHERE date=? AND status<>'VOID'`,
    day
  );
  const cashSales = d.get(
    "SELECT COALESCE(SUM(total_paisa),0) AS total FROM sales_invoices WHERE date=? AND status<>'VOID' AND sale_type='CASH'",
    day
  );
  const returnsRow = d.get(
    'SELECT COUNT(*) AS cnt, COALESCE(SUM(total_paisa),0) AS total FROM sales_returns WHERE date=?',
    day
  );
  const expRow = d.get('SELECT COALESCE(SUM(amount_paisa),0) AS total FROM expenses WHERE date=?', day);
  const purchRow = d.get(
    'SELECT COUNT(*) AS cnt, COALESCE(SUM(total_paisa),0) AS total FROM purchases WHERE date=?',
    day
  );
  const recovery = d.get(
    "SELECT COALESCE(SUM(amount_paisa),0) AS total FROM receipts WHERE date=? AND status='POSTED'",
    day
  );
  const monthSales = d.get(
    "SELECT COALESCE(SUM(total_paisa),0) AS total, COALESCE(SUM(gross_profit_paisa),0) AS gp FROM sales_invoices WHERE date BETWEEN ? AND ? AND status<>'VOID'",
    U.monthStart(month),
    U.monthEnd(month)
  );
  const pos = cashPosition(day);
  const receivables = U.int(d.val('SELECT COALESCE(SUM(balance_paisa),0) FROM customers WHERE balance_paisa > 0'));
  const advances = U.int(d.val('SELECT COALESCE(SUM(-balance_paisa),0) FROM customers WHERE balance_paisa < 0'));
  const payables = U.int(d.val('SELECT COALESCE(SUM(balance_paisa),0) FROM suppliers WHERE balance_paisa > 0'));
  const stockCost = stockValueCost();
  const stockRetail = U.int(d.val('SELECT COALESCE(SUM(b.qty_remaining * p.retail_paisa),0) FROM batches b JOIN products p ON p.id=b.product_id'));
  const expenseMonth = U.int(
    d.val('SELECT COALESCE(SUM(amount_paisa),0) FROM expenses WHERE date BETWEEN ? AND ?', U.monthStart(month), U.monthEnd(month))
  );

  const trend = d.all(
    `SELECT date, COALESCE(SUM(total_paisa),0) AS total, COALESCE(SUM(gross_profit_paisa),0) AS gp
       FROM sales_invoices WHERE date BETWEEN ? AND ? AND status<>'VOID' GROUP BY date ORDER BY date`,
    U.dateAdd(day, -13),
    day
  );

  const topProducts = d.all(
    `SELECT p.name, SUM(sl.qty) AS qty, SUM(sl.line_total_paisa) AS total, SUM(sl.qty*sl.cost_paisa) AS cost
       FROM sales_lines sl JOIN sales_invoices si ON si.id=sl.invoice_id JOIN products p ON p.id=sl.product_id
      WHERE si.date BETWEEN ? AND ? AND si.status<>'VOID' AND sl.is_free=0
      GROUP BY p.id ORDER BY total DESC LIMIT 8`,
    U.monthStart(month),
    day
  );

  const topCustomers = d.all(
    `SELECT c.name, COUNT(*) AS invoices, SUM(si.total_paisa) AS total, COALESCE(SUM(si.total_paisa - si.paid_paisa),0) AS due
       FROM sales_invoices si JOIN customers c ON c.id=si.customer_id
      WHERE si.date BETWEEN ? AND ? AND si.status<>'VOID' GROUP BY c.id ORDER BY total DESC LIMIT 8`,
    U.monthStart(month),
    day
  );

  const salesmanPerf = d.all(
    `SELECT s.id, s.name, COUNT(DISTINCT si.id) AS invoices, COALESCE(SUM(si.total_paisa),0) AS sales,
            (SELECT COALESCE(SUM(r.amount_paisa),0) FROM receipts r WHERE r.salesman_id=s.id AND r.date BETWEEN ? AND ? AND r.status='POSTED') AS recovery
       FROM salesmen s LEFT JOIN sales_invoices si ON si.salesman_id=s.id AND si.date BETWEEN ? AND ? AND si.status<>'VOID'
      WHERE s.active=1 GROUP BY s.id ORDER BY sales DESC`,
    U.monthStart(month),
    day,
    U.monthStart(month),
    day
  );

  const lowStock = d.all(
    `SELECT * FROM (
        SELECT p.id, p.name, p.reorder_level, p.carton_size,
               (SELECT COALESCE(SUM(b.qty_remaining),0) FROM batches b WHERE b.product_id=p.id) AS stock
          FROM products p WHERE p.active=1 AND p.reorder_level > 0)
      WHERE stock <= reorder_level ORDER BY stock ASC LIMIT 15`
  );

  const nearExpiry = d.all(
    `SELECT b.id, p.name AS product_name, b.batch_no, b.expiry_date, b.qty_remaining, b.cost_paisa,
            CAST(julianday(b.expiry_date) - julianday(?) AS INTEGER) AS days_left
       FROM batches b JOIN products p ON p.id=b.product_id
      WHERE b.qty_remaining > 0 AND b.expiry_date IS NOT NULL AND b.expiry_date <> ''
        AND julianday(b.expiry_date) - julianday(?) <= 90
      ORDER BY b.expiry_date ASC LIMIT 15`,
    day,
    day
  );

  const aging = [0, 30, 60, 90].map((bucket, i) => {
    const next = [30, 60, 90, 100000][i];
    const row = d.get(
      `SELECT COUNT(*) AS cnt, COALESCE(SUM(total_paisa - paid_paisa),0) AS amount
         FROM sales_invoices
        WHERE status IN ('UNPAID','PARTIAL') AND total_paisa > paid_paisa
          AND CAST(julianday(?) - julianday(date) AS INTEGER) >= ? AND CAST(julianday(?) - julianday(date) AS INTEGER) < ?`,
      day,
      bucket,
      day,
      next
    );
    return { bucket: i === 3 ? '90+' : `${bucket}-${next}`, days: bucket, count: U.int(row.cnt), amount_paisa: U.int(row.amount) };
  });

  return {
    date: day,
    month,
    sales: { count: U.int(salesRow.invoices), total_paisa: U.int(salesRow.total), gross_profit_paisa: U.int(salesRow.gp), discount_paisa: U.int(salesRow.disc), scheme_paisa: U.int(salesRow.scheme), cash_sales_paisa: U.int(cashSales.total) },
    returns: { count: U.int(returnsRow.cnt), total_paisa: U.int(returnsRow.total) },
    expenses_paisa: U.int(expRow.total),
    net_profit_paisa: U.int(salesRow.gp) - U.int(expRow.total),
    purchases: { count: U.int(purchRow.cnt), total_paisa: U.int(purchRow.total) },
    recovery_paisa: U.int(recovery.total),
    month: {
      sales_paisa: U.int(monthSales.total),
      gross_profit_paisa: U.int(monthSales.gp),
      expenses_paisa: expenseMonth,
      net_profit_paisa: U.int(monthSales.gp) - expenseMonth,
    },
    cash: pos,
    receivables_paisa: receivables,
    advances_paisa: advances,
    payables_paisa: payables,
    stock_value_cost_paisa: stockCost,
    stock_value_retail_paisa: stockRetail,
    trend,
    top_products: topProducts.map((r) => ({ ...r, profit: U.int(r.total) - U.int(r.cost) })),
    top_customers: topCustomers,
    salesman_performance: salesmanPerf,
    low_stock: lowStock,
    near_expiry: nearExpiry,
    aging,
    open_van_loads: d.all("SELECT id, load_no, date, vehicle_no FROM van_loads WHERE status='OPEN' ORDER BY id DESC LIMIT 5"),
    pending_claims: U.int(d.val("SELECT COUNT(*) FROM claims WHERE status='PENDING'")),
    pending_claims_value: U.int(d.val("SELECT COALESCE(SUM(value_paisa),0) FROM claims WHERE status='PENDING'")),
    cheques_pending: U.int(d.val("SELECT COUNT(*) FROM receipts WHERE method='CHEQUE' AND status='POSTED' AND cheque_status IN ('RECEIVED','IN_CLEARING')")),
    cheques_pending_value: U.int(d.val("SELECT COALESCE(SUM(amount_paisa),0) FROM receipts WHERE method='CHEQUE' AND status='POSTED' AND cheque_status IN ('RECEIVED','IN_CLEARING')")),
    next_cheque_due: d.get(
      "SELECT cheque_no, cheque_date, amount_paisa, bank_name, (SELECT name FROM customers c WHERE c.id=r.customer_id) AS customer_name FROM receipts r WHERE method='CHEQUE' AND cheque_status IN ('RECEIVED','IN_CLEARING') ORDER BY cheque_date ASC LIMIT 1"
    ),
    gl: glCheck(),
  };
}

module.exports = {
  // settings
  S, Sb, Sn, settings,
  // audit
  audit,
  // numbering
  nextNumber, num,
  // ledger / GL
  ledgerAdd, customerBalance, supplierBalance, accountBalance, balanceBefore, refreshBalance, recalcAllBalances, glCheck,
  // stock
  stockQty, stockValueCost, stockMove, addStock, consumeFEFO, moveStock, stockReturnToBatch,
  // pricing / schemes / credit
  priceFor, activeSchemes, schemeForLine, applicableSchemes, creditStatus, checkCredit,
  // documents
  createInvoice, getInvoice, voidInvoice, buildLines,
  createSalesReturn,
  createPurchase, getPurchase,
  createPurchaseReturn,
  createReceipt, setChequeStatus, allocateToInvoices,
  createPayment, allocateToPurchases,
  createExpense, cashPosition, createCashClosing,
  createOrder, getOrder, convertOrderToInvoice, cancelOrder,
  createVanLoad, getVanLoad, settleVanLoad,
  createTransfer, getTransfer, receiveTransfer,
  settleClaim, generateCommissions, payCommission,
  checkIn, haversine,
  dashboard,
};
