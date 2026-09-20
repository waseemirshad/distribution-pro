/* Distribution Pro - Recovery (Receipts), Cheques, Payments, Expenses, Cash Closing */
(function () {
  'use strict';
  const methodPill = (m) => DP.ui.pill(m, m === 'CASH' ? 'ok' : m === 'CHEQUE' ? 'warn' : 'info');
  const chequePill = (s) => DP.ui.pill(s || '—', s === 'CLEARED' ? 'ok' : s === 'BOUNCED' || s === 'RETURNED' ? 'bad' : s === 'IN_CLEARING' ? 'info' : 'warn');

  /* ================================================================ RECEIPTS */
  DP.definePage({
    key: 'receipts',
    title: 'Recovery (Cash Receipts)',
    sub: 'Udhaar wapsi — FIFO se purana bill pehle clear hota hai',
    icon: '💵',
    section: 'Money',
    perm: 'receipts.view',
    async render(root) {
      let from = DP.monthStart(), to = DP.today(), method = '', customer_id = '';
      const box = DP.el('div', { class: 'col' });
      root.appendChild(box);

      const columns = [
        { key: 'receipt_no', label: 'Receipt' },
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'customer_name', label: 'Customer', render: (r) => DP.el('div', {}, [DP.el('div', { text: r.customer_name }), DP.el('div', { class: 'tiny muted', text: r.customer_phone || '' })]) },
        { key: 'method', label: 'Method', render: (r) => methodPill(r.method) },
        { key: 'cheque_no', label: 'Cheque / Bank', render: (r) => (r.method === 'CHEQUE' ? DP.el('div', {}, [DP.el('div', { text: r.cheque_no || '' }), DP.el('div', { class: 'tiny muted', text: `${DP.fmt.date(r.cheque_date)} • ${r.bank_name || ''}` }), chequePill(r.cheque_status)]) : r.bank_name || '—') },
        { key: 'salesman_name', label: 'Salesman' },
        { key: 'amount_paisa', label: 'Amount', type: 'money0', align: 'right' },
        { key: 'allocated_paisa', label: 'Bills me laga', type: 'money0', align: 'right' },
        { key: 'advance_paisa', label: 'Advance', type: 'money0', align: 'right', class: 'warnc' },
        {
          key: 'act', label: '', render: (r) =>
            DP.el('div', { class: 'row tight' }, [
              DP.el('button', { class: 'btn sm', text: '🖨️', title: 'Receipt print', onclick: () => printReceipt(r) }),
              DP.el('button', { class: 'btn sm', text: '💬', title: 'WhatsApp', onclick: () => DP.whatsapp(r.customer_phone, `Assalam-o-Alaikum ${r.customer_name}!\nAap se Rs ${DP.fmt.money0(r.amount_paisa)} wasool hue (${r.receipt_no}, ${r.method}).\nShukriya — ${DP.state.settings.company_name || ''}`) }),
            ]),
        },
      ];

      async function load() {
        DP.clear(box).appendChild(DP.ui.spinner());
        const rows = await DP.get(`/receipts?from=${from}&to=${to}&method=${method}&customer_id=${customer_id}`);
        const pos = await DP.get('/cash/position?date=' + DP.today());
        DP.clear(box);
        box.appendChild(
          DP.el('div', { class: 'grid g4' }, [
            DP.ui.kpi({ label: 'Is period ki recovery', value: 'Rs ' + DP.fmt.money0(rows.reduce((s, r) => s + Number(r.amount_paisa), 0)), sub: rows.length + ' receipts', tone: 'ok' }),
            DP.ui.kpi({ label: 'Cash in hand (live)', value: 'Rs ' + DP.fmt.money0(pos.cash_in_hand_paisa), sub: 'Locker + counter', tone: 'info' }),
            DP.ui.kpi({ label: 'Bank balance (GL)', value: 'Rs ' + DP.fmt.money0(pos.bank_paisa), sub: 'Cleared cheques included', tone: 'info' }),
            DP.ui.kpi({ label: 'Cheques in hand', value: 'Rs ' + DP.fmt.money0(pos.cheques_in_hand_paisa), sub: 'PDC — clearance pending', tone: 'warn' }),
          ])
        );
        box.appendChild(
          DP.ui.card(
            DP.el('div', { class: 'row' }, [
              DP.ui.dateRange((f, t) => { from = f; to = t; load(); }, from, to),
              DP.ui.select([{ value: '', label: 'Sab method' }, { value: 'CASH', label: 'Cash' }, { value: 'CHEQUE', label: 'Cheque' }, { value: 'BANK', label: 'Bank' }], method, (e) => { method = e.target.value; load(); }),
              DP.el('button', { class: 'btn sm', text: '⬇ CSV', onclick: () => DP.downloadCsv('receipts.csv', columns, rows) }),
              DP.el('button', { class: 'btn sm primary', text: '+ Nayi Recovery', onclick: () => newReceipt(load), disabled: !DP.can('receipts.create') }),
            ]),
            DP.ui.table({
              columns,
              rows,
              totals: { label: 'TOTAL', amount_paisa: rows.reduce((s, r) => s + Number(r.amount_paisa), 0) },
              empty: 'Koi receipt nahi',
            })
          )
        );
      }
      await load();
    },
  });

  function printReceipt(r) {
    const s = DP.state.settings || {};
    DP.print.slip('CASH RECEIPT ' + r.receipt_no, [
      ['Customer', r.customer_name || ''],
      ['Date', DP.fmt.date(r.date)],
      ['Method', r.method + (r.cheque_no ? ' #' + r.cheque_no : '')],
      ['Bank', r.bank_name || '—'],
      ['Amount Received', 'Rs ' + DP.fmt.money(r.amount_paisa)],
      ['Bills me adjust', 'Rs ' + DP.fmt.money(r.allocated_paisa)],
      ['Advance', 'Rs ' + DP.fmt.money(r.advance_paisa)],
    ], { settings: s });
  }

  async function newReceipt(reload) {
    const customers = await DP.get('/customers?due=1');
    const all = customers.length ? customers : await DP.get('/customers');
    let customer = null;
    const custSel = DP.ui.select([{ value: '', label: '— Customer chunein —' }].concat(all.map((c) => ({ value: c.id, label: `${c.name} — udhaar Rs ${DP.fmt.money0(c.balance_paisa)}` }))), '', (e) => {
      customer = all.find((c) => c.id === Number(e.target.value)) || null;
      drawInfo();
    });
    const info = DP.el('div', { class: 'small muted', text: 'Customer chunein…' });
    const amount = DP.el('input', { type: 'number', step: '0.01', placeholder: 'Amount (Rs)' });
    const method = DP.ui.select([{ value: 'CASH', label: 'Cash' }, { value: 'CHEQUE', label: 'Cheque (PDC)' }, { value: 'BANK', label: 'Bank / Online' }], 'CASH', drawInfo);
    const bank = DP.el('input', { placeholder: 'Bank name' });
    const chequeNo = DP.el('input', { placeholder: 'Cheque No' });
    const chequeDate = DP.el('input', { type: 'date', value: DP.today() });
    const smSel = DP.ui.select([{ value: '', label: '— Salesman —' }].concat((DP.state.lookups.salesmen || []).map((s) => ({ value: s.id, label: s.name }))), DP.state.user.salesman_id || '', () => {});
    const note = DP.el('input', { placeholder: 'Note' });
    const chequeBox = DP.el('div', { class: 'grid g3' }, [
      DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Bank' }), bank]),
      DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Cheque No' }), chequeNo]),
      DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Cheque Date' }), chequeDate]),
    ]);
    function drawInfo() {
      if (!customer) {
        info.textContent = 'Customer chunein…';
        return;
      }
      DP.clear(info);
      info.appendChild(DP.ui.statLine('Purana udhaar', 'Rs ' + DP.fmt.money0(customer.balance_paisa)));
      info.appendChild(DP.ui.statLine('Open bills', 'Rs ' + DP.fmt.money0(customer.open_due_paisa || customer.balance_paisa)));
      info.appendChild(DP.ui.statLine('Credit limit', customer.credit_limit_paisa ? 'Rs ' + DP.fmt.money0(customer.credit_limit_paisa) : 'No limit'));
      if (method.value === 'CASH') info.appendChild(DP.el('div', { class: 'pill ok', text: 'Cash — locker me jayega' }));
      chequeBox.classList.toggle('hidden', method.value !== 'CHEQUE');
    }
    drawInfo();

    DP.modal({
      title: 'Nayi Recovery (payment receive)',
      size: 'lg',
      body: DP.el('div', { class: 'col' }, [
        DP.el('div', { class: 'grid g3' }, [
          DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Customer *' }), custSel]),
          DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Amount (Rs) *' }), amount]),
          DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Method' }), method]),
          DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Salesman (recovery credit)' }), smSel]),
          DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Note' }), note]),
        ]),
        chequeBox,
        DP.el('div', { style: { background: 'var(--panel-2)', padding: '10px', borderRadius: '10px' } }, info),
        DP.el('p', { class: 'small muted', text: 'System khud sab se purane unpaid bill se shuru kar ke FIFO tarteeb se payment adjust karega. Ziada bacha hua paisa advance ban jayega.' }),
      ]),
      buttons: [
        { label: 'Cancel', onClick: (m) => m.close() },
        {
          label: 'Recovery save karein',
          class: 'primary',
          onClick: async (m) => {
            if (!customer || !amount.value) return DP.toast('Customer aur amount zaroori hai', 'bad');
            if (method.value === 'CHEQUE' && (!chequeNo.value || !chequeDate.value)) return DP.toast('Cheque number aur date likhein', 'bad');
            try {
              const out = await DP.post('/receipts', {
                customer_id: customer.id,
                amount_paisa: DP.fmt.toPaisa(amount.value),
                method: method.value,
                bank_name: bank.value,
                cheque_no: chequeNo.value,
                cheque_date: method.value === 'CHEQUE' ? chequeDate.value : null,
                salesman_id: smSel.value ? Number(smSel.value) : null,
                notes: note.value,
              });
              const allocs = out.allocations || [];
              DP.toast(`${out.receipt.receipt_no} save ho gayi — ${allocs.length} bill(s) clear hue${out.unallocated ? ', advance Rs ' + DP.fmt.money0(out.unallocated) : ''}`, 'ok');
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
  DP.receiptModal = newReceipt;

  /* ================================================================ CHEQUES */
  DP.definePage({
    key: 'cheques',
    title: 'Cheque Register (PDC)',
    sub: 'Post-dated cheques ka pura cycle: received → clearing → cleared/bounced',
    icon: '🏦',
    section: 'Money',
    perm: 'receipts.view',
    async render(root) {
      let status = '';
      const box = DP.el('div', { class: 'col' });
      root.appendChild(box);

      async function load() {
        DP.clear(box).appendChild(DP.ui.spinner());
        const rows = await DP.get('/receipts/cheques' + (status ? '?status=' + status : ''));
        DP.clear(box);
        const pending = rows.filter((r) => ['RECEIVED', 'IN_CLEARING'].includes(r.cheque_status));
        const bounced = rows.filter((r) => r.cheque_status === 'BOUNCED');
        box.appendChild(
          DP.el('div', { class: 'grid g4' }, [
            DP.ui.kpi({ label: 'Pending cheques', value: pending.length, sub: 'Rs ' + DP.fmt.money0(pending.reduce((s, r) => s + Number(r.amount_paisa), 0)), tone: 'warn' }),
            DP.ui.kpi({ label: 'In clearing', value: rows.filter((r) => r.cheque_status === 'IN_CLEARING').length, sub: 'Bank me jama', tone: 'info' }),
            DP.ui.kpi({ label: 'Cleared', value: rows.filter((r) => r.cheque_status === 'CLEARED').length, sub: 'Rs ' + DP.fmt.money0(rows.filter((r) => r.cheque_status === 'CLEARED').reduce((s, r) => s + Number(r.amount_paisa), 0)), tone: 'ok' }),
            DP.ui.kpi({ label: 'Bounced', value: bounced.length, sub: 'Rs ' + DP.fmt.money0(bounced.reduce((s, r) => s + Number(r.amount_paisa), 0)), tone: 'bad' }),
          ])
        );
        box.appendChild(
          DP.ui.card(
            DP.el('div', { class: 'row' }, [
              DP.ui.select([{ value: '', label: 'Sab cheque' }, { value: 'RECEIVED', label: 'Received (pending)' }, { value: 'IN_CLEARING', label: 'In clearing' }, { value: 'CLEARED', label: 'Cleared' }, { value: 'BOUNCED', label: 'Bounced' }], status, (e) => { status = e.target.value; load(); }),
              DP.el('button', { class: 'btn sm', text: '⬇ CSV', onclick: () => DP.downloadCsv('cheques.csv', columns, rows) }),
            ]),
            DP.ui.table({
              columns,
              rows,
              totals: { label: 'TOTAL', amount_paisa: rows.reduce((s, r) => s + Number(r.amount_paisa), 0) },
              empty: 'Koi cheque nahi',
            })
          )
        );
      }

      const columns = [
        { key: 'cheque_no', label: 'Cheque No' },
        { key: 'customer_name', label: 'Customer' },
        { key: 'bank_name', label: 'Bank' },
        { key: 'cheque_date', label: 'Cheque Date', type: 'date' },
        { key: 'amount_paisa', label: 'Amount', type: 'money0', align: 'right' },
        { key: 'receipt_no', label: 'Receipt' },
        { key: 'cheque_status', label: 'Status', render: (r) => chequePill(r.cheque_status) },
        { key: 'cheque_status_at', label: 'Last update', render: (r) => DP.fmt.dateTime(r.cheque_status_at) },
        {
          key: 'act', label: '', render: (r) =>
            DP.el('div', { class: 'row tight' }, [
              r.cheque_status === 'RECEIVED' && DP.can('receipts.cheque') ? DP.el('button', { class: 'btn sm', text: '🏦 Clearing me', onclick: () => setStatus(r.id, 'IN_CLEARING', load) }) : null,
              ['RECEIVED', 'IN_CLEARING'].includes(r.cheque_status) && DP.can('receipts.cheque') ? DP.el('button', { class: 'btn sm primary', text: '✅ Cleared', onclick: () => setStatus(r.id, 'CLEARED', load) }) : null,
              ['RECEIVED', 'IN_CLEARING'].includes(r.cheque_status) && DP.can('receipts.cheque') ? DP.el('button', { class: 'btn sm danger', text: '❌ Bounce', onclick: () => setStatus(r.id, 'BOUNCED', load) }) : null,
            ].filter(Boolean)),
        },
      ];

      async function setStatus(id, st, reload) {
        let charges = null;
        if (st === 'BOUNCED') {
          charges = await DP.prompt({ title: 'Cheque bounce — bank charges (Rs)', label: 'Charges', value: '500', hint: 'Bounce hone par bill dobara udhaar me chala jayega aur bank charges expense me jayenge.' });
          if (charges === null) return;
          if (!(await DP.confirm('Cheque bounce confirm karein? Invoice dobara UNPAID ho jayegi.', { danger: true }))) return;
        } else if (!(await DP.confirm(`Cheque status "${st}" karna hai?`))) return;
        try {
          await DP.post(`/receipts/${id}/cheque`, { status: st, charges_paisa: st === 'BOUNCED' ? DP.fmt.toPaisa(charges) : 0 });
          DP.toast('Cheque status update ho gaya: ' + st, 'ok');
          reload();
        } catch (e) {
          DP.toast(e.message, 'bad');
        }
      }

      await load();
    },
  });

  /* ================================================================ PAYMENTS */
  DP.definePage({
    key: 'payments',
    title: 'Supplier Payments',
    sub: 'Suppliers ko di gayi payments',
    icon: '💳',
    section: 'Money',
    perm: 'payments.view',
    async render(root) {
      let from = DP.monthStart(), to = DP.today();
      const box = DP.el('div', { class: 'col' });
      root.appendChild(box);
      async function load() {
        DP.clear(box).appendChild(DP.ui.spinner());
        const rows = await DP.get(`/payments?from=${from}&to=${to}`);
        DP.clear(box);
        box.appendChild(
          DP.ui.card(
            DP.el('div', { class: 'row' }, [
              DP.ui.dateRange((f, t) => { from = f; to = t; load(); }, from, to),
              DP.el('button', { class: 'btn sm primary', text: '+ Nayi Payment', onclick: () => DP.paymentModal({}, load), disabled: !DP.can('payments.create') }),
            ]),
            DP.ui.table({
              columns: [
                { key: 'payment_no', label: 'Payment No' },
                { key: 'date', label: 'Date', type: 'date' },
                { key: 'supplier_name', label: 'Supplier' },
                { key: 'method', label: 'Method', render: (r) => methodPill(r.method) },
                { key: 'cheque_no', label: 'Cheque / Bank', render: (r) => (r.cheque_no ? r.cheque_no + ' • ' + DP.fmt.date(r.cheque_date) : r.bank_name || '—') },
                { key: 'amount_paisa', label: 'Amount', type: 'money0', align: 'right' },
                { key: 'allocated_paisa', label: 'Bills me laga', type: 'money0', align: 'right' },
                { key: 'notes', label: 'Note' },
              ],
              rows,
              totals: { label: 'TOTAL', amount_paisa: rows.reduce((s, r) => s + Number(r.amount_paisa), 0) },
              empty: 'Koi payment nahi',
            })
          )
        );
      }
      await load();
    },
  });

  /* ================================================================ EXPENSES */
  DP.definePage({
    key: 'expenses',
    title: 'Expenses (Kharche)',
    sub: 'Petrol, chai, salary, rent — sab kharche yahan',
    icon: '⛽',
    section: 'Money',
    perm: 'expenses.view',
    async render(root) {
      let from = DP.monthStart(), to = DP.today();
      const box = DP.el('div', { class: 'col' });
      root.appendChild(box);
      async function load() {
        DP.clear(box).appendChild(DP.ui.spinner());
        const rows = await DP.get(`/expenses?from=${from}&to=${to}`);
        const byHead = {};
        rows.forEach((r) => (byHead[r.head_name || 'Other'] = (byHead[r.head_name || 'Other'] || 0) + Number(r.amount_paisa)));
        DP.clear(box);
        box.appendChild(DP.el('div', { class: 'grid g4' }, Object.entries(byHead).slice(0, 4).map(([h, v]) => DP.ui.kpi({ label: h, value: 'Rs ' + DP.fmt.money0(v), tone: 'warn' }))));
        box.appendChild(
          DP.ui.card(
            DP.el('div', { class: 'row' }, [
              DP.ui.dateRange((f, t) => { from = f; to = t; load(); }, from, to),
              DP.el('button', { class: 'btn sm', text: '⬇ CSV', onclick: () => DP.downloadCsv('expenses.csv', columns, rows) }),
              DP.el('button', { class: 'btn sm primary', text: '+ Naya Kharcha', onclick: () => newExpense(load), disabled: !DP.can('expenses.create') }),
            ]),
            DP.ui.table({
              columns,
              rows,
              totals: { label: 'TOTAL', amount_paisa: rows.reduce((s, r) => s + Number(r.amount_paisa), 0) },
              empty: 'Koi kharcha nahi',
            })
          )
        );
      }
      const columns = [
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'head_name', label: 'Head' },
        { key: 'payee', label: 'Payee' },
        { key: 'vehicle_no', label: 'Vehicle' },
        { key: 'salesman_name', label: 'Salesman' },
        { key: 'method', label: 'Method', render: (r) => methodPill(r.method) },
        { key: 'amount_paisa', label: 'Amount', type: 'money', align: 'right' },
        { key: 'note', label: 'Note' },
        { key: 'username', label: 'Entry by' },
        DP.can('expenses.create')
          ? {
              key: 'del', label: '', render: (r) =>
                DP.el('button', {
                  class: 'btn sm', text: '🗑', title: 'Delete + reverse', onclick: async () => {
                    if (!(await DP.confirm('Kharcha delete karein? Reverse entry bhi banegi.', { danger: true }))) return;
                    try {
                      await DP.del('/expenses/' + r.id);
                      load();
                    } catch (e) { DP.toast(e.message, 'bad'); }
                  },
                }),
            }
          : null,
      ].filter(Boolean);
      await load();
    },
  });

  async function newExpense(reload) {
    const heads = DP.state.lookups.heads || [];
    const form = DP.ui.form([
      { key: 'date', label: 'Date', type: 'date', value: DP.today() },
      { key: 'head_id', label: 'Kharcha ka head *', type: 'select', options: heads.map((h) => ({ value: h.id, label: h.name })) },
      { key: 'amount_paisa', label: 'Amount (Rs) *', type: 'money' },
      { key: 'method', label: 'Paid from', type: 'select', options: [{ value: 'CASH', label: 'Cash (locker)' }, { value: 'BANK', label: 'Bank' }] },
      { key: 'vehicle_no', label: 'Vehicle No', type: 'text' },
      { key: 'salesman_id', label: 'Salesman (agar commission/allowance)', type: 'select', options: [{ value: '', label: '—' }].concat((DP.state.lookups.salesmen || []).map((s) => ({ value: s.id, label: s.name }))) },
      { key: 'payee', label: 'Payee (kisko diya)', type: 'text' },
      { key: 'note', label: 'Note', type: 'text' },
    ], { cols: 2 });
    DP.modal({
      title: 'Naya Kharcha',
      body: form,
      buttons: [
        { label: 'Cancel', onClick: (m) => m.close() },
        {
          label: 'Save',
          class: 'primary',
          onClick: async (m) => {
            const v = form.getValues();
            if (!v.amount_paisa) return DP.toast('Amount likhein', 'bad');
            try {
              await DP.post('/expenses', v);
              DP.toast('Kharcha save ho gaya', 'ok');
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

  /* ================================================================ CASH CLOSING */
  DP.definePage({
    key: 'cash',
    title: 'Cash Closing (Locker)',
    sub: 'Din ke aakhir me cash ka hisaab — chori/kami foran pakri jayegi',
    icon: '🔒',
    section: 'Money',
    perm: 'closing.view',
    async render(root) {
      let date = DP.today();
      const box = DP.el('div', { class: 'col' });
      root.appendChild(box);
      async function load() {
        DP.clear(box).appendChild(DP.ui.spinner());
        const [pos, closings] = await Promise.all([DP.get('/cash/position?date=' + date), DP.get('/cash/closings?from=' + DP.addDays(DP.today(), -30) + '&to=' + DP.today())]);
        DP.clear(box);
        box.appendChild(
          DP.el('div', { class: 'row' }, [
            DP.el('label', { class: 'small muted', text: 'Date:' }),
            DP.el('input', { type: 'date', value: date, class: 'sm', style: { width: '150px' }, onchange: (e) => { date = e.target.value; load(); } }),
          ])
        );
        box.appendChild(
          DP.el('div', { class: 'grid g4' }, [
            DP.ui.kpi({ label: 'Opening cash', value: 'Rs ' + DP.fmt.money0(pos.opening_paisa), sub: 'Din ke shuru me', tone: 'info' }),
            DP.ui.kpi({ label: 'Cash in (aaj)', value: 'Rs ' + DP.fmt.money0(pos.cash_in_paisa), sub: `Sale Rs ${DP.fmt.money0(pos.cash_in_sales_paisa)} + recovery Rs ${DP.fmt.money0(pos.cash_in_recovery_paisa)}`, tone: 'ok' }),
            DP.ui.kpi({ label: 'Cash out (aaj)', value: 'Rs ' + DP.fmt.money0(pos.cash_out_paisa), sub: `Kharcha ${DP.fmt.money0(pos.cash_out_expenses_paisa)} + supplier ${DP.fmt.money0(pos.cash_out_payments_paisa)}`, tone: 'warn' }),
            DP.ui.kpi({ label: 'Expected cash', value: 'Rs ' + DP.fmt.money0(pos.expected_paisa), sub: `Locker me hona chahiye • live Rs ${DP.fmt.money0(pos.cash_in_hand_paisa)}`, tone: 'info' }),
          ])
        );
        const counted = DP.el('input', { type: 'number', step: '0.01', placeholder: 'Ginti kar ke jo cash mila (Rs)' });
        const note = DP.el('input', { placeholder: 'Note (e.g. 50 rupees kam nikle)' });
        box.appendChild(
          DP.ui.card('Cash Closing karein', DP.el('div', { class: 'col' }, [
            DP.el('div', { class: 'grid g3' }, [
              DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Counted cash (Rs)' }), counted]),
              DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: 'Note' }), note]),
              DP.el('div', { class: 'field' }, [DP.el('label', { class: 'f', text: '' }), DP.el('button', {
                class: 'btn primary block', text: '🔒 Closing save karein', disabled: !DP.can('closing.create'),
                onclick: async () => {
                  if (!counted.value) return DP.toast('Counted cash likhein', 'bad');
                  try {
                    const c = await DP.post('/cash/closings', { date, counted_paisa: DP.fmt.toPaisa(counted.value), note: note.value });
                    DP.toast(`Closing save — variance Rs ${DP.fmt.money0(c.variance_paisa)}`, c.variance_paisa === 0 ? 'ok' : 'warn');
                    load();
                  } catch (e) { DP.toast(e.message, 'bad'); }
                },
              })]),
            ]),
            DP.el('p', { class: 'small muted', text: 'Farq (variance) automatically cash adjustment ke tor par record hota hai taake books tally rahein.' }),
          ]))
        );
        box.appendChild(
          DP.ui.card('Pichhle closings', DP.ui.table({
            columns: [
              { key: 'date', label: 'Date', type: 'date' },
              { key: 'opening_paisa', label: 'Opening', type: 'money0', align: 'right' },
              { key: 'cash_in_paisa', label: 'Cash In', type: 'money0', align: 'right' },
              { key: 'cash_out_paisa', label: 'Cash Out', type: 'money0', align: 'right' },
              { key: 'expected_paisa', label: 'Expected', type: 'money0', align: 'right' },
              { key: 'counted_paisa', label: 'Counted', type: 'money0', align: 'right' },
              { key: 'variance_paisa', label: 'Variance', align: 'right', render: (r) => DP.ui.pill(DP.fmt.money0(r.variance_paisa), Number(r.variance_paisa) === 0 ? 'ok' : Number(r.variance_paisa) > 0 ? 'info' : 'bad') },
              { key: 'username', label: 'By' },
              { key: 'note', label: 'Note' },
            ],
            rows: closings,
            empty: 'Koi closing nahi',
          }))
        );
      }
      await load();
    },
  });
})();
