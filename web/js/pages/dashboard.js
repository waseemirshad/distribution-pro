/* Distribution Pro - Dashboard */
(function () {
  'use strict';
  DP.definePage({
    key: 'dashboard',
    title: 'Dashboard',
    sub: 'Aaj ka mukammal hisaab — ek nazar me',
    icon: '📊',
    section: 'Main',
    perm: 'dashboard.view',
    async render(root) {
      let date = DP.today();
      const wrap = DP.el('div', { class: 'col' });
      root.appendChild(wrap);

      async function load() {
        DP.clear(wrap).appendChild(DP.ui.spinner('Dashboard load ho raha hai…'));
        const [d, alerts] = await Promise.all([DP.get('/dashboard?date=' + date), DP.get('/alerts')]);
        DP.clear(wrap);
        const s = d.sales;
        const profitTone = d.net_profit_paisa >= 0 ? 'ok' : 'bad';

        /* header */
        wrap.appendChild(
          DP.el('div', { class: 'spread' }, [
            DP.el('div', { class: 'row' }, [
              DP.el('label', { class: 'small muted', text: 'Date:' }),
              DP.el('input', {
                type: 'date',
                value: date,
                class: 'sm',
                style: { width: '150px' },
                onchange: (e) => {
                  date = e.target.value || DP.today();
                  load();
                },
              }),
              DP.el('button', { class: 'btn sm', text: 'Aaj', onclick: () => { date = DP.today(); load(); } }),
              DP.el('button', { class: 'btn sm', text: 'Refresh', onclick: load }),
            ]),
            DP.el('div', { class: 'row tight' }, [
              DP.el('button', { class: 'btn primary sm', text: '🧾 Naya Bill (F2)', onclick: () => DP.go('pos') }),
              DP.el('button', { class: 'btn sm', text: '💵 Recovery', onclick: () => DP.go('receipts') }),
              DP.el('button', { class: 'btn sm', text: '📦 Purchase', onclick: () => DP.go('purchases') }),
              DP.el('button', { class: 'btn sm', text: '🔒 Cash Closing', onclick: () => DP.go('cash') }),
            ]),
          ])
        );

        /* alerts strip */
        if (alerts.items.length) {
          wrap.appendChild(
            DP.ui.card(
              DP.el('h3', { text: `⚠️ Alerts (${alerts.items.length})` }),
              DP.el(
                'div',
                { class: 'row tight' },
                alerts.items.slice(0, 12).map((a) =>
                  DP.el('div', { class: 'alert-chip ' + a.level, title: a.detail }, [DP.el('b', { text: a.title }), DP.el('span', { class: 'tiny muted', text: a.detail })])
                )
              ),
              [DP.el('button', { class: 'btn sm ghost', text: 'Reports', onclick: () => DP.go('reports') })]
            )
          );
        }

        /* KPI rows */
        wrap.appendChild(
          DP.el('div', { class: 'grid g5' }, [
            DP.ui.kpi({ label: 'Aaj ki Sale', value: 'Rs ' + DP.fmt.money0(s.total_paisa), sub: `${s.count} bills • cash Rs ${DP.fmt.money0(s.cash_sales_paisa)}`, tone: 'info', onclick: () => DP.go('sales') }),
            DP.ui.kpi({ label: 'Gross Profit', value: 'Rs ' + DP.fmt.money0(s.gross_profit_paisa), sub: `Discount Rs ${DP.fmt.money0(s.discount_paisa)}`, tone: 'ok', onclick: () => DP.go('reports', { report: 'profit_report' }) }),
            DP.ui.kpi({ label: 'Aaj ke Kharche', value: 'Rs ' + DP.fmt.money0(d.expenses_paisa), sub: 'Petrol, chai, salary…', tone: 'warn', onclick: () => DP.go('expenses') }),
            DP.ui.kpi({ label: 'Net Profit (Aaj)', value: 'Rs ' + DP.fmt.money0(d.net_profit_paisa), sub: 'Gross profit − kharche', tone: profitTone }),
            DP.ui.kpi({ label: 'Recovery (Aaj)', value: 'Rs ' + DP.fmt.money0(d.recovery_paisa), sub: 'Cash + cheque + bank', tone: 'info', onclick: () => DP.go('receipts') }),
          ])
        );
        wrap.appendChild(
          DP.el('div', { class: 'grid g6' }, [
            DP.ui.kpi({ label: 'Market Udhaar', value: 'Rs ' + DP.fmt.money0(d.receivables_paisa), sub: 'Receivable', tone: d.receivables_paisa > 0 ? 'warn' : 'ok', onclick: () => DP.go('customers', { tab: 'due' }) }),
            DP.ui.kpi({ label: 'Supplier Baqaya', value: 'Rs ' + DP.fmt.money0(d.payables_paisa), sub: 'Payable', tone: 'bad', onclick: () => DP.go('suppliers') }),
            DP.ui.kpi({ label: 'Cash in Hand', value: 'Rs ' + DP.fmt.money0(d.cash.cash_in_hand_paisa), sub: `Bank: Rs ${DP.fmt.money0(d.cash.bank_paisa)}`, tone: 'ok', onclick: () => DP.go('cash') }),
            DP.ui.kpi({ label: 'Cheques in Hand', value: 'Rs ' + DP.fmt.money0(d.cash.cheques_in_hand_paisa), sub: `${d.cheques_pending} pending`, tone: 'info', onclick: () => DP.go('cheques') }),
            DP.ui.kpi({ label: 'Stock Value (Cost)', value: 'Rs ' + DP.fmt.money0(d.stock_value_cost_paisa), sub: `Retail: Rs ${DP.fmt.money0(d.stock_value_retail_paisa)}`, tone: 'info', onclick: () => DP.go('stock') }),
            DP.ui.kpi({ label: 'Is Mahine ka Munafa', value: 'Rs ' + DP.fmt.money0(d.month.net_profit_paisa), sub: `Sale Rs ${DP.fmt.money0(d.month.sales_paisa)}`, tone: d.month.net_profit_paisa >= 0 ? 'ok' : 'bad', onclick: () => DP.go('reports', { report: 'daily_sales_summary' }) }),
          ])
        );

        /* charts */
        const labels = d.trend.map((t) => t.date);
        const trendCard = DP.ui.card('Pichhle 14 din ki Sale & Profit', DP.el('div', {}, [
          DP.charts.line(labels, [
            { data: d.trend.map((t) => t.total), color: '#4f46e5', fill: true },
            { data: d.trend.map((t) => t.gp), color: '#059669' },
          ]),
          DP.el('div', { class: 'legend' }, [
            DP.el('span', {}, [DP.el('i', { style: { background: '#4f46e5' } }), 'Sale']),
            DP.el('span', {}, [DP.el('i', { style: { background: '#059669' } }), 'Gross Profit']),
          ]),
        ]));

        const agingCard = DP.ui.card('Udhaar Aging (30/60/90 din)', DP.el('div', {}, [
          DP.charts.bars(
            d.aging.map((a, i) => ({ label: a.bucket, value: a.amount_paisa, color: ['#059669', '#0284c7', '#d97706', '#dc2626'][i] })),
            { height: 180 }
          ),
          DP.el('div', { class: 'col', style: { marginTop: '8px' } }, d.aging.map((a) => DP.ui.statLine(`${a.bucket} din — ${a.count} bill(s)`, 'Rs ' + DP.fmt.money0(a.amount_paisa)))),
          DP.el('button', { class: 'btn sm', text: 'Poori aging report', onclick: () => DP.go('reports', { report: 'receivables_aging' }) }),
        ]));

        const salesMix = DP.ui.card('Aaj ka Sale Mix', DP.el('div', {}, [
          DP.charts.donut(
            [
              { label: 'Cash Sale', value: s.cash_sales_paisa, color: '#059669' },
              { label: 'Udhaar Sale', value: s.total_paisa - s.cash_sales_paisa, color: '#d97706' },
              { label: 'Returns', value: d.returns.total_paisa, color: '#dc2626' },
            ],
            { centerSub: 'Aaj' }
          ),
        ]));

        wrap.appendChild(DP.el('div', { class: 'grid g2' }, [trendCard, DP.el('div', { class: 'col' }, [agingCard, salesMix])]));

        /* top lists */
        const topProducts = DP.ui.table({
          columns: [
            { key: 'name', label: 'Item' },
            { key: 'qty', label: 'Qty', type: 'qty', align: 'right' },
            { key: 'total', label: 'Sale', type: 'money0', align: 'right' },
            { key: 'profit', label: 'Profit', type: 'money0', align: 'right', class: 'pos' },
          ],
          rows: d.top_products,
          empty: 'Is mahine koi sale nahi hui',
        });
        const topCustomers = DP.ui.table({
          columns: [
            { key: 'name', label: 'Dukan' },
            { key: 'invoices', label: 'Bills', align: 'right' },
            { key: 'total', label: 'Sale', type: 'money0', align: 'right' },
            { key: 'due', label: 'Udhaar', type: 'money0', align: 'right', class: 'neg' },
          ],
          rows: d.top_customers,
          empty: 'Koi customer sale nahi',
        });
        const salesmanTable = DP.ui.table({
          columns: [
            { key: 'name', label: 'Salesman' },
            { key: 'invoices', label: 'Bills', align: 'right' },
            { key: 'sales', label: 'Sale', type: 'money0', align: 'right' },
            { key: 'recovery', label: 'Recovery', type: 'money0', align: 'right', class: 'pos' },
          ],
          rows: d.salesman_performance,
          empty: 'Koi salesman active nahi',
        });
        wrap.appendChild(
          DP.el('div', { class: 'grid g3' }, [
            DP.ui.card('Top Items (is mahine)', topProducts),
            DP.ui.card('Top Dukanein', topCustomers),
            DP.ui.card('Salesman Performance', salesmanTable),
          ])
        );

        /* expiry + low stock */
        const low = DP.ui.table({
          columns: [
            { key: 'name', label: 'Item' },
            { key: 'stock', label: 'Stock', align: 'right' },
            { key: 'reorder_level', label: 'Reorder', align: 'right' },
          ],
          rows: d.low_stock,
          empty: 'Sab items ka stock theek hai 👍',
        });
        const exp = DP.ui.table({
          columns: [
            { key: 'product_name', label: 'Item' },
            { key: 'batch_no', label: 'Batch' },
            { key: 'expiry_date', label: 'Expiry', type: 'date' },
            { key: 'days_left', label: 'Din', align: 'right', render: (r) => DP.ui.pill(r.days_left + '', r.days_left < 0 ? 'bad' : r.days_left <= 30 ? 'bad' : r.days_left <= 60 ? 'warn' : 'ok') },
            { key: 'qty_remaining', label: 'Qty', align: 'right' },
          ],
          rows: d.near_expiry,
          empty: 'Agle 90 din me kuch expire nahi ho raha 👍',
        });
        wrap.appendChild(DP.el('div', { class: 'grid g2' }, [DP.ui.card('Near Expiry — Push Sale karein', exp), DP.ui.card('Low Stock / Reorder', low)]));

        /* footer info */
        const glOk = d.gl.balanced;
        wrap.appendChild(
          DP.el('div', { class: 'card tight' }, [
            DP.el('div', { class: 'row' }, [
              DP.ui.pill('GL: ' + (glOk ? 'Balanced ✓' : 'Mismatch ✗'), glOk ? 'ok' : 'bad'),
              DP.ui.pill('Pending claims: Rs ' + DP.fmt.money0(d.pending_claims_value), 'info'),
              d.next_cheque_due
                ? DP.ui.pill(`Next cheque: ${d.next_cheque_due.customer_name || ''} ${d.next_cheque_due.cheque_no || ''} (${DP.fmt.date(d.next_cheque_due.cheque_date)}) Rs ${DP.fmt.money0(d.next_cheque_due.amount_paisa)}`, 'warn')
                : null,
              d.open_van_loads.length ? DP.ui.pill(`${d.open_van_loads.length} van load settle pending`, 'warn') : DP.ui.pill('Koi van load pending nahi', 'ok'),
            ]),
          ])
        );
      }

      await load();
    },
  });
})();
