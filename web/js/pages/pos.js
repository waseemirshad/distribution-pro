/* Distribution Pro - Billing counter (POS) */
(function () {
  'use strict';

  DP.definePage({
    key: 'pos',
    title: 'Naya Bill (POS)',
    sub: 'Keyboard se tez billing — Carton + Loose pcs',
    icon: '🧾',
    section: 'Main',
    perm: 'invoices.create',
    async render(root) {
      const L = DP.state.lookups;
      const products = await DP.get('/products?limit=5000');
      const customers = await DP.get('/customers');
      const prices = await DP.get('/crud/product_prices?limit=5000').catch(() => []);
      const tiers = L.tiers || [];
      const tiersById = Object.fromEntries(tiers.map((t) => [t.id, t]));
      const priceMap = {};
      prices.forEach((p) => (priceMap[p.product_id + ':' + p.tier_id] = p.price_paisa));
      const prodById = Object.fromEntries(products.map((p) => [p.id, p]));

      const cart = [];
      const state = {
        customer: null,
        sale_type: 'CREDIT',
        salesman_id: '',
        warehouse_id: DP.state.warehouseId || '',
        notes: '',
        headerDiscount: 0,
        focusIndex: 0,
      };

      function tierPrice(p) {
        if (state.customer && state.customer.tier_id) {
          const key = p.id + ':' + state.customer.tier_id;
          if (priceMap[key]) return priceMap[key];
          const t = tiersById[state.customer.tier_id];
          if (t && Number(t.discount_pct)) return Math.round(p.wholesale_paisa * (1 - Number(t.discount_pct) / 100));
        }
        return p.wholesale_paisa || p.retail_paisa || 0;
      }

      /* ---------------- layout ---------------- */
      const searchInput = DP.el('input', { placeholder: 'Item ka naam / SKU / barcode likhein (F2) — Enter se add', autofocus: true });
      const searchList = DP.el('div', { class: 'search-list hidden' });
      const linesBox = DP.el('div', { class: 'scroll-y' });
      const totalsBox = DP.el('div', { class: 'col' });
      const customerBox = DP.el('div', { class: 'customer-box' }, DP.el('div', { class: 'muted small', text: 'Koi customer select nahi' }));
      const customerSearch = DP.el('input', { placeholder: 'Dukan / phone dhundein (F4)' });
      const custList = DP.el('div', { class: 'search-list hidden' });

      const left = DP.el('div', { class: 'card' }, [
        DP.el('div', { class: 'search-results' }, [searchInput, searchList]),
        DP.el('div', { class: 'line-row', style: { fontWeight: '700', fontSize: '11px', color: 'var(--ink-2)', textTransform: 'uppercase' } }, [
          DP.el('div', { text: 'Item' }),
          DP.el('div', { class: 'right', text: 'Carton' }),
          DP.el('div', { class: 'right', text: 'Loose' }),
          DP.el('div', { class: 'right', text: 'Rate' }),
          DP.el('div', { class: 'right', text: 'Disc%' }),
          DP.el('div', { text: '' }),
        ]),
        linesBox,
        DP.el('div', { class: 'row tight', style: { marginTop: '10px' } }, [
          DP.el('button', { class: 'btn sm', text: '+ Row (F3)', onclick: () => { addLine(products[0]); } }),
          DP.el('button', { class: 'btn sm', text: '🗑 Cart khali karein', onclick: () => { if (confirm('Poora cart khali karna hai?')) { cart.length = 0; draw(); } } }),
          DP.el('span', { class: 'muted small', id: 'scheme-hint' }),
        ]),
      ]);

      const right = DP.el('div', { class: 'card' }, [
        DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Customer (dukan)' }), DP.el('div', { class: 'search-results' }, [customerSearch, custList])]),
        customerBox,
        DP.el('div', { class: 'grid g2', style: { marginTop: '10px' } }, [
          DP.ui.field({
            key: 'sale_type', label: 'Sale Type', type: 'select', value: 'CREDIT',
            options: [{ value: 'CREDIT', label: 'Udhaar (Credit)' }, { value: 'CASH', label: 'Cash' }],
            onChange: (e) => { state.sale_type = e.target.value; draw(); },
          }),
          DP.ui.field({
            key: 'salesman_id', label: 'Salesman', type: 'select', value: '',
            options: [{ value: '', label: '— koi nahi —' }].concat((L.salesmen || []).map((s) => ({ value: s.id, label: s.name }))),
            onChange: (e) => (state.salesman_id = e.target.value),
          }),
          DP.ui.field({
            key: 'warehouse_id', label: 'Godown', type: 'select', value: state.warehouse_id,
            options: (L.warehouses || []).map((w) => ({ value: w.id, label: w.name })),
            onChange: (e) => { state.warehouse_id = e.target.value; DP.state.warehouseId = Number(e.target.value); },
          }),
          DP.ui.field({
            key: 'discount', label: 'Bill Discount (Rs)', type: 'money', value: 0,
            onChange: (e) => { state.headerDiscount = DP.fmt.toPaisa(e.target.value); draw(); },
          }),
        ]),
        DP.ui.field({ key: 'notes', label: 'Note (optional)', type: 'text', placeholder: 'e.g. delivery kal subah', onChange: (e) => (state.notes = e.target.value) }),
        DP.el('div', { class: 'hr' }),
        totalsBox,
        DP.el('div', { class: 'row tight', style: { marginTop: '10px' } }, [
          DP.el('button', { class: 'btn primary grow', text: '💾 Save & Print (F9)', onclick: () => save(true) }),
          DP.el('button', { class: 'btn', text: 'Save only', onclick: () => save(false) }),
        ]),
        DP.el('div', { class: 'muted tiny', text: 'Shortcuts: F2 search • F4 customer • F9 save+print • Esc clear' }),
      ]);

      root.appendChild(DP.el('div', { class: 'pos-grid' }, [left, right]));

      /* ---------------- search ---------------- */
      function showResults(q) {
        DP.clear(searchList);
        const term = String(q || '').toLowerCase().trim();
        if (!term) {
          searchList.classList.add('hidden');
          return;
        }
        const hits = products
          .filter((p) => p.name.toLowerCase().includes(term) || String(p.sku || '').toLowerCase().includes(term) || String(p.barcode || '').includes(term))
          .slice(0, 12);
        if (!hits.length) {
          searchList.appendChild(DP.el('div', { class: 'search-item', text: 'Koi item nahi mila' }));
        }
        hits.forEach((p, i) => {
          searchList.appendChild(
            DP.el('div', { class: 'search-item' + (i === state.focusIndex ? ' sel' : ''), onclick: () => addLine(p) }, [
              DP.el('div', {}, [DP.el('b', { text: p.name }), DP.el('div', { class: 'tiny muted', text: `${p.sku || ''} • carton ${p.carton_size} pcs • stock ${p.stock} pcs` })]),
              DP.el('div', { class: 'right' }, [DP.el('b', { text: 'Rs ' + DP.fmt.money(tierPrice(p)) }), DP.el('div', { class: 'tiny muted', text: 'per pc' })]),
            ])
          );
        });
        searchList.classList.remove('hidden');
      }
      searchInput.addEventListener('input', () => { state.focusIndex = 0; showResults(searchInput.value); });
      searchInput.addEventListener('keydown', async (e) => {
        const items = searchList.querySelectorAll('.search-item');
        if (e.key === 'ArrowDown') { state.focusIndex = Math.min(state.focusIndex + 1, items.length - 1); showResults(searchInput.value); e.preventDefault(); }
        else if (e.key === 'ArrowUp') { state.focusIndex = Math.max(0, state.focusIndex - 1); showResults(searchInput.value); e.preventDefault(); }
        else if (e.key === 'Enter') {
          e.preventDefault();
          const term = searchInput.value.trim();
          if (!term) return;
          const exact = products.find((p) => String(p.barcode) === term);
          if (exact) return addLine(exact);
          const hits = products.filter((p) => p.name.toLowerCase().includes(term.toLowerCase()) || String(p.sku || '').toLowerCase().includes(term.toLowerCase()));
          if (hits[state.focusIndex]) addLine(hits[state.focusIndex]);
          else if (hits[0]) addLine(hits[0]);
          else DP.toast('Item nahi mila: ' + term, 'warn');
        }
      });

      function addLine(p) {
        if (!p) return;
        const existing = cart.find((l) => l.product_id === p.id);
        if (existing) existing.cartons += 1;
        else cart.push({ product_id: p.id, name: p.name, carton_size: p.carton_size || 1, cartons: 1, loose: 0, unit_price_paisa: tierPrice(p), discount_pct: 0, stock: p.stock, free_hint: 0 });
        searchInput.value = '';
        searchList.classList.add('hidden');
        state.focusIndex = 0;
        draw();
        searchInput.focus();
      }

      /* ---------------- customer ---------------- */
      function showCustomers(q) {
        DP.clear(custList);
        const term = String(q || '').toLowerCase().trim();
        const hits = customers
          .filter((c) => !term || c.name.toLowerCase().includes(term) || String(c.phone || '').includes(term) || String(c.code || '').toLowerCase().includes(term))
          .slice(0, 10);
        hits.forEach((c) => {
          custList.appendChild(
            DP.el('div', { class: 'search-item', onclick: () => { state.customer = c; customerSearch.value = ''; custList.classList.add('hidden'); draw(); } }, [
              DP.el('div', {}, [DP.el('b', { text: c.name }), DP.el('div', { class: 'tiny muted', text: `${c.area || ''} • ${c.phone || ''} • ${c.route_name || 'no route'}` })]),
              DP.el('div', { class: 'right' }, [DP.el('b', { class: Number(c.balance_paisa) > 0 ? 'neg' : 'pos', text: 'Rs ' + DP.fmt.money0(c.balance_paisa) }), DP.el('div', { class: 'tiny muted', text: 'udhaar' })]),
            ])
          );
        });
        if (!hits.length) custList.appendChild(DP.el('div', { class: 'search-item', text: 'Customer nahi mila' }));
        custList.classList.remove('hidden');
      }
      customerSearch.addEventListener('input', () => showCustomers(customerSearch.value));
      customerSearch.addEventListener('focus', () => showCustomers(customerSearch.value));

      /* ---------------- draw cart ---------------- */
      function totals() {
        let subtotal = 0, discount = 0, cost = 0, qty = 0;
        cart.forEach((l) => {
          const q = Number(l.cartons || 0) * Number(l.carton_size || 1) + Number(l.loose || 0);
          const gross = q * Number(l.unit_price_paisa || 0);
          const disc = Math.round((gross * Number(l.discount_pct || 0)) / 100);
          subtotal += gross;
          discount += disc;
          qty += q;
          const p = prodById[l.product_id];
          if (p && p.cost_paisa) cost += q * p.cost_paisa;
        });
        const total = subtotal - discount - Number(state.headerDiscount || 0);
        return { subtotal, discount: discount + Number(state.headerDiscount || 0), cost, qty, total, profit: subtotal - discount - cost };
      }

      async function schemeHint() {
        const el = document.getElementById('scheme-hint');
        if (!el) return;
        const l = cart[cart.length - 1];
        if (!l) { el.textContent = ''; return; }
        const q = Number(l.cartons || 0) * Number(l.carton_size || 1) + Number(l.loose || 0);
        try {
          const list = await DP.get(`/schemes/applicable?product_id=${l.product_id}&qty=${q}`);
          const best = list.find((s) => s.calc && (s.calc.free_qty > 0 || s.calc.discount_pct > 0));
          el.textContent = best
            ? best.calc.free_qty > 0
              ? `🎁 Scheme: ${best.name} → ${best.calc.free_qty} pcs FREE milega`
              : `🏷️ Scheme: ${best.name} → ${best.calc.discount_pct}% discount lagega`
            : '';
        } catch (e) { el.textContent = ''; }
      }

      function draw() {
        /* customer box */
        DP.clear(customerBox);
        if (!state.customer) {
          customerBox.appendChild(DP.el('div', { class: 'muted small', text: 'Koi customer select nahi — search se dukan chunein' }));
        } else {
          const c = state.customer;
          customerBox.appendChild(DP.el('div', { class: 'spread' }, [
            DP.el('div', {}, [DP.el('b', { text: c.name }), DP.el('div', { class: 'tiny muted', text: `${c.area || ''} • ${c.phone || ''}` })]),
            DP.el('button', { class: 'btn sm ghost', text: 'Change', onclick: () => { state.customer = null; draw(); } }),
          ]));
          customerBox.appendChild(DP.el('div', { class: 'hr' }));
          customerBox.appendChild(DP.ui.statLine('Purana udhaar', 'Rs ' + DP.fmt.money0(c.balance_paisa)));
          customerBox.appendChild(DP.ui.statLine('Credit limit', c.credit_limit_paisa ? 'Rs ' + DP.fmt.money0(c.credit_limit_paisa) : 'No limit'));
          customerBox.appendChild(DP.ui.statLine('Credit days', (c.credit_days || 0) + ' din'));
          if (c.credit_limit_paisa) {
            const used = Math.min(100, (Number(c.balance_paisa) / Number(c.credit_limit_paisa)) * 100);
            customerBox.appendChild(DP.el('div', { style: { marginTop: '6px' } }, [DP.ui.bar(used, used > 90 ? 'bad' : used > 70 ? 'warn' : 'ok')]));
          }
        }

        /* lines */
        DP.clear(linesBox);
        if (!cart.length) linesBox.appendChild(DP.el('div', { class: 'empty', text: 'Cart khali hai — item search karein (F2)' }));
        cart.forEach((l, idx) => {
          const q = Number(l.cartons || 0) * Number(l.carton_size || 1) + Number(l.loose || 0);
          const gross = q * Number(l.unit_price_paisa || 0);
          const net = gross - Math.round((gross * Number(l.discount_pct || 0)) / 100);
          const row = DP.el('div', { class: 'line-row' }, [
            DP.el('div', {}, [
              DP.el('div', { class: 'nm', text: l.name }),
              DP.el('div', { class: 'tiny muted', text: `carton ${l.carton_size} pcs • qty ${DP.fmt.qty(q, l.carton_size)} • stock ${l.stock} pcs` }),
            ]),
            DP.el('input', { type: 'number', min: 0, value: l.cartons, oninput: (e) => { l.cartons = Number(e.target.value) || 0; draw(); } }),
            DP.el('input', { type: 'number', min: 0, value: l.loose, oninput: (e) => { l.loose = Number(e.target.value) || 0; draw(); } }),
            DP.el('input', { type: 'number', step: '0.01', value: DP.fmt.toRs(l.unit_price_paisa), oninput: (e) => { l.unit_price_paisa = DP.fmt.toPaisa(e.target.value); draw(); } }),
            DP.el('input', { type: 'number', step: '0.01', value: l.discount_pct, oninput: (e) => { l.discount_pct = Number(e.target.value) || 0; draw(); } }),
            DP.el('button', { class: 'icon-btn', text: '✕', title: 'Hatayein', onclick: () => { cart.splice(idx, 1); draw(); } }),
          ]);
          const sub = DP.el('div', { class: 'tiny right muted', style: { marginBottom: '4px' } }, [
            DP.el('span', { text: `Amount: Rs ${DP.fmt.money(net)}` }),
            l.free_hint ? DP.el('span', { class: 'pill ok', style: { marginLeft: '6px' }, text: l.free_hint + ' pcs FREE' }) : null,
          ]);
          linesBox.appendChild(DP.el('div', {}, [row, sub]));
        });

        /* totals */
        const t = totals();
        DP.clear(totalsBox);
        totalsBox.appendChild(DP.el('div', { class: 'tot-row' }, [DP.el('span', { text: `Total Qty (${cart.length} items)` }), DP.el('b', { text: t.qty + ' pcs' })]));
        totalsBox.appendChild(DP.el('div', { class: 'tot-row' }, [DP.el('span', { text: 'Sub Total' }), DP.el('b', { text: 'Rs ' + DP.fmt.money(t.subtotal) })]));
        totalsBox.appendChild(DP.el('div', { class: 'tot-row' }, [DP.el('span', { text: 'Discount' }), DP.el('b', { class: 'neg', text: '- Rs ' + DP.fmt.money(t.discount) })]));
        if (DP.can('cost.view')) totalsBox.appendChild(DP.el('div', { class: 'tot-row' }, [DP.el('span', { text: 'Expected Profit' }), DP.el('b', { class: 'pos', text: 'Rs ' + DP.fmt.money(t.profit) })]));
        totalsBox.appendChild(DP.el('div', { class: 'tot-row big' }, [DP.el('span', { text: 'Payable' }), DP.el('span', { text: 'Rs ' + DP.fmt.money(t.total) })]));
        if (state.customer && state.sale_type === 'CREDIT') {
          const after = Number(state.customer.balance_paisa) + t.total;
          totalsBox.appendChild(DP.el('div', { class: 'tot-row' }, [DP.el('span', { text: 'Bill ke baad udhaar' }), DP.el('b', { class: after > Number(state.customer.credit_limit_paisa || Infinity) ? 'neg' : '', text: 'Rs ' + DP.fmt.money0(after) })]));
        }
        schemeHint();
      }

      /* ---------------- save ---------------- */
      async function save(print) {
        if (!state.customer) return DP.toast('Pehle customer select karein', 'bad');
        const lines = cart.filter((l) => Number(l.cartons) || Number(l.loose));
        if (!lines.length) return DP.toast('Cart khali hai', 'bad');
        const payload = {
          customer_id: state.customer.id,
          sale_type: state.sale_type,
          salesman_id: state.salesman_id || state.customer.route_id ? state.salesman_id || null : null,
          warehouse_id: state.warehouse_id || undefined,
          date: DP.today(),
          discount_paisa: state.headerDiscount || 0,
          notes: state.notes,
          lines: lines.map((l) => ({
            product_id: l.product_id,
            cartons: Number(l.cartons) || 0,
            loose: Number(l.loose) || 0,
            unit_price_paisa: Number(l.unit_price_paisa) || 0,
            discount_pct: Number(l.discount_pct) || 0,
          })),
        };
        try {
          const inv = await DP.post('/invoices', payload);
          DP.toast(`Bill ban gaya: ${inv.invoice_no} — Rs ${DP.fmt.money0(inv.total_paisa)}`, 'ok');
          cart.length = 0;
          state.customer = null;
          state.notes = '';
          state.headerDiscount = 0;
          draw();
          afterSave(inv, print);
        } catch (err) {
          if (err.code === 'CREDIT_LIMIT') {
            const cs = err.data && err.data.credit_status;
            DP.modal({
              title: '🚫 Credit limit / purana udhaar',
              size: 'sm',
              body: DP.el('div', {}, [
                DP.el('div', { class: 'alert-chip danger', style: { display: 'block', whiteSpace: 'normal', padding: '10px' }, text: err.message }),
                cs ? DP.el('div', { style: { marginTop: '10px' } }, [
                  DP.ui.statLine('Mojooda udhaar', 'Rs ' + DP.fmt.money0(cs.balance_paisa)),
                  DP.ui.statLine('Credit limit', cs.credit_limit_paisa ? 'Rs ' + DP.fmt.money0(cs.credit_limit_paisa) : '—'),
                  DP.ui.statLine('Overdue', 'Rs ' + DP.fmt.money0(cs.overdue_paisa) + ' (' + cs.days_overdue + ' din)'),
                ]) : null,
                DP.el('p', { class: 'small muted', text: 'Malik/Manager ka PIN daal kar bill jari rakha ja sakta hai (override audit me record hoga).' }),
                (() => {
                  const pin = DP.el('input', { type: 'password', placeholder: 'Manager PIN' });
                  pin.dataset.pin = '1';
                  return DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Manager PIN' }), pin]);
                })(),
                (() => {
                  const r = DP.el('input', { placeholder: 'Wajah (e.g. malik ne ijazat di)' });
                  r.dataset.reason = '1';
                  return DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Override ki wajah' }), r]);
                })(),
              ]),
              buttons: [
                { label: 'Cancel', onClick: (m) => m.close() },
                {
                  label: 'Override & Save',
                  class: 'danger',
                  onClick: async (m) => {
                    const pin = m.body.querySelector('[data-pin]').value;
                    const reason = m.body.querySelector('[data-reason]').value;
                    m.close();
                    try {
                      const inv2 = await DP.post('/invoices', Object.assign({}, payload, { override_pin: pin, notes: (payload.notes || '') + ' | OVERRIDE: ' + reason }));
                      DP.toast('Override ke sath bill ban gaya: ' + inv2.invoice_no, 'ok');
                      cart.length = 0; state.customer = null; draw();
                      afterSave(inv2, print);
                    } catch (e2) {
                      DP.toast(e2.message, 'bad');
                    }
                  },
                },
              ],
            });
          } else {
            DP.toast(err.message, 'bad');
          }
        }
      }

      function afterSave(inv, print) {
        const full = DP.get('/invoices/' + inv.id + '/print');
        full.then((data) => {
          if (print) DP.print.invoice(data, {});
          DP.modal({
            title: '✅ Bill save ho gaya — ' + inv.invoice_no,
            size: 'sm',
            body: DP.el('div', { class: 'col' }, [
              DP.ui.statLine('Total', 'Rs ' + DP.fmt.money0(inv.total_paisa)),
              DP.ui.statLine('Sale type', inv.sale_type === 'CASH' ? 'Cash' : 'Udhaar'),
              DP.ui.statLine('Customer', inv.customer_name),
              DP.ui.statLine('Customer balance', 'Rs ' + DP.fmt.money0(inv.customer_balance)),
              DP.el('div', { class: 'row tight', style: { marginTop: '8px' } }, [
                DP.el('button', { class: 'btn sm primary', text: '🖨️ Thermal (80mm)', onclick: () => DP.print.invoice(data, { paper: '80mm' }) }),
                DP.el('button', { class: 'btn sm', text: '📄 A4 Invoice', onclick: () => DP.print.invoice(data, { paper: 'a4' }) }),
                DP.el('button', { class: 'btn sm', text: '💬 WhatsApp', onclick: () => DP.whatsapp(inv.customer_whatsapp || inv.customer_phone, `Assalam-o-Alaikum ${inv.customer_name}!\nAapka aaj ka bill ${inv.invoice_no} = Rs ${DP.fmt.money0(inv.total_paisa)}.\nKhata balance: Rs ${DP.fmt.money0(inv.customer_balance)}.\nShukriya — ${(DP.state.settings.company_name || '')}`) }),
              ]),
            ]),
            buttons: [{ label: 'Naya bill (F2)', class: 'primary', onClick: (m) => { m.close(); searchInput.focus(); } }],
          });
        });
      }

      /* ---------------- shortcuts ---------------- */
      function onKey(e) {
        if (e.key === 'F2') { e.preventDefault(); searchInput.focus(); }
        else if (e.key === 'F4') { e.preventDefault(); customerSearch.focus(); showCustomers(''); }
        else if (e.key === 'F9') { e.preventDefault(); save(true); }
        else if (e.key === 'F3') { e.preventDefault(); addLine(products[0]); }
        else if (e.key === 'Escape' && document.querySelectorAll('.modal-back').length === 0) { cart.length = 0; draw(); }
      }
      document.addEventListener('keydown', onKey);
      DP.cleanup = () => document.removeEventListener('keydown', onKey);

      draw();
      showResults('');
      searchInput.focus();
    },
  });
})();
