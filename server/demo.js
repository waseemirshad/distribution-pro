'use strict';
/**
 * Distribution Pro - demo / sample data generator.
 * Everything is created through the real business services, so the generated
 * data also acts as a full end-to-end test of the system.
 */

const { db } = require('./db');
const U = require('./util');
const SVC = require('./services');
const A = require('./auth');
const { install } = require('./install');

let seedState = 987654321;
function rnd() {
  seedState = (seedState * 1103515245 + 12345) % 2147483648;
  return seedState / 2147483648;
}
function pick(arr) {
  return arr[Math.floor(rnd() * arr.length)];
}
function randInt(min, max) {
  return min + Math.floor(rnd() * (max - min + 1));
}

const COMPANIES = [
  { name: 'Bisconni (Ismail Industries)', city: 'Karachi' },
  { name: 'Tapal Tea Pvt Ltd', city: 'Karachi' },
  { name: 'Nestle Pakistan', city: 'Lahore' },
  { name: 'Unilever Pakistan', city: 'Karachi' },
  { name: 'National Foods', city: 'Karachi' },
  { name: 'Dalda Foods', city: 'Karachi' },
  { name: 'Coca Cola Pakistan', city: 'Lahore' },
];

const CATEGORIES = ['Biscuits', 'Tea', 'Beverages', 'Snacks', 'Cooking Oil & Ghee', 'Soap & Detergent', 'Confectionery', 'Spices'];

const PRODUCTS = [
  // name, company, category, carton_size, cost, wholesale, retail, shelf life days
  ['Cocomo Biscuit 24pcs', 'Bisconni (Ismail Industries)', 'Biscuits', 24, 48, 54, 60, 180],
  ['Peanut Pik Biscuit 24pcs', 'Bisconni (Ismail Industries)', 'Biscuits', 24, 40, 45, 50, 180],
  ['Zeera Biscuit Family Pack', 'Bisconni (Ismail Industries)', 'Biscuits', 12, 55, 62, 70, 180],
  ['Sooper Biscuit Family Pack', 'Bisconni (Ismail Industries)', 'Biscuits', 12, 48, 54, 60, 180],
  ['Chocolate Chip Cookies 12pcs', 'Bisconni (Ismail Industries)', 'Biscuits', 12, 60, 68, 78, 150],
  ['Tapal Danedar Tea 200g', 'Tapal Tea Pvt Ltd', 'Tea', 24, 380, 420, 460, 730],
  ['Tapal Yellow Label 480g', 'Tapal Tea Pvt Ltd', 'Tea', 12, 760, 840, 920, 730],
  ['Lipton Yellow Label 190g', 'Unilever Pakistan', 'Tea', 24, 330, 370, 410, 730],
  ['Nestle Juicy Milk 250ml', 'Nestle Pakistan', 'Beverages', 24, 55, 62, 70, 240],
  ['Coca Cola 1.5 Litre', 'Coca Cola Pakistan', 'Beverages', 6, 170, 190, 210, 240],
  ['Fanta 1.5 Litre', 'Coca Cola Pakistan', 'Beverages', 6, 170, 190, 210, 240],
  ['Rooh Afza 800ml', 'National Foods', 'Beverages', 12, 420, 460, 510, 365],
  ['Kurkure Masala 40g', 'Unilever Pakistan', 'Snacks', 30, 30, 34, 40, 180],
  ['Kolson Slanty 40g', 'National Foods', 'Snacks', 40, 15, 18, 20, 180],
  ['Dalda Cooking Oil 1 Litre', 'Dalda Foods', 'Cooking Oil & Ghee', 12, 460, 500, 550, 365],
  ['Dalda Cooking Oil 5 Litre', 'Dalda Foods', 'Cooking Oil & Ghee', 4, 2150, 2300, 2500, 365],
  ['Habib Banaspati Ghee 1kg', 'Dalda Foods', 'Cooking Oil & Ghee', 12, 430, 470, 520, 365],
  ['Surf Excel 1kg', 'Unilever Pakistan', 'Soap & Detergent', 12, 420, 460, 510, 900],
  ['Bonus Detergent 1kg', 'Unilever Pakistan', 'Soap & Detergent', 12, 300, 330, 370, 900],
  ['Lux Soap 4x Pack', 'Unilever Pakistan', 'Soap & Detergent', 12, 180, 200, 220, 900],
  ['Sunsilk Shampoo 200ml', 'Unilever Pakistan', 'Soap & Detergent', 12, 330, 365, 400, 730],
  ['Dairy Milk Chocolate 24pcs', 'Nestle Pakistan', 'Confectionery', 24, 90, 100, 110, 300],
  ['Polo Candy 30pcs', 'Nestle Pakistan', 'Confectionery', 30, 30, 34, 38, 300],
  ['Chilli Milli Jelly 24pcs', 'National Foods', 'Confectionery', 24, 40, 45, 50, 300],
  ['National Red Chilli Powder 200g', 'National Foods', 'Spices', 12, 180, 200, 220, 365],
  ['Shan Biryani Masala 60g', 'National Foods', 'Spices', 24, 90, 100, 110, 500],
  ['Shan Karahi Masala 60g', 'National Foods', 'Spices', 24, 90, 100, 110, 500],
  ['Nestle Nido 400g', 'Nestle Pakistan', 'Beverages', 12, 1150, 1250, 1350, 365],
  ['Everyday Milk Powder 400g', 'Nestle Pakistan', 'Beverages', 12, 900, 980, 1060, 365],
  ['Cornetto Ice Cream Cone', 'Unilever Pakistan', 'Confectionery', 24, 100, 110, 125, 180],
];

