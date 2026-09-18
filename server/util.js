'use strict';
/**
 * Distribution Pro - chhote helpers (paisa, tarikh, token, CSV, PIN)
 * Paisa = INTEGER (1 rupee = 100 paisa). Float money kabhi use nahi hota.
 */
const crypto = require('node:crypto');

/* ------------------------------------------------------------------ money */
function toPaisa(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.\-]/g, ''));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}
function fromPaisa(p) {
  return Math.round(Number(p) || 0) / 100;
}
function fmtPaisa(p) {
  const neg = Number(p) < 0;
  const v = Math.abs(Math.round(Number(p) || 0));
  const s = (v / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + s;
}
/* Rupee value jisme paisa sirf .00 par chhupa ho jaye */
function fmtMoney(p, forceDecimals) {
  const neg = Number(p) < 0;
  const v = Math.abs(Math.round(Number(p) || 0));
  const body = forceDecimals || v % 100 ? (v / 100).toFixed(2) : String(Math.round(v / 100));
  const s = body.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + s;
}

/* ------------------------------------------------------------------ numbers */
function int(v, def) {
  if (v === null || v === undefined || v === '') return def === undefined ? 0 : def;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def === undefined ? 0 : def;
}
function num(v, def) {
  if (v === null || v === undefined || v === '') return def === undefined ? 0 : def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def === undefined ? 0 : def;
}
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
function pad(n, len) {
  return String(n).padStart(len, '0');
}
function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

/* ------------------------------------------------------------------ dates */
function dstr(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return null;
  return (
    dt.getFullYear() + '-' + pad(dt.getMonth() + 1, 2) + '-' + pad(dt.getDate(), 2)
  );
}
function today() {
  return dstr(new Date());
}
function nowIso() {
  const d = new Date();
  return (
    dstr(d) + ' ' + pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2) + ':' + pad(d.getSeconds(), 2)
  );
}
function addDays(dateStr, n) {
  const d = new Date((dateStr || today()) + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return dstr(d);
}
function daysBetween(from, to) {
  const a = new Date(from + 'T00:00:00').getTime();
  const b = new Date((to || today()) + 'T00:00:00').getTime();
  return Math.round((b - a) / 86400000);
}
function monthStart(dateStr) {
  const s = dateStr || today();
  return s.slice(0, 7) + '-01';
}
function monthOf(dateStr) {
  return (dateStr || today()).slice(0, 7);
}
function isDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
}
function dateOr(s, fallback) {
  return isDate(s) ? s : fallback || today();
}

/** 'YYYY-MM-DD' ya ISO string se Date object (comparison ke liye) */
function parseDate(s) {
  if (s instanceof Date) return s;
  const str = str0(s);
  if (!str) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(str) ? str + 'T00:00:00' : str.replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
}
function str0(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}
/** dateAdd() ka alias - dono naam chalte hain */
function dateAdd(dateStr, n) {
  return addDays(dateStr, n);
}
/** us mahine ka aakhri din: '2026-02' | '2026-02-14' -> '2026-02-28' */
function monthEnd(dateStr) {
  const s = str0(dateStr) || today();
  const y = int(s.slice(0, 4), new Date().getFullYear());
  const m = int(s.slice(5, 7), new Date().getMonth() + 1);
  return dstr(new Date(y, m, 0));
}
/** percentage (0 agar base 0 ho) - e.g. pct(achieved, target) */
function pct(part, whole, decimals) {
  const w = Number(whole) || 0;
  if (!w) return 0;
  const f = Math.pow(10, decimals === undefined ? 2 : decimals);
  return Math.round(((Number(part) || 0) / w) * 100 * f) / f;
}
/** random hex token (sessions etc.) */
function token(bytes) {
  return randomToken(bytes);
}

/* ------------------------------------------------------------------ strings */
function str(v, def) {
  if (v === null || v === undefined) return def === undefined ? '' : def;
  return String(v).trim();
}
function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function slug(s) {
  return str(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
/* Barcode scanners kabhi Urdu/Arabic digits bhejte hain */
function normalizeDigits(s) {
  const urdu = '۰۱۲۳۴۵۶۷۸۹';
  const arabic = '٠١٢٣٤٥٦٧٨٩';
  let out = '';
  for (const ch of String(s || '')) {
    const i = urdu.indexOf(ch);
    const j = arabic.indexOf(ch);
    out += i >= 0 ? String(i) : j >= 0 ? String(j) : ch;
  }
  return out;
}

/* ------------------------------------------------------------------ tokens & pin */
function randomToken(bytes) {
  return crypto.randomBytes(bytes || 24).toString('hex');
}
function hashPassword(password, salt, iterations) {
  const it = iterations || 100000;
  const s = salt || crypto.randomBytes(16).toString('hex');
  const h = crypto.pbkdf2Sync(String(password), s, it, 32, 'sha256').toString('hex');
  return `pbkdf2$${it}$${s}$${h}`;
}
function verifyPassword(password, stored) {
  try {
    const [scheme, it, salt, hash] = String(stored).split('$');
    if (scheme !== 'pbkdf2') return false;
    const h = crypto.pbkdf2Sync(String(password), salt, int(it, 100000), 32, 'sha256').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(hash, 'hex'));
  } catch (e) {
    return false;
  }
}
function hashPin(pin) {
  return hashPassword(String(pin), 'dp-manager-pin', 50000);
}
function verifyPin(pin, stored) {
  if (!stored) return String(pin) === '1234';
  return verifyPassword(String(pin), stored);
}

/* ------------------------------------------------------------------ csv */
function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(rows, columns) {
  const cols = (columns || []).map((c) =>
    typeof c === 'string' ? { key: c, label: c } : { label: c.label || c.title || c.key, key: c.key, raw: c.raw }
  );
  const head = cols.map((c) => csvCell(c.label)).join(',');
  const body = (rows || [])
    .map((r) => cols.map((c) => csvCell(typeof c.raw === 'function' ? c.raw(r) : r[c.key])).join(','))
    .join('\n');
  return head + '\n' + body + '\n';
}

/* ------------------------------------------------------------------ misc */
function isTrue(v) {
  return v === true || v === 1 || v === '1' || v === 'true' || v === 'yes' || v === 'on';
}
function uniq(arr) {
  return Array.from(new Set(arr));
}
function sum(arr, fn) {
  return (arr || []).reduce((s, x) => s + Number(fn ? fn(x) : x || 0), 0);
}
function groupBy(arr, fn) {
  const m = new Map();
  for (const x of arr || []) {
    const k = fn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}
/** Mobile number ko WhatsApp format (92300xxxxxxx) me badalta hai */
function waNumber(phone) {
  let digits = normalizeDigits(phone).replace(/[^0-9]/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = '92' + digits.slice(1);
  else if (!digits.startsWith('92') && digits.length === 10) digits = '92' + digits;
  return digits;
}
function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

module.exports = {
  toPaisa,
  fromPaisa,
  fmtPaisa,
  fmtMoney,
  int,
  num,
  round2,
  pad,
  clamp,
  dstr,
  today,
  nowIso,
  addDays,
  dateAdd,
  parseDate,
  daysBetween,
  monthEnd,
  pct,
  token,
  monthStart,
  monthOf,
  isDate,
  dateOr,
  str,
  esc,
  slug,
  normalizeDigits,
  randomToken,
  hashPassword,
  verifyPassword,
  hashPin,
  verifyPin,
  csvCell,
  toCsv,
  isTrue,
  uniq,
  sum,
  groupBy,
  waNumber,
  deepClone,
};
