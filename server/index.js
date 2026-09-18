'use strict';
/**
 * Distribution Pro - server entry point
 */

const http = require('http');
const os = require('os');
const path = require('path');
const { install } = require('./install');
const { handle } = require('./routes');
const { db, dbPath } = require('./db');
const { getSettingsMap, setSetting } = require('./settings');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

function lanIps() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const n of list || []) if (n.family === 'IPv4' && !n.internal) out.push(n.address);
  }
  return out;
}

function banner(port) {
  const settings = getSettingsMap(true);
  const line = '='.repeat(66);
  console.log('');
  console.log('  ' + line);
  console.log('   DISTRIBUTION PRO  v' + require('../package.json').version + '   —   Wholesale & FMCG Distribution ERP');
  console.log('  ' + line);
  console.log('   Company : ' + (settings.company_name || 'Distribution Pro'));
  console.log('   Engine  : ' + db().engine() + '   |   Node ' + process.version);
  console.log('   Database: ' + dbPath());
  console.log('');
  console.log('   Is computer par kholein :  http://localhost:' + port);
  lanIps().forEach((ip) => console.log('   Mobile / LAN par kholein:  http://' + ip + ':' + port));
  console.log('');
  console.log('   Login users (pehli dafa ke liye):');
  console.log('     admin    / admin123      -> Malik / Owner (poori ijazat)');
  console.log('     manager  / manager123    -> Manager (limit override, void)');
  console.log('     counter  / counter123    -> Billing operator (POS)');
  console.log('     godown   / godown123     -> Godown keeper (purchase, stock)');
  console.log('     accounts / accounts123   -> Accountant (recovery, reports)');
  console.log('     salesman / salesman123   -> Salesman (orders, recovery, visits)');
  console.log('');
  console.log('   Band karne ke liye: Ctrl + C');
  console.log('  ' + line);
  console.log('');
}

function start(port, attempt = 0) {
  const server = http.createServer((req, res) => {
    const started = Date.now();
    res.on('finish', () => {
      if (res.statusCode >= 400 && !String(req.url).startsWith('/api/reports')) {
        console.log(`  [${res.statusCode}] ${req.method} ${req.url} (${Date.now() - started} ms)`);
      }
    });
    handle(req, res).catch((err) => {
      console.error('  [ERROR]', req.method, req.url, err);
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message || 'Server error' }));
      } catch (e) {
        /* ignore */
      }
    });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempt < 10) {
      console.log(`  Port ${port} busy hai — ${port + 1} try kar rahe hain...`);
      start(port + 1, attempt + 1);
      return;
    }
    console.error('  Server start nahi ho saka:', err.message);
    process.exit(1);
  });

  server.listen(port, HOST, () => {
    banner(port);
    setSetting('last_started_at', new Date().toISOString());
  });

  const shutdown = () => {
    console.log('\n  Server band ho raha hai... data safe hai.');
    try {
      db().checkpoint();
      db().close();
    } catch (e) {
      /* ignore */
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function main() {
  console.log('  Starting Distribution Pro ...');
  try {
    install();
    const fresh = U_empty();
    if (fresh && String(getSettingsMap(true).demo_data || '1') === '1' && String(process.env.NO_DEMO || '') !== '1') {
      console.log('  Pehli dafa: demo (sample) data bana rahe hain...');
      const { seedDemo } = require('./demo');
      const out = seedDemo({});
      console.log('  Demo data tayyar:', JSON.stringify(out));
    }
  } catch (e) {
    console.error('  Install/migration me masla:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
  start(PORT);
}

function U_empty() {
  return db().val('SELECT COUNT(*) FROM products') === 0;
}

main();
