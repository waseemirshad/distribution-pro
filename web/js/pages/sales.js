/* Distribution Pro - Invoices, Sales Returns, Orders, Van Sales */
(function () {
  'use strict';
  const statusPill = (st) => DP.ui.pill(st, st === 'PAID' ? 'ok' : st === 'PARTIAL' ? 'warn' : st === 'VOID' ? 'bad' : st === 'DELIVERED' ? 'ok' : st === 'BOOKED' ? 'info' : 'warn');

  /* ================================================================ INVOICES */
  DP.definePage({
    key: 'invoices',
    title: 'Sales / Bills',
    sub: 'Sab bills, udhaar aur recovery status',
    icon: '📄',
    section: 'Sales',
    perm: 'invoices.view',
    async render(root) {
      let from = DP.monthStart(), to = DP.today(), q = '', status = 'ALL', saleType = '';
      const box = DP.el('div', { class: 'col' });
      root.appendChild(box);

      async function load() {
        DP.clear(box).appendChild(DP.ui.spinner());
        const rows = await DP.get(`/invoices?from=${from}&to=${to}&status=${status}&sale_type=${saleType}&q=${encodeURIComponent(q)}&limit=500`);
        DP.clear(box);
        const totals = {
          label: 'TOTAL',
          total_paisa: rows.reduce((s, r) => s + Number(r.total_paisa), 0),
          paid_paisa: rows.reduce((s, r) => s + Number(r.paid_paisa), 0),
          balance_paisa: rows.reduce((s, r) => s + Number(r.balance_paisa), 0),
          gross_profit_paisa: DP.can('cost.view') ? rows.reduce((s, r) => s + Number(r.gross_profit_paisa || 0), 0) : undefined,
        };
        box.appendChild(
          DP.ui.card(
            DP.el('div', { class: 'row' }, [
              DP.ui.dateRange((f, t) => { from = f; to = t; load(); }, from, to),
              DP.ui.searchBox('Bill no / customer…', (v) => { q = v; load(); }, q),
              DP.ui.select([{ value: 'ALL', label: 'Sab status' }, { value: 'UNPAID', label: 'Udhaar (Unpaid)' }, { value: 'PARTIAL', label: 'Kuch paid' }, { value: 'PAID', label: 'Paid' }], status, (e) => { status = e.target.value; load(); }),
              DP.ui.select([{ value: '', label: 'Cash + Credit' }, { value: 'CASH', label: 'Sirf Cash' }, { value: 'CREDIT', label: 'Sirf Udhaar' }], saleType, (e) => { saleType = e.target.value; load(); }),
              DP.el('button', { class: 'btn sm', text: '⬇ CSV', onclick: () => DP.downloadCsv(`invoices-${DP.today()}.csv`, columns, rows) }),
              DP.el('button', { class: 'btn sm primary', text: '+ Naya Bill', onclick: () => DP.go('pos') }),
            ]),
            DP.ui.table({
              columns,
              rows,
              totals,
              onRowClick: (r) => viewInvoice(r.id),
              empty: 'Is range me koi bill nahi',
            })
          )
        );
      }

      const columns = [
        { key: 'invoice_no', label: 'Bill No', render: (r) => DP.el('b', { text: r.invoice_no }) },
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'customer_name', label: 'Customer', render: (r) => DP.el('div', {}, [DP.el('div', { text: r.customer_name }), DP.el('div', { class: 'tiny muted', text: r.customer_phone || '' })]) },
        { key: 'sale_type', label: 'Type', render: (r) => DP.ui.pill(r.sale_type === 'CASH' ? 'Cash' : 'Udhaar', r.sale_type === 'CASH' ? 'ok' : 'warn') },
        { key: 'total_paisa', label: 'Total', type: 'money0', align: 'right' },
        { key: 'paid_paisa', label: 'Paid', type: 'money0', align: 'right', class: 'pos' },
        { key: 'balance_paisa', label: 'Balance', type: 'money0', align: 'right', render: (r) => DP.el('b', { class: Number(r.balance_paisa) > 0 ? 'neg' : 'muted', text: DP.fmt.money0(r.balance_paisa) }) },
        DP.can('cost.view') ? { key: 'gross_profit_paisa', label: 'Profit', type: 'money0', align: 'right' } : null,
        { key: 'status', label: 'Status', render: (r) => statusPill(r.status) },
        {
          key: 'act', label: '', render: (r) =>
            DP.el('div', { class: 'row tight' }, [
              DP.el('button', { class: 'btn sm', text: '👁', title: 'Dekhein', onclick: (e) => { e.stopPropagation(); viewInvoice(r.id); } }),
              DP.el('button', { class: 'btn sm', text: '🖨️', title: 'Print', onclick: async (e) => { e.stopPropagation(); const d = await DP.get('/invoices/' + r.id + '/print'); DP.print.invoice(d, {}); } }),
              DP.el('button', { class: 'btn sm', text: '💬', title: 'WhatsApp', onclick: (e) => { e.stopPropagation(); waBill(r); } }),
              DP.el('button', { class: 'btn sm', text: '↩️', title: 'Wapsi (return)', onclick: (e) => { e.stopPropagation(); DP.go('sales-returns', { customer_id: r.customer_id, invoice_id: r.id }); } }),
            ]),
        },
      ].filter(Boolean);

      async function viewInvoice(id) {
        const inv = await DP.get('/invoices/' + id);
        const data = await DP.get('/invoices/' + id + '/print');
        DP.modal({
          title: `${inv.invoice_no} • ${inv.customer_name}`,
          size: 'lg',
          body: DP.el('div', { class: 'col' }, [
            DP.el('div', { class: 'grid g4' }, [
              DP.ui.kpi({ label: 'Total', value: 'Rs ' + DP.fmt.money0(inv.total_paisa), tone: 'info' }),
              DP.ui.kpi({ label: 'Paid', value: 'Rs ' + DP.fmt.money0(inv.paid_paisa), tone: 'ok' }),
              DP.ui.kpi({ label: 'Balance', value: 'Rs ' + DP.fmt.money0(Number(inv.total_paisa) - Number(inv.paid_paisa)), tone: Number(inv.total_paisa) - Number(inv.paid_paisa) > 0 ? 'bad' : 'ok' }),
              DP.ui.kpi({ label: 'Customer ka total udhaar', value: 'Rs ' + DP.fmt.money0(inv.customer_balance), tone: 'warn' }),
            ]),
            DP.ui.table({
              columns: [
                { key: 'product_name', label: 'Item', render: (r) => DP.el('div', {}, [DP.el('span', { text: r.product_name }), r.is_free ? DP.ui.pill('FREE', 'ok') : null, DP.el('div', { class: 'tiny muted', text: r.batch_no ? 'Batch ' + r.batch_no + (r.expiry_date ? ' • exp ' + DP.fmt.date(r.expiry_date) : '') : '' })]) },
                { key: 'qty', label: 'Qty', align: 'right', render: (r) => DP.fmt.qty(r.qty, r.carton_size) },
                { key: 'unit_price_paisa', label: 'Rate', type: 'money', align: 'right' },
                { key: 'discount_pct', label: 'Disc%', align: 'right' },
                { key: 'line_total_paisa', label: 'Amount', type: 'money', align: 'right' },
              ],
              rows: inv.lines,
              totals: { label: 'TOTAL', line_total_paisa: inv.total_paisa },
            }),
            inv.receipts && inv.receipts.length
              ? DP.ui.card('Is bill par mili payments', DP.ui.table({
                  columns: [
                    { key: 'receipt_no', label: 'Receipt' },
                    { key: 'date', label: 'Date', type: 'date' },
                    { key: 'method', label: 'Method' },
                    { key: 'cheque_no', label: 'Cheque' },
                    { key: 'amount_paisa', label: 'Amount', type: 'money', align: 'right' },
                  ],
                  rows: inv.receipts,
                }))
              : null,
          ]),
          buttons: [
            { label: '🖨️ Thermal', onClick: () => DP.print.invoice(data, { paper: '80mm' }) },
            { label: '📄 A4', onClick: () => DP.print.invoice(data, { paper: 'a4' }) },
            { label: '💬 WhatsApp', onClick: () => waBill(inv) },
            DP.can('invoices.void')
              ? {
                  label: '🚫 Void karein',
                  class: 'danger',
                  onClick: (m) => {
                    m.close();
                    voidInvoice(inv);
                  },
                }
              : null,
            { label: 'Band karein', class: 'primary' },
          ].filter(Boolean),
        });
      }

      async function voidInvoice(inv) {
        const reason = await DP.prompt({ title: 'Bill void karne ki wajah', label: 'Wajah', placeholder: 'e.g. ghalat entry' });
        if (reason === null) return;
        const pin = await DP.prompt({ title: 'Manager PIN', label: 'PIN', type: 'password' });
        if (pin === null) return;
        try {
          await DP.post(`/invoices/${inv.id}/void`, { reason, pin });
          DP.toast('Bill void ho gaya aur stock wapas aa gaya', 'ok');
          load();
        } catch (e) {
          DP.toast(e.message, 'bad');
        }
      }

      function waBill(inv) {
        DP.whatsapp(
          inv.customer_whatsapp || inv.customer_phone,
          `Assalam-o-Alaikum ${inv.customer_name}!\nBill ${inv.invoice_no} (${DP.fmt.date(inv.date)})\nTotal: Rs ${DP.fmt.money0(inv.total_paisa)}\nBaqaya: Rs ${DP.fmt.money0(Number(inv.total_paisa) - Number(inv.paid_paisa))}\nKhata balance: Rs ${DP.fmt.money0(inv.customer_balance)}\n— ${DP.state.settings.company_name || ''}`
        );
      }

      await load();
    },
  });

  /* ================================================================ SALES RETURNS */
  DP.definePage({
    key: 'sales-returns',
    title: 'Sales Returns (Wapsi)',
    sub: 'Customer se maal wapsi — Good stock ya Scrap',
    icon: '↩️',
    section: 'Sales',
    perm: 'returns.view',
    async render(root, params) {
      let from = DP.monthStart(), to = DP.today();
      const box = DP.el('div', { class: 'col' });
      root.appendChild(box);

      async function load() {
        DP.clear(box).appendChild(DP.ui.spinner());
        const rows = await DP.get(`/sales-returns?from=${from}&to=${to}`);
        DP.clear(box);
        box.appendChild(
          DP.ui.card(
            DP.el('div', { class: 'row' }, [
              DP.ui.dateRange((f, t) => { from = f; to = t; load(); }, from, to),
              DP.el('button', { class: 'btn sm primary', text: '+ Nayi Wapsi', onclick: () => newReturn(params) , disabled: !DP.can('returns.create')}),
            ]),
            DP.ui.table({
              columns: [
                { key: 'return_no', label: 'Return No' },
                { key: 'date', label: 'Date', type: 'date' },
                { key: 'customer_name', label: 'Customer' },
                { key: 'kind', label: 'Type', render: (r) => DP.ui.pill(r.kind === 'SCRAP' ? 'Scrap/Damage' : 'Good stock', r.kind === 'SCRAP' ? 'bad' : 'ok') },
                { key: 'warehouse_name', label: 'Godown' },
                { key: 'total_paisa', label: 'Value', type: 'money0', align: 'right' },
                { key: 'reason', label: 'Wajah' },
                { key: 'username', label: 'User' },
              ],
              rows,
              totals: { label: 'TOTAL', total_paisa: rows.reduce((s, r) => s + Number(r.total_paisa), 0) },
              empty: 'Koi wapsi nahi hui',
            })
          )
        );
      }
      await load();
    },
  });

  DP.newReturn = async function (params = {}) {
    const customers = await DP.get('/customers');
    const products = await DP.get('/products?limit=5000');
    const lines = [];
    let customer = params.customer_id ? customers.find((c) => c.id === Number(params.customer_id)) : null;
    let invoice = null;

    const custSel = DP.ui.select([{ value: '', label: '— Customer chunein —' }].concat(customers.map((c) => ({ value: c.id, label: `${c.name} (${c.area || ''})` }))), customer ? customer.id : '', async (e) => {
      customer = customers.find((c) => c.id === Number(e.target.value)) || null;
      await loadInvoices();
    });
    const invSel = DP.ui.select([{ value: '', label: '— Koi bill nahi (manual wapsi) —' }], '', async (e) => {
      const id = Number(e.target.value);
      if (!id) { invoice = null; drawLines(); return; }
      invoice = await DP.get('/invoices/' + id);
      lines.length = 0;
      invoice.lines.forEach((l) => lines.push({ product_id: l.product_id, product_name: l.product_name, carton_size: l.carton_size, qty: 0, unit_price_paisa: l.unit_price_paisa, batch_id: l.batch_id, max: l.qty }));
      drawLines();
    });
    const kindSel = DP.ui.select([{ value: 'GOOD', label: 'Good stock (wapas godown)' }, { value: 'SCRAP', label: 'Damage / Scrap (scrap godown)' }], 'GOOD', () => {});
    const reason = DP.el('input', { placeholder: 'Wajah (e.g. excess stock, toot gaya)' });
    const refundSel = DP.ui.select([{ value: '', label: 'Balance me adjust karein (udhaar kam)' }, { value: 'CASH', label: 'Cash wapas dein' }, { value: 'BANK', label: 'Bank se wapas' }], '', () => {});
    const linesBox = DP.el('div', { class: 'col' });
    const prodSel = DP.ui.select([{ value: '', label: '+ Item add karein…' }].concat(products.map((p) => ({ value: p.id, label: p.name }))), '', (e) => {
      const p = products.find((x) => x.id === Number(e.target.value));
      if (!p) return;
      lines.push({ product_id: p.id, product_name: p.name, carton_size: p.carton_size, qty: 0, unit_price_paisa: p.wholesale_paisa, batch_id: null });
      e.target.value = '';
      drawLines();
    });

    async function loadInvoices() {
      if (!customer) return;
      const invs = await DP.get(`/invoices?customer_id=${customer.id}&limit=40`);
      DP.clear(invSel);
      invSel.appendChild(DP.el('option', { value: '', text: '— Koi bill nahi (manual wapsi) —' }));
      invs.forEach((i) => invSel.appendChild(DP.el('option', { value: i.id, text: `${i.invoice_no} • ${DP.fmt.date(i.date)} • Rs ${DP.fmt.money0(i.total_paisa)}` })));
    }

    function drawLines() {
      DP.clear(linesBox);
      if (!lines.length) {
        linesBox.appendChild(DP.el('div', { class: 'empty small', text: 'Item add karein ya upar bill select karein' }));
        return;
      }
      lines.forEach((l, idx) => {
        linesBox.appendChild(
          DP.el('div', { class: 'line-row', style: { gridTemplateColumns: '2.4fr .9fr .9fr auto' } }, [
            DP.el('div', {}, [DP.el('div', { class: 'nm', text: l.product_name }), DP.el('div', { class: 'tiny muted', text: `carton ${l.carton_size} pcs${l.max ? ' • bill me ' + l.max : ''}` })]),
            DP.el('input', { type: 'number', value: l.qty, placeholder: 'Qty pcs', oninput: (e) => (l.qty = Number(e.target.value) || 0) }),
            DP.el('input', { type: 'number', step: '0.01', value: DP.fmt.toRs(l.unit_price_paisa), oninput: (e) => (l.unit_price_paisa = DP.fmt.toPaisa(e.target.value)) }),
            DP.el('button', { class: 'icon-btn', text: '✕', onclick: () => { lines.splice(idx, 1); drawLines(); } }),
          ])
        );
      });
    }

    DP.modal({
      title: 'Sales Return — maal wapsi',
      size: 'lg',
      body: DP.el('div', { class: 'col' }, [
        DP.el('div', { class: 'grid g2' }, [
          DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Customer *' }), custSel]),
          DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Bill (optional)' }), invSel]),
          DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Wapsi ka type' }), kindSel]),
          DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Balance / refund' }), refundSel]),
          DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Wajah' }), reason]),
          DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Item add' }), prodSel]),
        ]),
        linesBox,
      ]),
      buttons: [
        { label: 'Cancel', onClick: (m) => m.close() },
        {
          label: 'Wapsi save karein',
          class: 'primary',
          onClick: async (m) => {
            if (!customer) return DP.toast('Customer chunein', 'bad');
            const valid = lines.filter((l) => Number(l.qty) > 0);
            if (!valid.length) return DP.toast('Kam az kam ek item ki qty likhein', 'bad');
            try {
              await DP.post('/sales-returns', {
                customer_id: customer.id,
                invoice_id: invoice ? invoice.id : null,
                date: DP.today(),
                kind: kindSel.value,
                refund_method: refundSel.value || null,
                reason: reason.value,
                lines: valid.map((l) => ({ product_id: l.product_id, qty: Number(l.qty), unit_price_paisa: l.unit_price_paisa, batch_id: l.batch_id })),
              });
              DP.toast('Wapsi record ho gayi — stock wapas aa gaya', 'ok');
              m.close();
              DP.rerender();
            } catch (e) {
              DP.toast(e.message, 'bad');
            }
          },
        },
      ],
    });
    if (params.invoice_id) {
      const inv = await DP.get('/invoices/' + params.invoice_id);
      invoice = inv;
      customer = customers.find((c) => c.id === inv.customer_id);
      if (customer) custSel.value = customer.id;
      await loadInvoices();
      invSel.value = inv.id;
      inv.lines.forEach((l) => lines.push({ product_id: l.product_id, product_name: l.product_name, carton_size: l.carton_size, qty: 0, unit_price_paisa: l.unit_price_paisa, batch_id: l.batch_id, max: l.qty }));
      drawLines();
    }
  };

  /* ================================================================ ORDERS */
  DP.definePage({
    key: 'orders',
    title: 'Order Booking',
    sub: 'Salesman market se order book kare — delivery par bill bane',
    icon: '📝',
    section: 'Sales',
    perm: 'orders.view',
    async render(root) {
      let from = DP.monthStart(), to = DP.today(), status = 'BOOKED';
      const box = DP.el('div', { class: 'col' });
      root.appendChild(box);

      async function load() {
        DP.clear(box).appendChild(DP.ui.spinner());
        const rows = await DP.get(`/orders?from=${from}&to=${to}${status ? '&status=' + status : ''}`);
        DP.clear(box);
        box.appendChild(
          DP.ui.card(
            DP.el('div', { class: 'row' }, [
              DP.ui.dateRange((f, t) => { from = f; to = t; load(); }, from, to),
              DP.ui.select([{ value: '', label: 'Sab orders' }, { value: 'BOOKED', label: 'Pending (Booked)' }, { value: 'DELIVERED', label: 'Delivered' }, { value: 'CANCELLED', label: 'Cancelled' }], status, (e) => { status = e.target.value; load(); }),
              DP.el('button', { class: 'btn sm primary', text: '+ Naya Order', onclick: () => newOrder(), disabled: !DP.can('orders.create') }),
            ]),
            DP.ui.table({
              columns: [
                { key: 'order_no', label: 'Order No' },
                { key: 'date', label: 'Date', type: 'date' },
                { key: 'customer_name', label: 'Customer' },
                { key: 'salesman_name', label: 'Salesman' },
                { key: 'route_name', label: 'Route' },
                { key: 'total_paisa', label: 'Value', type: 'money0', align: 'right' },
                { key: 'status', label: 'Status', render: (r) => statusPill(r.status) },
                {
                  key: 'act', label: '', render: (r) =>
                    DP.el('div', { class: 'row tight' }, [
                      DP.el('button', { class: 'btn sm', text: '👁', onclick: () => viewOrder(r.id) }),
                      r.status === 'BOOKED' && DP.can('invoices.create')
                        ? DP.el('button', { class: 'btn sm primary', text: '🚚 Bill banao', onclick: () => deliver(r) })
                        : null,
                      r.status === 'BOOKED'
                        ? DP.el('button', { class: 'btn sm', text: '✕', title: 'Cancel', onclick: async () => { if (await DP.confirm('Order cancel karna hai?')) { await DP.post(`/orders/${r.id}/cancel`, { reason: 'cancelled by user' }); load(); } } })
                        : null,
                    ]),
                },
              ],
              rows,
              empty: 'Koi order nahi',
            })
          )
        );
      }

      async function viewOrder(id) {
        const o = await DP.get('/orders/' + id);
        DP.modal({
          title: `${o.order_no} • ${o.customer_name}`,
          size: 'lg',
          body: DP.el('div', { class: 'col' }, [
            DP.el('div', { class: 'row' }, [DP.ui.pill('Date: ' + DP.fmt.date(o.date)), DP.ui.pill('Salesman: ' + (o.salesman_name || '—')), DP.ui.pill('Route: ' + (o.route_name || '—')), statusPill(o.status)]),
            DP.ui.table({
              columns: [
                { key: 'product_name', label: 'Item' },
                { key: 'qty', label: 'Qty', align: 'right', render: (r) => DP.fmt.qty(r.qty, r.carton_size) },
                { key: 'unit_price_paisa', label: 'Rate', type: 'money', align: 'right' },
                { key: 'line_total_paisa', label: 'Amount', type: 'money', align: 'right' },
              ],
              rows: o.lines,
              totals: { label: 'TOTAL', line_total_paisa: o.total_paisa },
            }),
          ]),
          buttons: [
            { label: '🖨️ Loading slip', onClick: () => DP.print.slip('ORDER / LOADING SLIP ' + o.order_no, [['Customer', o.customer_name || ''], ['Date', DP.fmt.date(o.date)], ['Salesman', o.salesman_name || ''], ['Total', 'Rs ' + DP.fmt.money0(o.total_paisa)]], { table: `<table><thead><tr><th>Item</th><th class="right">Qty</th></tr></thead><tbody>${o.lines.map((l) => `<tr><td>${DP.esc(l.product_name)}</td><td class="right">${DP.esc(DP.fmt.qty(l.qty, l.carton_size))}</td></tr>`).join('')}</tbody></table>` }) },
            { label: 'Band', class: 'primary' },
          ],
        });
      }

      async function deliver(r) {
        const o = await DP.get('/orders/' + r.id);
        const pay = DP.ui.select([{ value: 'CREDIT', label: 'Udhaar (Credit)' }, { value: 'CASH', label: 'Cash' }], 'CREDIT', () => {});
        DP.modal({
          title: 'Order ko bill me convert karein — ' + o.order_no,
          size: 'sm',
          body: DP.el('div', { class: 'col' }, [
            DP.ui.statLine('Customer', o.customer_name),
            DP.ui.statLine('Items', o.lines.length + ''),
            DP.ui.statLine('Value', 'Rs ' + DP.fmt.money0(o.total_paisa)),
            DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Payment type' }), pay]),
          ]),
          buttons: [
            { label: 'Cancel', onClick: (m) => m.close() },
            {
              label: 'Bill banao',
              class: 'primary',
              onClick: async (m) => {
                try {
                  const inv = await DP.post(`/orders/${r.id}/convert`, { sale_type: pay.value });
                  m.close();
                  DP.toast('Bill ban gaya: ' + inv.invoice_no, 'ok');
                  load();
                } catch (e) {
                  DP.toast(e.message + (e.code === 'CREDIT_LIMIT' ? ' — POS se PIN override ke sath banayein' : ''), 'bad');
                }
              },
            },
          ],
        });
      }

      async function newOrder() {
        const customers = await DP.get('/customers');
        const products = await DP.get('/products?limit=5000');
        const lines = [];
        const custSel = DP.ui.select([{ value: '', label: '— Customer chunein —' }].concat(customers.map((c) => ({ value: c.id, label: c.name }))), '', () => {});
        const smSel = DP.ui.select([{ value: '', label: '— Salesman —' }].concat((DP.state.lookups.salesmen || []).map((s) => ({ value: s.id, label: s.name }))), DP.state.user.salesman_id || '', () => {});
        const note = DP.el('input', { placeholder: 'Note / delivery instructions' });
        const linesBox = DP.el('div', { class: 'col' });
        const prodSel = DP.ui.select([{ value: '', label: '+ Item add karein…' }].concat(products.map((p) => ({ value: p.id, label: p.name }))), '', (e) => {
          const p = products.find((x) => x.id === Number(e.target.value));
          if (!p) return;
          lines.push({ product_id: p.id, product_name: p.name, carton_size: p.carton_size, cartons: 1, loose: 0, unit_price_paisa: p.wholesale_paisa });
          e.target.value = '';
          draw();
        });
        function draw() {
          DP.clear(linesBox);
          lines.forEach((l, i) => {
            linesBox.appendChild(
              DP.el('div', { class: 'line-row', style: { gridTemplateColumns: '2.4fr .9fr .9fr .9fr auto' } }, [
                DP.el('div', { class: 'nm', text: l.product_name }),
                DP.el('input', { type: 'number', value: l.cartons, oninput: (e) => (l.cartons = Number(e.target.value) || 0) }),
                DP.el('input', { type: 'number', value: l.loose, oninput: (e) => (l.loose = Number(e.target.value) || 0) }),
                DP.el('input', { type: 'number', step: '0.01', value: DP.fmt.toRs(l.unit_price_paisa), oninput: (e) => (l.unit_price_paisa = DP.fmt.toPaisa(e.target.value)) }),
                DP.el('button', { class: 'icon-btn', text: '✕', onclick: () => { lines.splice(i, 1); draw(); } }),
              ])
            );
          });
        }
        DP.modal({
          title: 'Naya Order (booking)',
          size: 'lg',
          body: DP.el('div', { class: 'col' }, [
            DP.el('div', { class: 'grid g3' }, [
              DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Customer *' }), custSel]),
              DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Salesman' }), smSel]),
              DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Note' }), note]),
            ]),
            prodSel,
            linesBox,
          ]),
          buttons: [
            { label: 'Cancel', onClick: (m) => m.close() },
            {
              label: 'Order save karein',
              class: 'primary',
              onClick: async (m) => {
                if (!custSel.value) return DP.toast('Customer chunein', 'bad');
                if (!lines.length) return DP.toast('Item add karein', 'bad');
                try {
                  await DP.post('/orders', {
                    customer_id: Number(custSel.value),
                    salesman_id: smSel.value ? Number(smSel.value) : null,
                    notes: note.value,
                    lines: lines.map((l) => ({ product_id: l.product_id, cartons: l.cartons, loose: l.loose, unit_price_paisa: l.unit_price_paisa })),
                  });
                  DP.toast('Order book ho gaya', 'ok');
                  m.close();
                  load();
                } catch (e) {
                  DP.toast(e.message, 'bad');
                }
              },
            },
          ],
        });
      }

      await load();
    },
  });

  /* ================================================================ VAN SALES */
  DP.definePage({
    key: 'van',
    title: 'Van Sales (Mobile Godown)',
    sub: 'Subah loading sheet, sham settlement — shortage foran pakar me',
    icon: '🚚',
    section: 'Sales',
    perm: 'van.view',
    async render(root) {
      let from = DP.dateAdd(DP.today(), -14), to = DP.today();
      const box = DP.el('div', { class: 'col' });
      root.appendChild(box);

      async function load() {
        DP.clear(box).appendChild(DP.ui.spinner());
        const rows = await DP.get(`/van-loads?from=${from}&to=${to}`);
        DP.clear(box);
        box.appendChild(
          DP.ui.card(
            DP.el('div', { class: 'row' }, [
              DP.ui.dateRange((f, t) => { from = f; to = t; load(); }, from, to),
              DP.el('button', { class: 'btn sm', text: '📦 Loading sheets', onclick: () => DP.go('reports', { report: 'van_settlement' }) }),
              DP.el('button', { class: 'btn sm primary', text: '+ Nayi Loading Sheet', onclick: () => newLoad(), disabled: !DP.can('van.create') }),
            ]),
            DP.ui.table({
              columns: [
                { key: 'load_no', label: 'Load No' },
                { key: 'date', label: 'Date', type: 'date' },
                { key: 'vehicle_no', label: 'Vehicle' },
                { key: 'salesman_name', label: 'Salesman' },
                { key: 'route_name', label: 'Route' },
                { key: 'loaded_qty', label: 'Loaded', align: 'right' },
                { key: 'sold_qty', label: 'Sold', align: 'right' },
                { key: 'returned_qty', label: 'Returned', align: 'right' },
                { key: 'short_qty', label: 'Short', align: 'right', render: (r) => (Number(r.short_qty) ? DP.ui.pill(String(r.short_qty), 'bad') : '0') },
                { key: 'shortage_value_paisa', label: 'Shortage Rs', type: 'money0', align: 'right' },
                { key: 'status', label: 'Status', render: (r) => DP.ui.pill(r.status === 'OPEN' ? 'Chal rahi' : 'Settled', r.status === 'OPEN' ? 'warn' : 'ok') },
                {
                  key: 'act', label: '', render: (r) =>
                    DP.el('div', { class: 'row tight' }, [
                      DP.el('button', { class: 'btn sm', text: '👁', onclick: () => viewLoad(r.id) }),
                      r.status === 'OPEN' && DP.can('van.settle') ? DP.el('button', { class: 'btn sm primary', text: 'Settle', onclick: () => settle(r.id) }) : null,
                    ]),
                },
              ],
              rows,
              empty: 'Koi van load nahi',
            })
          )
        );
      }

      async function viewLoad(id) {
        const v = await DP.get('/van-loads/' + id);
        DP.modal({
          title: `${v.load_no} • ${v.vehicle_no || ''} • ${v.salesman_name || ''}`,
          size: 'lg',
          body: DP.el('div', { class: 'col' }, [
            DP.el('div', { class: 'grid g4' }, [
              DP.ui.kpi({ label: 'Loaded', value: v.loaded_qty + ' pcs', sub: 'Rs ' + DP.fmt.money0(v.loaded_value_paisa) }),
              DP.ui.kpi({ label: 'Sold', value: v.sold_qty + ' pcs', sub: 'Rs ' + DP.fmt.money0(v.sold_value_paisa), tone: 'ok' }),
              DP.ui.kpi({ label: 'Returned', value: v.returned_qty + ' pcs', sub: 'Rs ' + DP.fmt.money0(v.returned_value_paisa), tone: 'info' }),
              DP.ui.kpi({ label: 'Short / Leak', value: v.short_qty + ' pcs', sub: 'Rs ' + DP.fmt.money0(v.shortage_value_paisa), tone: Number(v.short_qty) ? 'bad' : 'ok' }),
            ]),
            DP.ui.table({
              columns: [
                { key: 'product_name', label: 'Item' },
                { key: 'qty_loaded', label: 'Loaded', align: 'right' },
                { key: 'qty_sold', label: 'Sold', align: 'right' },
                { key: 'qty_returned', label: 'Returned', align: 'right' },
                { key: 'qty_short', label: 'Short', align: 'right' },
                { key: 'unit_cost_paisa', label: 'Unit Cost', type: 'money', align: 'right' },
              ],
              rows: v.lines,
            }),
          ]),
          buttons: [
            { label: '🖨️ Loading sheet print', onClick: () => DP.print.slip('VAN LOADING SHEET ' + v.load_no, [['Vehicle', v.vehicle_no || ''], ['Salesman', v.salesman_name || ''], ['Route', v.route_name || ''], ['Date', DP.fmt.date(v.date)], ['Loaded', v.loaded_qty + ' pcs'], ['Load Value', 'Rs ' + DP.fmt.money0(v.loaded_value_paisa)]], { table: `<table><thead><tr><th>Item</th><th class="right">Qty</th></tr></thead><tbody>${v.lines.map((l) => `<tr><td>${DP.esc(l.product_name)}</td><td class="right">${l.qty_loaded}</td></tr>`).join('')}</tbody></table>` }) },
            { label: 'Band', class: 'primary' },
          ],
        });
      }

      async function newLoad() {
        const products = await DP.get('/products?limit=5000');
        const vans = (DP.state.lookups.warehouses || []).filter((w) => w.type === 'VAN');
        const mains = (DP.state.lookups.warehouses || []).filter((w) => w.type !== 'VAN');
        if (!vans.length) return DP.toast('Pehle Settings se Van godown banayein (e.g. "Van 1 Mobile Godown")', 'warn');
        const lines = [];
        const vanSel = DP.ui.select(vans.map((v) => ({ value: v.id, label: v.name })), vans[0].id, () => {});
        const srcSel = DP.ui.select(mains.map((v) => ({ value: v.id, label: v.name })), DP.state.warehouseId || mains[0].id, () => {});
        const smSel = DP.ui.select([{ value: '', label: '— Salesman —' }].concat((DP.state.lookups.salesmen || []).map((s) => ({ value: s.id, label: s.name }))), '', () => {});
        const routeSel = DP.ui.select([{ value: '', label: '— Route —' }].concat((DP.state.lookups.routes || []).map((r) => ({ value: r.id, label: r.name }))), '', () => {});
        const vehicle = DP.el('input', { placeholder: 'Vehicle no (e.g. JW-4521)' });
        const linesBox = DP.el('div', { class: 'col' });
        const prodSel = DP.ui.select([{ value: '', label: '+ Item add karein…' }].concat(products.map((p) => ({ value: p.id, label: `${p.name} (stock ${p.stock})` }))), '', (e) => {
          const p = products.find((x) => x.id === Number(e.target.value));
          if (!p) return;
          lines.push({ product_id: p.id, product_name: p.name, carton_size: p.carton_size, cartons: 1, loose: 0 });
          e.target.value = '';
          draw();
        });
        function draw() {
          DP.clear(linesBox);
          lines.forEach((l, i) => {
            linesBox.appendChild(
              DP.el('div', { class: 'line-row', style: { gridTemplateColumns: '2.6fr .9fr .9fr auto' } }, [
                DP.el('div', { class: 'nm', text: l.product_name + ` (carton ${l.carton_size})` }),
                DP.el('input', { type: 'number', value: l.cartons, oninput: (e) => (l.cartons = Number(e.target.value) || 0) }),
                DP.el('input', { type: 'number', value: l.loose, oninput: (e) => (l.loose = Number(e.target.value) || 0) }),
                DP.el('button', { class: 'icon-btn', text: '✕', onclick: () => { lines.splice(i, 1); draw(); } }),
              ])
            );
          });
        }
        DP.modal({
          title: 'Nayi Van Loading Sheet (Gate Pass)',
          size: 'lg',
          body: DP.el('div', { class: 'col' }, [
            DP.el('div', { class: 'grid g3' }, [
              DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Van / Mobile godown *' }), vanSel]),
              DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Source godown *' }), srcSel]),
              DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Vehicle No' }), vehicle]),
              DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Salesman' }), smSel]),
              DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Route / Beat' }), routeSel]),
              DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Item add' }), prodSel]),
            ]),
            linesBox,
          ]),
          buttons: [
            { label: 'Cancel', onClick: (m) => m.close() },
            {
              label: 'Load chadha dein',
              class: 'primary',
              onClick: async (m) => {
                if (!lines.length) return DP.toast('Kam az kam ek item daalein', 'bad');
                try {
                  const v = await DP.post('/van-loads', {
                    date: DP.today(),
                    van_warehouse_id: Number(vanSel.value),
                    source_warehouse_id: Number(srcSel.value),
                    salesman_id: smSel.value ? Number(smSel.value) : null,
                    route_id: routeSel.value ? Number(routeSel.value) : null,
                    vehicle_no: vehicle.value,
                    lines: lines.map((l) => ({ product_id: l.product_id, cartons: l.cartons, loose: l.loose })),
                  });
                  DP.toast(`Loading sheet ban gayi: ${v.load_no}`, 'ok');
                  m.close();
                  load();
                } catch (e) {
                  DP.toast(e.message, 'bad');
                }
              },
            },
          ],
        });
      }

      async function settle(id) {
        const v = await DP.get('/van-loads/' + id);
        const inputs = {};
        const rows = v.lines.map((l) => {
          const expected = Math.max(0, Number(l.qty_loaded) - Number(l.qty_sold_now || 0));
          inputs[l.id] = { qty_returned: expected, return_to: 'MAIN' };
          return DP.el('div', { class: 'line-row', style: { gridTemplateColumns: '2.4fr .8fr .8fr .9fr' } }, [
            DP.el('div', {}, [DP.el('div', { class: 'nm', text: l.product_name }), DP.el('div', { class: 'tiny muted', text: `Loaded ${l.qty_loaded} • aaj sold ${l.qty_sold_now || 0} • wapas aana chahiye ${expected}` })]),
            DP.el('input', { type: 'number', value: expected, oninput: (e) => (inputs[l.id].qty_returned = Number(e.target.value) || 0) }),
            DP.ui.select([{ value: 'MAIN', label: 'Godown wapas' }, { value: 'SCRAP', label: 'Scrap/Damage' }], 'MAIN', (e) => (inputs[l.id].return_to = e.target.value)),
            DP.el('button', {
              class: 'btn sm',
              text: '⚠ Short',
              onclick: (e) => {
                inputs[l.id].qty_returned = Math.max(0, expected - 1);
                DP.toast('Short qty enter karein — farq shortage me jayega', 'warn');
              },
            }),
          ]);
        });
        DP.modal({
          title: `Van Settlement — ${v.load_no}`,
          size: 'lg',
          body: DP.el('div', { class: 'col' }, [
            DP.el('p', { class: 'small muted', text: 'Wapas aane wali qty likhein. Jo qty wapas nahi aayi wo SHORTAGE (loss) me jayegi — yeh foran pakri jayegi.' }),
            ...rows,
          ]),
          buttons: [
            { label: 'Cancel', onClick: (m) => m.close() },
            {
              label: 'Settlement karein',
              class: 'primary',
              onClick: async (m) => {
                try {
                  const out = await DP.post(`/van-loads/${id}/settle`, {
                    lines: Object.entries(inputs).map(([line_id, val]) => ({ line_id: Number(line_id), qty_returned: val.qty_returned, return_to: val.return_to })),
                  });
                  DP.toast(`Settlement ho gaya — shortage ${out.short_qty} pcs (Rs ${DP.fmt.money0(out.shortage_value_paisa)})`, Number(out.short_qty) ? 'warn' : 'ok');
                  m.close();
                  load();
                } catch (e) {
                  DP.toast(e.message, 'bad');
                }
              },
            },
          ],
        });
      }

      await load();
    },
  });
})();
