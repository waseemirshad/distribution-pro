/* Distribution Pro - Stock, Batches/Expiry, Transfers */
(function () {
  'use strict';

  /* ================================================================ STOCK */
  DP.definePage({
    key: 'stock',
    title: 'Stock (Godown)',
    sub: 'Har godown ka maal, value aur adjustment',
    icon: '📦',
    section: 'Inventory',
    perm: 'stock.view',
    async render(root) {
      let warehouse_id = DP.state.warehouseId || '';
      let q = '';
      const box = DP.el('div', { class: 'col' });
      root.appendChild(box);

      async function load() {
        DP.clear(box).appendChild(DP.ui.spinner());
        const rows = await DP.get(`/stock/by-warehouse?warehouse_id=${warehouse_id}&product_id=`);
        const filtered = rows.filter((r) => !q || r.product.toLowerCase().includes(q.toLowerCase()) || String(r.sku || '').toLowerCase().includes(q.toLowerCase()));
        DP.clear(box);
        const byWh = {};
        filtered.forEach((r) => (byWh[r.warehouse] = (byWh[r.warehouse] || 0) + Number(r.value_paisa)));
        box.appendChild(
          DP.el('div', { class: 'grid g3' }, Object.entries(byWh).map(([name, val]) => DP.ui.kpi({ label: name, value: 'Rs ' + DP.fmt.money0(val), sub: 'Stock value (cost)', tone: 'info' })))
        );
        box.appendChild(
          DP.ui.card(
            DP.el('div', { class: 'row' }, [
              DP.ui.select([{ value: '', label: 'Sab godown' }].concat((DP.state.lookups.warehouses || []).map((w) => ({ value: w.id, label: w.name }))), warehouse_id, (e) => { warehouse_id = e.target.value; load(); }),
              DP.ui.searchBox('Item / SKU…', (v) => { q = v; load(); }, q),
              DP.el('button', { class: 'btn sm', text: '⬇ CSV', onclick: () => DP.downloadCsv('stock.csv', columns, filtered) }),
              DP.el('button', { class: 'btn sm', text: '🖨️ Print', onclick: () => DP.print.report({ name: 'Stock Summary', columns, rows: filtered, totals: { label: 'TOTAL', qty: filtered.reduce((s, r) => s + Number(r.qty), 0), value_paisa: filtered.reduce((s, r) => s + Number(r.value_paisa), 0) } }) }),
              DP.can('stock.adjust') ? DP.el('button', { class: 'btn sm', text: '⚖️ Adjustment', onclick: () => adjust(load) }) : null,
              DP.can('stock.adjust') ? DP.el('button', { class: 'btn sm primary', text: '+ Opening Stock', onclick: () => opening(load) }) : null,
            ]),
            DP.ui.table({
              columns,
              rows: filtered,
              totals: {
                label: 'TOTAL',
                qty: filtered.reduce((s, r) => s + Number(r.qty), 0),
                value_paisa: filtered.reduce((s, r) => s + Number(r.value_paisa), 0),
              },
              empty: 'Koi stock nahi — purchase ya opening stock daalein',
            })
          )
        );
      }
      const columns = [
        { key: 'product', label: 'Item' },
        { key: 'sku', label: 'SKU' },
        { key: 'warehouse', label: 'Godown', render: (r) => DP.ui.pill(r.warehouse, r.warehouse_type === 'VAN' ? 'info' : r.warehouse_type === 'SCRAP' ? 'bad' : '') },
        { key: 'qty', label: 'Qty', align: 'right', render: (r) => DP.el('b', { text: DP.fmt.qty(r.qty, r.carton_size) }) },
        { key: 'carton_size', label: 'Carton', align: 'right' },
        DP.can('cost.view') ? { key: 'cost_paisa', label: 'Cost/pc', type: 'money', align: 'right' } : null,
        { key: 'wholesale_paisa', label: 'Wholesale', type: 'money', align: 'right' },
        DP.can('cost.view') ? { key: 'value_paisa', label: 'Value (cost)', type: 'money0', align: 'right' } : null,
      ].filter(Boolean);

      await load();
    },
  });

  function adjust(reload) {
    const products = DP.state.lookups.products || [];
    const form = DP.ui.form([
      { key: 'product_id', label: 'Item *', type: 'select', options: products.map((p) => ({ value: p.id, label: p.name })) },
      { key: 'warehouse_id', label: 'Godown *', type: 'select', options: (DP.state.lookups.warehouses || []).map((w) => ({ value: w.id, label: w.name })) },
      { key: 'qty_delta', label: 'Qty (+ in / − out)', type: 'number', required: true, hint: 'Misaal: 24 likhein to 24 pcs add honge, -6 likhein to 6 pcs nikal jayenge' },
      { key: 'cost_paisa', label: 'Cost per pc (Rs)', type: 'money', value: 0 },
      { key: 'reason', label: 'Wajah *', type: 'text', placeholder: 'e.g. Damage / counter se nikala / galti sudhari' },
    ]);
    DP.modal({
      title: 'Stock Adjustment',
      body: form,
      buttons: [
        { label: 'Cancel', onClick: (m) => m.close() },
        {
          label: 'Save',
          class: 'primary',
          onClick: async (m) => {
            const v = form.getValues();
            try {
              await DP.post('/stock/adjust', v);
              DP.toast('Stock adjust ho gaya', 'ok');
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

  function opening(reload) {
    const products = DP.state.lookups.products || [];
    const lines = [];
    const linesBox = DP.el('div', { class: 'col' });
    const prodSel = DP.ui.select([{ value: '', label: '+ Item add karein…' }].concat(products.map((p) => ({ value: p.id, label: p.name }))), '', (e) => {
      const p = products.find((x) => x.id === Number(e.target.value));
      if (!p) return;
      lines.push({ product_id: p.id, name: p.name, carton_size: p.carton_size, qty: 0, cost_paisa: p.cost_paisa || 0, batch_no: 'OPENING', expiry_date: '' });
      e.target.value = '';
      draw();
    });
    const whSel = DP.ui.select((DP.state.lookups.warehouses || []).map((w) => ({ value: w.id, label: w.name })), DP.state.warehouseId, () => {});
    function draw() {
      DP.clear(linesBox);
      lines.forEach((l, i) => {
        linesBox.appendChild(
          DP.el('div', { class: 'line-row', style: { gridTemplateColumns: '2.2fr .8fr .9fr .9fr auto' } }, [
            DP.el('div', { class: 'nm', text: l.name }),
            DP.el('input', { type: 'number', value: l.qty, placeholder: 'Qty pcs', oninput: (e) => (l.qty = Number(e.target.value) || 0) }),
            DP.el('input', { type: 'number', step: '0.01', value: DP.fmt.toRs(l.cost_paisa), oninput: (e) => (l.cost_paisa = DP.fmt.toPaisa(e.target.value)) }),
            DP.el('input', { type: 'date', value: l.expiry_date, title: 'Expiry (optional)', onchange: (e) => (l.expiry_date = e.target.value) }),
            DP.el('button', { class: 'icon-btn', text: '✕', onclick: () => { lines.splice(i, 1); draw(); } }),
          ])
        );
      });
    }
    DP.modal({
      title: 'Opening Stock (shuru ka maal)',
      size: 'lg',
      body: DP.el('div', { class: 'col' }, [
        DP.el('p', { class: 'small muted', text: 'Business shuru karte waqt jo maal godown me mojood hai wo yahan ek dafa enter kar dein (cost par).' }),
        DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Godown' }), whSel]),
        prodSel,
        linesBox,
      ]),
      buttons: [
        { label: 'Cancel', onClick: (m) => m.close() },
        {
          label: 'Save',
          class: 'primary',
          onClick: async (m) => {
            const valid = lines.filter((l) => Number(l.qty) > 0);
            if (!valid.length) return DP.toast('Qty likhein', 'bad');
            try {
              await DP.post('/stock/opening', { warehouse_id: Number(whSel.value), lines: valid });
              DP.toast('Opening stock save ho gaya', 'ok');
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

  /* ================================================================ BATCHES / EXPIRY */
  DP.definePage({
    key: 'batches',
    title: 'Batch & Expiry (FEFO)',
    sub: 'Push sale — purani expiry ka maal pehle nikalne ke liye',
    icon: '⏳',
    section: 'Inventory',
    perm: 'stock.view',
    async render(root) {
      let days = 90;
      let warehouse_id = DP.state.warehouseId || '';
      const box = DP.el('div', { class: 'col' });
      root.appendChild(box);

      async function load() {
        DP.clear(box).appendChild(DP.ui.spinner());
        const rows = await DP.get(`/stock/batches?expiring=${days}&warehouse_id=${warehouse_id}`);
        DP.clear(box);
        const buckets = { EXPIRED: 0, '0-30': 0, '31-60': 0, '61-90': 0 };
        rows.forEach((r) => {
          const d = Number(r.days_left);
          if (d < 0) buckets.EXPIRED += Number(r.qty_remaining) * Number(r.cost_paisa);
          else if (d <= 30) buckets['0-30'] += Number(r.qty_remaining) * Number(r.cost_paisa);
          else if (d <= 60) buckets['31-60'] += Number(r.qty_remaining) * Number(r.cost_paisa);
          else buckets['61-90'] += Number(r.qty_remaining) * Number(r.cost_paisa);
        });
        box.appendChild(
          DP.el('div', { class: 'grid g4' }, [
            DP.ui.kpi({ label: 'Expire ho gaya', value: 'Rs ' + DP.fmt.money0(buckets.EXPIRED), sub: 'Foran scrap/claim karein', tone: 'bad' }),
            DP.ui.kpi({ label: '0–30 din baqi', value: 'Rs ' + DP.fmt.money0(buckets['0-30']), sub: 'Push sale — discount ke sath', tone: 'bad' }),
            DP.ui.kpi({ label: '31–60 din', value: 'Rs ' + DP.fmt.money0(buckets['31-60']), sub: 'Scheme banayein', tone: 'warn' }),
            DP.ui.kpi({ label: '61–90 din', value: 'Rs ' + DP.fmt.money0(buckets['61-90']), sub: 'Monitor karein', tone: 'info' }),
          ])
        );
        box.appendChild(
          DP.ui.card(
            DP.el('div', { class: 'row' }, [
              DP.ui.select([{ value: 30, label: '30 din' }, { value: 60, label: '60 din' }, { value: 90, label: '90 din' }, { value: 365, label: 'Saal bhar' }], days, (e) => { days = e.target.value; load(); }),
              DP.ui.select([{ value: '', label: 'Sab godown' }].concat((DP.state.lookups.warehouses || []).map((w) => ({ value: w.id, label: w.name }))), warehouse_id, (e) => { warehouse_id = e.target.value; load(); }),
              DP.el('button', { class: 'btn sm', text: '🖨️ Push-sale list print', onclick: () => DP.print.report({ name: 'Push Sale List (Expiry)', columns: columns, rows, totals: { label: 'TOTAL', qty_remaining: rows.reduce((s, r) => s + Number(r.qty_remaining), 0), value_paisa: rows.reduce((s, r) => s + Number(r.qty_remaining) * Number(r.cost_paisa), 0) } }) }),
              DP.el('button', { class: 'btn sm', text: '⬇ CSV', onclick: () => DP.downloadCsv('expiry.csv', columns, rows) }),
            ]),
            DP.ui.table({
              columns,
              rows,
              totals: { label: 'TOTAL', qty_remaining: rows.reduce((s, r) => s + Number(r.qty_remaining), 0), value_paisa: rows.reduce((s, r) => s + Number(r.qty_remaining) * Number(r.cost_paisa), 0) },
              empty: 'Is range me koi batch expire nahi ho raha 👍',
            })
          )
        );
      }
      const columns = [
        { key: 'product_name', label: 'Item' },
        { key: 'batch_no', label: 'Batch' },
        { key: 'expiry_date', label: 'Expiry', type: 'date' },
        { key: 'days_left', label: 'Din baqi', align: 'right', render: (r) => DP.ui.pill(Number(r.days_left) < 0 ? 'EXPIRED' : r.days_left + ' din', Number(r.days_left) < 0 ? 'bad' : Number(r.days_left) <= 30 ? 'bad' : Number(r.days_left) <= 60 ? 'warn' : 'ok') },
        { key: 'warehouse_name', label: 'Godown' },
        { key: 'qty_remaining', label: 'Qty', align: 'right', render: (r) => DP.el('b', { text: DP.fmt.qty(r.qty_remaining, r.carton_size) }) },
        { key: 'cost_paisa', label: 'Cost/pc', type: 'money', align: 'right' },
        { key: 'value_paisa', label: 'Value at risk', align: 'right', render: (r) => 'Rs ' + DP.fmt.money0(Number(r.qty_remaining) * Number(r.cost_paisa)) },
      ];

      await load();
    },
  });

  /* ================================================================ TRANSFERS */
  DP.definePage({
    key: 'transfers',
    title: 'Stock Transfer (STN)',
    sub: 'Ek godown se doosre godown maal bhejein — raste ka hisaab',
    icon: '🔁',
    section: 'Inventory',
    perm: 'transfers.view',
    async render(root) {
      let from = DP.dateAdd(DP.today(), -30), to = DP.today();
      const box = DP.el('div', { class: 'col' });
      root.appendChild(box);

      async function load() {
        DP.clear(box).appendChild(DP.ui.spinner());
        const rows = await DP.get(`/transfers?from=${from}&to=${to}`);
        DP.clear(box);
        box.appendChild(
          DP.ui.card(
            DP.el('div', { class: 'row' }, [
              DP.ui.dateRange((f, t) => { from = f; to = t; load(); }, from, to),
              DP.el('button', { class: 'btn sm primary', text: '+ Nayi Transfer', onclick: () => newTransfer(load), disabled: !DP.can('transfers.create') }),
            ]),
            DP.ui.table({
              columns: [
                { key: 'stn_no', label: 'STN No' },
                { key: 'date', label: 'Date', type: 'date' },
                { key: 'from_name', label: 'From' },
                { key: 'to_name', label: 'To' },
                { key: 'status', label: 'Status', render: (r) => DP.ui.pill(r.status, r.status === 'RECEIVED' ? 'ok' : 'warn') },
                { key: 'notes', label: 'Note' },
                {
                  key: 'act', label: '', render: (r) =>
                    DP.el('div', { class: 'row tight' }, [
                      DP.el('button', { class: 'btn sm', text: '👁', onclick: () => view(r.id) }),
                      r.status === 'DISPATCHED' && DP.can('transfers.receive') ? DP.el('button', { class: 'btn sm primary', text: 'Receive', onclick: () => receive(r.id, load) }) : null,
                    ]),
                },
              ],
              rows,
              empty: 'Koi transfer nahi',
            })
          )
        );
      }

      async function view(id) {
        const t = await DP.get('/transfers/' + id);
        DP.modal({
          title: `${t.stn_no} — ${t.from_name} → ${t.to_name}`,
          size: 'lg',
          body: DP.ui.table({
            columns: [
              { key: 'product_name', label: 'Item' },
              { key: 'qty_sent', label: 'Bheja', align: 'right' },
              { key: 'qty_received', label: 'Mila', align: 'right' },
              { key: 'qty_sent', label: 'Farq', align: 'right', render: (r) => Number(r.qty_sent) - Number(r.qty_received) },
            ],
            rows: t.lines,
          }),
          buttons: [{ label: '🖨️ Print', onClick: () => DP.print.slip('STOCK TRANSFER NOTE ' + t.stn_no, [['From', t.from_name || ''], ['To', t.to_name || ''], ['Date', DP.fmt.date(t.date)], ['Status', t.status]], { table: `<table><thead><tr><th>Item</th><th class="right">Bheja</th><th class="right">Mila</th></tr></thead><tbody>${t.lines.map((l) => `<tr><td>${DP.esc(l.product_name)}</td><td class="right">${l.qty_sent}</td><td class="right">${l.qty_received}</td></tr>`).join('')}</tbody></table>` }) }, { label: 'Band', class: 'primary' }],
        });
      }

      async function receive(id, reload) {
        const t = await DP.get('/transfers/' + id);
        const inputs = {};
        const rows = t.lines.map((l) => {
          inputs[l.id] = Number(l.qty_sent);
          return DP.el('div', { class: 'line-row', style: { gridTemplateColumns: '3fr 1fr' } }, [
            DP.el('div', { class: 'nm', text: `${l.product_name} — bheja ${l.qty_sent} pcs` }),
            DP.el('input', { type: 'number', value: l.qty_sent, oninput: (e) => (inputs[l.id] = Number(e.target.value) || 0) }),
          ]);
        });
        DP.modal({
          title: 'Transfer receive karein — ' + t.stn_no,
          body: DP.el('div', { class: 'col' }, [DP.el('p', { class: 'small muted', text: 'Jo maal haath laga wo likhein. Kami (short) automatically loss me jayegi.' }), ...rows]),
          buttons: [
            { label: 'Cancel', onClick: (m) => m.close() },
            {
              label: 'Receive',
              class: 'primary',
              onClick: async (m) => {
                try {
                  await DP.post(`/transfers/${id}/receive`, { lines: Object.entries(inputs).map(([line_id, qty_received]) => ({ line_id: Number(line_id), qty_received })) });
                  DP.toast('Transfer receive ho gaya', 'ok');
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

      async function newTransfer(reload) {
        const products = DP.state.lookups.products || [];
        const whs = DP.state.lookups.warehouses || [];
        const lines = [];
        const fromSel = DP.ui.select(whs.map((w) => ({ value: w.id, label: w.name })), DP.state.warehouseId || whs[0].id, () => {});
        const toSel = DP.ui.select(whs.map((w) => ({ value: w.id, label: w.name })), whs[1] ? whs[1].id : whs[0].id, () => {});
        const note = DP.el('input', { placeholder: 'Note (e.g. counter ke liye bheja)' });
        const linesBox = DP.el('div', { class: 'col' });
        const prodSel = DP.ui.select([{ value: '', label: '+ Item add karein…' }].concat(products.map((p) => ({ value: p.id, label: p.name }))), '', (e) => {
          const p = products.find((x) => x.id === Number(e.target.value));
          if (!p) return;
          lines.push({ product_id: p.id, name: p.name, carton_size: p.carton_size, cartons: 1, loose: 0 });
          e.target.value = '';
          draw();
        });
        function draw() {
          DP.clear(linesBox);
          lines.forEach((l, i) => {
            linesBox.appendChild(
              DP.el('div', { class: 'line-row', style: { gridTemplateColumns: '2.6fr .9fr .9fr auto' } }, [
                DP.el('div', { class: 'nm', text: l.name + ` (carton ${l.carton_size})` }),
                DP.el('input', { type: 'number', value: l.cartons, oninput: (e) => (l.cartons = Number(e.target.value) || 0) }),
                DP.el('input', { type: 'number', value: l.loose, oninput: (e) => (l.loose = Number(e.target.value) || 0) }),
                DP.el('button', { class: 'icon-btn', text: '✕', onclick: () => { lines.splice(i, 1); draw(); } }),
              ])
            );
          });
        }
        DP.modal({
          title: 'Nayi Stock Transfer (STN)',
          size: 'lg',
          body: DP.el('div', { class: 'col' }, [
            DP.el('div', { class: 'grid g3' }, [
              DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'From godown' }), fromSel]),
              DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'To godown' }), toSel]),
              DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Note' }), note]),
            ]),
            prodSel,
            linesBox,
          ]),
          buttons: [
            { label: 'Cancel', onClick: (m) => m.close() },
            {
              label: 'Dispatch karein',
              class: 'primary',
              onClick: async (m) => {
                if (!lines.length) return DP.toast('Item add karein', 'bad');
                try {
                  const t = await DP.post('/transfers', {
                    from_warehouse_id: Number(fromSel.value),
                    to_warehouse_id: Number(toSel.value),
                    notes: note.value,
                    lines: lines.map((l) => ({ product_id: l.product_id, cartons: l.cartons, loose: l.loose })),
                  });
                  DP.toast('Transfer dispatch ho gayi: ' + t.stn_no, 'ok');
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

      await load();
    },
  });
})();
