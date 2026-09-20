/* ============================================================
   Distribution Pro - core UI kit (vanilla JS, offline safe)
   ============================================================ */
(function () {
  'use strict';

  const DP = (window.DP = window.DP || {});
  DP.pages = DP.pages || [];
  DP.pageMap = DP.pageMap || {};
  DP.state = {
    user: null,
    settings: {},
    lookups: {},
    warehouseId: null,
    route: null,
    alerts: [],
    paper: '80mm',
  };

  /* ---------------------------------------------------------------- utils */
  const PAISA = 100;
  const nf = (n, d = 2) => Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: d, maximumFractionDigits: d });

  DP.fmt = {
    money(paisa, d = 2) {
      return nf((Number(paisa) || 0) / PAISA, d);
    },
    money0(paisa) {
      return nf(Math.round((Number(paisa) || 0) / PAISA), 0);
    },
    rs(paisa, d = 2) {
      const v = (Number(paisa) || 0) / PAISA;
      return (v < 0 ? '-Rs ' : 'Rs ') + nf(Math.abs(v), d);
    },
    rs0(paisa) {
      const v = Math.round((Number(paisa) || 0) / PAISA);
      return (v < 0 ? '-Rs ' : 'Rs ') + nf(Math.abs(v), 0);
    },
    toPaisa(v) {
      if (v === '' || v === null || v === undefined) return 0;
      const n = parseFloat(String(v).replace(/[,\sRs]/gi, ''));
      return Number.isFinite(n) ? Math.round(n * PAISA) : 0;
    },
    toRs(paisa) {
      return (Number(paisa) || 0) / PAISA;
    },
    qty(pcs, cartonSize) {
      const cs = Number(cartonSize) || 1;
      const q = Number(pcs) || 0;
      if (cs <= 1) return q + ' pcs';
      const c = Math.floor(Math.abs(q) / cs);
      const l = Math.abs(q) % cs;
      const sign = q < 0 ? '-' : '';
      if (c && l) return `${sign}${c} ctn + ${l} pcs`;
      if (c) return `${sign}${c} ctn`;
      return `${sign}${l} pcs`;
    },
    date(d) {
      if (!d) return '—';
      return String(d).slice(0, 10);
    },
    dateLong(d) {
      if (!d) return '—';
      const dt = new Date(String(d).slice(0, 10) + 'T00:00:00');
      if (isNaN(dt)) return String(d);
      return dt.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
    },
    dateTime(d) {
      return String(d || '').slice(0, 16);
    },
    pct(v) {
      return (Number(v) || 0).toFixed(2) + '%';
    },
    days(v) {
      const n = Number(v);
      if (!Number.isFinite(n)) return '—';
      if (n < 0) return Math.abs(n) + ' din pehle';
      if (n === 0) return 'aaj';
      return n + ' din';
    },
    phone(p) {
      return String(p || '—');
    },
  };

  DP.esc = function (s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  };
  DP.today = () => new Date().toLocaleDateString('en-CA');
  DP.addDays = (d, n) => {
    const dt = new Date(String(d).slice(0, 10) + 'T00:00:00');
    dt.setDate(dt.getDate() + n);
    return dt.toLocaleDateString('en-CA');
  };
  DP.dateAdd = DP.addDays; // alias — pages dono naam use karte hain
  DP.monthStart = () => DP.today().slice(0, 8) + '01';
  DP.debounce = (fn, ms = 250) => {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  };

  /* ---------------------------------------------------------------- API */
  DP.token = localStorage.getItem('dp_token') || '';
  DP.setToken = (t) => {
    DP.token = t || '';
    if (t) localStorage.setItem('dp_token', t);
    else localStorage.removeItem('dp_token');
  };

  DP.api = async function (path, opts = {}) {
    const res = await fetch('/api' + path, {
      method: opts.method || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' }, opts.body ? {} : {}, DP.token ? { Authorization: 'Bearer ' + DP.token } : {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      data = { error: text };
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'Request failed');
      err.code = data && data.code;
      err.status = res.status;
      err.data = data;
      // session khatam / token invalid -> app shell ko batayein (login screen dikhaye)
      if ((res.status === 401 || err.code === 'UNAUTHORIZED') && path.indexOf('/auth/login') !== 0 && typeof DP.onUnauthorized === 'function') {
        try {
          DP.onUnauthorized(err);
        } catch (e) {
          /* ignore */
        }
      }
      throw err;
    }
    return data;
  };
  DP.get = (p) => DP.api(p);
  DP.post = (p, body) => DP.api(p, { method: 'POST', body });
  DP.put = (p, body) => DP.api(p, { method: 'PUT', body });
  DP.del = (p) => DP.api(p, { method: 'DELETE' });

  /* ---------------------------------------------------------------- DOM */
  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (typeof props === 'string') props = { class: props };
    props = props || {};
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k === 'value') node.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'readOnly') node[k] = !!v;
      else node.setAttribute(k, v);
    }
    append(node, children);
    return node;
  }
  function append(node, children) {
    if (children === null || children === undefined || children === false) return;
    if (Array.isArray(children)) {
      children.forEach((c) => append(node, c));
      return;
    }
    if (children instanceof Node) node.appendChild(children);
    else node.appendChild(document.createTextNode(String(children)));
  }
  DP.el = el;
  DP.h = el;
  DP.clear = (n) => {
    while (n && n.firstChild) n.removeChild(n.firstChild);
    return n;
  };

  /* ---------------------------------------------------------------- toasts / modal */
  DP.toast = function (msg, type = '') {
    const root = document.getElementById('toast-root');
    const node = el('div', { class: 'toast ' + type, html: DP.esc(msg) });
    root.appendChild(node);
    setTimeout(() => node.remove(), type === 'bad' ? 6000 : 3200);
  };

  DP.modal = function (opts = {}) {
    const back = el('div', { class: 'modal-back' });
    const box = el('div', { class: 'modal ' + (opts.size || '') });
    const head = el('div', { class: 'modal-head' }, [el('h3', { text: opts.title || '' })]);
    const body = el('div', { class: 'modal-body' }, opts.body || '');
    const foot = el('div', { class: 'modal-foot' });
    const api = {
      box,
      body,
      close(result) {
        back.remove();
        document.removeEventListener('keydown', onKey);
        if (opts.onClose) opts.onClose(result);
      },
      setBody(node) {
        DP.clear(body).appendChild(node);
      },
      setFooter(nodes) {
        DP.clear(foot);
        (nodes || []).forEach((n) => foot.appendChild(n));
      },
    };
    const onKey = (e) => {
      if (e.key === 'Escape') api.close(null);
    };
    document.addEventListener('keydown', onKey);
    if (opts.closable !== false) head.appendChild(el('button', { class: 'icon-btn', text: '✕', onclick: () => api.close(null) }));
    box.appendChild(head);
    box.appendChild(body);
    (opts.buttons || []).forEach((b) =>
      foot.appendChild(
        el('button', {
          class: 'btn ' + (b.class || ''),
          text: b.label,
          disabled: b.disabled,
          onclick: () => {
            if (!b.onClick) return api.close(null);
            const r = b.onClick(api);
            if (r !== false && b.close !== false) return;
          },
        })
      )
    );
    if (opts.buttons && opts.buttons.length) box.appendChild(foot);
    back.appendChild(box);
    back.addEventListener('mousedown', (e) => {
      if (e.target === back && opts.closable !== false) api.close(null);
    });
    document.getElementById('modal-root').appendChild(back);
    const first = box.querySelector('input,select,textarea,button');
    if (first) setTimeout(() => first.focus(), 30);
    return api;
  };

  DP.confirm = function (message, opts = {}) {
    return new Promise((resolve) => {
      DP.modal({
        title: opts.title || 'Confirm karein',
        size: 'sm',
        body: el('div', { html: DP.esc(message).replace(/\n/g, '<br>') }),
        buttons: [
          { label: 'Cancel', onClick: (m) => { m.close(); resolve(false); } },
          {
            label: opts.okLabel || 'Haan, karein',
            class: opts.danger ? 'danger' : 'primary',
            onClick: (m) => { m.close(); resolve(true); },
          },
        ],
        onClose: () => resolve(false),
      });
    });
  };

  DP.prompt = function (opts = {}) {
    return new Promise((resolve) => {
      const input = el('input', { type: opts.type || 'text', placeholder: opts.placeholder || '', value: opts.value || '' });
      const box = el('div', {}, [opts.label ? el('label', { class: 'f', text: opts.label }) : null, input, opts.hint ? el('div', { class: 'hint', text: opts.hint }) : null]);
      DP.modal({
        title: opts.title || 'Value likhein',
        size: 'sm',
        body: box,
        buttons: [
          { label: 'Cancel', onClick: (m) => { m.close(); resolve(null); } },
          { label: 'OK', class: 'primary', onClick: (m) => { m.close(); resolve(input.value); } },
        ],
        onClose: () => resolve(null),
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const v = input.value;
          document.querySelector('.modal-back') && document.querySelector('.modal-back').remove();
          resolve(v);
        }
      });
    });
  };

  /* ---------------------------------------------------------------- ui bits */
  DP.ui = {
    card(title, children, actions) {
      const head = title
        ? el('div', { class: 'card-head' }, [
            typeof title === 'string' ? el('h3', { text: title }) : title,
            actions ? el('div', { class: 'row tight' }, actions) : null,
          ])
        : null;
      return el('div', { class: 'card' }, [head, children]);
    },
    kpi({ label, value, sub, tone = '', onclick }) {
      return el('div', { class: 'kpi ' + tone, onclick: onclick || undefined, style: onclick ? { cursor: 'pointer' } : null }, [
        el('div', { class: 'stripe' }),
        el('div', { class: 'lbl', text: label }),
        el('div', { class: 'val', text: value }),
        sub ? el('div', { class: 'sub', text: sub }) : null,
      ]);
    },
    pill(text, tone = '') {
      return el('span', { class: 'pill ' + tone, text });
    },
    bar(pct, tone = '') {
      const p = Math.max(0, Math.min(100, Number(pct) || 0));
      return el('div', { class: 'bar ' + tone }, [el('i', { style: { width: p + '%' } })]);
    },
    statLine(a, b) {
      return el('div', { class: 'stat-line' }, [el('span', { text: a }), el('b', { text: b })]);
    },
    field(f) {
      let input;
      if (f.type === 'select') {
        input = el('select', { class: f.class || '', onchange: f.onChange, disabled: f.disabled });
        (f.options || []).forEach((o) => {
          input.appendChild(el('option', { value: o.value, selected: String(o.value) === String(f.value), text: o.label }));
        });
      } else if (f.type === 'textarea') {
        input = el('textarea', { rows: f.rows || 2, value: f.value || '', placeholder: f.placeholder || '', oninput: f.onChange, class: f.class || '' });
      } else if (f.type === 'checkbox') {
        return el('div', { class: 'check' }, [el('input', { type: 'checkbox', checked: !!f.value, onchange: f.onChange, id: f.id }), el('label', { for: f.id, text: f.label })]);
      } else {
        input = el('input', {
          type: f.type === 'money' ? 'number' : f.type || 'text',
          step: f.type === 'money' ? '0.01' : f.step || undefined,
          value: f.value === null || f.value === undefined ? '' : f.value,
          placeholder: f.placeholder || '',
          oninput: f.onChange,
          onchange: f.onChange,
          class: f.class || '',
          min: f.min,
          autofocus: f.autofocus,
        });
      }
      input.dataset.key = f.key || '';
      if (f.autofocus) setTimeout(() => input.focus(), 50);
      return el('div', { class: 'field' }, [f.label ? el('label', { class: 'f', text: f.label }) : null, input, f.hint ? el('div', { class: 'hint', text: f.hint }) : null]);
    },
    /** generic form; money fields are entered in rupees and returned in paisa */
    form(fields, opts = {}) {
      const values = {};
      const nodes = [];
      fields.forEach((f) => {
        if (f.hidden) {
          values[f.key] = f.value;
          return;
        }
        const value = f.type === 'money' && f.value ? DP.fmt.toRs(f.value) : f.value;
        const node = DP.ui.field(Object.assign({}, f, { value }));
        const input = node.querySelector('input,select,textarea');
        if (input) values[f.key] = input;
        nodes.push(node);
      });
      const wrap = el('div', { class: 'grid ' + (opts.cols === 3 ? 'g3' : opts.cols === 1 ? '' : 'g2') }, nodes);
      wrap.getValues = () => {
        const out = {};
        for (const f of fields) {
          const input = values[f.key];
          let v;
          if (f.hidden) v = f.value;
          else if (input && input.type === 'checkbox') v = input.checked ? 1 : 0;
          else v = input ? input.value : undefined;
          if (f.type === 'money') v = DP.fmt.toPaisa(v);
          else if (f.type === 'number' || f.numeric) v = v === '' ? null : Number(v);
          if (v === '') v = null;
          out[f.key] = v;
        }
        return out;
      };
      wrap.focusFirst = () => {
        const i = wrap.querySelector('input,select,textarea');
        if (i) i.focus();
      };
      return wrap;
    },
    table({ columns, rows, totals, onRowClick, empty, footer, maxHeight }) {
      if (!rows || !rows.length) return el('div', { class: 'empty', text: empty || 'Koi record nahi mila' });
      const thead = el('thead', {}, [
        el('tr', {}, columns.map((c) => el('th', { style: c.width ? { width: c.width } : null, class: c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : '', text: c.label }))),
      ]);
      const tbody = el('tbody');
      rows.forEach((r, i) => {
        const tr = el('tr', { class: onRowClick ? 'clickable' : '', onclick: onRowClick ? () => onRowClick(r, i) : null });
        columns.forEach((c) => {
          let content;
          if (c.render) content = c.render(r, i);
          else {
            const v = r[c.key];
            if (c.type === 'money') content = DP.fmt.money(v);
            else if (c.type === 'money0') content = DP.fmt.money0(v);
            else if (c.type === 'rs') content = DP.fmt.rs(v);
            else if (c.type === 'qty') content = DP.fmt.qty(v, c.cartonKey ? r[c.cartonKey] : 1);
            else if (c.type === 'date') content = DP.fmt.date(v);
            else if (c.type === 'pct') content = DP.fmt.pct(v);
            else if (c.type === 'pill') content = DP.ui.pill(v || '—', (c.tone ? c.tone(r) : '') || '');
            else content = v === null || v === undefined || v === '' ? '—' : String(v);
          }
          tr.appendChild(el('td', { class: (c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : '') + (c.class ? ' ' + c.class : '') + (c.type === 'money' || c.type === 'money0' || c.type === 'rs' ? ' mono nowrap' : '') }, [content instanceof Node ? content : document.createTextNode(content)]));
        });
        tbody.appendChild(tr);
      });
      const tfoot = totals
        ? el('tfoot', {}, [
            el('tr', {}, columns.map((c, idx) => {
              if (idx === 0) return el('td', { text: totals.label || 'TOTAL' });
              const v = totals[c.key];
              return el('td', { class: 'right mono', text: v === undefined || v === null ? '' : (c.type === 'money' || c.type === 'money0' ? DP.fmt.money(v) : c.type === 'qty' ? v : '') });
            })),
          ])
        : null;
      return el('div', { class: 'table-wrap', style: maxHeight ? { maxHeight } : null }, [el('table', {}, [thead, tbody, tfoot, footer])]);
    },
    tabs(items, activeKey, onChange) {
      const wrap = el('div', { class: 'tabs' });
      items.forEach((it) =>
        wrap.appendChild(
          el('button', { class: 'tab ' + (it.key === activeKey ? 'active' : ''), text: it.label, onclick: () => onChange(it.key) })
        )
      );
      return wrap;
    },
    dateRange(onChange, from, to) {
      const f = el('input', { type: 'date', value: from || DP.monthStart(), class: 'sm' });
      const t = el('input', { type: 'date', value: to || DP.today(), class: 'sm' });
      const fire = () => onChange(f.value, t.value);
      f.addEventListener('change', fire);
      t.addEventListener('change', fire);
      const quick = el('select', { class: 'sm', style: { width: '130px' } }, [
        el('option', { value: '', text: 'Quick range…' }),
        el('option', { value: 'today', text: 'Aaj' }),
        el('option', { value: 'yesterday', text: 'Kal' }),
        el('option', { value: 'week', text: 'Is hafte' }),
        el('option', { value: 'month', text: 'Is mahine' }),
        el('option', { value: 'last_month', text: 'Pichhla mahina' }),
        el('option', { value: 'year', text: 'Is saal' }),
      ]);
      quick.addEventListener('change', () => {
        const v = quick.value;
        if (!v) return;
        const t0 = DP.today();
        let a = t0,
          b = t0;
        if (v === 'yesterday') a = b = DP.addDays(t0, -1);
        else if (v === 'week') {
          const dow = (new Date(t0 + 'T00:00:00').getDay() + 6) % 7;
          a = DP.addDays(t0, -dow);
        } else if (v === 'month') a = DP.monthStart();
        else if (v === 'last_month') {
          const d = new Date(t0 + 'T00:00:00');
          const m = new Date(d.getFullYear(), d.getMonth() - 1, 1);
          const ms = m.toLocaleDateString('en-CA').slice(0, 7);
          a = ms + '-01';
          b = new Date(m.getFullYear(), m.getMonth() + 1, 0).toLocaleDateString('en-CA');
        } else if (v === 'year') a = t0.slice(0, 4) + '-01-01';
        f.value = a;
        t.value = b;
        fire();
      });
      return el('div', { class: 'row tight' }, [quick, f, t]);
    },
    searchBox(placeholder, onChange, value) {
      const input = el('input', { placeholder: placeholder || 'Search…', value: value || '', class: 'sm' });
      input.addEventListener('input', DP.debounce(() => onChange(input.value), 220));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') onChange(input.value);
      });
      return input;
    },
    select(options, value, onChange, attrs = {}) {
      const s = el('select', Object.assign({ class: 'sm', onchange: onChange }, attrs));
      options.forEach((o) => s.appendChild(el('option', { value: o.value, text: o.label, selected: String(o.value) === String(value) })));
      return s;
    },
    spinner(text) {
      return el('div', { class: 'empty', text: text || 'Loading…' });
    },
  };

  DP.lookupOptions = function (name, valueKey, labelFn, extra = []) {
    const rows = (DP.state.lookups[name] || []).slice();
    const opts = extra.slice();
    rows.forEach((r) => opts.push({ value: r[valueKey || 'id'], label: labelFn ? labelFn(r) : r.name }));
    return opts;
  };

  /* ---------------------------------------------------------------- charts */
  DP.charts = {
    line(labels, series, opts = {}) {
      const w = 700,
        h = opts.height || 200,
        pad = 34;
      const all = series.flatMap((s) => s.data);
      const max = Math.max(1, ...all);
      const n = Math.max(1, labels.length - 1);
      const x = (i) => pad + (i * (w - pad - 8)) / n;
      const y = (v) => h - 24 - (Number(v || 0) / max) * (h - 24 - 12);
      let svg = `<svg viewBox="0 0 ${w} ${h}" class="chart" preserveAspectRatio="none">`;
      svg += `<line x1="${pad}" y1="${h - 24}" x2="${w - 6}" y2="${h - 24}" stroke="var(--line-2)"/>`;
      [0, 0.5, 1].forEach((f) => {
        const yy = y(max * f);
        svg += `<line x1="${pad}" y1="${yy}" x2="${w - 6}" y2="${yy}" stroke="var(--line)" stroke-dasharray="3 4"/>`;
      });
      series.forEach((s) => {
        const pts = s.data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
        if (s.fill) svg += `<polygon fill="${s.color}22" points="${pad},${h - 24} ${pts} ${x(s.data.length - 1)},${h - 24}"/>`;
        svg += `<polyline fill="none" stroke="${s.color}" stroke-width="2.4" points="${pts}"/>`;
        s.data.forEach((v, i) => (svg += `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.6" fill="${s.color}"/>`));
      });
      labels.forEach((l, i) => {
        if (labels.length > 10 && i % Math.ceil(labels.length / 8) !== 0) return;
        svg += `<text x="${x(i).toFixed(1)}" y="${h - 8}" font-size="10" fill="var(--ink-3)" text-anchor="middle">${DP.esc(String(l).slice(5))}</text>`;
      });
      svg += `<text x="4" y="14" font-size="10" fill="var(--ink-3)">${DP.fmt.money0(max)}</text>`;
      svg += '</svg>';
      return el('div', { html: svg }, []);
    },
    bars(items, opts = {}) {
      const w = 600,
        h = opts.height || 200;
      const max = Math.max(1, ...items.map((i) => Number(i.value) || 0));
      let svg = `<svg viewBox="0 0 ${w} ${h}" class="chart">`;
      const bw = (w - 20) / Math.max(1, items.length);
      items.forEach((it, i) => {
        const bh = ((Number(it.value) || 0) / max) * (h - 44);
        svg += `<rect x="${10 + i * bw + 4}" y="${h - 26 - bh}" width="${Math.max(3, bw - 8)}" height="${bh}" rx="4" fill="${it.color || 'var(--brand)'}"/>`;
        svg += `<text x="${10 + i * bw + bw / 2}" y="${h - 10}" font-size="10" fill="var(--ink-3)" text-anchor="middle">${DP.esc(String(it.label).slice(0, 10))}</text>`;
        if (bh > 16) svg += `<text x="${10 + i * bw + bw / 2}" y="${h - 30 - bh + 12}" font-size="10" fill="var(--ink-2)" text-anchor="middle">${DP.fmt.money0(it.value)}</text>`;
      });
      svg += '</svg>';
      return el('div', { html: svg });
    },
    donut(items, opts = {}) {
      const total = items.reduce((s, i) => s + (Number(i.value) || 0), 0);
      const size = 170,
        r = 62,
        cx = size / 2,
        cy = size / 2,
        thick = 20;
      let acc = 0;
      let svg = `<svg viewBox="0 0 ${size} ${size}" style="width:170px;height:170px">`;
      if (!total) svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${thick}"/>`;
      items.forEach((it) => {
        const v = Number(it.value) || 0;
        if (!total || !v) return;
        const frac = v / total;
        const a0 = acc * Math.PI * 2 - Math.PI / 2;
        acc += frac;
        const a1 = acc * Math.PI * 2 - Math.PI / 2;
        const large = frac > 0.5 ? 1 : 0;
        const x0 = cx + r * Math.cos(a0),
          y0 = cy + r * Math.sin(a0),
          x1 = cx + r * Math.cos(a1),
          y1 = cy + r * Math.sin(a1);
        svg += `<path d="M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}" fill="none" stroke="${it.color}" stroke-width="${thick}"/>`;
      });
      svg += `<text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="15" font-weight="700" fill="var(--ink)">${DP.esc(opts.center || DP.fmt.money0(total))}</text>`;
      svg += `<text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="10" fill="var(--ink-3)">${DP.esc(opts.centerSub || '')}</text>`;
      svg += '</svg>';
      const legend = el(
        'div',
        { class: 'legend', style: { flexDirection: 'column', gap: '6px' } },
        items.map((i) =>
          el('div', {}, [el('i', { style: { background: i.color } }), `${i.label}: `, el('b', { text: DP.fmt.money0(i.value) })])
        )
      );
      return el('div', { class: 'row', style: { alignItems: 'center', gap: '16px' } }, [el('div', { html: svg }), legend]);
    },
  };

  /* ---------------------------------------------------------------- printing */
  function receiptCss(width) {
    return `
    *{box-sizing:border-box}
    body{font-family:"Segoe UI",Tahoma,Arial,sans-serif;margin:0;color:#000;background:#fff}
    .sheet{width:${width};margin:0 auto;padding:8px 10px;font-size:12px}
    .center{text-align:center}.right{text-align:right}
    .shop{font-size:16px;font-weight:800;margin:0}
    .tag{font-size:11px;margin:1px 0}
    .line{border-top:1px dashed #000;margin:6px 0}
    table{width:100%;border-collapse:collapse;font-size:11.5px}
    th{text-align:left;border-bottom:1px solid #000;padding:3px 0;font-size:10.5px}
    td{padding:3px 0;vertical-align:top}
    .tot{font-weight:800;font-size:13px}
    .small{font-size:10.5px}
    .kv{display:flex;justify-content:space-between;gap:8px}
    .box{border:1px solid #000;padding:5px;border-radius:4px;margin-top:6px}
    @media print{@page{margin:4mm} .noprint{display:none}}
  `;
    }

  function openPrint(html, opts = {}) {
    const frame = document.getElementById('print-frame');
    const doc = frame.contentWindow.document;
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${DP.esc(opts.title || 'Print')}</title><style>${opts.css || ''}</style></head><body>${html}</body></html>`);
    doc.close();
    setTimeout(() => {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    }, 250);
  }

  DP.print = { open: openPrint, receiptCss };

  DP.print.invoice = function (data, opts = {}) {
    const s = data.settings || DP.state.settings || {};
    const inv = data.invoice || data;
    const paper = opts.paper || s.print_paper || '80mm';
    const width = paper === 'a4' ? '190mm' : paper === 'a5' ? '148mm' : '80mm';
    const lines = inv.lines || [];
    const rows = lines
      .map((l) => {
        const qtyText = DP.fmt.qty(l.qty, l.carton_size);
        return `<tr><td>${DP.esc(l.product_name || '')}${l.is_free ? ' <b>(FREE)</b>' : ''}<div class="small">${DP.esc(l.batch_no ? 'Batch ' + l.batch_no : '')}</div></td>
        <td class="right">${DP.esc(qtyText)}</td>
        <td class="right">${DP.fmt.money(l.unit_price_paisa)}</td>
        <td class="right">${DP.fmt.money(l.line_total_paisa)}</td></tr>`;
      })
      .join('');
    const html = `
    <div class="sheet">
      <div class="center">
        <p class="shop">${DP.esc(s.company_name || 'Distribution Pro')}</p>
        <p class="tag">${DP.esc(s.company_tagline || '')}</p>
        <p class="tag">${DP.esc(s.company_address || '')}</p>
        <p class="tag">Tel: ${DP.esc(s.company_phone || '')}${s.company_ntn ? ' • NTN: ' + DP.esc(s.company_ntn) : ''}</p>
      </div>
      <div class="line"></div>
      <div class="kv"><b>${inv.sale_type === 'CASH' ? 'CASH MEMO' : 'CREDIT BILL'}</b><span>${DP.esc(inv.invoice_no)}</span></div>
      <div class="kv small"><span>Date: ${DP.fmt.date(inv.date)}</span><span>${inv.due_date ? 'Due: ' + DP.fmt.date(inv.due_date) : ''}</span></div>
      <div class="line"></div>
      <div class="small">
        <div><b>Customer:</b> ${DP.esc(inv.customer_name || '')}</div>
        ${inv.customer_phone ? `<div>Phone: ${DP.esc(inv.customer_phone)}</div>` : ''}
        ${inv.customer_address ? `<div>${DP.esc(inv.customer_address)}</div>` : ''}
        ${inv.salesman_name ? `<div>Salesman: ${DP.esc(inv.salesman_name)}</div>` : ''}
      </div>
      <div class="line"></div>
      <table><thead><tr><th>Item</th><th class="right">Qty</th><th class="right">Rate</th><th class="right">Amount</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="line"></div>
      <div class="kv"><span>Sub Total</span><span>${DP.fmt.money(inv.subtotal_paisa)}</span></div>
      ${Number(inv.discount_paisa) ? `<div class="kv"><span>Discount</span><span>-${DP.fmt.money(inv.discount_paisa)}</span></div>` : ''}
      ${Number(inv.scheme_discount_paisa) ? `<div class="kv"><span>Scheme (free goods)</span><span>${DP.fmt.money(inv.scheme_discount_paisa)}</span></div>` : ''}
      ${Number(inv.tax_paisa) ? `<div class="kv"><span>Tax</span><span>${DP.fmt.money(inv.tax_paisa)}</span></div>` : ''}
      <div class="kv tot"><span>Total</span><span>Rs ${DP.fmt.money(inv.total_paisa)}</span></div>
      <div class="kv"><span>Paid</span><span>${DP.fmt.money(inv.paid_paisa)}</span></div>
      <div class="kv"><b>Balance (Udhaar)</b><b>Rs ${DP.fmt.money(Number(inv.total_paisa) - Number(inv.paid_paisa))}</b></div>
      ${inv.customer_balance !== undefined ? `<div class="kv small"><span>Total khata balance</span><span>Rs ${DP.fmt.money(inv.customer_balance)}</span></div>` : ''}
      <div class="box small">${DP.esc(s.invoice_footer || '')}</div>
      <div class="center small" style="margin-top:6px">Print: ${new Date().toLocaleString('en-GB')} • Distribution Pro</div>
    </div>`;
    openPrint(html, { title: inv.invoice_no, css: receiptCss(width) });
  };

  DP.print.slip = function (title, lines, opts = {}) {
    const s = opts.settings || DP.state.settings || {};
    const width = (opts.paper || s.print_paper || '80mm') === 'a4' ? '190mm' : '80mm';
    const html = `
    <div class="sheet">
      <div class="center"><p class="shop">${DP.esc(s.company_name || 'Distribution Pro')}</p><p class="tag">${DP.esc(title)}</p></div>
      <div class="line"></div>
      ${lines.map((l) => `<div class="kv"><span>${DP.esc(l[0])}</span><b>${DP.esc(l[1])}</b></div>`).join('')}
      ${opts.table || ''}
      <div class="line"></div>
      <div class="center small">${new Date().toLocaleString('en-GB')}</div>
    </div>`;
    openPrint(html, { title, css: receiptCss(width) });
  };

  DP.print.report = function (report, opts = {}) {
    const s = DP.state.settings || {};
    const head = report.columns.map((c) => `<th class="${c.type === 'money' || c.type === 'qty' ? 'right' : ''}">${DP.esc(c.label)}</th>`).join('');
    const body = report.rows
      .map(
        (r) =>
          '<tr>' +
          report.columns
            .map((c) => {
              let v = r[c.key];
              if (c.type === 'money') v = DP.fmt.money(v);
              else if (c.type === 'qty') v = v === null || v === undefined ? '' : v;
              else if (c.type === 'date') v = DP.fmt.date(v);
              return `<td class="${c.type === 'money' || c.type === 'qty' ? 'right' : ''}">${DP.esc(v === null || v === undefined ? '' : v)}</td>`;
            })
            .join('') +
          '</tr>'
      )
      .join('');
    const html = `
    <div class="sheet">
      <div class="center"><p class="shop">${DP.esc(s.company_name || '')}</p><p class="tag">${DP.esc(report.name)}</p>
      <p class="tag small">${opts.range ? DP.esc(opts.range) : ''} • Print ${new Date().toLocaleString('en-GB')}</p></div>
      <div class="line"></div>
      <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
      ${report.totals && Object.keys(report.totals).length ? `<div class="line"></div><div class="small">${report.columns.filter((c) => report.totals[c.key] !== undefined).map((c) => `<div class="kv"><span>Total ${DP.esc(c.label)}</span><b>${c.type === 'money' ? 'Rs ' + DP.fmt.money(report.totals[c.key]) : report.totals[c.key]}</b></div>`).join('')}</div>` : ''}
    </div>`;
    openPrint(html, { title: report.name, css: receiptCss('190mm') });
  };

  /* ---------------------------------------------------------------- share */
  DP.whatsapp = function (phone, text) {
    let d = String(phone || '').replace(/[^0-9+]/g, '').replace(/\+/g, '');
    if (!d) {
      DP.toast('Customer ka phone number mojood nahi', 'warn');
      return;
    }
    if (d.startsWith('0')) d = '92' + d.slice(1);
    window.open('https://wa.me/' + d + '?text=' + encodeURIComponent(text), '_blank');
  };

  /* ---------------------------------------------------------------- csv */
  DP.downloadCsv = function (filename, columns, rows) {
    const esc = (v) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
    const csv = '\uFEFF' + columns.map((c) => esc(c.label)).join(',') + '\r\n' + rows.map((r) => columns.map((c) => esc(c.type === 'money' ? DP.fmt.money(r[c.key]) : r[c.key])).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
  };

  /* ---------------------------------------------------------------- page registry */
  DP.definePage = function (page) {
    DP.pages.push(page);
    DP.pageMap[page.key] = page;
  };
  DP.can = function (perm) {
    const u = DP.state.user;
    if (!u) return false;
    if (u.role === 'ADMIN') return true;
    return (u.permissions || []).includes(perm);
  };
  DP.ready = []; // page modules push async loaders here
})();
