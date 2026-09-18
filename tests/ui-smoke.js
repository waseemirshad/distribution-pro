'use strict';
/**
 * Distribution Pro - UI smoke test (jsdom)
 * Poori SPA ko headless browser (jsdom) me load karta hai, har page kholta hai
 * aur JavaScript errors pakarta hai.
 *
 * Chalane ka tareeqa:
 *   1) server chalayein:  node --no-warnings server/index.js
 *   2) npm i -D jsdom   (ek dafa)
 *   3) node --no-warnings tests/ui-smoke.js
 */
const path = require('path');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
let JSDOM;
try {
  ({ JSDOM } = require('jsdom'));
} catch (e) {
  try {
    ({ JSDOM } = require(path.join('/tmp/uitest/node_modules/jsdom')));
  } catch (e2) {
    console.log('  jsdom install nahi hai — `npm i -D jsdom` chalayein. Skipping UI test.');
    process.exit(0);
  }
}

const errors = [];
const apiErrors = [];
let pass = 0;
let fail = 0;
const t = (name, ok, extra) => {
  if (ok) {
    pass++;
    console.log('  ✓ ' + name);
  } else {
    fail++;
    console.log('  ✗ ' + name + (extra ? '  → ' + extra : ''));
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('\nUI smoke test — ' + BASE);
  const dom = await JSDOM.fromURL(BASE + '/', {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    beforeParse(win) {
      win.fetch = (url, opts) => {
        const full = new URL(url, BASE).toString();
        return fetch(full, opts).then((res) => {
          if (full.includes('/api/') && res.status >= 400) apiErrors.push(res.status + ' ' + full.replace(BASE, ''));
          return res;
        });
      };
      win.Response = Response;
      win.Request = Request;
      win.Headers = Headers;
      win.console.error = (...a) => errors.push(a.map(String).join(' '));
      win.addEventListener('error', (e) => errors.push('window error: ' + (e.message || e.error)));
      win.addEventListener('unhandledrejection', (e) => errors.push('unhandled: ' + (e.reason && e.reason.message)));
      win.open = () => ({});
      win.print = () => {};
    },
  });
  const win = dom.window;
  await sleep(1500);

  t('scripts load ho gaye (DP + app)', !!(win.DP && win.DP.pages && win.DP.pages.length >= 22), win.DP ? 'pages=' + (win.DP.pages || []).length : 'DP missing');
  t('22+ pages register hui', win.DP.pages.length >= 22, 'pages=' + win.DP.pages.length);
  ['dashboard', 'pos', 'invoices', 'sales-returns', 'orders', 'van', 'purchases', 'purchase-returns', 'stock', 'batches', 'transfers', 'receipts', 'cheques', 'payments', 'expenses', 'cash', 'customers', 'suppliers', 'salesmen', 'targets', 'schemes', 'visits', 'reports', 'products', 'masters', 'users', 'settings', 'audit'].forEach((k) => {
    if (!win.DP.pageMap[k]) t('page missing: ' + k, false);
  });
  t('required page keys mojood', ['dashboard', 'pos', 'invoices', 'reports', 'masters', 'settings', 'products', 'audit', 'van', 'cheques', 'schemes'].every((k) => win.DP.pageMap[k]));

  // login
  const doc = win.document;
  doc.getElementById('login-user').value = 'admin';
  doc.getElementById('login-pass').value = 'admin123';
  doc.getElementById('login-form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(2500);
  const loggedIn = !doc.getElementById('app').classList.contains('hidden');
  t('login ho gaya (admin/admin123)', loggedIn, doc.getElementById('login-error').textContent);
  t('user state set hai', win.DP.state.user && win.DP.state.user.username === 'admin');
  t('lookups load hue (warehouses/tiers/salesmen/routes)', ['warehouses', 'tiers', 'salesmen', 'routes'].every((k) => (win.DP.state.lookups[k] || []).length > 0), JSON.stringify(Object.entries(win.DP.state.lookups).map(([k, v]) => k + ':' + (v || []).length)));
  t('sidebar nav bana', doc.querySelectorAll('#nav .nav-item').length >= 20, 'items=' + doc.querySelectorAll('#nav .nav-item').length);

  const keys = Object.keys(win.DP.pageMap);
  for (const key of keys) {
    errors.length = 0;
    apiErrors.length = 0;
    const before = errors.length;
    win.DP.go(key);
    await sleep(900);
    const view = doc.getElementById('view');
    const text = (view.textContent || '').trim();
    const hasContent = text.length > 20;
    const spinning = text.includes('Load ho raha hai');
    const knocked = text.includes('Page load nahi hua') || text.includes('Ijazat nahi');
    const apiBad = apiErrors.slice();
    t('page render: ' + key + (spinning ? ' [loading]' : '') + (apiBad.length ? ' [api ' + apiBad.length + ']' : ''), hasContent && !knocked && errors.length === before && !apiBad.length, (errors.slice(0, 2).concat(apiBad.slice(0, 3))).join(' | '));
  }


  /* ---------------- deep checks (sirf render nahi, asli data bhi) ---------------- */
  errors.length = 0;
  win.DP.go('dashboard');
  await sleep(1200);
  const dashText = doc.getElementById('view').textContent;
  t('dashboard par asli numbers (Rs + KPI) aaye', dashText.includes('Rs ') && dashText.includes('Aaj ki Sale'), dashText.slice(0, 120));

  errors.length = 0;
  win.DP.go('reports', { report: 'sales_register' });
  await sleep(1600);
  const repText = doc.getElementById('view').textContent;
  const repRows = doc.querySelectorAll('#view table tbody tr').length;
  t('reports page: sales_register ke rows dikhe', repRows > 0 && repText.includes('Sales Register'), 'rows=' + repRows);

  errors.length = 0;
  win.DP.go('customers');
  await sleep(1200);
  const custRows = doc.querySelectorAll('#view table tbody tr').length;
  t('customers list me demo customers dikhe', custRows > 3, 'rows=' + custRows);


  /* ---------------- POS billing flow (asli bill) ---------------- */
  errors.length = 0;
  apiErrors.length = 0;
  win.DP.go('pos');
  await sleep(1800);
  const hdr = { authorization: 'Bearer ' + win.DP.token };
  const prods = await (await fetch(BASE + '/api/products?limit=5', { headers: hdr })).json();
  const custs = await (await fetch(BASE + '/api/customers?limit=5', { headers: hdr })).json();
  t('POS: products + customers load hue', prods.length > 0 && custs.length > 0, `p=${prods.length} c=${custs.length}`);
  const posInputs = [...doc.querySelectorAll('#view input')];
  const sIn = posInputs.find((i) => /Item ka naam/.test(i.placeholder || ''));
  let cartOk = false;
  if (sIn) {
    sIn.value = prods[0].name.slice(0, 6);
    sIn.dispatchEvent(new win.Event('input', { bubbles: true }));
    await sleep(400);
    const openList = [...doc.querySelectorAll('.search-list')].find((l) => !l.classList.contains('hidden'));
    const hit = openList && openList.querySelector('.search-item');
    if (hit) hit.click();
    await sleep(400);
    cartOk = doc.querySelectorAll('.line-row').length > 1;
  }
  t('POS: item cart me gaya', cartOk);
  const cIn = [...doc.querySelectorAll('#view input')].find((i) => /Dukan/.test(i.placeholder || ''));
  if (cIn) {
    cIn.value = custs[0].name.slice(0, 6);
    cIn.dispatchEvent(new win.Event('input', { bubbles: true }));
    await sleep(400);
    const cl = [...doc.querySelectorAll('.search-list')].find((l) => !l.classList.contains('hidden'));
    const chit = cl && cl.querySelector('.search-item');
    if (chit) chit.click();
    await sleep(500);
  }
  const saveBtn = [...doc.querySelectorAll('#view button')].find((b) => b.textContent.trim() === 'Save only');
  if (saveBtn) saveBtn.click();
  await sleep(2500);
  const posBody = doc.body.textContent;
  t('POS: bill save hua (ya credit-limit override modal aaya)', posBody.includes('Bill save ho gaya') || posBody.includes('Bill ban gaya') || posBody.includes('Credit limit'), posBody.slice(-200));
  t('POS: koi JS error nahi', errors.length === 0, errors.slice(0, 2).join(' | '));

  t('koi JS error nahi aaya (aakhri page ke baad)', errors.length === 0, errors.slice(0, 3).join(' | '));

  console.log(`\n  UI TEST: ${pass} passed, ${fail} failed\n`);
  win.close();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('UI test crash:', e);
  process.exit(1);
});
