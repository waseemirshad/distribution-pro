# Distribution Pro — Wholesale & FMCG Distribution ERP

**Aap ki poori distribution company ka hisaab ek jagah** — billing counter, udhaar (credit), recovery,
godown/stock, van sales, schemes, reports. Sab kuch aap ke **apne computer par** chalta hai
(offline), internet ki zaroorat nahi. Data ek SQLite file me safe rehta hai.

> Ye app us blueprint ke mutabiq bana hai jo aap ne diya:
> *"Distribution Pro — System Analysis & .NET Architecture Blueprint"* (12 modules + master prompt).
> Neeche **"Node.js kyun, .NET 9 kyun nahi"** section me wajah likhi hai.

---

## 1. Sab se tez tareeqa (Windows)

1. **Node.js** install karein → <https://nodejs.org> (LTS version, 22 ya us se oopar). Bas Next → Next.
2. Is folder me **`START.bat`** par **double-click** karein.
3. Browser khud khul jayega: <http://localhost:3000>
4. Login: **`admin` / `admin123`**

Pehli dafa app khaali hoti hai. Demo data dekhna ho to — `npm run demo` (ya Settings page se
**"Demo data load karein"**), phir dashboard par poori company ka hisaab nazar aayega.

**Server window ko band na karein** — jab tak wo window khuli hai, app chalti rahegi.
Band karne se pehle koi data khatam nahi hota, sab kuch save rehta hai.

### Linux / macOS
```bash
chmod +x START.sh
./START.sh
```

### Ya npm se (har platform)
```bash
npm start          # http://localhost:3000
npm run dev        # auto-restart on file change
```

---

## 2. Zaroorat (Requirements)

| Cheez | Tafseel |
|---|---|
| Node.js | **22.5+** best hai — SQLite Node ke andar built-in hoti hai, **koi npm install nahi**. |
| Node 18/20 | Phir `npm install` chalayein (better-sqlite3 optional package install hoga). |
| Internet | Sirf install ke waqt. Chalane ke liye **bilkul zaroori nahi**. |
| RAM | 200 MB se bhi kam. |
| Multi-user | Ek system par server chale, baqi computers/mobile usi ke LAN IP par kholein. |

Zaroori dependencies: **koi nahi** (zero-dependency). Web UI plain HTML/CSS/JS hai, database
Node ka built-in `node:sqlite` hai.

---

## 3. Login users (default passwords)

| Username | Password | Kya kar sakta hai |
|---|---|---|
| `admin` | `admin123` | Malik / sab kuch (users, backup, settings) |
| `manager` | `manager123` | Credit-limit override, bill void, sari reports |
| `counter` | `counter123` | POS billing, recovery (cash/cheque) |
| `godown` | `godown123` | Purchase, stock, godown transfer (STN), batches |
| `accounts` | `accounts123` | Receipts, payments, kharcha, cash closing, reports |
| `salesman` | `salesman123` | Order booking, recovery, market visit (demo me) |

> **Zaroori:** pehle din hi **Settings → Users** se apne asli logins banayein aur `admin123`
> jaisay default passwords badal dein. Manager PIN (default `1234`) bhi Settings me badlein —
> wohi PIN credit-limit override aur void ke waqt maanga jata hai.

---

## 4. Kya kya bana hai (12 modules — sab mukammal)

1. **Master catalogs** — companies, categories, products, suppliers, customers, routes/beats,
   salesmen, warehouses (multi-godown), expense heads, price tiers (Retail / Wholesale /
   Distributor / Super Store).
2. **Trade schemes & claims** — `X+Y free` (3+1), slab % discount, cash discount; scheme
   automatically bill par lag jati hai; company **claims** ka register + settle.
3. **Counter POS + credit billing** — carton **aur** loose piece dono se entry, item ka carton
   size khud sambhalta hai, barcode/SKU search, per-line discount, bill discount,
   cash/udhaar sale, **credit limit + credit days ki hard-lock** (overdue 30/60/90) aur
   manager PIN se override (audit me record).
4. **Sales & Purchase Returns** — return-to-godown ya **return-to-scrap**, credit note
   (balance reversal), purchase return se supplier ka balance kam.
5. **Van sales** — morning **loading sheet + gate pass**, evening **loaded vs sold
   reconciliation** (shortage automatically Stock Loss me jata hai), spot billing + 80mm slip.
6. **Beat planning (PJP) + GPS check-in** — route ka din fix, customer par 150 m ke andar
   check-in (geo-fence), visit log.
7. **Near-expiry push engine** — 30/60/90 din wale batches ka alert, expiry par sale block.
8. **Multi-godown + STN** — godown se godown transfer, send/receive do step me.
9. **Receipts (FIFO) + cheque/PDC register** — recovery pehle purane bill se adjust hoti hai;
   cheque ka pura lifecycle: *Received → Clearing → Cleared / Bounced* (bounce par
   auto-reverse).
