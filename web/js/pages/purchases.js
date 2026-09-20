/* Distribution Pro - Purchases, Purchase Returns, Suppliers, Payments */
(function () {
  'use strict';

  /* ================================================================ PURCHASES */
  DP.definePage({
    key: 'purchases',
    title: 'Purchases (Maal Inward)',
    sub: 'Supplier se maal aaya — batch, expiry aur bill ke sath',
    icon: '📥',
    section: 'Inventory',
    perm: 'purchases.view',
    async render(root) {
      let from = DP.monthStart(), to = DP.today(), q = '', supplier_id = '';
      const box = DP.el('div', { class: 'col' });
      root.appendChild(box);

      const columns = [
        { key: 'invoice_no', label: 'Bill No' },
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'supplier_name', label: 'Supplier' },
        { key: 'warehouse_name', label: 'Godown' },
        { key: 'total_paisa', label: 'Total', type: 'money0', align: 'right' },
        { key: 'paid_paisa', label: 'Paid', type: 'money0', align: 'right', class: 'pos' },
        { key: 'balance_paisa', label: 'Baqaya', type: 'money0', align: 'right', class: 'neg' },
        { key: 'status', label: 'Status', render: (r) => DP.ui.pill(r.status, r.status === 'PAID' ? 'ok' : r.status === 'PARTIAL' ? 'warn' : 'bad') },
        {
          key: 'act', label: '', render: (r) =>
            DP.el('button', { class: 'btn sm', text: '👁 Dekhein', onclick: () => view(r.id) }),
        },
      ];

      async function load() {
        DP.clear(box).appendChild(DP.ui.spinner());
        const rows = await DP.get(`/purchases?from=${from}&to=${to}&supplier_id=${supplier_id}&q=${encodeURIComponent(q)}`);
        DP.clear(box);
        box.appendChild(
          DP.ui.card(
            DP.el('div', { class: 'row' }, [
              DP.ui.dateRange((f, t) => { from = f; to = t; load(); }, from, to),
              DP.ui.select([{ value: '', label: 'Sab suppliers' }].concat((DP.state.lookups.suppliers || []).map((s) => ({ value: s.id, label: s.name }))), supplier_id, (e) => { supplier_id = e.target.value; load(); }),
              DP.ui.searchBox('Bill no / supplier…', (v) => { q = v; load(); }, q),
              DP.el('button', { class: 'btn sm', text: '⬇ CSV', onclick: () => DP.downloadCsv('purchases.csv', columns, rows) }),
              DP.el('button', { class: 'btn sm primary', text: '+ Naya Purchase', onclick: () => newPurchase(load), disabled: !DP.can('purchases.create') }),
            ]),
            DP.ui.table({
              columns,
              rows,
              totals: { label: 'TOTAL', total_paisa: rows.reduce((s, r) => s + Number(r.total_paisa), 0), paid_paisa: rows.reduce((s, r) => s + Number(r.paid_paisa), 0), balance_paisa: rows.reduce((s, r) => s + Number(r.balance_paisa), 0) },
              empty: 'Koi purchase nahi',
            })
          )
        );
      }

      async function view(id) {
        const p = await DP.get('/purchases/' + id);
        DP.modal({
          title: `${p.invoice_no} • ${p.supplier_name}`,
          size: 'lg',
          body: DP.el('div', { class: 'col' }, [
            DP.el('div', { class: 'grid g4' }, [
              DP.ui.kpi({ label: 'Total', value: 'Rs ' + DP.fmt.money0(p.total_paisa), tone: 'info' }),
              DP.ui.kpi({ label: 'Paid', value: 'Rs ' + DP.fmt.money0(p.paid_paisa), tone: 'ok' }),
              DP.ui.kpi({ label: 'Baqaya', value: 'Rs ' + DP.fmt.money0(p.total_paisa - p.paid_paisa), tone: 'bad' }),
              DP.ui.kpi({ label: 'Supplier total payable', value: 'Rs ' + DP.fmt.money0(p.supplier_balance), tone: 'warn' }),
            ]),
            DP.ui.table({
              columns: [
                { key: 'product_name', label: 'Item' },
                { key: 'batch_no', label: 'Batch' },
                { key: 'expiry_date', label: 'Expiry', type: 'date' },
                { key: 'qty', label: 'Qty', align: 'right', render: (r) => DP.fmt.qty(r.qty, r.carton_size) },
                { key: 'unit_cost_paisa', label: 'Cost', type: 'money', align: 'right' },
                { key: 'line_total_paisa', label: 'Amount', type: 'money', align: 'right' },
              ],
              rows: p.lines,
              totals: { label: 'TOTAL', line_total_paisa: p.total_paisa },
            }),
          ]),
          buttons: [
            { label: '🖨️ GRN Print', onClick: () => DP.print.report({ name: 'Goods Received Note ' + p.invoice_no, columns: [{ key: 'product_name', label: 'Item' }, { key: 'batch_no', label: 'Batch' }, { key: 'qty', label: 'Qty' }, { key: 'unit_cost_paisa', label: 'Cost', type: 'money' }, { key: 'line_total_paisa', label: 'Amount', type: 'money' }], rows: p.lines, totals: { label: 'TOTAL', line_total_paisa: p.total_paisa } }) },
            DP.can('payments.create') && p.total_paisa - p.paid_paisa > 0
              ? { label: '💵 Payment karein', class: 'primary', onClick: (m) => { m.close(); payment({ supplier_id: p.supplier_id, purchase_id: p.id, amount: p.total_paisa - p.paid_paisa }, load); } }
              : null,
            { label: 'Band' },
          ].filter(Boolean),
        });
      }

      await load();
    },
  });

  async function newPurchase(reload) {
    const products = await DP.get('/products?limit=5000');
    const suppliers = DP.state.lookups.suppliers || [];
    const whs = DP.state.lookups.warehouses || [];
    const lines = [];
    let payment = null;
    const supplierSel = DP.ui.select([{ value: '', label: '— Supplier chunein —' }].concat(suppliers.map((s) => ({ value: s.id, label: s.name }))), '', () => {});
    const whSel = DP.ui.select(whs.map((w) => ({ value: w.id, label: w.name })), DP.state.warehouseId || (whs[0] && whs[0].id), () => {});
    const billNo = DP.el('input', { placeholder: 'Supplier ka bill number' });
    const dateIn = DP.el('input', { type: 'date', value: DP.today() });
    const freight = DP.el('input', { type: 'number', step: '0.01', placeholder: 'Freight (Rs)', value: '' });
    const discount = DP.el('input', { type: 'number', step: '0.01', placeholder: 'Bill discount (Rs)', value: '' });
    const payNow = DP.el('input', { type: 'number', step: '0.01', placeholder: 'Abhi kitna paid (Rs)' });
    const payMethod = DP.ui.select([{ value: 'CASH', label: 'Cash' }, { value: 'BANK', label: 'Bank / Online' }, { value: 'CHEQUE', label: 'Cheque' }], 'CASH', () => {});
    const note = DP.el('input', { placeholder: 'Note' });
    const linesBox = DP.el('div', { class: 'col' });
    const prodSel = DP.ui.select([{ value: '', label: '+ Item add karein…' }].concat(products.map((p) => ({ value: p.id, label: p.name }))), '', (e) => {
      const p = products.find((x) => x.id === Number(e.target.value));
      if (!p) return;
      lines.push({
        product_id: p.id, name: p.name, carton_size: p.carton_size, cartons: 1, loose: 0,
        unit_cost_paisa: p.cost_paisa || 0, batch_no: 'B' + String(Date.now()).slice(-5), mfg_date: '', expiry_date: '', discount_pct: 0,
      });
      e.target.value = '';
      draw();
    });
    function draw() {
      DP.clear(linesBox);
      if (!lines.length) linesBox.appendChild(DP.el('div', { class: 'empty small', text: 'Item add karein — batch number aur expiry zaroor likhein' }));
      lines.forEach((l, i) => {
        linesBox.appendChild(
          DP.el('div', { class: 'line-row', style: { gridTemplateColumns: '2fr .7fr .7fr .8fr 1fr 1fr .6fr auto' } }, [
            DP.el('div', { class: 'nm', text: l.name + ` (${l.carton_size})` }),
            DP.el('input', { type: 'number', value: l.cartons, placeholder: 'Ctn', oninput: (e) => (l.cartons = Number(e.target.value) || 0) }),
            DP.el('input', { type: 'number', value: l.loose, placeholder: 'Pcs', oninput: (e) => (l.loose = Number(e.target.value) || 0) }),
            DP.el('input', { type: 'number', step: '0.01', value: DP.fmt.toRs(l.unit_cost_paisa), placeholder: 'Cost', oninput: (e) => (l.unit_cost_paisa = DP.fmt.toPaisa(e.target.value)) }),
            DP.el('input', { value: l.batch_no, placeholder: 'Batch', oninput: (e) => (l.batch_no = e.target.value) }),
            DP.el('input', { type: 'date', value: l.expiry_date, title: 'Expiry date', onchange: (e) => (l.expiry_date = e.target.value) }),
            DP.el('input', { type: 'number', value: l.discount_pct, placeholder: 'D%', oninput: (e) => (l.discount_pct = Number(e.target.value) || 0) }),
            DP.el('button', { class: 'icon-btn', text: '✕', onclick: () => { lines.splice(i, 1); draw(); } }),
          ])
        );
      });
    }
    draw();

    DP.modal({
      title: 'Naya Purchase (maal inward)',
      size: 'xl',
      body: DP.el('div', { class: 'col' }, [
        DP.el('div', { class: 'grid g4' }, [
          DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Supplier *' }), supplierSel]),
          DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Godown' }), whSel]),
          DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Bill No' }), billNo]),
          DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Date' }), dateIn]),
          DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Freight (Rs)' }), freight]),
          DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Bill discount (Rs)' }), discount]),
          DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Payment abhi (Rs)' }), payNow]),
          DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Payment method' }), payMethod]),
        ]),
        DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Note' }), note]),
        prodSel,
        linesBox,
      ]),
      buttons: [
        { label: 'Cancel', onClick: (m) => m.close() },
        {
          label: 'Purchase save karein',
          class: 'primary',
          onClick: async (m) => {
            if (!supplierSel.value) return DP.toast('Supplier chunein', 'bad');
            const valid = lines.filter((l) => Number(l.cartons) || Number(l.loose));
            if (!valid.length) return DP.toast('Item add karein', 'bad');
            try {
              const p = await DP.post('/purchases', {
                supplier_id: Number(supplierSel.value),
                warehouse_id: Number(whSel.value),
                invoice_no: billNo.value || null,
                date: dateIn.value,
                freight_paisa: DP.fmt.toPaisa(freight.value),
                discount_paisa: DP.fmt.toPaisa(discount.value),
                notes: note.value,
                payment: payNow.value ? { method: payMethod.value, amount_paisa: DP.fmt.toPaisa(payNow.value) } : null,
                lines: valid,
              });
              DP.toast(`Purchase save ho gayi — stock barh gaya (${p.invoice_no})`, 'ok');
              m.close();
              reload();
            } catch (e) {
              DP.toast(e.message, 'bad');
            }
          },
        },
      ],
    });
  }

  /* ================================================================ PURCHASE RETURNS */
  DP.definePage({
    key: 'purchase-returns',
    title: 'Purchase Returns',
    sub: 'Supplier ko maal wapas (damage / excess)',
    icon: '📤',
    section: 'Inventory',
    perm: 'purchase_returns.view',
    async render(root) {
      let from = DP.dateAdd(DP.today(), -60), to = DP.today();
      const box = DP.el('div', { class: 'col' });
      root.appendChild(box);
      async function load() {
        DP.clear(box).appendChild(DP.ui.spinner());
        const rows = await DP.get(`/purchase-returns?from=${from}&to=${to}`);
        DP.clear(box);
        box.appendChild(
          DP.ui.card(
            DP.el('div', { class: 'row' }, [
              DP.ui.dateRange((f, t) => { from = f; to = t; load(); }, from, to),
              DP.el('button', { class: 'btn sm primary', text: '+ Nayi Return', onclick: () => newPurchaseReturn(load), disabled: !DP.can('purchase_returns.create') }),
            ]),
            DP.ui.table({
              columns: [
                { key: 'return_no', label: 'Return No' },
                { key: 'date', label: 'Date', type: 'date' },
                { key: 'supplier_name', label: 'Supplier' },
                { key: 'total_paisa', label: 'Value', type: 'money0', align: 'right' },
                { key: 'reason', label: 'Wajah' },
              ],
              rows,
              totals: { label: 'TOTAL', total_paisa: rows.reduce((s, r) => s + Number(r.total_paisa), 0) },
              empty: 'Koi purchase return nahi',
            })
          )
        );
      }
      await load();
    },
  });

  async function newPurchaseReturn(reload) {
    const products = await DP.get('/products?limit=5000');
    const suppliers = DP.state.lookups.suppliers || [];
    const lines = [];
    const supplierSel = DP.ui.select(suppliers.map((s) => ({ value: s.id, label: s.name })), '', () => {});
    const whSel = DP.ui.select((DP.state.lookups.warehouses || []).map((w) => ({ value: w.id, label: w.name })), DP.state.warehouseId, () => {});
    const reason = DP.el('input', { placeholder: 'Wajah (damage, expiry, excess)' });
    const condSel = DP.ui.select([{ value: 'GOOD', label: 'Good (wapas bheja)' }, { value: 'DAMAGED', label: 'Damage / Expired' }], 'DAMAGED', () => {});
    const linesBox = DP.el('div', { class: 'col' });
    const prodSel = DP.ui.select([{ value: '', label: '+ Item add karein…' }].concat(products.map((p) => ({ value: p.id, label: p.name }))), '', (e) => {
      const p = products.find((x) => x.id === Number(e.target.value));
      if (!p) return;
      lines.push({ product_id: p.id, name: p.name, carton_size: p.carton_size, qty: 0, unit_cost_paisa: p.cost_paisa || 0 });
      e.target.value = '';
      draw();
    });
    function draw() {
      DP.clear(linesBox);
      lines.forEach((l, i) => {
        linesBox.appendChild(
          DP.el('div', { class: 'line-row', style: { gridTemplateColumns: '2.6fr .9fr .9fr auto' } }, [
            DP.el('div', { class: 'nm', text: l.name }),
            DP.el('input', { type: 'number', value: l.qty, placeholder: 'Qty pcs', oninput: (e) => (l.qty = Number(e.target.value) || 0) }),
            DP.el('input', { type: 'number', step: '0.01', value: DP.fmt.toRs(l.unit_cost_paisa), oninput: (e) => (l.unit_cost_paisa = DP.fmt.toPaisa(e.target.value)) }),
            DP.el('button', { class: 'icon-btn', text: '✕', onclick: () => { lines.splice(i, 1); draw(); } }),
          ])
        );
      });
    }
    DP.modal({
      title: 'Purchase Return (supplier ko wapsi)',
      size: 'lg',
      body: DP.el('div', { class: 'col' }, [
        DP.el('div', { class: 'grid g3' }, [
          DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Supplier *' }), supplierSel]),
          DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Godown' }), whSel]),
          DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Condition' }), condSel]),
          DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Wajah' }), reason]),
          DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Item add' }), prodSel]),
        ]),
        linesBox,
      ]),
      buttons: [
        { label: 'Cancel', onClick: (m) => m.close() },
        {
          label: 'Return save karein',
          class: 'primary',
          onClick: async (m) => {
            const valid = lines.filter((l) => Number(l.qty) > 0);
            if (!supplierSel.value || !valid.length) return DP.toast('Supplier aur item zaroori hai', 'bad');
            try {
              await DP.post('/purchase-returns', {
                supplier_id: Number(supplierSel.value),
                warehouse_id: Number(whSel.value),
                reason: reason.value,
                lines: valid.map((l) => ({ product_id: l.product_id, qty: l.qty, unit_cost_paisa: l.unit_cost_paisa, condition: condSel.value })),
              });
              DP.toast('Purchase return ho gaya — stock kam aur payable kam', 'ok');
              m.close();
              reload();
            } catch (e) {
              DP.toast(e.message, 'bad');
            }
          },
        },
      ],
    });
  }

  /* ================================================================ PAYMENT TO SUPPLIER */
  DP.paymentModal = async function payment(prefill = {}, reload) {
    const suppliers = DP.state.lookups.suppliers || [];
    const form = DP.ui.form([
      { key: 'supplier_id', label: 'Supplier *', type: 'select', options: suppliers.map((s) => ({ value: s.id, label: `${s.name} (payable Rs ${DP.fmt.money0(s.balance_paisa)})` })), value: prefill.supplier_id },
      { key: 'amount_paisa', label: 'Amount (Rs) *', type: 'money', value: prefill.amount || 0 },
      { key: 'method', label: 'Method', type: 'select', options: [{ value: 'CASH', label: 'Cash' }, { value: 'BANK', label: 'Bank / Online' }, { value: 'CHEQUE', label: 'Cheque' }], value: 'CASH' },
      { key: 'bank_name', label: 'Bank (agar cheque/bank)', type: 'text' },
      { key: 'cheque_no', label: 'Cheque No', type: 'text' },
      { key: 'cheque_date', label: 'Cheque Date', type: 'date', value: DP.today() },
      { key: 'notes', label: 'Note', type: 'text' },
    ]);
    DP.modal({
      title: 'Supplier Payment',
      body: form,
      buttons: [
        { label: 'Cancel', onClick: (m) => m.close() },
        {
          label: 'Payment save karein',
          class: 'primary',
          onClick: async (m) => {
            const v = form.getValues();
            if (!v.supplier_id || !v.amount_paisa) return DP.toast('Supplier aur amount zaroori', 'bad');
            try {
              const p = await DP.post('/payments', Object.assign({ purchase_id: prefill.purchase_id || null }, v));
              DP.toast('Payment ho gayi: ' + p.payment_no, 'ok');
              m.close();
              if (reload) reload();
              if (DP.state.route === 'payments') DP.rerender();
            } catch (e) {
              DP.toast(e.message, 'bad');
            }
          },
        },
      ],
    });
  };
  const payment = DP.paymentModal;
})();
