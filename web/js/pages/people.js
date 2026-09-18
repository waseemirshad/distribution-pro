/* Distribution Pro - Customers, Suppliers, Salesmen, Targets, Commissions, Schemes, Claims, Visits */
(function () {
  'use strict';

  /* ================================================================ CUSTOMERS */
  DP.definePage({
    key: 'customers',
    title: 'Customers (Dukanein)',
    sub: 'Khata, credit limit, udhaar aur dukan ka record',
    icon: '🏪',
    section: 'People',
    perm: 'customers.view',
    async render(root, params) {
      let q = '', route_id = '', tab = (params && params.tab) || 'all';
      const box = DP.el('div', { class: 'col' });
      root.appendChild(box);

      async function load() {
        DP.clear(box).appendChild(DP.ui.spinner());
        const rows = await DP.get(`/customers?q=${encodeURIComponent(q)}&route_id=${route_id}&due=${tab === 'due' ? 1 : ''}`);
        const totalDue = rows.reduce((s, r) => s + Math.max(0, Number(r.balance_paisa)), 0);
        DP.clear(box);
        box.appendChild(
          DP.el('div', { class: 'grid g4' }, [
            DP.ui.kpi({ label: 'Total dukanein', value: rows.length, tone: 'info' }),
            DP.ui.kpi({ label: 'Total udhaar', value: 'Rs ' + DP.fmt.money0(totalDue), tone: totalDue ? 'warn' : 'ok' }),
            DP.ui.kpi({ label: 'Limit se ziada', value: rows.filter((r) => Number(r.credit_limit_paisa) && Number(r.balance_paisa) > Number(r.credit_limit_paisa)).length, tone: 'bad' }),
            DP.ui.kpi({ label: 'Advance wale', value: rows.filter((r) => Number(r.balance_paisa) < 0).length, tone: 'ok' }),
          ])
        );
        box.appendChild(
          DP.ui.card(
            DP.el('div', { class: 'row' }, [
              DP.ui.tabs([{ key: 'all', label: 'Sab dukanein' }, { key: 'due', label: 'Udhaar wale' }], tab, (k) => { tab = k; load(); }),
              DP.ui.searchBox('Naam / phone / area…', (v) => { q = v; load(); }, q),
              DP.ui.select([{ value: '', label: 'Sab route' }].concat((DP.state.lookups.routes || []).map((r) => ({ value: r.id, label: r.name }))), route_id, (e) => { route_id = e.target.value; load(); }),
              DP.el('button', { class: 'btn sm', text: '⬇ CSV', onclick: () => DP.downloadCsv('customers.csv', columns, rows) }),
              DP.can('customers.manage') ? DP.el('button', { class: 'btn sm primary', text: '+ Naya Customer', onclick: () => editCustomer(null, load) }) : null,
            ]),
            DP.ui.table({ columns, rows, onRowClick: (r) => profile(r), empty: 'Koi customer nahi — pehla customer add karein' })
          )
        );
      }

      const columns = [
        { key: 'name', label: 'Dukan', render: (r) => DP.el('div', {}, [DP.el('b', { text: r.name }), DP.el('div', { class: 'tiny muted', text: `${r.owner_name || ''} ${r.phone ? '• ' + r.phone : ''}` })]) },
        { key: 'area', label: 'Area' },
        { key: 'route_name', label: 'Route' },
        { key: 'tier_name', label: 'Rate Tier' },
        { key: 'balance_paisa', label: 'Udhaar', align: 'right', render: (r) => DP.el('b', { class: Number(r.balance_paisa) > 0 ? 'neg' : Number(r.balance_paisa) < 0 ? 'pos' : 'muted', text: 'Rs ' + DP.fmt.money0(r.balance_paisa) }) },
        { key: 'credit_limit_paisa', label: 'Limit', type: 'money0', align: 'right' },
        { key: 'credit_days', label: 'Days', align: 'right' },
        { key: 'invoice_count', label: 'Bills', align: 'right' },
        { key: 'last_sale', label: 'Aakhri Sale', type: 'date' },
        {
          key: 'flag', label: 'Status', render: (r) =>
            DP.ui.pill(
              r.credit_limit_paisa && Number(r.balance_paisa) > Number(r.credit_limit_paisa) ? 'Limit se ziada' : Number(r.balance_paisa) > 0 ? 'Udhaar' : Number(r.balance_paisa) < 0 ? 'Advance' : 'Clear',
              r.credit_limit_paisa && Number(r.balance_paisa) > Number(r.credit_limit_paisa) ? 'bad' : Number(r.balance_paisa) > 0 ? 'warn' : 'ok'
            ),
        },
      ];

      async function profile(r) {
        const p = await DP.get(`/customers/${r.id}/profile`);
        const c = p.customer;
        DP.modal({
          title: `${c.name} — ${c.area || ''}`,
          size: 'xl',
          body: DP.el('div', { class: 'col' }, [
            DP.el('div', { class: 'grid g5' }, [
              DP.ui.kpi({ label: 'Udhaar balance', value: 'Rs ' + DP.fmt.money0(p.credit.balance_paisa), tone: Number(p.credit.balance_paisa) > 0 ? 'bad' : 'ok' }),
              DP.ui.kpi({ label: 'Credit limit', value: p.credit.credit_limit_paisa ? 'Rs ' + DP.fmt.money0(p.credit.credit_limit_paisa) : 'No limit', tone: 'info' }),
              DP.ui.kpi({ label: 'Credit days', value: (p.credit.credit_days || 0) + ' din', tone: 'info' }),
              DP.ui.kpi({ label: 'Overdue', value: 'Rs ' + DP.fmt.money0(p.credit.overdue_paisa), sub: p.credit.days_overdue ? p.credit.days_overdue + ' din purana' : 'koi nahi', tone: p.credit.overdue_paisa ? 'bad' : 'ok' }),
              DP.ui.kpi({ label: 'Advance / jama', value: 'Rs ' + DP.fmt.money0(Math.max(0, -Number(p.credit.balance_paisa))), tone: 'ok' }),
            ]),
            DP.el('div', { class: 'row' }, [
              DP.el('span', { class: 'small muted', text: `${c.phone || ''} • ${c.address || ''} • Route: ${c.route_id ? '#' + c.route_id : '—'}` }),
            ]),
            DP.ui.tabs([{ key: 'bills', label: 'Bills' }, { key: 'receipts', label: 'Recovery' }, { key: 'items', label: 'Top items' }, { key: 'monthly', label: 'Monthly sale' }], 'bills', (k) => switchTab(k)),
            DP.el('div', { id: 'cust-tab-body' }),
          ]),
          buttons: [
            DP.can('receipts.create') ? { label: '💵 Recovery lein', class: 'primary', onClick: (m) => { m.close(); DP.receiptModal({ customer_id: c.id }, () => load()); } } : null,
            { label: '🖨️ Khata print', onClick: () => printStatement(r.id, c.name, c.phone) },
            { label: '💬 Khata WhatsApp', onClick: () => waStatement(c, p.credit) },
            DP.can('customers.manage') ? { label: '✏️ Edit', onClick: (m) => { m.close(); editCustomer(r, load); } } : null,
            { label: 'Band' },
          ].filter(Boolean),
        });
        const bodyEl = document.getElementById('cust-tab-body');
        function switchTab(k) {
          DP.clear(bodyEl);
          if (k === 'bills') {
            bodyEl.appendChild(DP.ui.table({
              columns: [
                { key: 'invoice_no', label: 'Bill' }, { key: 'date', label: 'Date', type: 'date' }, { key: 'total_paisa', label: 'Total', type: 'money0', align: 'right' },
                { key: 'paid_paisa', label: 'Paid', type: 'money0', align: 'right' }, { key: 'balance_paisa', label: 'Baqaya', type: 'money0', align: 'right' },
                { key: 'status', label: 'Status', render: (x) => DP.ui.pill(x.status, x.status === 'PAID' ? 'ok' : x.status === 'PARTIAL' ? 'warn' : 'bad') },
              ],
              rows: p.invoices,
              onRowClick: () => {},
            }));
          } else if (k === 'receipts') {
            bodyEl.appendChild(DP.ui.table({
              columns: [
                { key: 'receipt_no', label: 'Receipt' }, { key: 'date', label: 'Date', type: 'date' }, { key: 'method', label: 'Method' },
                { key: 'cheque_no', label: 'Cheque' }, { key: 'amount_paisa', label: 'Amount', type: 'money0', align: 'right' },
                { key: 'allocated_paisa', label: 'Adjust', type: 'money0', align: 'right' }, { key: 'cheque_status', label: 'Status' },
              ],
              rows: p.receipts,
              empty: 'Koi recovery nahi',
            }));
          } else if (k === 'items') {
            bodyEl.appendChild(DP.ui.table({
              columns: [{ key: 'name', label: 'Item' }, { key: 'qty', label: 'Qty', align: 'right' }, { key: 'total', label: 'Sale', type: 'money0', align: 'right' }],
              rows: p.top_items,
              empty: 'Koi sale nahi',
            }));
          } else {
            bodyEl.appendChild(DP.ui.table({
              columns: [{ key: 'month', label: 'Mahina' }, { key: 'total', label: 'Sale', type: 'money0', align: 'right' }],
              rows: p.monthly,
              empty: 'Koi sale nahi',
            }));
          }
        }
        switchTab('bills');
      }

      async function printStatement(id, name, phone) {
        const rep = await DP.get(`/customers/${id}/statement?from=${DP.monthStart()}&to=${DP.today()}`);
        rep.name = 'Khata Statement — ' + name;
        DP.print.report(rep, { range: `${DP.monthStart()} se ${DP.today()}` });
      }
      async function waStatement(c, credit) {
        DP.whatsapp(
          c.whatsapp || c.phone,
          `Assalam-o-Alaikum ${c.name}!\nAap ka khata balance: Rs ${DP.fmt.money0(credit.balance_paisa)}\n${credit.overdue_paisa ? 'Purana baqaya: Rs ' + DP.fmt.money0(credit.overdue_paisa) + '\n' : ''}Baraye meherbani payment karwa dein.\n— ${DP.state.settings.company_name || ''}`
        );
      }

      await load();
      if (params && params.open) profile({ id: params.open });
    },
  });

  async function editCustomer(r, reload) {
    const opts = (name, list, lbl) => [{ value: '', label: '—' }].concat(list.map((x) => ({ value: x.id, label: lbl ? lbl(x) : x.name })));
    const fields = [
      { key: 'name', label: 'Dukan ka naam *', type: 'text', value: r ? r.name : '' },
      { key: 'owner_name', label: 'Malik ka naam', type: 'text', value: r ? r.owner_name : '' },
      { key: 'phone', label: 'Phone', type: 'text', value: r ? r.phone : '', placeholder: '0300-1234567' },
      { key: 'whatsapp', label: 'WhatsApp', type: 'text', value: r ? r.whatsapp : '' },
      { key: 'area', label: 'Area / Bazar', type: 'text', value: r ? r.area : '' },
      { key: 'address', label: 'Poora pata', type: 'text', value: r ? r.address : '' },
      { key: 'route_id', label: 'Route / Beat', type: 'select', options: opts('route', DP.state.lookups.routes || []), value: r ? r.route_id : '' },
      { key: 'tier_id', label: 'Rate tier', type: 'select', options: (DP.state.lookups.tiers || []).map((t) => ({ value: t.id, label: t.name + (Number(t.discount_pct) ? ` (${t.discount_pct}% off)` : '') })), value: r ? r.tier_id : '' },
      { key: 'credit_limit_paisa', label: 'Credit limit (Rs)', type: 'money', value: r ? r.credit_limit_paisa : 0, hint: '0 = koi limit nahi (matlab unlimited udhaar allowed)' },
      { key: 'credit_days', label: 'Credit days', type: 'number', value: r ? r.credit_days : 0 },
      { key: 'opening_balance_paisa', label: 'Opening udhaar (Rs)', type: 'money', value: r ? r.opening_balance_paisa : 0, hint: 'Purana baqaya jo system se pehle ka hai' },
      { key: 'shop_type', label: 'Dukan ka type', type: 'text', value: r ? r.shop_type : '', placeholder: 'Kiryana / Super Store' },
      { key: 'ntn', label: 'NTN / Tax no', type: 'text', value: r ? r.ntn : '' },
      { key: 'notes', label: 'Note', type: 'text', value: r ? r.notes : '' },
      { key: 'active', label: 'Active dukan', type: 'checkbox', value: r ? r.active : 1 },
    ];
    const form = DP.ui.form(fields, { cols: 2 });
    DP.modal({
      title: r ? 'Customer edit karein — ' + r.name : 'Naya Customer',
      size: 'lg',
      body: form,
      buttons: [
        { label: 'Cancel', onClick: (m) => m.close() },
        {
          label: 'Save',
          class: 'primary',
          onClick: async (m) => {
            const v = form.getValues();
            if (!v.name) return DP.toast('Naam zaroori hai', 'bad');
            try {
              if (r) await DP.put('/crud/customers/' + r.id, v);
              else await DP.post('/crud/customers', v);
              DP.toast('Customer save ho gaya', 'ok');
              m.close();
              if (reload) reload();
            } catch (e) {
              DP.toast(e.message, 'bad');
            }
          },
        },
      ],
    });
  }

  /* ================================================================ SUPPLIERS */
  DP.definePage({
    key: 'suppliers',
    title: 'Suppliers',
    sub: 'Maal dene wale — payable aur khata',
    icon: '🏭',
    section: 'People',
    perm: 'suppliers.view',
    async render(root) {
      let q = '';
      const box = DP.el('div', { class: 'col' });
      root.appendChild(box);
      async function load() {
        DP.clear(box).appendChild(DP.ui.spinner());
        const rows = await DP.get('/crud/suppliers?q=' + encodeURIComponent(q) + '&limit=500');
        DP.clear(box);
        box.appendChild(
          DP.el('div', { class: 'grid g3' }, [
            DP.ui.kpi({ label: 'Suppliers', value: rows.length, tone: 'info' }),
            DP.ui.kpi({ label: 'Total payable', value: 'Rs ' + DP.fmt.money0(rows.reduce((s, r) => s + Math.max(0, Number(r.balance_paisa)), 0)), tone: 'bad' }),
            DP.ui.kpi({ label: 'Advance diya hua', value: 'Rs ' + DP.fmt.money0(rows.reduce((s, r) => s + Math.max(0, -Number(r.balance_paisa)), 0)), tone: 'ok' }),
          ])
        );
        box.appendChild(
          DP.ui.card(
            DP.el('div', { class: 'row' }, [
              DP.ui.searchBox('Supplier naam / phone…', (v) => { q = v; load(); }, q),
              DP.el('button', { class: 'btn sm', text: '⬇ CSV', onclick: () => DP.downloadCsv('suppliers.csv', columns, rows) }),
              DP.el('button', { class: 'btn sm primary', text: '+ Naya Supplier', onclick: () => editSupplier(null, load), disabled: !DP.can('suppliers.manage') }),
            ]),
            DP.ui.table({ columns, rows, onRowClick: (r) => profile(r), empty: 'Koi supplier nahi' })
          )
        );
      }
      const columns = [
        { key: 'name', label: 'Supplier', render: (r) => DP.el('div', {}, [DP.el('b', { text: r.name }), DP.el('div', { class: 'tiny muted', text: `${r.contact_person || ''} ${r.phone ? '• ' + r.phone : ''}` })]) },
        { key: 'city', label: 'City' },
        { key: 'balance_paisa', label: 'Payable', align: 'right', render: (r) => DP.el('b', { class: Number(r.balance_paisa) > 0 ? 'neg' : 'muted', text: 'Rs ' + DP.fmt.money0(r.balance_paisa) }) },
        { key: 'ntn', label: 'NTN' },
        {
          key: 'act', label: '', render: (r) =>
            DP.el('div', { class: 'row tight' }, [
              DP.el('button', { class: 'btn sm', text: '👁', onclick: () => profile(r) }),
              DP.can('payments.create') ? DP.el('button', { class: 'btn sm primary', text: '💳 Pay', onclick: () => DP.paymentModal({ supplier_id: r.id, amount: Number(r.balance_paisa) }, load) }) : null,
              DP.can('suppliers.manage') ? DP.el('button', { class: 'btn sm', text: '✏️', onclick: () => editSupplier(r, load) }) : null,
            ].filter(Boolean)),
        },
      ];
      async function profile(r) {
        const p = await DP.get(`/suppliers/${r.id}/profile`);
        DP.modal({
          title: p.supplier.name + ' — supplier khata',
          size: 'lg',
          body: DP.el('div', { class: 'col' }, [
            DP.el('div', { class: 'grid g3' }, [
              DP.ui.kpi({ label: 'Payable', value: 'Rs ' + DP.fmt.money0(p.supplier.balance_paisa), tone: Number(p.supplier.balance_paisa) > 0 ? 'bad' : 'ok' }),
              DP.ui.kpi({ label: 'Total purchases', value: 'Rs ' + DP.fmt.money0(p.purchases.reduce((s, x) => s + Number(x.total_paisa), 0)), tone: 'info' }),
              DP.ui.kpi({ label: 'Payments kiye', value: 'Rs ' + DP.fmt.money0(p.payments.reduce((s, x) => s + Number(x.amount_paisa), 0)), tone: 'ok' }),
            ]),
            DP.ui.table({
              columns: [
                { key: 'invoice_no', label: 'Bill' }, { key: 'date', label: 'Date', type: 'date' }, { key: 'total_paisa', label: 'Total', type: 'money0', align: 'right' },
                { key: 'paid_paisa', label: 'Paid', type: 'money0', align: 'right' }, { key: 'balance_paisa', label: 'Baqaya', type: 'money0', align: 'right' },
              ],
              rows: p.purchases,
              empty: 'Koi purchase nahi',
            }),
          ]),
          buttons: [
            DP.can('payments.create') ? { label: '💳 Payment', class: 'primary', onClick: (m) => { m.close(); DP.paymentModal({ supplier_id: r.id, amount: Number(r.balance_paisa) }, load); } } : null,
            { label: '🖨️ Khata print', onClick: async () => { const rep = await DP.get(`/suppliers/${r.id}/statement?from=${DP.monthStart()}&to=${DP.today()}`); DP.print.report(rep, { range: `${DP.monthStart()} se ${DP.today()}` }); } },
            { label: 'Band' },
          ].filter(Boolean),
        });
      }
      await load();
    },
  });

  async function editSupplier(r, reload) {
    const form = DP.ui.form([
      { key: 'name', label: 'Supplier / Company *', type: 'text', value: r ? r.name : '' },
      { key: 'contact_person', label: 'Contact person', type: 'text', value: r ? r.contact_person : '' },
      { key: 'phone', label: 'Phone', type: 'text', value: r ? r.phone : '' },
      { key: 'email', label: 'Email', type: 'text', value: r ? r.email : '' },
      { key: 'city', label: 'City', type: 'text', value: r ? r.city : '' },
      { key: 'address', label: 'Address', type: 'text', value: r ? r.address : '' },
      { key: 'ntn', label: 'NTN', type: 'text', value: r ? r.ntn : '' },
      { key: 'opening_balance_paisa', label: 'Opening payable (Rs)', type: 'money', value: r ? r.opening_balance_paisa : 0 },
      { key: 'notes', label: 'Note', type: 'text', value: r ? r.notes : '' },
      { key: 'active', label: 'Active', type: 'checkbox', value: r ? r.active : 1 },
    ], { cols: 2 });
    DP.modal({
      title: r ? 'Supplier edit' : 'Naya Supplier',
      size: 'lg',
      body: form,
      buttons: [
        { label: 'Cancel', onClick: (m) => m.close() },
        {
          label: 'Save',
          class: 'primary',
          onClick: async (m) => {
            const v = form.getValues();
            if (!v.name) return DP.toast('Naam zaroori hai', 'bad');
            try {
              if (r) await DP.put('/crud/suppliers/' + r.id, v);
              else await DP.post('/crud/suppliers', v);
              DP.toast('Supplier save ho gaya', 'ok');
              m.close();
              reload();
            } catch (e) { DP.toast(e.message, 'bad'); }
          },
        },
      ],
    });
  }

  /* ================================================================ SALESMEN */
  DP.definePage({
    key: 'salesmen',
    title: 'Salesmen & Commission',
    sub: 'Recovery par commission — sirf wasooli par incentive',
    icon: '🧑‍💼',
    section: 'People',
    perm: 'masters.view',
    async render(root) {
      const box = DP.el('div', { class: 'col' });
      root.appendChild(box);
      let tab = 'salesmen';
      async function load() {
        DP.clear(box).appendChild(DP.ui.spinner());
        const [salesmen, commissions] = await Promise.all([DP.get('/lookup/salesmen'), DP.get('/commissions')]);
        DP.clear(box);
        box.appendChild(DP.ui.tabs([{ key: 'salesmen', label: 'Salesmen' }, { key: 'commission', label: 'Commission' }], tab, (k) => { tab = k; load(); }));

        if (tab === 'salesmen') {
          box.appendChild(
            DP.ui.card(
              DP.el('div', { class: 'row' }, [
                DP.el('span', { class: 'small muted', text: 'Salesman ka commission uski wasooli (recovery) par lagta hai, sirf bill banane par nahi.' }),
                DP.can('masters.manage') ? DP.el('button', { class: 'btn sm primary', text: '+ Naya Salesman', onclick: () => editSalesman(null, load) }) : null,
              ]),
              DP.ui.table({
                columns: [
                  { key: 'name', label: 'Salesman', render: (r) => DP.el('b', { text: r.name }) },
                  { key: 'code', label: 'Code' },
                  { key: 'phone', label: 'Phone' },
                  { key: 'route_name', label: 'Route' },
                  { key: 'vehicle_no', label: 'Vehicle' },
                  { key: 'commission_pct', label: 'Commission %', align: 'right' },
                  { key: 'basic_salary_paisa', label: 'Salary', type: 'money0', align: 'right' },
                  { key: 'active', label: 'Status', render: (r) => DP.ui.pill(r.active ? 'Active' : 'Inactive', r.active ? 'ok' : 'bad') },
                  DP.can('masters.manage')
                    ? { key: 'act', label: '', render: (r) => DP.el('button', { class: 'btn sm', text: '✏️', onclick: () => editSalesman(r, load) }) }
                    : null,
                ].filter(Boolean),
                rows: salesmen,
                empty: 'Koi salesman nahi',
              })
            )
          );
        } else {
          box.appendChild(
            DP.ui.card(
              DP.el('div', { class: 'row' }, [
                DP.el('span', { class: 'small muted', text: 'Rehne dein — sirf CLEARED cheques/cash recovery count hoti hai.' }),
                DP.can('commissions.manage')
                  ? DP.el('button', {
                      class: 'btn sm primary', text: '🔄 Is mahine ka commission generate karein',
                      onclick: async () => {
                        try {
                          const out = await DP.post('/commissions/generate', { from: DP.monthStart(), to: DP.today() });
                          DP.toast(out.length + ' salesmen ka commission bana', 'ok');
                          load();
                        } catch (e) { DP.toast(e.message, 'bad'); }
                      },
                    })
                  : null,
              ]),
              DP.ui.table({
                columns: [
                  { key: 'salesman_name', label: 'Salesman' },
                  { key: 'period_from', label: 'From', type: 'date' },
                  { key: 'period_to', label: 'To', type: 'date' },
                  { key: 'base_paisa', label: 'Recovery Base', type: 'money0', align: 'right' },
                  { key: 'pct', label: '%', align: 'right' },
                  { key: 'amount_paisa', label: 'Commission', type: 'money0', align: 'right' },
                  { key: 'note', label: 'Note' },
                  { key: 'status', label: 'Status', render: (r) => DP.ui.pill(r.status, r.status === 'PAID' ? 'ok' : 'warn') },
                  DP.can('commissions.manage')
                    ? {
                        key: 'act', label: '', render: (r) =>
                          r.status !== 'PAID' ? DP.el('button', { class: 'btn sm primary', text: '💵 Pay', onclick: async () => { try { await DP.post(`/commissions/${r.id}/pay`, {}); DP.toast('Commission paid (expense me record)', 'ok'); load(); } catch (e) { DP.toast(e.message, 'bad'); } } }) : null,
                      }
                    : null,
                ].filter(Boolean),
                rows: commissions,
                empty: 'Koi commission record nahi — generate karein',
              })
            )
          );
        }
      }
      async function editSalesman(r, reload) {
        const form = DP.ui.form([
          { key: 'name', label: 'Naam *', type: 'text', value: r ? r.name : '' },
          { key: 'code', label: 'Code', type: 'text', value: r ? r.code : '' },
          { key: 'phone', label: 'Phone', type: 'text', value: r ? r.phone : '' },
          { key: 'route_id', label: 'Route', type: 'select', options: [{ value: '', label: '—' }].concat((DP.state.lookups.routes || []).map((x) => ({ value: x.id, label: x.name }))), value: r ? r.route_id : '' },
          { key: 'vehicle_no', label: 'Vehicle No', type: 'text', value: r ? r.vehicle_no : '' },
          { key: 'commission_pct', label: 'Commission % (recovery par)', type: 'number', value: r ? r.commission_pct : 2.5 },
          { key: 'basic_salary_paisa', label: 'Basic salary (Rs)', type: 'money', value: r ? r.basic_salary_paisa : 0 },
          { key: 'active', label: 'Active', type: 'checkbox', value: r ? r.active : 1 },
        ], { cols: 2 });
        DP.modal({
          title: r ? 'Salesman edit' : 'Naya Salesman',
          body: form,
          buttons: [
            { label: 'Cancel', onClick: (m) => m.close() },
            {
              label: 'Save', class: 'primary',
              onClick: async (m) => {
                const v = form.getValues();
                if (!v.name) return DP.toast('Naam likhein', 'bad');
                try {
                  if (r) await DP.put('/crud/salesmen/' + r.id, v); else await DP.post('/crud/salesmen', v);
                  DP.toast('Salesman save ho gaya', 'ok');
                  DP.state.lookups.salesmen = await DP.get('/lookup/salesmen');
                  m.close(); reload();
                } catch (e) { DP.toast(e.message, 'bad'); }
              },
            },
          ],
        });
      }
      await load();
    },
  });

  /* ================================================================ TARGETS */
  DP.definePage({
    key: 'targets',
    title: 'Targets',
    sub: 'Salesman ka monthly target vs achievement',
    icon: '🎯',
    section: 'People',
    perm: 'targets.view',
    async render(root) {
      let period = DP.today().slice(0, 7);
      const box = DP.el('div', { class: 'col' });
      root.appendChild(box);
      async function load() {
        DP.clear(box).appendChild(DP.ui.spinner());
        const rows = await DP.get('/targets?period=' + period);
        DP.clear(box);
        box.appendChild(
          DP.ui.card(
            DP.el('div', { class: 'row' }, [
              DP.el('input', { type: 'month', value: period, class: 'sm', style: { width: '150px' }, onchange: (e) => { period = e.target.value; load(); } }),
              DP.can('targets.manage') ? DP.el('button', { class: 'btn sm primary', text: '+ Target set karein', onclick: () => editTarget(period, load) }) : null,
            ]),
            DP.ui.table({
              columns: [
                { key: 'salesman_name', label: 'Salesman' },
                { key: 'target_sales_paisa', label: 'Target Sale', type: 'money0', align: 'right' },
                { key: 'achieved_sales_paisa', label: 'Achieved', type: 'money0', align: 'right' },
                { key: 'p', label: 'Progress Sale', render: (r) => DP.el('div', { style: { minWidth: '120px' } }, [DP.ui.bar((Number(r.achieved_sales_paisa) / Math.max(1, Number(r.target_sales_paisa))) * 100, Number(r.achieved_sales_paisa) >= Number(r.target_sales_paisa) ? 'ok' : '')]) },
                { key: 'target_recovery_paisa', label: 'Target Recovery', type: 'money0', align: 'right' },
                { key: 'achieved_recovery_paisa', label: 'Recovered', type: 'money0', align: 'right' },
                { key: 'p2', label: 'Progress Recovery', render: (r) => DP.ui.bar((Number(r.achieved_recovery_paisa) / Math.max(1, Number(r.target_recovery_paisa))) * 100, 'ok') },
              ],
              rows,
              empty: 'Is mahine ke targets set nahi — "Target set karein" dabayein',
            })
          )
        );
      }
      async function editTarget(period, reload) {
        const form = DP.ui.form([
          { key: 'salesman_id', label: 'Salesman *', type: 'select', options: (DP.state.lookups.salesmen || []).map((s) => ({ value: s.id, label: s.name })) },
          { key: 'period', label: 'Month (YYYY-MM)', type: 'text', value: period },
          { key: 'target_sales_paisa', label: 'Target sale (Rs)', type: 'money' },
          { key: 'target_recovery_paisa', label: 'Target recovery (Rs)', type: 'money' },
          { key: 'target_new_outlets', label: 'Nayi dukanein', type: 'number', value: 0 },
          { key: 'note', label: 'Note', type: 'text' },
        ], { cols: 2 });
        DP.modal({
          title: 'Target set karein', body: form,
          buttons: [
            { label: 'Cancel', onClick: (m) => m.close() },
            {
              label: 'Save', class: 'primary',
              onClick: async (m) => {
                const v = form.getValues();
                try {
                  const existing = (await DP.get('/targets?period=' + v.period)).find((t) => t.salesman_id === Number(v.salesman_id));
                  if (existing) await DP.put('/crud/targets/' + existing.id, v); else await DP.post('/crud/targets', v);
                  DP.toast('Target save ho gaya', 'ok');
                  m.close(); reload();
                } catch (e) { DP.toast(e.message, 'bad'); }
              },
            },
          ],
        });
      }
      await load();
    },
  });

  /* ================================================================ SCHEMES & CLAIMS */
  DP.definePage({
    key: 'schemes',
    title: 'Trade Schemes & Claims',
    sub: '10+1 free, slab discount aur company se claim',
    icon: '🎁',
    section: 'Trade',
    perm: 'schemes.view',
    async render(root) {
      let tab = 'schemes';
      const box = DP.el('div', { class: 'col' });
      root.appendChild(box);
      async function load() {
        DP.clear(box).appendChild(DP.ui.spinner());
        const [schemes, claims] = await Promise.all([DP.get('/schemes'), DP.get('/claims?from=' + DP.addDays(DP.today(), -180))]);
        DP.clear(box);
        box.appendChild(DP.ui.tabs([{ key: 'schemes', label: 'Schemes' }, { key: 'claims', label: 'Company Claims' }], tab, (k) => { tab = k; load(); }));
        if (tab === 'schemes') {
          box.appendChild(
            DP.ui.card(
              DP.el('div', { class: 'row' }, [
                DP.el('span', { class: 'small muted', text: 'Scheme bill par khud lag jati hai — POS me clerk ko kuch nahi karna padta.' }),
                DP.can('schemes.manage') ? DP.el('button', { class: 'btn sm primary', text: '+ Nayi Scheme', onclick: () => editScheme(null, load) }) : null,
              ]),
              DP.ui.table({
                columns: [
                  { key: 'name', label: 'Scheme' },
                  { key: 'type', label: 'Type', render: (r) => DP.ui.pill({ FREE_QTY: 'X+Y Free', SLAB_DISCOUNT: 'Slab %', CASH_DISCOUNT: 'Cash %' }[r.type] || r.type, 'brand') },
                  { key: 'product_name', label: 'Item', render: (r) => r.product_name || r.category_name || r.company_name || 'Sab items' },
                  { key: 'buy_qty', label: 'Buy', align: 'right' },
                  { key: 'free_qty', label: 'Free', align: 'right' },
                  { key: 'discount_pct', label: 'Disc %', align: 'right' },
                  { key: 'start_date', label: 'From', type: 'date' },
                  { key: 'end_date', label: 'To', type: 'date' },
                  { key: 'claimable', label: 'Claim', render: (r) => DP.ui.pill(r.claimable ? 'Claimable' : 'No', r.claimable ? 'ok' : '') },
                  { key: 'active', label: 'Status', render: (r) => DP.ui.pill(r.active ? 'Active' : 'Band', r.active ? 'ok' : 'bad') },
                  DP.can('schemes.manage') ? { key: 'act', label: '', render: (r) => DP.el('button', { class: 'btn sm', text: '✏️', onclick: () => editScheme(r, load) }) } : null,
                ].filter(Boolean),
                rows: schemes,
                empty: 'Koi scheme nahi — nayi scheme banayein',
              })
            )
          );
        } else {
          box.appendChild(
            DP.ui.card(
              DP.el('div', { class: 'row' }, [DP.el('span', { class: 'small muted', text: 'Free goods ka kharcha company se claim hota hai — status track karein.' })]),
              DP.ui.table({
                columns: [
                  { key: 'date', label: 'Date', type: 'date' },
                  { key: 'company_name', label: 'Company' },
                  { key: 'scheme_name', label: 'Scheme' },
                  { key: 'product_name', label: 'Item' },
                  { key: 'qty_free', label: 'Free Qty', align: 'right' },
                  { key: 'value_paisa', label: 'Claim Value', type: 'money0', align: 'right' },
                  { key: 'invoice_no', label: 'Bill' },
                  { key: 'status', label: 'Status', render: (r) => DP.ui.pill(r.status, r.status === 'SETTLED' ? 'ok' : r.status === 'SUBMITTED' ? 'info' : 'warn') },
                  DP.can('claims.manage')
                    ? {
                        key: 'act', label: '', render: (r) =>
                          r.status !== 'SETTLED'
                            ? DP.el('div', { class: 'row tight' }, [
                                DP.el('button', { class: 'btn sm', text: '📤 Submit', onclick: async () => { await DP.post(`/claims/${r.id}/settle`, { status: 'SUBMITTED' }); load(); } }),
                                DP.el('button', { class: 'btn sm primary', text: '✅ Settled', onclick: async () => { await DP.post(`/claims/${r.id}/settle`, { status: 'SETTLED' }); load(); } }),
                              ])
                            : null,
                      }
                    : null,
                ].filter(Boolean),
                rows: claims,
                totals: { label: 'TOTAL', value_paisa: claims.reduce((s, r) => s + Number(r.value_paisa), 0) },
                empty: 'Koi claim nahi',
              })
            )
          );
        }
      }
      async function editScheme(r, reload) {
        const form = DP.ui.form([
          { key: 'name', label: 'Scheme ka naam *', type: 'text', value: r ? r.name : '', hint: 'e.g. Cocomo 10 Carton + 1 Carton Free' },
          { key: 'type', label: 'Type', type: 'select', options: [{ value: 'FREE_QTY', label: 'X + Y Free (qty scheme)' }, { value: 'SLAB_DISCOUNT', label: 'Slab % discount' }, { value: 'CASH_DISCOUNT', label: 'Cash % discount' }], value: r ? r.type : 'FREE_QTY' },
          { key: 'product_id', label: 'Item (ya khali chhorein)', type: 'select', options: [{ value: '', label: '— sab items —' }].concat((DP.state.lookups.products || []).map((p) => ({ value: p.id, label: p.name }))), value: r ? r.product_id : '' },
          { key: 'company_id', label: 'Company (claim ke liye)', type: 'select', options: [{ value: '', label: '—' }].concat((DP.state.lookups.companies || []).map((c) => ({ value: c.id, label: c.name }))), value: r ? r.company_id : '' },
          { key: 'buy_qty', label: 'Buy qty (pcs)', type: 'number', value: r ? r.buy_qty : 240, hint: 'Misaal: 240 pcs (10 carton) par…' },
          { key: 'free_qty', label: 'Free qty (pcs)', type: 'number', value: r ? r.free_qty : 24, hint: '…24 pcs (1 carton) free' },
          { key: 'slab_min_qty', label: 'Slab minimum qty (pcs)', type: 'number', value: r ? r.slab_min_qty : 0 },
          { key: 'discount_pct', label: 'Discount %', type: 'number', value: r ? r.discount_pct : 0 },
          { key: 'start_date', label: 'Start date', type: 'date', value: r ? r.start_date : DP.today() },
          { key: 'end_date', label: 'End date', type: 'date', value: r ? r.end_date : DP.addDays(DP.today(), 90) },
          { key: 'claimable', label: 'Company se claim hogi', type: 'checkbox', value: r ? r.claimable : 1 },
          { key: 'active', label: 'Active', type: 'checkbox', value: r ? r.active : 1 },
        ], { cols: 2 });
        DP.modal({
          title: r ? 'Scheme edit' : 'Nayi Trade Scheme',
          size: 'lg',
          body: form,
          buttons: [
            { label: 'Cancel', onClick: (m) => m.close() },
            {
              label: 'Save', class: 'primary',
              onClick: async (m) => {
                const v = form.getValues();
                if (!v.name) return DP.toast('Naam likhein', 'bad');
                try {
                  if (r) await DP.put('/crud/schemes/' + r.id, v); else await DP.post('/crud/schemes', v);
                  DP.toast('Scheme save ho gayi', 'ok');
                  m.close(); reload();
                } catch (e) { DP.toast(e.message, 'bad'); }
              },
            },
          ],
        });
      }
      await load();
    },
  });

  /* ================================================================ VISITS */
  DP.definePage({
    key: 'visits',
    title: 'Market Visits (GPS)',
    sub: 'Salesman ne dukan par check-in kiya — geo-fence ke sath',
    icon: '📍',
    section: 'Trade',
    perm: 'visits.view',
    async render(root) {
      let from = DP.today(), to = DP.today();
      const box = DP.el('div', { class: 'col' });
      root.appendChild(box);
      async function load() {
        DP.clear(box).appendChild(DP.ui.spinner());
        const rows = await DP.get(`/visits?from=${from}&to=${to}`);
        const customers = await DP.get('/customers');
        DP.clear(box);
        box.appendChild(
          DP.ui.card(
            DP.el('div', { class: 'row' }, [
              DP.ui.dateRange((f, t) => { from = f; to = t; load(); }, from, to),
              DP.can('visits.create') ? DP.el('button', { class: 'btn sm primary', text: '📍 Check-in karein', onclick: () => newVisit(customers, load) }) : null,
            ]),
            DP.ui.table({
              columns: [
                { key: 'at', label: 'Time', render: (r) => DP.fmt.dateTime(r.at) },
                { key: 'customer_name', label: 'Dukan' },
                { key: 'salesman_name', label: 'Salesman' },
                { key: 'kind', label: 'Type', render: (r) => DP.ui.pill(r.kind, r.kind === 'ORDER' ? 'ok' : 'info') },
                { key: 'distance_m', label: 'Distance (m)', align: 'right', render: (r) => (r.distance_m === null ? '—' : DP.ui.pill(r.distance_m + ' m', Number(r.distance_m) <= 150 ? 'ok' : 'bad')) },
                { key: 'notes', label: 'Note' },
              ],
              rows,
              empty: 'Aaj koi visit nahi',
            })
          )
        );
      }
      async function newVisit(customers, reload) {
        const custSel = DP.ui.select(customers.map((c) => ({ value: c.id, label: c.name })), '', () => {});
        const kindSel = DP.ui.select([{ value: 'CHECKIN', label: 'Check-in' }, { value: 'ORDER', label: 'Order liya' }], 'CHECKIN', () => {});
        const note = DP.el('input', { placeholder: 'Note' });
        const status = DP.el('div', { class: 'small muted', text: 'GPS permission maangi ja rahi hai…' });
        let coords = null;
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (pos) => { coords = { lat: pos.coords.latitude, lng: pos.coords.longitude }; status.textContent = `Location mil gayi (±${Math.round(pos.coords.accuracy)}m)`; },
            () => { status.textContent = 'GPS nahi mila — bina location check-in hoga (geo-fence skip).'; }
          );
        } else status.textContent = 'Is browser me GPS nahi hai.';
        DP.modal({
          title: 'Market Visit Check-in',
          size: 'sm',
          body: DP.el('div', { class: 'col' }, [
            DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Dukan *' }), custSel]),
            DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Visit ka type' }), kindSel]),
            DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Note' }), note]),
            status,
          ]),
          buttons: [
            { label: 'Cancel', onClick: (m) => m.close() },
            {
              label: 'Check-in', class: 'primary',
              onClick: async (m) => {
                try {
                  const v = await DP.post('/visits/checkin', { customer_id: Number(custSel.value), kind: kindSel.value, notes: note.value, lat: coords && coords.lat, lng: coords && coords.lng });
                  DP.toast(`Check-in ho gaya (${v.distance_m === null ? 'GPS nahi' : v.distance_m + ' m'})`, 'ok');
                  m.close(); reload();
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

  DP.customerEdit = editCustomer;
  DP.supplierEdit = editSupplier;
})();
