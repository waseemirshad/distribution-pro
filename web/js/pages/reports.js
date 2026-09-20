/* Distribution Pro - Reports (32 reports, print + CSV) */
(function () {
  'use strict';

  DP.definePage({
    key: 'reports',
    title: 'Reports',
    sub: '32 reports — sale, munafa, stock, expiry, udhaar, cheque, van, commission',
    icon: '📈',
    section: 'Reports',
    perm: 'reports.view',
    async render(root, params) {
      const list = await DP.get('/reports');
      const state = {
        key: (params && params.report) || list[0].key,
        values: { from: DP.monthStart(), to: DP.today() },
        filter: '',
      };
      const sidebarBox = DP.el('div', { class: 'col' });
      const pane = DP.el('div', { class: 'col' });
      root.appendChild(DP.el('div', { class: 'report-layout' }, [DP.el('div', { class: 'report-list' }, [sidebarBox]), DP.el('div', { class: 'report-pane' }, [pane])]));

      function drawList() {
        DP.clear(sidebarBox);
        sidebarBox.appendChild(DP.ui.searchBox('Report dhundein…', (v) => { state.filter = v.toLowerCase(); drawList(); }, state.filter));
        const groups = { Sales: [], Purchase: [], Stock: [], Money: [], Trade: [], Other: [] };
        list.filter((r) => !state.filter || (r.name + ' ' + r.key).toLowerCase().includes(state.filter)).forEach((r) => {
          const k = r.key;
          if (/^(sales|salesman|daily|profit|receivable|target)/.test(k)) groups.Sales.push(r);
          else if (/^purchase|payable|supplier/.test(k)) groups.Purchase.push(r);
          else if (/stock|batch|item|inventory/.test(k)) groups.Stock.push(r);
          else if (/cash|expense|cheque|day_book|account/.test(k)) groups.Money.push(r);
          else if (/scheme|commission|market|open_orders|returns/.test(k)) groups.Trade.push(r);
          else groups.Other.push(r);
        });
        Object.entries(groups).forEach(([g, rows]) => {
          if (!rows.length) return;
          sidebarBox.appendChild(DP.el('div', { class: 'nav-section' }, [DP.el('span', { text: g })]));
          rows.forEach((r) =>
            sidebarBox.appendChild(DP.el('button', { class: 'nav-item' + (r.key === state.key ? ' active' : ''), onclick: () => { state.key = r.key; drawList(); run(); } }, [DP.el('span', { class: 'tx', text: r.name })]))
          );
        });
      }

      function currentReport() {
        return list.find((r) => r.key === state.key) || list[0];
      }

      function paramControl(name) {
        const label = { from: 'Se (date)', to: 'Tak (date)', as_on: 'As on (date)', date: 'Date', period: 'Mahina', days: 'Din', q: 'Search', status: 'Status', customer_id: 'Customer', supplier_id: 'Supplier', salesman_id: 'Salesman', warehouse_id: 'Godown', product_id: 'Item' }[name] || name;
        const set = (v) => { state.values[name] = v; };
        if (['from', 'to', 'as_on', 'date'].includes(name)) return DP.ui.field({ key: name, label, type: 'date', value: state.values[name] || DP.today(), onChange: (e) => { set(e.target.value); run(); } });
        if (name === 'period') return DP.ui.field({ key: name, label, type: 'month', value: state.values[name] || DP.today().slice(0, 7), onChange: (e) => { set(e.target.value); run(); } });
        if (name === 'days') return DP.ui.field({ key: name, label, type: 'select', value: state.values[name] || '90', options: [{ value: '30', label: '30 din' }, { value: '60', label: '60 din' }, { value: '90', label: '90 din' }, { value: '180', label: '180 din' }], onChange: (e) => { set(e.target.value); run(); } });
        if (name === 'status') return DP.ui.field({ key: name, label, type: 'select', value: state.values[name] || '', options: [{ value: '', label: 'Sab' }, { value: 'RECEIVED', label: 'Received' }, { value: 'IN_CLEARING', label: 'Clearing' }, { value: 'CLEARED', label: 'Cleared' }, { value: 'BOUNCED', label: 'Bounced' }], onChange: (e) => { set(e.target.value); run(); } });
        if (name === 'warehouse_id') return DP.ui.field({ key: name, label, type: 'select', value: state.values[name] || '', options: [{ value: '', label: 'Sab godown' }].concat((DP.state.lookups.warehouses || []).map((w) => ({ value: w.id, label: w.name }))), onChange: (e) => { set(e.target.value); run(); } });
        if (name === 'customer_id') return DP.ui.field({ key: name, label, type: 'select', value: state.values[name] || '', options: [{ value: '', label: 'Sab customer' }].concat((DP.state.lookups.customersAll || []).map((c) => ({ value: c.id, label: c.name }))), onChange: (e) => { set(e.target.value); run(); } });
        if (name === 'supplier_id') return DP.ui.field({ key: name, label, type: 'select', value: state.values[name] || '', options: [{ value: '', label: 'Sab supplier' }].concat((DP.state.lookups.suppliers || []).map((c) => ({ value: c.id, label: c.name }))), onChange: (e) => { set(e.target.value); run(); } });
        if (name === 'salesman_id') return DP.ui.field({ key: name, label, type: 'select', value: state.values[name] || '', options: [{ value: '', label: 'Sab salesman' }].concat((DP.state.lookups.salesmen || []).map((c) => ({ value: c.id, label: c.name }))), onChange: (e) => { set(e.target.value); run(); } });
        if (name === 'product_id') return DP.ui.field({ key: name, label, type: 'select', value: state.values[name] || '', options: [{ value: '', label: 'Sab items' }].concat((DP.state.lookups.productsAll || []).map((c) => ({ value: c.id, label: c.name }))), onChange: (e) => { set(e.target.value); run(); } });
        return DP.ui.field({ key: name, label, type: 'text', value: state.values[name] || '', onChange: DP.debounce((e) => { set(e.target.value); run(); }, 300) });
      }

      function qs(extra) {
        const p = Object.assign({}, state.values, extra || {});
        return Object.entries(p).filter(([, v]) => v !== '' && v !== null && v !== undefined).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
      }

      let lastReport = null;
      async function run() {
        const rep = currentReport();
        DP.clear(pane).appendChild(DP.ui.spinner('Report ban raha hai…'));
        try {
          const data = await DP.get('/reports/' + rep.key + '?' + qs());
          lastReport = data;
          DP.clear(pane);
          pane.appendChild(
            DP.el('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'flex-start' } }, [
              DP.el('div', {}, [DP.el('h3', { text: data.name }), DP.el('div', { class: 'small muted', text: data.rows.length + ' rows • ' + (DP.state.settings.company_name || '') })]),
              DP.el('div', { class: 'row tight' }, [
                DP.el('button', { class: 'btn sm primary', text: '🖨️ Print', onclick: () => DP.print.report(data, { range: rangeText() }) }),
                DP.el('button', { class: 'btn sm', text: '⬇ CSV', onclick: () => downloadCsv(rep.key) }),
                DP.el('button', { class: 'btn sm', text: '💬 WhatsApp summary', onclick: () => shareSummary(data) }),
              ]),
            ])
          );
          pane.appendChild(DP.el('div', { class: 'row tight' }, (rep.params || []).map((p) => paramControl(p))));
          const totalsText = Object.entries(data.totals || {}).filter(([, v]) => typeof v === 'number').map(([k, v]) => {
            const col = (data.columns || []).find((c) => c.key === k);
            const isMoney = col && col.type === 'money';
            return `${(col && col.label) || k}: ${isMoney ? 'Rs ' + DP.fmt.money(v) : DP.fmt.money0 ? (isMoney ? '' : String(v)) : v}`;
          });
          if (totalsText.length) pane.appendChild(DP.el('div', { class: 'totals-strip', text: totalsText.join('   |   ') }));
          pane.appendChild(DP.ui.card(DP.ui.table({ columns: data.columns, rows: data.rows, empty: 'Is filter me koi data nahi — date range badal kar dekhein' })));
        } catch (e) {
          DP.clear(pane).appendChild(DP.el('div', { class: 'empty', text: '⚠️ ' + e.message }));
        }
      }

      function rangeText() {
        const v = state.values;
        if (v.from || v.to) return `${v.from || '—'} se ${v.to || '—'}`;
        if (v.date) return `Date: ${v.date}`;
        if (v.period) return `Mahina: ${v.period}`;
        if (v.as_on) return `As on ${v.as_on}`;
        return '';
      }

      function downloadCsv(key) {
        const url = '/api/reports/' + key + '?format=csv&' + qs() + '&token=' + encodeURIComponent(DP.token);
        window.open(url, '_blank');
      }

      function shareSummary(data) {
        const s = DP.state.settings || {};
        const lines = [data.name, rangeText(), ''];
        const moneyCol = (data.columns || []).filter((c) => c.type === 'money');
        moneyCol.forEach((c) => {
          if (data.totals && data.totals[c.key] !== undefined) lines.push(`${c.label}: Rs ${DP.fmt.money(data.totals[c.key])}`);
        });
        lines.push('', '— ' + (s.company_name || 'Distribution Pro'));
        const phone = window.prompt('Kis number par bhejna hai? (khali chhorein = WhatsApp apna number chunein)', '');
        if (phone === null) return;
        if (phone) DP.whatsapp(phone, lines.join('\n'));
        else window.open('https://wa.me/?text=' + encodeURIComponent(lines.join('\n')), '_blank');
      }

      // customers/items list for select filters (agar permission ho)
      DP.state.lookups.customersAll = await DP.get('/customers?limit=2000').catch(() => []);
      DP.state.lookups.productsAll = await DP.get('/products?limit=5000').catch(() => []);

      drawList();
      await run();
      DP.cleanup = null;
    },
  });
})();