const SUPPLIERS = [
  ['Bisconni Karachi Distributor', 'Muhammad Farooq', '0300-1234501'],
  ['Tapal Tea Agency Karachi', 'Zahid Hussain', '0301-2345602'],
  ['Nestle Sales Center SITE', 'Adnan Sheikh', '0302-3456703'],
  ['Unilever Distributor Korangi', 'Rizwan Ali', '0303-4567804'],
  ['National Foods Agency', 'Salman Yousuf', '0304-5678905'],
  ['Coca Cola Bottler Karachi', 'Imran Khan', '0305-6789006'],
];

const ROUTES = [
  ['Sadar Bazar Route', 'Sadar', 'Monday'],
  ['Bolton Market Route', 'Bolton Market', 'Tuesday'],
  ['Lea Market Route', 'Lea Market', 'Wednesday'],
  ['Orangi Town Route', 'Orangi', 'Thursday'],
  ['Nazimabad Route', 'Nazimabad', 'Friday'],
  ['Korangi Route', 'Korangi', 'Saturday'],
];

const SALESMEN = [
  ['SM-01', 'Ali Raza', '0311-1111111', 2.5, 'Suzuki Van JW-4521'],
  ['SM-02', 'Bilal Ahmed', '0312-2222222', 2.0, 'Suzuki Van JW-7788'],
  ['SM-03', 'Usman Ghani', '0313-3333333', 3.0, 'Loader Rickshaw'],
  ['SM-04', 'Kashif Mehmood', '0314-4444444', 2.5, 'Suzuki Van JU-1122'],
];

const SHOPS = [
  ['Bismillah General Store', 'Haji Rafiq', 'Sadar'],
  ['Al-Madina Kiryana Store', 'Sheikh Nadeem', 'Sadar'],
  ['Rehmat Grocery Store', 'Abdul Rehman', 'Bolton Market'],
  ['New Iqbal Store', 'Iqbal Hussain', 'Bolton Market'],
  ['Shahid Super Store', 'Shahid Ali', 'Lea Market'],
  ['Al-Habib Kiryana', 'Habib Ullah', 'Lea Market'],
  ['Madina Mart', 'Faisal Mehmood', 'Orangi'],
  ['Anas General Store', 'Anas Ahmed', 'Orangi'],
  ['Bilal Kiryana Store', 'Bilal Sheikh', 'Nazimabad'],
  ['Faisal Store', 'Muhammad Faisal', 'Nazimabad'],
  ['Gulshan Super Mart', 'Kamran Akmal', 'Gulshan'],
  ['Noor Traders', 'Noor Muhammad', 'Korangi'],
  ['Zainab General Store', 'Yousuf Ali', 'Korangi'],
  ['Barkat Kiryana', 'Saeed Anwar', 'Sadar'],
  ['Sufyan Store', 'Sufyan Khan', 'Orangi'],
  ['Al-Noor Mart', 'Danish Ali', 'Nazimabad'],
  ['Kashmir Store', 'Junaid Iqbal', 'Lea Market'],
  ['Awami Kiryana Store', 'Rashid Mehmood', 'Bolton Market'],
  ['Shaheen Super Store', 'Tariq Aziz', 'Gulshan'],
  ['Mehran Store', 'Shakeel Ahmed', 'Korangi'],
  ['Habib Kiryana Mart', 'Naveed Anjum', 'Sadar'],
  ['Chaudhry Store', 'Asif Chaudhry', 'Nazimabad'],
  ['Shalimar General Store', 'Waqas Ahmed', 'Orangi'],
  ['Super Save Mart', 'Hamza Farooq', 'Gulshan'],
  ['City Kiryana Store', 'Zeeshan Ali', 'Lea Market'],
];

