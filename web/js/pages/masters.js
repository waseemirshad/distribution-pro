/* Distribution Pro - Items/Products, Masters (CRUD), Users, Settings/Backup, Audit */
(function () {
  'use strict';

  /* ================================================================ PRODUCTS */
  DP.definePage({
    key: 'products',
    title: 'Items / Products',
    sub: 'Rate, carton size, barcode, reorder level aur tier rates',
    icon: '🏷️',
    section: 'Inventory',
    perm: 'products.view',
    async render(root) {
      let q = '', company_id = '', category_id = '', tab = 'items';
      const box = DP.el('div', { class: 'col' });
      root.appendChild(box);

      async function load() {
        DP.clear(box).appendChild(DP.ui.spinner());
        const [rows, tiers] = await Promise.all([
          DP.get(`/products?q=${encodeURIComponent(q)}&company_id=${company_id}&category_id=${category_id}&limit=5000`),
          DP.get('/crud/price_tiers?limit=50').catch(() => []),
        ]);
        DP.clear(box);
        box.appendChild(DP.ui.tabs([{ key: 'items', label: 'Items' }, { key: 'tiers', label: 'Rate Tiers' }], tab, (k) => { tab = k; load(); }));
        if (tab === 'tiers') {
          box.appendChild(
            DP.ui.card(
              DP.el('div', { class: 'row' }, [
                DP.el('span', { class: 'small muted', text: 'Tier = customer group (Misaal: Wholesale 3% kam). Rate POS me khud lagti hai.' }),
                DP.can('products.manage') ? DP.el('button', { class: 'btn sm primary', text: '+ Naya Tier', onclick: () => tierModal(null, load) }) : null,
              ]),
              DP.ui.table({
                columns: [
                  { key: 'name', label: 'Tier' },
                  { key: 'discount_pct', label: 'Discount %', align: 'right' },
                  { key: 'is_default', label: 'Default', render: (r) => DP.ui.pill(r.is_default ? 'Default' : '', r.is_default ? 'ok' : '') },
                  DP.can('products.manage') ? { key: 'act', label: '', render: (r) => DP.el('button', { class: 'btn sm', text: '✏️', onclick: () => tierModal(r, load) }) } : null,
                ].filter(Boolean),
                rows: tiers,
              })
            )
          );
          return;
        }
        const lowCount = rows.filter((r) => Number(r.reorder_level) > 0 && Number(r.stock) <= Number(r.reorder_level)).length;
        box.appendChild(
          DP.el('div', { class: 'grid g4' }, [
            DP.ui.kpi({ label: 'Total items', value: rows.length, tone: 'info' }),
            DP.ui.kpi({ label: 'Stock par value (retail)', value: 'Rs ' + DP.fmt.money0(rows.reduce((s, r) => s + Number(r.stock_retail_value_paisa || 0), 0)), tone: 'ok' }),
            DP.ui.kpi({ label: 'Reorder par', value: lowCount, sub: 'Settings me list dekhein', tone: lowCount ? 'warn' : 'ok' }),
            DP.ui.kpi({ label: 'Rate tiers', value: tiers.length, sub: 'Wholesale / Retail…', tone: 'info' }),
          ])
        );
        box.appendChild(
          DP.ui.card(
            DP.el('div', { class: 'row' }, [
              DP.ui.searchBox('Item / SKU / barcode…', (v) => { q = v; load(); }, q),
              DP.ui.select([{ value: '', label: 'Sab companies' }].concat((DP.state.lookups.companies || []).map((c) => ({ value: c.id, label: c.name }))), company_id, (e) => { company_id = e.target.value; load(); }),
              DP.ui.select([{ value: '', label: 'Sab categories' }].concat((DP.state.lookups.categories || []).map((c) => ({ value: c.id, label: c.name }))), category_id, (e) => { category_id = e.target.value; load(); }),
              DP.el('button', { class: 'btn sm', text: '⬇ CSV', onclick: () => DP.downloadCsv('products.csv', columns, rows) }),
              DP.can('products.manage') ? DP.el('button', { class: 'btn sm primary', text: '+ Naya Item', onclick: () => itemModal(null, load) }) : null,
            ]),
            DP.ui.table({ columns, rows, onRowClick: (r) => (DP.can('products.manage') ? itemModal(r, load) : viewBatches(r)), empty: 'Koi item nahi — naya item add karein' })
          )
        );
      }

      const columns = [
        { key: 'name', label: 'Item', render: (r) => DP.el('div', {}, [DP.el('b', { text: r.name }), DP.el('div', { class: 'tiny muted', text: [r.company_name, r.category_name, r.sku].filter(Boolean).join(' • ') })]) },
        { key: 'carton_size', label: 'Carton', align: 'right' },
        DP.can('cost.view') ? { key: 'cost_paisa', label: 'Cost', type: 'money', align: 'right' } : null,
        { key: 'wholesale_paisa', label: 'Wholesale', type: 'money', align: 'right' },
        { key: 'retail_paisa', label: 'Retail', type: 'money', align: 'right' },
        { key: 'margin', label: 'Margin %', align: 'right', render: (r) => (DP.can('cost.view') ? DP.fmt.pct(Number(r.retail_paisa) ? ((Number(r.retail_paisa) - Number(r.cost_paisa)) / Number(r.retail_paisa)) * 100 : 0) : '—') },
        { key: 'stock', label: 'Stock', align: 'right', render: (r) => DP.el('b', { text: DP.fmt.qty(r.stock, r.carton_size) }) },
        { key: 'reorder_level', label: 'Reorder', align: 'right' },
        {
          key: 'st', label: 'Status', render: (r) =>
            Number(r.reorder_level) > 0 && Number(r.stock) <= Number(r.reorder_level)
              ? DP.ui.pill(Number(r.stock) <= 0 ? 'Stock khatam' : 'Reorder karein', Number(r.stock) <= 0 ? 'bad' : 'warn')
              : DP.ui.pill('OK', 'ok'),
        },
        {
          key: 'act', label: '', render: (r) =>
            DP.el('div', { class: 'row tight' }, [
              DP.el('button', { class: 'btn sm', text: '📦', title: 'Batches', onclick: (e) => { e.stopPropagation(); viewBatches(r); } }),
              DP.can('products.manage') ? DP.el('button', { class: 'btn sm', text: '🎯', title: 'Tier rates', onclick: (e) => { e.stopPropagation(); tierPriceModal(r, load); } }) : null,
              DP.can('products.manage') ? DP.el('button', { class: 'btn sm', text: '✏️', title: 'Edit', onclick: (e) => { e.stopPropagation(); itemModal(r, load); } }) : null,
            ].filter(Boolean)),
        },
      ].filter(Boolean);

      async function viewBatches(r) {
        const p = await DP.get('/products/' + r.id);
        DP.modal({
          title: 'Batches — ' + p.name,
          size: 'lg',
          body: DP.el('div', { class: 'col' }, [
            DP.ui.table({
              columns: [
                { key: 'batch_no', label: 'Batch' },
                { key: 'expiry_date', label: 'Expiry', type: 'date' },
                { key: 'qty_remaining', label: 'Baqi qty', align: 'right' },
                { key: 'cost_paisa', label: 'Cost', type: 'money', align: 'right' },
                { key: 'warehouse', label: 'Godown', render: (x) => x.warehouse_name || x.warehouse || '—' },
              ],
              rows: (p.batches || []).map((b) => Object.assign({}, b, { warehouse_name: (DP.state.lookups.warehouses.find((w) => w.id === b.warehouse_id) || {}).name })),
              empty: 'Koi batch nahi',
            }),
            DP.el('h4', { text: 'Tier rates' }),
            DP.ui.table({ columns: [{ key: 'tier_name', label: 'Tier' }, { key: 'price_paisa', label: 'Rate', type: 'money', align: 'right' }], rows: p.prices || [], empty: 'Tier rate set nahi — default discount % lagega' }),
            DP.el('h4', { text: 'Aakhri stock movement' }),
            DP.ui.table({ columns: [{ key: 'at', label: 'Time' }, { key: 'warehouse', label: 'Godown' }, { key: 'type', label: 'Type' }, { key: 'qty', label: 'Qty', align: 'right' }], rows: p.recent || [], empty: 'Koi movement nahi' }),
          ]),
          buttons: [{ label: 'Band', class: 'primary' }],
        });
      }

      function itemModal(r, reload) {
        const form = DP.ui.form([
          { key: 'name', label: 'Item ka naam *', type: 'text', value: r ? r.name : '', autofocus: true },
          { key: 'sku', label: 'SKU / Code', type: 'text', value: r ? r.sku : '' },
          { key: 'barcode', label: 'Barcode', type: 'text', value: r ? r.barcode : '', hint: 'Scanner se bill banane ke liye' },
          { key: 'company_id', label: 'Company', type: 'select', value: r ? r.company_id : '', options: [{ value: '', label: '—' }].concat((DP.state.lookups.companies || []).map((c) => ({ value: c.id, label: c.name }))) },
          { key: 'category_id', label: 'Category', type: 'select', value: r ? r.category_id : '', options: [{ value: '', label: '—' }].concat((DP.state.lookups.categories || []).map((c) => ({ value: c.id, label: c.name }))) },
          { key: 'unit', label: 'Unit', type: 'text', value: r ? r.unit : 'pcs' },
          { key: 'carton_size', label: 'Ek carton me kitne pcs *', type: 'number', value: r ? r.carton_size : 12, hint: 'Misaal: 24 — phir bill me "2 ctn + 5 pcs" likha ja sakta hai' },
          { key: 'cost_paisa', label: 'Cost per pc (Rs)', type: 'money', value: r ? r.cost_paisa : 0 },
          { key: 'wholesale_paisa', label: 'Wholesale rate (Rs)', type: 'money', value: r ? r.wholesale_paisa : 0 },
          { key: 'retail_paisa', label: 'Retail rate (Rs)', type: 'money', value: r ? r.retail_paisa : 0 },
          { key: 'tax_pct', label: 'Tax %', type: 'number', value: r ? r.tax_pct : 0 },
          { key: 'reorder_level', label: 'Reorder level (pcs)', type: 'number', value: r ? r.reorder_level : 0, hint: 'Is se kam stock par alert aayega' },
          { key: 'shelf_life_days', label: 'Shelf life (din)', type: 'number', value: r ? r.shelf_life_days : 0 },
          { key: 'notes', label: 'Note', type: 'text', value: r ? r.notes : '' },
          { key: 'active', label: 'Active', type: 'checkbox', value: r ? r.active : 1 },
        ], { cols: 2 });
        DP.modal({
          title: r ? 'Item edit — ' + r.name : 'Naya Item',
          size: 'xl',
          body: form,
          buttons: [
            { label: 'Cancel', onClick: (m) => m.close() },
            r && DP.can('products.manage')
              ? {
                  label: '🗑 Deactivate',
                  class: 'danger',
                  onClick: async (m) => {
                    if (!(await DP.confirm('Item deactivate karein? (record safe rahega)', { danger: true }))) return;
                    try {
                      await DP.del('/crud/products/' + r.id);
                      DP.toast('Item deactivate ho gaya', 'ok');
                      m.close();
                      reload();
                    } catch (e) { DP.toast(e.message, 'bad'); }
                  },
                }
              : null,
            {
              label: 'Save',
              class: 'primary',
              onClick: async (m) => {
                const v = form.getValues();
                if (!v.name) return DP.toast('Naam zaroori hai', 'bad');
                try {
                  if (r) await DP.put('/crud/products/' + r.id, v);
                  else await DP.post('/crud/products', v);
                  DP.toast('Item save ho gaya', 'ok');
                  m.close();
                  reload();
                } catch (e) { DP.toast(e.message, 'bad'); }
              },
            },
          ].filter(Boolean),
        });
      }

      async function tierPriceModal(r, reload) {
        const tiers = await DP.get('/crud/price_tiers?limit=50');
        const existing = await DP.get('/products/' + r.id);
        const rows = tiers.map((t) => {
          const found = (existing.prices || []).find((p) => p.tier_id === t.id) || {};
          const input = DP.el('input', { type: 'number', step: '0.01', value: DP.fmt.toRs(found.price_paisa || r.wholesale_paisa) });
          return { t, input, id: found.id };
        });
        DP.modal({
          title: 'Tier rates — ' + r.name,
          body: DP.el('div', { class: 'col' }, [
            DP.el('p', { class: 'small muted', text: 'Har tier (dukan group) ke liye alag rate. Khali chhorein to default discount % lagega.' }),
            ...rows.map((x) => DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: x.t.name + (x.t.discount_pct ? ` (default ${x.t.discount_pct}% kam)` : '') }), x.input])),
          ]),
          buttons: [
            { label: 'Cancel', onClick: (m) => m.close() },
            {
              label: 'Save rates',
              class: 'primary',
              onClick: async (m) => {
                try {
                  for (const x of rows) {
                    const paisa = DP.fmt.toPaisa(x.input.value);
                    if (x.id) await DP.put('/crud/product_prices/' + x.id, { product_id: r.id, tier_id: x.t.id, price_paisa: paisa });
                    else await DP.post('/crud/product_prices', { product_id: r.id, tier_id: x.t.id, price_paisa: paisa });
                  }
                  DP.toast('Tier rates save ho gayi', 'ok');
                  m.close();
                  reload();
                } catch (e) { DP.toast(e.message, 'bad'); }
              },
            },
          ],
        });
      }

      function tierModal(t, reload) {
        const form = DP.ui.form([
          { key: 'name', label: 'Tier ka naam *', type: 'text', value: t ? t.name : '' },
          { key: 'discount_pct', label: 'Discount %', type: 'number', value: t ? t.discount_pct : 0 },
          { key: 'is_default', label: 'Default tier (naye customer ke liye)', type: 'checkbox', value: t ? t.is_default : 0 },
        ]);
        DP.modal({
          title: t ? 'Tier edit' : 'Naya Rate Tier',
          body: form,
          buttons: [
            { label: 'Cancel', onClick: (m) => m.close() },
            {
              label: 'Save',
              class: 'primary',
              onClick: async (m) => {
                const v = form.getValues();
                try {
                  const out = t ? await DP.put('/crud/price_tiers/' + t.id, v) : await DP.post('/crud/price_tiers', v);
                  DP.toast((out && out.name ? out.name : v.name) + ' save ho gaya', 'ok');
                  DP.state.lookups.tiers = await DP.get('/lookup/tiers').catch(() => DP.state.lookups.tiers);
                  m.close();
                  reload();
                } catch (e) { DP.toast(e.message, 'bad'); }
              },
            },
          ],
        });
      }

      await load();
    },
  });

  /* ================================================================ GENERIC MASTERS */
  const MASTER_TABS = {
    companies: {
      label: 'Companies (principal)',
      title: 'Company',
      perm: 'masters',
      columns: [{ key: 'name', label: 'Company' }, { key: 'contact_person', label: 'Contact' }, { key: 'phone', label: 'Phone' }, { key: 'city', label: 'City' }, { key: 'ntn', label: 'NTN' }, { key: 'active', label: 'Status', render: (r) => DP.ui.pill(r.active ? 'Active' : 'Off', r.active ? 'ok' : 'bad') }],
      fields: [{ key: 'name', label: 'Company ka naam *', type: 'text' }, { key: 'contact_person', label: 'Contact person', type: 'text' }, { key: 'phone', label: 'Phone', type: 'text' }, { key: 'email', label: 'Email', type: 'text' }, { key: 'city', label: 'City', type: 'text' }, { key: 'address', label: 'Address', type: 'text' }, { key: 'ntn', label: 'NTN', type: 'text' }, { key: 'active', label: 'Active', type: 'checkbox' }],
    },
    categories: {
      label: 'Categories',
      title: 'Category',
      perm: 'masters',
      columns: [{ key: 'name', label: 'Category' }, { key: 'active', label: 'Status', render: (r) => DP.ui.pill(r.active ? 'Active' : 'Off', r.active ? 'ok' : 'bad') }],
      fields: [{ key: 'name', label: 'Category *', type: 'text' }, { key: 'active', label: 'Active', type: 'checkbox' }],
    },
    routes: {
      label: 'Routes / Beats',
      title: 'Route',
      perm: 'masters',
      columns: [{ key: 'name', label: 'Route' }, { key: 'area', label: 'Area' }, { key: 'weekday', label: 'Din' }, { key: 'note', label: 'Note' }, { key: 'active', label: 'Status', render: (r) => DP.ui.pill(r.active ? 'Active' : 'Off', r.active ? 'ok' : 'bad') }],
      fields: [{ key: 'name', label: 'Route ka naam *', type: 'text' }, { key: 'area', label: 'Area', type: 'text' }, { key: 'weekday', label: 'Kis din jana hai', type: 'text' }, { key: 'note', label: 'Note', type: 'text' }, { key: 'active', label: 'Active', type: 'checkbox' }],
    },
    warehouses: {
      label: 'Godowns',
      title: 'Godown',
      perm: 'masters',
      columns: [{ key: 'name', label: 'Godown' }, { key: 'code', label: 'Code' }, { key: 'type', label: 'Type', render: (r) => DP.ui.pill(r.type, r.type === 'MAIN' ? 'ok' : r.type === 'SCRAP' ? 'bad' : 'info') }, { key: 'address', label: 'Address' }, { key: 'active', label: 'Status', render: (r) => DP.ui.pill(r.active ? 'Active' : 'Off', r.active ? 'ok' : 'bad') }],
      fields: [{ key: 'name', label: 'Godown ka naam *', type: 'text' }, { key: 'code', label: 'Code', type: 'text' }, { key: 'type', label: 'Type', type: 'select', options: [{ value: 'MAIN', label: 'Main godown' }, { value: 'COUNTER', label: 'Counter' }, { value: 'VAN', label: 'Van' }, { value: 'SCRAP', label: 'Scrap / Damage' }] }, { key: 'address', label: 'Address', type: 'text' }, { key: 'active', label: 'Active', type: 'checkbox' }],
    },
    expense_heads: {
      label: 'Expense Heads',
      title: 'Kharcha head',
      perm: 'masters',
      columns: [{ key: 'name', label: 'Head' }, { key: 'is_cogs', label: 'COGS', render: (r) => DP.ui.pill(r.is_cogs ? 'Haan' : 'Nahi', r.is_cogs ? 'info' : '') }, { key: 'active', label: 'Status', render: (r) => DP.ui.pill(r.active ? 'Active' : 'Off', r.active ? 'ok' : 'bad') }],
      fields: [{ key: 'name', label: 'Head ka naam *', type: 'text' }, { key: 'is_cogs', label: 'Ye COGS (maal ki lagat) hai', type: 'checkbox' }, { key: 'active', label: 'Active', type: 'checkbox' }],
    },
    salesmen: {
      label: 'Salesmen',
      title: 'Salesman',
      perm: 'masters',
      columns: [{ key: 'name', label: 'Salesman' }, { key: 'code', label: 'Code' }, { key: 'phone', label: 'Phone' }, { key: 'vehicle_no', label: 'Vehicle' }, { key: 'commission_pct', label: 'Comm %', align: 'right' }, { key: 'active', label: 'Status', render: (r) => DP.ui.pill(r.active ? 'Active' : 'Off', r.active ? 'ok' : 'bad') }],
      fields: [{ key: 'name', label: 'Naam *', type: 'text' }, { key: 'code', label: 'Code', type: 'text' }, { key: 'phone', label: 'Phone', type: 'text' }, { key: 'route_id', label: 'Route', type: 'select', options: () => [{ value: '', label: '—' }].concat((DP.state.lookups.routes || []).map((r) => ({ value: r.id, label: r.name }))) }, { key: 'vehicle_no', label: 'Vehicle No', type: 'text' }, { key: 'commission_pct', label: 'Commission % (recovery par)', type: 'number' }, { key: 'basic_salary_paisa', label: 'Salary (Rs)', type: 'money' }, { key: 'active', label: 'Active', type: 'checkbox' }],
    },
    schemes: {
      label: 'Schemes',
      title: 'Scheme',
      perm: 'schemes',
      columns: [{ key: 'name', label: 'Scheme' }, { key: 'type', label: 'Type' }, { key: 'buy_qty', label: 'Buy', align: 'right' }, { key: 'free_qty', label: 'Free', align: 'right' }, { key: 'discount_pct', label: 'Disc %', align: 'right' }, { key: 'claimable', label: 'Claim', render: (r) => DP.ui.pill(r.claimable ? 'Claimable' : '—', r.claimable ? 'ok' : '') }, { key: 'active', label: 'Status', render: (r) => DP.ui.pill(r.active ? 'Active' : 'Off', r.active ? 'ok' : 'bad') }],
      fields: [{ key: 'name', label: 'Scheme ka naam *', type: 'text' }, { key: 'type', label: 'Type', type: 'select', options: [{ value: 'FREE_QTY', label: 'X + Y Free' }, { value: 'SLAB_DISCOUNT', label: 'Slab %' }, { value: 'CASH_DISCOUNT', label: 'Cash %' }] }, { key: 'buy_qty', label: 'Buy qty', type: 'number' }, { key: 'free_qty', label: 'Free qty', type: 'number' }, { key: 'slab_min_qty', label: 'Slab min qty', type: 'number' }, { key: 'discount_pct', label: 'Discount %', type: 'number' }, { key: 'start_date', label: 'Start', type: 'date' }, { key: 'end_date', label: 'End', type: 'date' }, { key: 'claimable', label: 'Company se claim', type: 'checkbox' }, { key: 'active', label: 'Active', type: 'checkbox' }],
    },
  };

  DP.definePage({
    key: 'masters',
    title: 'Masters',
    sub: 'Companies, categories, routes, godowns, kharcha heads, salesmen, schemes',
    icon: '🗂️',
    section: 'Admin',
    perm: 'masters.view',
    async render(root, params) {
      let tab = (params && params.tab) || 'companies';
      let q = '';
      const box = DP.el('div', { class: 'col' });
      root.appendChild(box);

      async function load() {
        const cfg = MASTER_TABS[tab] || MASTER_TABS.companies;
        DP.clear(box).appendChild(DP.ui.spinner());
        const rows = await DP.get(`/crud/${tab}?q=${encodeURIComponent(q)}&limit=1000`);
        const canManage = DP.can(cfg.perm + '.manage');
        DP.clear(box);
        box.appendChild(
          DP.ui.tabs(Object.entries(MASTER_TABS).map(([k, v]) => ({ key: k, label: v.label })), tab, (k) => { tab = k; load(); })
        );
        box.appendChild(
          DP.ui.card(
            DP.el('div', { class: 'row' }, [
              DP.ui.searchBox('Dhundein…', (v) => { q = v; load(); }, q),
              DP.el('span', { class: 'small muted', text: rows.length + ' record' }),
              DP.el('button', { class: 'btn sm', text: '⬇ CSV', onclick: () => DP.downloadCsv(tab + '.csv', cfg.columns, rows) }),
              canManage ? DP.el('button', { class: 'btn sm primary', text: '+ Naya ' + cfg.title, onclick: () => edit(cfg, null, load) }) : null,
            ]),
            DP.ui.table({
              columns: cfg.columns.concat(
                canManage
                  ? [{ key: 'act', label: '', render: (r) => DP.el('div', { class: 'row tight' }, [DP.el('button', { class: 'btn sm', text: '✏️', onclick: (e) => { e.stopPropagation(); edit(cfg, r, load); } }), DP.el('button', { class: 'btn sm', text: '🗑', onclick: async (e) => { e.stopPropagation(); if (!(await DP.confirm('Delete / deactivate karein?', { danger: true }))) return; try { const o = await DP.del(`/crud/${tab}/` + r.id); DP.toast(o && o.deactivated ? 'Record deactivate ho gaya (kahin use ho raha tha)' : 'Delete ho gaya', 'ok'); load(); } catch (err) { DP.toast(err.message, 'bad'); } } })] ) }]
                  : []
              ),
              rows,
              empty: 'Koi record nahi',
            })
          )
        );
      }

      function edit(cfg, r, reload) {
        const fields = cfg.fields.map((f) => {
          let opts = f.options;
          if (typeof opts === 'function') opts = opts();
          return Object.assign({}, f, { value: r ? r[f.key] : f.type === 'checkbox' ? 1 : '' , options: opts });
        });
        const form = DP.ui.form(fields, { cols: 2 });
        DP.modal({
          title: r ? cfg.title + ' edit' : 'Naya ' + cfg.title,
          size: 'lg',
          body: form,
          buttons: [
            { label: 'Cancel', onClick: (m) => m.close() },
            {
              label: 'Save',
              class: 'primary',
              onClick: async (m) => {
                const v = form.getValues();
                try {
                  if (r) await DP.put(`/crud/${tab}/` + r.id, v);
                  else await DP.post(`/crud/${tab}`, v);
                  DP.toast('Save ho gaya', 'ok');
                  m.close();
                  if (tab === 'warehouses') DP.state.lookups.warehouses = await DP.get('/lookup/warehouses').catch(() => DP.state.lookups.warehouses);
                  reload();
                } catch (e) { DP.toast(e.message, 'bad'); }
              },
            },
          ],
        });
      }

      await load();
    },
  });

  /* ================================================================ USERS */
  DP.definePage({
    key: 'users',
    title: 'Users & Roles',
    sub: 'Staff ke login, role aur ijazat',
    icon: '👥',
    section: 'Admin',
    perm: 'users.manage',
    async render(root) {
      const box = DP.el('div', { class: 'col' });
      root.appendChild(box);
      async function load() {
        DP.clear(box).appendChild(DP.ui.spinner());
        const [users, roles] = await Promise.all([DP.get('/users'), DP.get('/roles')]);
        DP.clear(box);
        box.appendChild(
          DP.ui.card(
            DP.el('div', { class: 'row' }, [
              DP.el('span', { class: 'small muted', text: 'Role ka matlab: jo kaam uske permission me hai wahi kar sakta hai.' }),
              DP.el('button', { class: 'btn sm primary', text: '+ Naya User', onclick: () => editUser(null, roles, load) }),
            ]),
            DP.ui.table({
              columns: [
                { key: 'username', label: 'Username', render: (r) => DP.el('b', { text: r.username }) },
                { key: 'full_name', label: 'Naam' },
                { key: 'role', label: 'Role', render: (r) => DP.ui.pill(r.role_label || r.role, r.role === 'ADMIN' ? 'ok' : '') },
                { key: 'phone', label: 'Phone' },
                { key: 'last_login', label: 'Aakhri login', render: (r) => DP.fmt.dateTime(r.last_login) },
                { key: 'active', label: 'Status', render: (r) => DP.ui.pill(r.active ? 'Active' : 'Band', r.active ? 'ok' : 'bad') },
                {
                  key: 'act', label: '', render: (r) =>
                    DP.el('div', { class: 'row tight' }, [
                      DP.el('button', { class: 'btn sm', text: '✏️', onclick: () => editUser(r, roles, load) }),
                      DP.el('button', { class: 'btn sm', text: '🔑', title: 'Password badlein', onclick: async () => {
                        const p = await DP.prompt({ title: 'Naya password — ' + r.username, label: 'Naya password (4+)' });
                        if (!p) return;
                        try { await DP.put('/users/' + r.id, { password: p }); DP.toast('Password badal gaya', 'ok'); } catch (e) { DP.toast(e.message, 'bad'); }
                      } }),
                      DP.el('button', { class: 'btn sm', text: '🗑', onclick: async () => {
                        if (!(await DP.confirm(r.username + ' ko delete karein?', { danger: true }))) return;
                        try { await DP.del('/users/' + r.id); DP.toast('User delete ho gaya', 'ok'); load(); } catch (e) { DP.toast(e.message, 'bad'); }
                      } }),
                    ]),
                },
              ],
              rows: users,
            })
          )
        );
        users.forEach(() => {});
        box.appendChild(
          DP.ui.card('Roles aur permissions', DP.el('div', { class: 'col' }, roles.map((role) =>
            DP.el('div', { class: 'role-row' }, [
              DP.el('b', { text: role.label + ' (' + role.role + ')' }),
              DP.el('div', { class: 'small muted', text: role.permissions.join(' • ') }),
            ])
          )))
        );
      }
      function editUser(u, roles, reload) {
        const form = DP.ui.form([
          { key: 'username', label: 'Username *', type: 'text', value: u ? u.username : '' },
          { key: 'full_name', label: 'Poora naam', type: 'text', value: u ? u.full_name : '' },
          { key: 'password', label: u ? 'Naya password (khali = wahi rahega)' : 'Password *', type: 'password' },
          { key: 'role', label: 'Role *', type: 'select', options: roles.map((r) => ({ value: r.role, label: r.label })), value: u ? u.role : 'CASHIER' },
          { key: 'salesman_id', label: 'Salesman link (agar salesman hai)', type: 'select', options: [{ value: '', label: '—' }].concat((DP.state.lookups.salesmen || []).map((s) => ({ value: s.id, label: s.name }))), value: u ? u.salesman_id : '' },
          { key: 'phone', label: 'Phone', type: 'text', value: u ? u.phone : '' },
          { key: 'active', label: 'Active', type: 'checkbox', value: u ? u.active : 1 },
        ], { cols: 2 });
        DP.modal({
          title: u ? 'User edit — ' + u.username : 'Naya User',
          body: form,
          buttons: [
            { label: 'Cancel', onClick: (m) => m.close() },
            {
              label: 'Save',
              class: 'primary',
              onClick: async (m) => {
                const v = form.getValues();
                if (!u && !v.password) return DP.toast('Password likhein', 'bad');
                try {
                  if (u) await DP.put('/users/' + u.id, v);
                  else await DP.post('/users', v);
                  DP.toast('User save ho gaya', 'ok');
                  m.close();
                  reload();
                } catch (e) { DP.toast(e.message, 'bad'); }
              },
            },
          ],
        });
      }
      await load();
    },
  });

  /* ================================================================ SETTINGS */
  DP.definePage({
    key: 'settings',
    title: 'Settings & Backup',
    sub: 'Company info, credit rules, printing, manager PIN, backup',
    icon: '⚙️',
    section: 'Admin',
    perm: 'settings.manage',
    async render(root) {
      const box = DP.el('div', { class: 'col' });
      root.appendChild(box);
      const s = await DP.get('/settings');
      const form = DP.ui.form([
        { key: 'company_name', label: 'Company ka naam', type: 'text', value: s.company_name },
        { key: 'company_phone', label: 'Phone', type: 'text', value: s.company_phone },
        { key: 'company_address', label: 'Address', type: 'text', value: s.company_address },
        { key: 'company_ntn', label: 'NTN / Tax no', type: 'text', value: s.company_ntn },
        { key: 'currency_symbol', label: 'Currency symbol', type: 'text', value: s.currency_symbol || 'Rs' },
        { key: 'print_paper', label: 'Print paper', type: 'select', options: [{ value: '80mm', label: '80mm thermal (Bluetooth printer)' }, { value: 'a5', label: 'A5' }, { value: 'a4', label: 'A4' }], value: s.print_paper || '80mm' },
        { key: 'enforce_credit_limit', label: 'Credit limit sakhti se lagayein', type: 'checkbox', value: s.enforce_credit_limit === '1' },
        { key: 'enforce_credit_days', label: 'Credit days (purana udhaar) rok lagayein', type: 'checkbox', value: s.enforce_credit_days === '1' },
        { key: 'credit_grace_days', label: 'Grace days', type: 'number', value: s.credit_grace_days || 3 },
        { key: 'allow_negative_stock', label: 'Negative stock allow (marzi se)', type: 'checkbox', value: s.allow_negative_stock === '1' },
        { key: 'tax_enabled', label: 'Tax / GST lagayein', type: 'checkbox', value: s.tax_enabled === '1' },
        { key: 'sales_tax_pct', label: 'Default tax %', type: 'number', value: s.sales_tax_pct || 0 },
        { key: 'expiry_warning_days', label: 'Expiry warning (din pehle)', type: 'number', value: s.expiry_warning_days || 90 },
        { key: 'manager_pin', label: 'Manager PIN (limit override / void)', type: 'text', value: s.manager_pin || '', hint: 'Khali chhorein to default 1234 chalega' },
        { key: 'enable_geo_fence', label: 'GPS geo-fence lagayein (visit check-in)', type: 'checkbox', value: s.enable_geo_fence === '1' },
        { key: 'geo_fence_radius_m', label: 'Geo-fence radius (meter)', type: 'number', value: s.geo_fence_radius_m || 150 },
        { key: 'invoice_footer', label: 'Bill ke neeche note', type: 'text', value: s.invoice_footer },
        { key: 'statement_footer', label: 'Khata statement ka note', type: 'text', value: s.statement_footer },
        { key: 'whatsapp_country_code', label: 'WhatsApp country code', type: 'text', value: s.whatsapp_country_code || '92' },
      ], { cols: 3 });
      box.appendChild(
        DP.el('div', { class: 'col' }, [
          DP.ui.card('Company & rules', DP.el('div', { class: 'col' }, [
            form,
            DP.el('div', { class: 'row' }, [
              DP.el('button', { class: 'btn primary', text: '💾 Save settings', onclick: async () => {
                try {
                  const v = Object.assign({}, form.getValues());
                  for (const k of ['enforce_credit_limit', 'enforce_credit_days', 'allow_negative_stock', 'tax_enabled', 'enable_geo_fence']) v[k] = v[k] ? '1' : '0';
                  DP.state.settings = await DP.put('/settings', v);
                  DP.state.paper = DP.state.settings.print_paper;
                  DP.toast('Settings save ho gayin', 'ok');
                } catch (e) { DP.toast(e.message, 'bad'); }
              } }),
              DP.el('button', { class: 'btn sm', text: '🔄 Hisab recalculate', onclick: async () => {
                try { const o = await DP.post('/maintenance/recalc', {}); DP.toast('Recalculate ho gaya — GL ' + (o.gl.balanced ? 'balanced ✔' : 'me farq!'), o.gl.balanced ? 'ok' : 'warn'); } catch (e) { DP.toast(e.message, 'bad'); }
              } }),
            ]),
          ])),
          DP.ui.card('Backup aur data safety', DP.el('div', { class: 'col' }, [
            DP.el('p', { class: 'small muted', text: 'Poora data ek SQLite file me hai (data/distribution-pro.db). Roz backup banayein — client ka hisab anmol hai.' }),
            DP.el('div', { class: 'row' }, [
              DP.el('button', { class: 'btn primary', text: '💾 Backup banayein', onclick: async () => {
                try { const o = await DP.post('/backup/create', {}); DP.toast('Backup bana: ' + o.name, 'ok'); DP.rerender(); } catch (e) { DP.toast(e.message, 'bad'); }
              } }),
              DP.el('a', { class: 'btn', href: '/api/backup/download?token=' + encodeURIComponent(DP.token), target: '_blank', text: '⬇ Database download' }),
              DP.el('button', { class: 'btn danger', text: '♻️ Demo data hata kar khali karein', onclick: () => clearTransactions() }),
              DP.el('button', { class: 'btn', text: '📦 Demo data load karein', onclick: async () => {
                if (!(await DP.confirm('Demo (sample) data load karein? Mojooda data safe rahega, sirf sample add hoga.', { okLabel: 'Load karein' }))) return;
                try { const o = await DP.post('/maintenance/demo-data', {}); DP.toast('Demo data load ho gaya', 'ok'); } catch (e) { DP.toast(e.message, 'bad'); }
              } }),
            ]),
            DP.ui.table({
              columns: [
                { key: 'name', label: 'Backup file' },
                { key: 'size', label: 'Size (KB)', align: 'right', render: (r) => Math.round(Number(r.size) / 1024) },
                { key: 'at', label: 'Kab', render: (r) => DP.fmt.dateTime(r.at) },
                { key: 'act', label: '', render: (r) => DP.el('button', { class: 'btn sm danger', text: 'Restore', onclick: async () => {
                  if (!(await DP.confirm('Restore karne se mojooda data is backup se badal jayega. Confirm?', { danger: true, okLabel: 'Restore karein' }))) return;
                  try { await DP.post('/backup/restore', { name: r.name }); DP.toast('Restore ho gaya', 'ok'); setTimeout(() => location.reload(), 800); } catch (e) { DP.toast(e.message, 'bad'); }
                } }) },
              ],
              rows: await DP.get('/backup/list').catch(() => []),
              empty: 'Koi backup nahi — pehla backup banayein',
            }),
          ])),
          DP.ui.card('Versions & server', DP.el('div', { class: 'col small muted' }, [
            DP.ui.statLine('App version', 'v' + (window.DP_INFO ? DP_INFO.version : '1.0.0')),
            DP.ui.statLine('Database', s.db_file || ''),
          ])),
        ])
      );

      async function clearTransactions() {
        if (!(await DP.confirm('Ye saara transaction data (bills, stock, receipts) hata dega — customers/products/masters rahenge. Ye kaam wapas nahi hoga!', { danger: true, okLabel: 'Aage barhein' }))) return;
        const word = await DP.prompt({ title: 'Confirm likhein', label: 'CLEAR likhein', placeholder: 'CLEAR', hint: 'Ye asli business shuru karne se pehle demo data hatane ke liye hai.' });
        if (word === null) return;
        try {
          await DP.post('/maintenance/clear-transactions', { confirm: word });
          DP.toast('Transaction data clear ho gaya', 'ok');
          DP.rerender();
        } catch (e) { DP.toast(e.message, 'bad'); }
      }
    },
  });

  /* ================================================================ AUDIT */
  DP.definePage({
    key: 'audit',
    title: 'Audit Log',
    sub: 'Kis ne kya kiya — har entry ka record',
    icon: '🕵️',
    section: 'Admin',
    perm: 'audit.view',
    async render(root) {
      let from = DP.addDays(DP.today(), -7), q = '';
      const box = DP.el('div', { class: 'col' });
      root.appendChild(box);
      async function load() {
        DP.clear(box).appendChild(DP.ui.spinner());
        const rows = await DP.get(`/audit?from=${from}&limit=1000`);
        const filtered = q ? rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q.toLowerCase())) : rows;
        DP.clear(box);
        box.appendChild(
          DP.ui.card(
            DP.el('div', { class: 'row' }, [
              DP.el('input', { type: 'date', value: from, class: 'sm', onchange: (e) => { from = e.target.value; load(); } }),
              DP.ui.searchBox('Username / action / entity…', (v) => { q = v; load(); }, q),
              DP.el('button', { class: 'btn sm', text: '⬇ CSV', onclick: () => DP.downloadCsv('audit.csv', [{ key: 'at', label: 'Time' }, { key: 'username', label: 'User' }, { key: 'action', label: 'Action' }, { key: 'entity', label: 'Entity' }, { key: 'entity_id', label: 'ID' }, { key: 'details', label: 'Details' }], filtered) }),
            ]),
            DP.ui.table({
              columns: [
                { key: 'at', label: 'Time' },
                { key: 'username', label: 'User' },
                { key: 'action', label: 'Action', render: (r) => DP.ui.pill(r.action, /DELETE|VOID|BOUNCE|CLEAR/.test(r.action) ? 'bad' : /CREATE/.test(r.action) ? 'ok' : '') },
                { key: 'entity', label: 'Entity' },
                { key: 'entity_id', label: 'ID', align: 'right' },
                { key: 'details', label: 'Details', render: (r) => DP.el('span', { class: 'tiny', text: String(r.details || '').slice(0, 120) }) },
              ],
              rows: filtered,
              empty: 'Koi record nahi',
            })
          )
        );
      }
      await load();
    },
  });
})();
