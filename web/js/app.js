/* ============================================================
   Distribution Pro - app shell: login, router, nav, topbar
   ============================================================ */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const LOGIN_USERS = [
    { username: 'admin', password: 'admin123', label: 'Admin / Malik', desc: 'Sab kuch' },
    { username: 'manager', password: 'manager123', label: 'Manager', desc: 'Limit override, void, reports' },
    { username: 'counter', password: 'counter123', label: 'Counter Billing', desc: 'POS, recovery' },
    { username: 'godown', password: 'godown123', label: 'Godown Keeper', desc: 'Purchase, stock, STN' },
    { username: 'accounts', password: 'accounts123', label: 'Accountant', desc: 'Recovery, kharcha, reports' },
    { username: 'salesman', password: 'salesman123', label: 'Salesman', desc: 'Order, recovery, visit' },
  ];
  const SECTION_ORDER = ['Main', 'Sales', 'Inventory', 'Money', 'People', 'Trade', 'Reports', 'Admin'];
  const NAV_MORE = [
    { key: 'products', title: 'Items / Products', icon: '🏷️', section: 'Inventory', perm: 'products.view' },
    { key: 'reports', title: 'Reports (32)', icon: '📈', section: 'Reports', perm: 'reports.view' },
    { key: 'masters', title: 'Masters', icon: '🗂️', section: 'Admin', perm: 'masters.view' },
    { key: 'users', title: 'Users & Roles', icon: '👥', section: 'Admin', perm: 'users.manage' },
    { key: 'settings', title: 'Settings & Backup', icon: '⚙️', section: 'Admin', perm: 'settings.manage' },
    { key: 'audit', title: 'Audit Log', icon: '🕵️', section: 'Admin', perm: 'audit.view' },
  ];

  /* ------------------------------------------------------------------ router */
  let current = { key: null, params: {} };
  let rendering = false;

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    if (!raw) return { key: 'dashboard', params: {} };
    const [key, qs] = raw.split('?');
    const params = {};
    new URLSearchParams(qs || '').forEach((v, k) => (params[k] = v));
    return { key: key || 'dashboard', params };
  }

  DP.go = function (key, params) {
    if (key === 'sales') key = 'invoices'; // purana alias
    const qs = Object.entries(params || {})
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    const hash = `#/${key}` + (qs ? '?' + qs : '');
    if (location.hash === hash) renderPage();
    else location.hash = hash;
  };

  DP.rerender = function () {
    renderPage();
  };

  function pageFor(key) {
    return DP.pageMap[key] || DP.pages.find((p) => p.key === key) || null;
  }

  async function renderPage() {
    if (!DP.state.user || rendering) return;
    const { key, params } = parseHash();
    let page = pageFor(key);
    if (!page) {
      page = pageFor('dashboard');
      DP.toast('Page nahi mila: ' + key, 'warn');
    }
    if (page.perm && !DP.can(page.perm)) {
      $('view').innerHTML = '';
      $('view').appendChild(
        DP.el('div', { class: 'empty', html: '🚫 <b>Ijazat nahi hai</b><br>Aap ke role (' + DP.esc(DP.state.user.role_label || DP.state.user.role) + ') ko is page ki ijazat nahi.' })
      );
      setTitle(page, true);
      return;
    }
    if (typeof DP.cleanup === 'function') {
      try { DP.cleanup(); } catch (e) { /* ignore */ }
    }
    DP.cleanup = null;
    rendering = true;
    current = { key: page.key, params };
    DP.state.route = page.key;
    DP.state.params = params;
    setTitle(page);
    const view = $('view');
    const scroll = view.scrollTop;
    DP.clear(view).appendChild(DP.ui.spinner('Load ho raha hai…'));
    markActive(page);
    try {
      // pages apne root me append karte hain — is liye spinner ko hata kar
      // ek saaf wrapper dein (warna "Load ho raha hai…" upar chipka reh jata hai)
      const holder = DP.el('div', { class: 'view-holder' }, []);
      DP.clear(view).appendChild(holder);
      await page.render(holder, params);
    } catch (e) {
      console.error(e);
      DP.clear(view).appendChild(
        DP.el('div', { class: 'empty' }, [
          DP.el('div', { html: '⚠️ <b>Page load nahi hua:</b> ' + DP.esc(e.message || String(e)) }),
          e.code === 'CREDIT_LIMIT' ? DP.el('div', { class: 'small muted', text: 'Credit limit ka masla hai — POS me manager PIN se override karein.' }) : null,
          DP.el('button', { class: 'btn sm', text: '🔄 Dobara koshish', onclick: () => renderPage(), style: { marginTop: '8px' } }),
        ])
      );
    } finally {
      rendering = false;
      view.scrollTop = scroll;
      location.href.indexOf('#') === 0 && window.scrollTo(0, 0);
    }
  }

  function setTitle(page, denied) {
    $('page-title').textContent = (page && page.title) || 'Distribution Pro';
    $('page-sub').textContent = denied ? 'Ijazat nahi' : (page && page.sub) || '';
    document.title = ((page && page.title) || 'Distribution Pro') + ' — Distribution Pro';
  }

  function markActive(page) {
    document.querySelectorAll('#nav .nav-item').forEach((n) => n.classList.toggle('active', n.dataset.key === page.key));
    if (window.innerWidth <= 900) $('sidebar').classList.remove('open');
  }

  window.addEventListener('hashchange', renderPage);

  /* ------------------------------------------------------------------ nav */
  function buildNav() {
    const nav = $('nav');
    DP.clear(nav);
    const extra = NAV_MORE.filter((e) => (!e.perm || DP.can(e.perm)) && !pageFor(e.key)).map((e) => ({ key: e.key, title: e.title, icon: e.icon, section: e.section, perm: e.perm, render: null, virtual: true }));
    const all = DP.pages.concat(extra).filter((p) => !p.perm || DP.can(p.perm));
    const sections = SECTION_ORDER.filter((s) => all.some((p) => (p.section || 'Main') === s)).concat(
      Array.from(new Set(all.map((p) => p.section || 'Main'))).filter((s) => !SECTION_ORDER.includes(s))
    );
    sections.forEach((sec) => {
      const items = all.filter((p) => (p.section || 'Main') === sec);
      if (!items.length) return;
      nav.appendChild(DP.el('div', { class: 'nav-section' }, [DP.el('span', { text: sec })]));
      items.forEach((p) => {
        nav.appendChild(
          DP.el('button', { class: 'nav-item', 'data-key': p.key, 'data-title': (p.title + ' ' + (p.sub || '') + ' ' + sec).toLowerCase(), onclick: () => DP.go(p.key) }, [
            DP.el('span', { class: 'ic', text: p.icon || '•' }),
            DP.el('span', { class: 'tx', text: p.title }),
          ])
        );
      });
    });
    DP.navIndex = Array.from(nav.querySelectorAll('.nav-item'));
  }

  function filterNav(q) {
    const term = String(q || '').trim().toLowerCase();
    document.querySelectorAll('#nav .nav-item').forEach((n) => {
      const hit = !term || n.dataset.title.includes(term);
      n.classList.toggle('hidden', !hit);
    });
    document.querySelectorAll('#nav .nav-section').forEach((s) => {
      let n = s.nextElementSibling;
      let any = false;
      while (n && n.classList.contains('nav-item')) {
        if (!n.classList.contains('hidden')) any = true;
        n = n.nextElementSibling;
      }
      s.classList.toggle('hidden', !any);
    });
  }

  /* ------------------------------------------------------------------ bootstrap */
  async function safeGet(path, fallback) {
    try {
      return await DP.get(path);
    } catch (e) {
      return fallback === undefined ? null : fallback;
    }
  }

  async function boot() {
    const me = await DP.get('/auth/me');
    DP.state.user = me.user;
    DP.state.settings = (await safeGet('/settings', {})) || {};
    const [warehouses, tiers, salesmen, routes, companies, categories, heads, suppliers] = await Promise.all([
      safeGet('/lookup/warehouses', []),
      safeGet('/lookup/tiers', []),
      safeGet('/lookup/salesmen', []),
      safeGet('/lookup/routes', []),
      safeGet('/lookup/companies', []),
      safeGet('/lookup/categories', []),
      safeGet('/lookup/heads', []),
      safeGet('/crud/suppliers?limit=1000', []),
    ]);
    DP.state.lookups = { warehouses: warehouses || [], tiers: tiers || [], salesmen: salesmen || [], routes: routes || [], companies: companies || [], categories: categories || [], heads: heads || [], suppliers: suppliers || [] };
    DP.state.paper = DP.state.settings.print_paper || '80mm';
    const saved = Number(localStorage.getItem('dp_warehouse') || 0);
    DP.state.warehouseId = saved || Number(DP.state.settings.default_warehouse_id) || (DP.state.lookups.warehouses[0] && DP.state.lookups.warehouses[0].id) || null;

    $('brand-name').textContent = DP.state.settings.company_name || 'Distribution Pro';
    $('user-name').textContent = DP.state.user.full_name || DP.state.user.username;
    $('user-role').textContent = DP.state.user.role_label || DP.state.user.role;
    $('user-avatar').textContent = (DP.state.user.full_name || DP.state.user.username || 'A').trim().charAt(0).toUpperCase();
    $('app-version').textContent = 'v' + ((serverInfo && serverInfo.version) || '1.0.0');

    fillWarehousePicker();
    buildNav();

    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');

    refreshAlerts();
    if (!location.hash || location.hash === '#/') location.hash = '#/dashboard';
    renderPage();
  }

  let serverInfo = null;

  function fillWarehousePicker() {
    const sel = $('warehouse-picker');
    DP.clear(sel);
    (DP.state.lookups.warehouses || []).forEach((w) =>
      sel.appendChild(DP.el('option', { value: w.id, text: w.name + (w.type && w.type !== 'MAIN' ? ' (' + w.type + ')' : ''), selected: Number(w.id) === Number(DP.state.warehouseId) }))
    );
    sel.onchange = () => {
      DP.state.warehouseId = Number(sel.value);
      localStorage.setItem('dp_warehouse', String(sel.value));
      DP.toast('Godown badal gaya: ' + sel.options[sel.selectedIndex].text, '');
      if (['stock', 'batches', 'pos'].includes(current.key)) renderPage();
    };
  }

  async function refreshAlerts() {
    const out = await safeGet('/alerts', { items: [] });
    DP.state.alerts = (out && out.items) || [];
    const badge = $('alert-count');
    const bar = $('alert-bar');
    const danger = DP.state.alerts.filter((a) => a.level === 'danger');
    const warn = DP.state.alerts.filter((a) => a.level === 'warn');
    badge.textContent = DP.state.alerts.length;
    badge.classList.toggle('hidden', !DP.state.alerts.length);
    badge.className = 'badge-dot' + (danger.length ? ' bad' : warn.length ? ' warn' : '');
    DP.clear(bar);
    const show = DP.state.alerts.slice(0, 6);
    if (!show.length) {
      bar.classList.add('hidden');
      return;
    }
    bar.classList.remove('hidden');
    show.forEach((a) => bar.appendChild(DP.el('span', { class: 'alert-chip ' + (a.level || ''), title: a.detail || '', onclick: () => alertGo(a) }, [DP.el('b', { text: alertIcon(a.type) + ' ' }), a.title])));
    if (DP.state.alerts.length > 6) bar.appendChild(DP.el('span', { class: 'alert-chip', text: '+' + (DP.state.alerts.length - 6) + ' more', onclick: () => showAlertsModal() }));
  }

  function alertIcon(t) {
    return { LOW_STOCK: '📦', EXPIRY: '⏳', OVERDUE: '💰', CHEQUE: '🏦', CLAIM: '🎁', VAN: '🚚' }[t] || '🔔';
  }
  function alertGo(a) {
    const map = { LOW_STOCK: 'stock', EXPIRY: 'batches', OVERDUE: 'customers', CHEQUE: 'cheques', CLAIM: 'schemes', VAN: 'van' };
    DP.go(map[a.type] || 'dashboard', a.type === 'OVERDUE' ? { tab: 'due' } : {});
  }

  function showAlertsModal() {
    DP.modal({
      title: '🔔 Alerts & Yaad-dehani',
      size: 'lg',
      body: DP.el('div', { class: 'col' }, DP.state.alerts.map((a) =>
        DP.el('div', { class: 'alert-row ' + (a.level || '') }, [DP.el('b', { text: alertIcon(a.type) + ' ' + a.title }), DP.el('div', { class: 'small muted', text: a.detail || '' })])
      )),
      buttons: [{ label: 'Band', class: 'primary' }],
    });
  }

  /* ------------------------------------------------------------------ login */
  function fillUserChips() {
    const grid = $('login-user-grid');
    DP.clear(grid);
    LOGIN_USERS.forEach((u) =>
      grid.appendChild(
        DP.el('button', { type: 'button', class: 'login-user', onclick: () => { $('login-user').value = u.username; $('login-pass').value = u.password; doLogin(); } }, [
          DP.el('b', { text: u.label }),
          DP.el('span', { text: u.username + ' / ' + u.password }),
          DP.el('i', { text: u.desc }),
        ])
      )
    );
  }

  async function doLogin() {
    const btn = $('login-btn');
    const err = $('login-error');
    err.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Login ho raha hai…';
    try {
      const out = await DP.post('/auth/login', { username: $('login-user').value.trim(), password: $('login-pass').value });
      DP.setToken(out.token);
      DP.state.user = out.user;
      await boot();
      DP.toast('Khush aamdeed, ' + (out.user.full_name || out.user.username) + '!', 'ok');
    } catch (e) {
      err.textContent = e.message || 'Login nahi hua';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Login karein';
    }
  }

  async function autoLogin() {
    if (!DP.token) return false;
    try {
      await DP.get('/auth/me');
      await boot();
      return true;
    } catch (e) {
      DP.setToken('');
      return false;
    }
  }

  function logout() {
    DP.post('/auth/logout', {}).catch(() => null);
    DP.setToken('');
    DP.state.user = null;
    location.hash = '';
    document.getElementById('app').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
    $('login-pass').value = '';
  }

  /* ------------------------------------------------------------------ modals from topbar */
  function profileModal() {
    const u = DP.state.user;
    const form = DP.ui.form([
      { key: 'full_name', label: 'Poora naam', type: 'text', value: u.full_name || '' },
      { key: 'phone', label: 'Phone', type: 'text', value: u.phone || '' },
      { key: 'old_password', label: 'Purana password', type: 'password' },
      { key: 'new_password', label: 'Naya password (4+)', type: 'password' },
    ], { cols: 2 });
    DP.modal({
      title: 'Mera profile — ' + u.username + ' (' + (u.role_label || u.role) + ')',
      body: DP.el('div', { class: 'col' }, [
        form,
        DP.el('div', { class: 'small muted', text: 'Ijazat: ' + (u.permissions || []).join(', ') }),
      ]),
      buttons: [
        { label: 'Cancel', onClick: (m) => m.close() },
        {
          label: 'Save',
          class: 'primary',
          onClick: async (m) => {
            const v = form.getValues();
            try {
              if (v.new_password) await DP.post('/auth/change-password', { old_password: v.old_password, new_password: v.new_password });
              if (v.full_name) await DP.put('/users/' + u.id, { full_name: v.full_name, phone: v.phone });
              DP.toast('Update ho gaya', 'ok');
              m.close();
              const me = await DP.get('/auth/me');
              DP.state.user = me.user;
            } catch (e) {
              DP.toast(e.message, 'bad');
            }
          },
        },
      ],
    });
  }

  function shortcutsModal() {
    const rows = [
      ['F1', 'Ye shortcuts list'],
      ['F2', 'Naya bill (POS) — kisi bhi page se'],
      ['F3', 'POS: customer chunein'],
      ['F4', 'POS: barcode / search box par jayein'],
      ['F9', 'POS: bill save karein'],
      ['Esc', 'Modal band karein / POS khali karein'],
      ['Ctrl + K', 'Menu me search'],
    ];
    DP.modal({
      title: '⌨️ Keyboard shortcuts',
      size: 'sm',
      body: DP.el('div', { class: 'col' }, rows.map((r) => DP.ui.statLine(r[0], r[1]))),
      buttons: [{ label: 'Band', class: 'primary' }],
    });
  }

  function recalc() {
    DP.confirm('Sab customers / suppliers ke balance dobara GL se calculate karein?', { okLabel: 'Haan, recalculate' }).then(async (ok) => {
      if (!ok) return;
      try {
        const out = await DP.post('/maintenance/recalc', {});
        DP.toast('Recalculate ho gaya — GL ' + (out.gl && out.gl.balanced ? 'balanced ✔' : 'me farq hai!'), out.gl && out.gl.balanced ? 'ok' : 'warn');
      } catch (e) {
        DP.toast(e.message, 'bad');
      }
    });
  }

  /* ------------------------------------------------------------------ global keys */
  document.addEventListener('keydown', (e) => {
    const typing = /input|select|textarea/i.test((document.activeElement && document.activeElement.tagName) || '');
    if (e.key === 'F1') {
      e.preventDefault();
      if (DP.state.user) shortcutsModal();
    } else if (e.key === 'F2') {
      if (DP.state.user && DP.can('invoices.create')) {
        e.preventDefault();
        DP.go('pos');
      }
    } else if (e.key === 'k' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      $('menu-search').focus();
    } else if (e.key === 'Escape' && !typing) {
      document.querySelectorAll('.modal-back').forEach((m) => m.remove());
    }
  });

  /* ------------------------------------------------------------------ wire shell */
  function wire() {
    $('login-form').addEventListener('submit', (e) => {
      e.preventDefault();
      doLogin();
    });
    $('menu-search').addEventListener('input', (e) => filterNav(e.target.value));
    $('menu-search').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const first = DP.navIndex && DP.navIndex.find((n) => !n.classList.contains('hidden'));
        if (first) {
          DP.go(first.dataset.key);
          $('menu-search').value = '';
          filterNav('');
        }
      }
    });
    $('btn-quick-sale').onclick = () => DP.go('pos');
    $('btn-alerts').onclick = showAlertsModal;
    $('btn-theme').onclick = () => {
      const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', cur);
      localStorage.setItem('dp_theme', cur);
    };
    $('open-nav').onclick = () => $('sidebar').classList.toggle('open');
    $('close-nav').onclick = () => $('sidebar').classList.remove('open');
    $('user-chip').onclick = (e) => {
      e.stopPropagation();
      $('user-menu').classList.toggle('hidden');
    };
    document.addEventListener('click', () => $('user-menu').classList.add('hidden'));
    $('menu-profile').onclick = () => profileModal();
    $('menu-shortcuts').onclick = () => shortcutsModal();
    $('menu-recalc').onclick = () => recalc();
    $('menu-logout').onclick = () => logout();
  }

  /* ------------------------------------------------------------------ start */
  async function start() {
    const theme = localStorage.getItem('dp_theme');
    if (theme) document.documentElement.setAttribute('data-theme', theme);
    fillUserChips();
    wire();
    serverInfo = await fetch('/api/server/info').then((r) => r.json()).catch(() => null);
    if (serverInfo) {
      $('server-info').textContent = `v${serverInfo.version} • ${serverInfo.engine} • ${serverInfo.node} • DB: ${serverInfo.db_file}` + (serverInfo.lan_ips && serverInfo.lan_ips.length ? ' • LAN: http://' + serverInfo.lan_ips[0] + ':' + serverInfo.port : '');
      $('app-version').textContent = 'v' + serverInfo.version;
    } else {
      $('server-info').textContent = 'Server se rabta nahi — server chal raha hai?';
    }
    const ok = await autoLogin();
    if (!ok) {
      document.getElementById('login-screen').classList.remove('hidden');
      setTimeout(() => $('login-user').focus(), 200);
    }
    // alerts refresh every 5 minutes (agar login ho)
    setInterval(() => {
      if (DP.state.user) refreshAlerts();
    }, 300000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