function clearTransactions() {
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
  });
}

function createMasters() {
  const d = db();
  const admin = d.get("SELECT * FROM users WHERE username='admin'");
  const user = A.publicUser(admin);

  const companyIds = {};
  for (const c of COMPANIES) {
    const exists = d.get('SELECT id FROM companies WHERE name=?', c.name);
    companyIds[c.name] = exists ? exists.id : d.insert('companies', { name: c.name, city: c.city, active: 1 });
  }
  const catIds = {};
  for (const c of CATEGORIES) {
    const exists = d.get('SELECT id FROM categories WHERE name=?', c);
    catIds[c] = exists ? exists.id : d.insert('categories', { name: c, active: 1 });
  }
  const supplierIds = [];
  for (const [name, person, phone] of SUPPLIERS) {
    let s = d.get('SELECT id FROM suppliers WHERE name=?', name);
    if (!s) {
      const id = d.insert('suppliers', {
        name, contact_person: person, phone, city: 'Karachi', opening_balance_paisa: 0, balance_paisa: 0, active: 1, created_at: U.nowIso(),
      });
      supplierIds.push(id);
    } else supplierIds.push(s.id);
  }
  const routeIds = {};
  for (const [name, area, weekday] of ROUTES) {
    let r = d.get('SELECT id FROM routes WHERE name=?', name);
    routeIds[area] = r ? r.id : d.insert('routes', { name, area, weekday, active: 1 });
  }
  const tiers = d.all('SELECT * FROM price_tiers ORDER BY id');
  const tier = (name) => (tiers.find((t) => t.name === name) || tiers[0]).id;

  const salesmanIds = [];
  for (const [code, name, phone, commission, vehicle] of SALESMEN) {
    let s = d.get('SELECT id FROM salesmen WHERE name=?', name);
    if (!s) {
      const routeKey = pick(Object.keys(routeIds));
      const id = d.insert('salesmen', {
        code, name, phone, route_id: routeIds[routeKey], vehicle_no: vehicle, commission_pct: commission,
        basic_salary_paisa: 3500000, joined_at: U.dateAdd(U.today(), -200), active: 1,
      });
      salesmanIds.push(id);
    } else salesmanIds.push(s.id);
  }

  // van warehouses (mobile godowns)
  const vanWarehouses = [];
  for (let i = 1; i <= 3; i++) {
    const name = `Van ${i} Mobile Godown`;
    let w = d.get('SELECT id FROM warehouses WHERE name=?', name);
    const id = w ? w.id : d.insert('warehouses', { code: `VAN${i}`, name, type: 'VAN', active: 1 });
    vanWarehouses.push(id);
  }

  const productIds = [];
  for (const [name, company, category, carton, cost, wholesale, retail, shelf] of PRODUCTS) {
    let p = d.get('SELECT id FROM products WHERE name=?', name);
    if (!p) {
      const id = d.insert('products', {
        sku: 'SKU-' + U.pad(productIds.length + 1, 4),
        barcode: '200' + U.pad(randInt(10000, 99999), 5),
        name, company_id: companyIds[company], category_id: catIds[category], unit: 'pcs', carton_size: carton,
        cost_paisa: cost * 100, wholesale_paisa: wholesale * 100, retail_paisa: retail * 100, tax_pct: 0,
        reorder_level: carton * 3, shelf_life_days: shelf, active: 1, created_at: U.nowIso(),
      });
      productIds.push(id);
    } else productIds.push(p.id);
  }

  const customerIds = [];
  SHOPS.forEach(([name, owner, area], idx) => {
    let c = d.get('SELECT id FROM customers WHERE name=?', name);
    if (!c) {
      const creditLimit = [0, 50000, 100000, 200000][idx % 4];
      const id = d.insert('customers', {
        code: 'C-' + U.pad(idx + 1, 4),
        name,
        owner_name: owner,
        phone: '03' + randInt(10, 49) + '-' + randInt(1000000, 9999999),
        whatsapp: '03' + randInt(10, 49) + '-' + randInt(1000000, 9999999),
        address: 'Shop ' + randInt(1, 90) + ', ' + area + ' Market, Karachi',
        area, city: 'Karachi', shop_type: idx % 7 === 0 ? 'Super Store' : 'Kiryana',
        route_id: routeIds[area] || routeIds[Object.keys(routeIds)[0]],
        tier_id: creditLimit >= 100000 ? tier('Wholesale') : creditLimit > 0 ? tier('Retail') : tier('Cash Customer'),
        credit_limit_paisa: creditLimit * 100,
        credit_days: creditLimit >= 200000 ? 30 : creditLimit >= 100000 ? 15 : creditLimit > 0 ? 7 : 0,
        opening_balance_paisa: 0, balance_paisa: 0, advance_paisa: 0,
        lat: 24.86 + rnd() * 0.09, lng: 67.0 + rnd() * 0.09,
        active: 1, created_at: U.nowIso(),
      });
      customerIds.push(id);
    } else customerIds.push(c.id);
  });

  // trade schemes
  if (!d.val('SELECT COUNT(*) FROM schemes')) {
    d.insert('schemes', {
      name: 'Cocomo 10+1 Carton Free', type: 'FREE_QTY', product_id: productIds[0], buy_qty: 240, free_qty: 24,
      claimable: 1, active: 1, start_date: U.dateAdd(U.today(), -30), end_date: U.dateAdd(U.today(), 60),
      created_at: U.nowIso(), notes: 'Company scheme - claim from Bisconni',
    });
    d.insert('schemes', {
      name: 'Tapal Danedar 3% Slab (10+ carton)', type: 'SLAB_DISCOUNT', product_id: productIds[5], slab_min_qty: 240, discount_pct: 3,
      claimable: 0, active: 1, start_date: U.dateAdd(U.today(), -30), end_date: U.dateAdd(U.today(), 90), created_at: U.nowIso(),
    });
    d.insert('schemes', {
      name: 'Surf Excel 2% Cash Discount', type: 'CASH_DISCOUNT', product_id: productIds[17], discount_pct: 2, claimable: 0,
      active: 1, start_date: U.dateAdd(U.today(), -30), end_date: U.dateAdd(U.today(), 90), created_at: U.nowIso(),
    });
    d.insert('schemes', {
      name: 'Shan Masala 5+1 Free', type: 'FREE_QTY', company_id: companyIds['National Foods'], buy_qty: 120, free_qty: 24,
      claimable: 1, active: 1, start_date: U.dateAdd(U.today(), -30), end_date: U.dateAdd(U.today(), 60), created_at: U.nowIso(),
    });
  }

  // salesman login user
  if (!d.get("SELECT id FROM users WHERE username='salesman'")) {
    A.createUser({ username: 'salesman', password: 'salesman123', full_name: 'Ali Raza (Salesman)', role: 'SALESMAN', salesman_id: salesmanIds[0] });
  }
  // targets for current month
  const period = U.monthOf(U.today());
  for (const sid of salesmanIds) {
    if (!d.get('SELECT id FROM targets WHERE salesman_id=? AND period=?', sid, period)) {
      d.insert('targets', {
        salesman_id: sid, period, target_sales_paisa: randInt(600, 1200) * 1000 * 100,
        target_recovery_paisa: randInt(500, 1000) * 1000 * 100, target_new_outlets: randInt(3, 8), created_at: U.nowIso(),
      });
    }
  }

  return { user, productIds, customerIds, supplierIds, salesmanIds, routeIds, vanWarehouses, companies: companyIds };
}