10. **WhatsApp automation** — bill aur ledger statement ka message ek click me WhatsApp par.
11. **Salesman commission** — sirf **realized recovery** par (jab cheque clear ho, tab
    commission banay), commission register + payment.
12. **Daily cash closing + executive dashboard** — aaj ki sale, gross profit, kharche, net
    profit, recovery, receivables aging, cheque in hand, stock valuation (cost + retail).

**Saath me:** login/RBAC (56 permissions), audit log, ledger (double-entry GL), backup/restore,
CSV export, 32 reports, thermal 80mm + A4 printing, dark/light theme, auto backup-friendly
single-file DB.

### 32 Reports
Sale register • item-wise • customer-wise • route-wise • salesman performance • daily summary •
profit report • purchase register • supplier-wise • stock summary • stock ledger • **batch expiry** •
**low stock / reorder** • item movement • **inventory valuation** • receivables aging •
payables aging • customer statement • supplier statement • day book • account balances •
cash book • expense report • cheque register • van settlement • sale returns • purchase returns •
scheme/claim • commission • target achievement • market visits • open orders.

---

## 5. Rozana ka kaam (kaise chalayein)

**Subah — Godown**
- `Purchase` → supplier ka bill entry (`purchase.create`), batch no + expiry date daalein.
- `Van` → *Naya load*: salesman + route select, items cartons/loose me daal kar **Gate Pass** print.
- `Stock` → opening stock, adjustment (wastage), aur `Batches` par expiry dekhein.

**Din bhar — Counter (POS)**
- `Naya Bill (POS)` — **F2** se item search, carton/loose likhein, **F4** se customer,
  **F9** se save + print. Cash ya Udhaar.
- Udhaar me limit cross ho to manager PIN maange ga; PIN ke baad hi bill jari hoga.

**Shaam — Recovery + Settlement**
- `Receipts` — customer se cash/cheque/bank receipt; **FIFO** khud purane bill se adjust karega.
- `Payments` — supplier ko cash/cheque payment.
- `Cheques` — cheque clear / bounce mark karein (status ke sath).
- `Van` → us din ka load **settle**: kitna bikā, kitna wapas godown, kitna scrap, kitni shortage.
- `Cash` → din ka **cash closing** (counter cash, bank, expenses) aur variance.

**Mahine ka**
- `Schemes` — scheme banayein aur **Claims** (company se claim) settle karein.
- `Targets` — salesman ka sale/recovery target; `Salesmen` par commission generate + pay.
- `Reports` → 32 reports, kisi ko bhi **CSV** me export ya **print**.

---

## 6. Printing & WhatsApp

- **80mm thermal:** bill save karne ke baad "🖨️ Thermal (80mm)" — browser ka print dialog,
  paper size 80mm (Roll) chunein. Thermal printer Windows me default printer hona chahiye.
- **A4/A5 invoice:** "📄 A4 Invoice" — proper invoice layout (batch, rate, discount, totals).
- **Statements / reports:** screen par print button (A4 landscape/portrait).
- **WhatsApp:** bill ke baad "💬 WhatsApp" — customer ka number `92` prefix ke sath
  wa.me link khulega, message tayyar hoga (bill value + khata balance).

## 7. Data, Backup aur Multi-user

- Sab kuch ek file me: **`data/distribution-pro.db`** (SQLite WAL).
- **Backup:** Settings → *Backup create* (ya `data/backups/` folder — app khud copy banata hai).
  Backup file ko USB/Google Drive par rakh dein. Restore bhi usi page se.
- **Dobara se shuru karna ho:** `npm run reset` (sab data delete, khaali app) ya
  `npm run fresh` (khaali + demo data).
- **LAN par multi-user:** server wale PC par `START.bat` chalayein; baqi systems/mobiles
  browser me server ka IP kholein, jaise `http://192.168.1.5:3000`. (Windows Firewall me
  Node.js ko "Allow" karna hoga.) Har user apne login se aayega — audit me naam record hota hai.
- **Port badalna ho:** `START.bat` me `PORT=3001` kar dein (ya `set PORT=3001`).

---

## 8. Node.js kyun? .NET 9 / WPF kyun nahi?

Aap ke blueprint ke master prompt me **.NET 9 + WPF (Fluent UI) + EF Core 9** likha tha. Wo
bilkul theek choice hai — magar **is machine par wo ban nahi sakta**:

- Yahan ka mahaul **headless Linux** hai, aur **`dotnet` SDK / NuGet kisi bhi tarah reachable nahi**
  (sab download hosts block). .NET install nahi ho sakta.
- **WPF sirf Windows par chalta hai** — Linux par WPF project compile/build ho hi nahi sakta.
  Yani app ban kar yahan test ho hi nahi sakti thi — aap ko sirf na-compile hone wala code milta.

