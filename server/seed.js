'use strict';
/**
 * Distribution Pro - seeder CLI
 *   node server/seed.js               -> install + demo data (agar khali ho)
 *   node server/seed.js --reset       -> database delete karke dobara demo data
 *   node server/seed.js --empty       -> database delete karke bilkul khali (asli business ke liye)
 *   node server/seed.js --demo        -> maujooda data hata kar sirf demo data
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const reset = args.includes('--reset') || args.includes('--empty');
const empty = args.includes('--empty');
const demoOnly = args.includes('--demo');

const { dbPath } = require('./db');

if (reset) {
  for (const suffix of ['', '-wal', '-shm']) {
    const f = dbPath() + suffix;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  console.log('  Purana database delete kar diya:', dbPath());
}

const { install } = require('./install');
const info = install();
console.log('  Migrations applied:', info.applied, '| engine:', info.backend);
console.log('  Database:', info.file);

if (empty) {
  console.log('  Khali database tayyar hai — ab apna asli data daalein (Settings me company info bhi set karein).');
  process.exit(0);
}

const { seedDemo } = require('./demo');
const out = seedDemo({ force: demoOnly });
console.log('  Seed result:', JSON.stringify(out, null, 2));
console.log('  GL check:', JSON.stringify(require('./services').glCheck()));
console.log('  Tayyar! Ab chalao:  npm start   (ya START.bat double click karein)');