function seedDemo(opts = {}) {
  install();
  // deterministic demo data — har dafa ek jaisa sample data banta hai
  seedState = 987654321;
  const d = db();
  if (opts.force) clearTransactions();
  if (d.val('SELECT COUNT(*) FROM products') > 0 && !opts.force) return { skipped: true };

  const ctx = createMasters();
  const user = ctx.user;
  const mainWh = U.int(SVC.S('default_warehouse_id'));
  const scrapWh = U.int(SVC.S('default_scrap_warehouse_id'));
  const rndPick = () => pick(ctx.productIds);
  const dayPlan = [];
  for (let i = 21; i >= 0; i--) dayPlan.push(U.dateAdd(U.today(), -i));

  /* ---------------- purchases (stock in with batches) ---------------- */
  dayPlan.slice(0, 12).forEach((date, idx) => {
    if (idx % 2 !== 0) return;
    const supplierIdx = randInt(0, ctx.supplierIds.length - 1);
    const lines = [];
    const count = randInt(4, 8);
    for (let i = 0; i < count; i++) {
      const pid = rndPick();
      if (lines.find((l) => l.product_id === pid)) continue;
      const p = d.get('SELECT * FROM products WHERE id=?', pid);
      const cartons = randInt(10, 40);
      const shelf = U.int(p.shelf_life_days) || 365;
      // some batches intentionally near expiry for the FEFO / push-sale demo
      const expDays = i === 0 && idx % 4 === 0 ? randInt(20, 50) : randInt(Math.round(shelf * 0.4), shelf);
      lines.push({
        product_id: pid,
        cartons,
        qty: cartons * U.int(p.carton_size),
        unit_cost_paisa: U.int(p.cost_paisa),
        batch_no: 'B' + U.pad(randInt(1000, 9999), 4),
        mfg_date: U.dateAdd(date, -randInt(5, 30)),
        expiry_date: U.dateAdd(date, expDays),
      });
    }
    SVC.createPurchase(user, {
      supplier_id: ctx.supplierIds[supplierIdx],
      date,
      warehouse_id: mainWh,
      invoice_no: 'BILL-' + U.pad(idx + 100, 4),
      freight_paisa: randInt(300, 1200) * 100,
      notes: 'Demo purchase',
      lines,
      payment: idx % 3 === 0 ? { method: 'BANK', amount_paisa: 5000000, bank_name: 'HBL' } : null,
    });
  });

  /* ---------------- van loading: yesterday settled + today open ---------------- */
  const yesterday = U.dateAdd(U.today(), -1);
  try {
    const vanLoad = SVC.createVanLoad(user, {
      date: yesterday,
      vehicle_no: 'JW-4521',
      salesman_id: ctx.salesmanIds[0],
      route_id: ctx.routeIds['Sadar'],
      van_warehouse_id: ctx.vanWarehouses[0],
      source_warehouse_id: mainWh,
      notes: 'Morning loading sheet',
      lines: ctx.productIds.slice(0, 8).map((pid) => {
        const p = d.get('SELECT * FROM products WHERE id=?', pid);
        return { product_id: pid, cartons: randInt(3, 8) };
      }),
    });
    SVC.settleVanLoad(user, vanLoad.id, { lines: vanLoad.lines.map((l) => ({ line_id: l.id, return_to: rnd() > 0.8 ? 'SCRAP' : 'MAIN' })), notes: 'Evening settlement' });
  } catch (e) {
    /* ignore demo hiccups */
  }
  try {
    SVC.createVanLoad(user, {
      date: U.today(),
      vehicle_no: 'JW-7788',
      salesman_id: ctx.salesmanIds[1],
      route_id: ctx.routeIds['Bolton Market'],
      van_warehouse_id: ctx.vanWarehouses[1],
      source_warehouse_id: mainWh,
      notes: 'Aaj ka load (open)',
      lines: ctx.productIds.slice(8, 16).map((pid) => ({ product_id: pid, cartons: randInt(2, 6) })),
    });
  } catch (e) {
    /* ignore */
  }

  /* ---------------- orders (booking) ---------------- */
  try {
    for (let i = 0; i < 4; i++) {
      const cust = ctx.customerIds[randInt(0, ctx.customerIds.length - 1)];
      const lines = [];
      for (let j = 0; j < randInt(2, 5); j++) {
        const pid = rndPick();
        if (lines.find((l) => l.product_id === pid)) continue;
        lines.push({ product_id: pid, cartons: randInt(1, 5) });
      }
      const order = SVC.createOrder(user, {
        customer_id: cust,
        salesman_id: ctx.salesmanIds[i % ctx.salesmanIds.length],
        route_id: ctx.routeIds[Object.keys(ctx.routeIds)[i % Object.keys(ctx.routeIds).length]],
        lines,
        notes: 'Market se book kiya gaya order',
      });
      if (i === 0) SVC.convertOrderToInvoice(user, order.id, { sale_type: 'CREDIT', warehouse_id: mainWh });
    }
  } catch (e) {
    /* ignore */
  }

  /* ---------------- sales invoices ---------------- */
  const invoiceIds = [];
  dayPlan.forEach((date, dayIdx) => {
    const billsToday = randInt(2, 6);
    for (let b = 0; b < billsToday; b++) {
      const cust = ctx.customerIds[randInt(0, ctx.customerIds.length - 1)];
      const lines = [];
      const itemCount = randInt(2, 6);
      for (let i = 0; i < itemCount; i++) {
        const pid = rndPick();
        if (lines.find((l) => l.product_id === pid)) continue;
        lines.push({ product_id: pid, cartons: randInt(1, 8) });
      }
      if (!lines.length) continue;
      const isCash = rnd() < 0.35;
      const salesman_id = ctx.salesmanIds[randInt(0, ctx.salesmanIds.length - 1)];
      try {
        const inv = SVC.createInvoice(user, {
          date,
          customer_id: cust,
          sale_type: isCash ? 'CASH' : 'CREDIT',
          warehouse_id: dayIdx % 5 === 4 && ctx.vanWarehouses.length ? pick(ctx.vanWarehouses) : mainWh,
          salesman_id,
          lines,
          notes: isCash ? 'Counter cash sale' : 'Udhaar sale',
        });
        invoiceIds.push(inv.id);
      } catch (e) {
        /* stock kam ho to skip */
      }
    }
  });

  /* ---------------- receipts (recovery) ---------------- */
  const creditInvoices = d.all("SELECT * FROM sales_invoices WHERE sale_type='CREDIT' AND status<>'VOID' ORDER BY id");
  const banks = ['HBL', 'Meezan Bank', 'UBL', 'Bank Alfalah', 'MCB'];
  creditInvoices.forEach((inv, i) => {
    const roll = rnd();
    const due = U.int(inv.total_paisa) - U.int(inv.paid_paisa);
    if (due <= 0) return;
    try {
      if (roll < 0.45) {
        // full cash recovery after a few days
        SVC.createReceipt(user, {
          customer_id: inv.customer_id,
          date: U.dateAdd(inv.date, randInt(1, 6)) > U.today() ? U.today() : U.dateAdd(inv.date, randInt(1, 6)),
          method: 'CASH',
          amount_paisa: due,
          salesman_id: inv.salesman_id,
          notes: 'Cash recovery',
        });
      } else if (roll < 0.65) {
        // partial cash
        SVC.createReceipt(user, {
          customer_id: inv.customer_id,
          date: U.dateAdd(inv.date, randInt(2, 8)) > U.today() ? U.today() : U.dateAdd(inv.date, randInt(2, 8)),
          method: 'CASH',
          amount_paisa: Math.round(due * 0.5),
          salesman_id: inv.salesman_id,
          notes: 'Part payment',
        });
      } else if (roll < 0.78) {
        // post dated cheque (PDC)
        SVC.createReceipt(user, {
          customer_id: inv.customer_id,
          date: U.dateAdd(inv.date, randInt(1, 4)) > U.today() ? U.today() : U.dateAdd(inv.date, randInt(1, 4)),
          method: 'CHEQUE',
          amount_paisa: due,
          cheque_no: String(randInt(100000, 999999)),
          cheque_date: U.dateAdd(U.today(), randInt(2, 20)),
          bank_name: pick(banks),
          salesman_id: inv.salesman_id,
          notes: 'PDC cheque received',
        });
      } else if (roll < 0.85) {
        SVC.createReceipt(user, {
          customer_id: inv.customer_id,
          date: U.dateAdd(inv.date, randInt(1, 5)) > U.today() ? U.today() : U.dateAdd(inv.date, randInt(1, 5)),
          method: 'BANK',
          amount_paisa: due,
          bank_name: pick(banks),
          salesman_id: inv.salesman_id,
          notes: 'Online transfer',
        });
      }
    } catch (e) {
      /* ignore */
    }
  });

  // one cheque cleared, one bounced for realism
  const cheques = d.all("SELECT * FROM receipts WHERE method='CHEQUE' ORDER BY id LIMIT 4");
  if (cheques[0]) {
    try {
      SVC.setChequeStatus(user, cheques[0].id, 'IN_CLEARING', {});
      SVC.setChequeStatus(user, cheques[0].id, 'CLEARED', {});
    } catch (e) {}
  }
  if (cheques[1]) {
    try {
      SVC.setChequeStatus(user, cheques[1].id, 'BOUNCED', { charges_paisa: 50000, bank_name: cheques[1].bank_name });
    } catch (e) {}
  }

  /* ---------------- sales returns ---------------- */
  ctx.customerIds.slice(0, 3).forEach((cid, i) => {
    const pid = rndPick();
    const p = d.get('SELECT * FROM products WHERE id=?', pid);
    try {
      SVC.createSalesReturn(user, {
        customer_id: cid,
        date: U.dateAdd(U.today(), -randInt(1, 5)),
        kind: i === 2 ? 'SCRAP' : 'GOOD',
        warehouse_id: i === 2 ? scrapWh : mainWh,
        reason: i === 2 ? 'Carton toot gaya / damage' : 'Excess stock wapsi',
        lines: [{ product_id: pid, qty: randInt(1, 3) * U.int(p.carton_size), unit_price_paisa: U.int(p.wholesale_paisa) }],
      });
    } catch (e) {}
  });

  /* ---------------- expenses ---------------- */
  const heads = d.all('SELECT * FROM expense_heads');
  const head = (kw) => (heads.find((h) => h.name.toLowerCase().includes(kw)) || heads[0]).id;
  dayPlan.forEach((date) => {
    try {
      SVC.createExpense(user, { date, head_id: head('petrol'), amount_paisa: randInt(500, 1800) * 100, method: 'CASH', vehicle_no: 'JW-4521', note: 'Van petrol' });
      if (rnd() < 0.6) SVC.createExpense(user, { date, head_id: head('tea'), amount_paisa: randInt(150, 500) * 100, method: 'CASH', note: 'Chai / lunch' });
    } catch (e) {}
  });

  /* ---------------- cash closings ---------------- */
  dayPlan.slice(-5).forEach((date) => {
    try {
      const pos = SVC.cashPosition(date);
      const counted = pos.expected_paisa + (rnd() < 0.6 ? 0 : rnd() < 0.5 ? -randInt(1, 5) * 10000 : randInt(1, 5) * 10000);
      SVC.createCashClosing(user, { date, counted_paisa: counted, note: 'Roozana cash closing' });
    } catch (e) {}
  });

  /* ---------------- market visits (geo tracking) ---------------- */
  const salesUser = d.get("SELECT * FROM users WHERE username='salesman'");
  const salesUserPub = A.publicUser(salesUser);
  ctx.customerIds.slice(0, 10).forEach((cid, i) => {
    const c = d.get('SELECT * FROM customers WHERE id=?', cid);
    try {
      SVC.checkIn(salesUserPub, {
        customer_id: cid,
        lat: Number(c.lat) + 0.0002,
        lng: Number(c.lng) - 0.0001,
        salesman_id: ctx.salesmanIds[0],
        kind: i % 3 === 0 ? 'ORDER' : 'CHECKIN',
        notes: 'Shop visit',
      });
    } catch (e) {}
  });

  SVC.recalcAllBalances();
  return {
    products: d.val('SELECT COUNT(*) FROM products'),
    customers: d.val('SELECT COUNT(*) FROM customers'),
    invoices: d.val('SELECT COUNT(*) FROM sales_invoices'),
    receipts: d.val('SELECT COUNT(*) FROM receipts'),
    purchases: d.val('SELECT COUNT(*) FROM purchases'),
    gl: SVC.glCheck(),
  };
}

module.exports = { seedDemo, clearTransactions };