Is liye wahi **poora blueprint (sab 12 modules, wahi business rules, wahi reports, wahi print)**
aik aisi stack me implement kiya gaya jo:
1. yahan **ban kar, chal kar, test ho kar** verify hui (62/62 API + business tests, aur 28 pages + POS billing flow ka browser test), aur
2. aap ke paas **is lamhe chal jati hai** — sirf `START.bat` double-click.

Kya kya barabar hai:

| Blueprint (.NET/WPF) | Is app me |
|---|---|
| Clean Architecture (Domain/Application/Infrastructure/Presentation) | `server/` (schema, services, reports, routes) + `web/` (SPA UI) |
| EF Core 9 + SQLite WAL, auto-migrate | `node:sqlite` + WAL + auto schema install (`server/schema.js`) |
| `decimal(18,2)` money | **paisa (integer)** me pura hisaab — float kahin nahi, 1 paisa ka bhi error nahi |
| WPF Fluent nav + billing counter | Browser SPA (keyboard-first POS, F1–F9 shortcuts) |
| QuestPDF / FastReport 80mm + A4 | CSS **80mm thermal** + A4 print layouts (browser print dialog) |
| `RUN_APP.bat` / `BUILD_STANDALONE_EXE.bat` / Inno Setup | **`START.bat`** (ek click) / `START.sh` |
| Multi-user SQL Server/PostgreSQL future | SQLite (WAL) — LAN par multi-user; SQL Server/Postgres par shift karna ho to services layer alag rakhhi hai |

**Agar aap ko phir bhi .NET 9 + WPF version chahiye** (Windows par distribute karne ke liye), to
wo isi repo me alag branch/folder me banaya ja sakta hai — bolo, main bana dunga.

---

## 9. Project structure

```
distribution-pro/
  START.bat / START.sh      → ek click me app chalayein
  package.json              → npm start / demo / reset / test
  server/
    index.js                → HTTP server, static files, startup
    routes.js               → poori REST API (~150 endpoints)
    services.js             → business rules (invoice, FEFO, FIFO, cheque, van, scheme, GL)
    schema.js               → 47 tables + indexes + default settings
    db.js                   → SQLite wrapper (WAL, transactions)
    auth.js                 → login, sessions, 56 permissions / roles
    reports.js              → 32 reports engine
    demo.js / seed.js       → demo data + CLI
    util.js / settings.js   → helpers
  web/                      → browser UI (SPA)
    index.html, css/app.css
    js/core.js              → UI kit (table, modal, toast, print, charts)
    js/pages/*.js           → 28 pages
    js/app.js               → router, login, nav, alerts
  tests/smoke.js            → 62 API/business tests
  tests/ui-smoke.js         → 28 pages ka UI test (jsdom)
  data/                     → aap ka database + backups (git me nahi jata)
```

---

## 10. Test karna (optional)

```bash
npm test        # 62 tests: billing, FEFO, credit lock, returns, van, cheques, GL balance, 32 reports
npm run test:ui # 28 pages render + dashboard/reports/customers data + poora POS billing flow (pehle ek dafa: npm i -D jsdom)
```
Dono green hone chahiye: `62 passed / 0 failed` aur `UI TEST: 43 passed, 0 failed`
(repo me `tests/smoke.js` aur `tests/ui-smoke.js` mojood hain — `npm test` asli database ko chhoota bhi nahi,
apna alag temporary DB banata hai).

## 11. Keyboard shortcuts

| Key | Kaam |
|---|---|
| `F1` | Shortcuts list |
| `F2` | POS me item search (kisi bhi page se naya bill) |
| `F3` | POS: naya row / customer search |
| `F4` | POS: customer chunein |
| `F9` | POS: bill save + print |
| `Ctrl + K` | Menu search |
| `Esc` | Modal band / POS khali |

## 12. Masla ho to (Troubleshooting)

| Masla | Hal |
|---|---|
| `Node.js nahi mila` | <https://nodejs.org> se LTS install karein, phir `START.bat` dobara. |
| `SQLite engine nahi mila` | Node 22.5+ install karein, ya folder me `npm install` chalayein. |
| Browser nahi khula | Khud kholein: <http://localhost:3000> |
| `Port 3000 busy` | `set PORT=3001` kar ke dobara `START.bat` chalayein. |
| Doosre PC se nahi khul raha | Windows Firewall me Node.js allow karein; IP check karein (`ipconfig`). |
| Print galat size | Print dialog me paper **80mm / Roll** chunein, margins "None", scale 100%. |
| Sab data mitana hai | `npm run reset` (pehle backup lena behtar hai). |

---

**Distribution Pro v1.0** — banaya gaya blueprint ke mutabiq, 12/12 modules.
Koi bhi naya feature (e.g. FBR/tax invoice, multi-branch, mobile app, .NET/WPF version) chahiye to
bata dein.
