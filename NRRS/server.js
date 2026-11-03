'use strict';
/* =========================================================================
   Somaliland NGO Registration and Renewing System(NRRS) — LOCAL DEMO
   Pure Node.js, zero dependencies.  Run:  node server.js  → http://localhost:3000
   Mirrors the NGO registration and renewal flows under Law No. 43/2010:
   name search → registration → operating permit → annual renewal,
   invoice → ZAAD/eDAHAB payment → technical review → senior officer →
   Director of NGOs → Registrar / Minister → signed certificate or permit.
   ========================================================================= */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const PUB = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

/* ============================== persistence ============================== */
let db;
function freshDb() {
  return {
    users: [], applications: [], invoices: [], emails: [], notifications: [],
    sessions: {}, registry: [], reservations: [],
    counters: { app: 1, inv: 1, reg: 1, cert: 1, lic: 1 }
  };
}
function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DB_FILE);
  } catch (e) { console.error('DB save failed:', e.message); }
}
function loadOrSeed() {
  let usedSeed = false;
  try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch (e) { db = freshDb(); usedSeed = true; }
  if (!db.counters) db.counters = { app: 1, inv: 1, reg: 1, cert: 1, lic: 1 };
  if (usedSeed) { seedDemo(); save(); }
}
function nextId(key, prefix) {
  const n = db.counters[key]++;
  save();
  return `${prefix}-2026-${String(n).padStart(4, '0')}`;
}
function uid() { return crypto.randomBytes(16).toString('hex'); }

/* =============================== domain data ============================= */
const ROLES = {
  applicant:       { label: 'Applicant' },
  tech_officer:    { label: 'NGO Technical Officer' },
  senior_officer:  { label: 'Senior NGO Officer' },
  director:        { label: 'Director of NGOs' },
  ag:              { label: 'Registrar of NGOs' },
  minister:        { label: 'Minister of Planning & National Development' }
};
const STAGE_ROLE = {
  tech_review: 'tech_officer',
  senior_review: 'senior_officer',
  director_review: 'director',
  ag_review: 'ag',
  minister_review: 'minister'
};
const STAGE_LABEL = {
  tech_review: 'Technical review',
  senior_review: 'Senior NGO Officer review',
  director_review: 'Director of NGOs review',
  ag_review: 'Registrar of NGOs final review',
  minister_review: 'Minister final review'
};
const TYPES = {
  name_search:  { label: 'NGO Name Search & Clearance' },
  registration: { label: 'NGO Registration' },
  license:      { label: 'Operating Permit' },
  renewal:      { label: 'Annual Renewal' }
};
/* stage chain AFTER payment (name_search has none: it resolves at payment) */
const CHAINS = {
  registration: ['senior_review', 'director_review', 'ag_review'],
  license:      ['director_review', 'minister_review'],
  renewal:      ['director_review', 'minister_review'],
  name_search:  []
};
const STATUS_BADGE = {
  submitted: 'gray', tech_review: 'blue', awaiting_payment: 'amber',
  name_cleared: 'teal', reserved: 'emerald', paid: 'violet',
  senior_review: 'indigo', director_review: 'indigo', ag_review: 'indigo',
  minister_review: 'indigo', issued: 'green', rejected: 'red'
};

/* Operating-permit fee schedule for NGOs (demo, USD).
   Columns: local NGO | locally funded NGO | INGO branch | INGO affiliate */
const FEE_SCHEDULE = [
  { id: 'wash',           label: 'Water, Sanitation & Hygiene (WASH)', tiers: [100, 150, 400, 600] },
  { id: 'education',      label: 'Education & Training',               tiers: [100, 150, 400, 600] },
  { id: 'health',         label: 'Health & Nutrition',                 tiers: [100, 150, 400, 600] },
  { id: 'humanitarian',   label: 'Humanitarian Relief & Emergency',     tiers: [150, 200, 500, 750] },
  { id: 'food_security',  label: 'Food Security & Livelihoods',         tiers: [100, 150, 400, 600] },
  { id: 'child_protection', label: 'Child Protection & Youth',          tiers: [100, 150, 400, 600] },
  { id: 'women_gender',   label: 'Women & Gender Empowerment',          tiers: [100, 150, 400, 600] },
  { id: 'environment',    label: 'Environment & Climate Action',        tiers: [100, 150, 400, 600] },
  { id: 'governance',     label: 'Human Rights & Governance',           tiers: [150, 200, 500, 750] },
  { id: 'capacity',       label: 'Research & Capacity Building',        tiers: [100, 150, 400, 600] },
  { id: 'culture_sports', label: 'Culture, Arts & Sports',              tiers: [100, 150, 300, 500] },
  { id: 'social_services', label: 'Social Services & Community Development', tiers: [100, 150, 400, 600] }
];
const OWNERSHIP = [
  { id: 'sole_local',           label: 'Local NGO — resident founders' },
  { id: 'partnership_local',    label: 'Local NGO — foreign funded' },
  { id: 'sole_foreign',         label: 'International NGO — branch' },
  { id: 'partnership_foreign',  label: 'International NGO — affiliate' }
];
const ENTITY_TYPES = [
  { id: 'local_ngo',           label: 'Local NGO',                    fee: 150 },
  { id: 'community_org',       label: 'Community-Based Organisation', fee: 100 },
  { id: 'faith_based',         label: 'Faith-Based NGO',              fee: 150 },
  { id: 'international_ngo',   label: 'International NGO (INGO)',     fee: 500 }
];
const RESERVATION_FEE = 50;
const GOV = { trade: '1140808', stamp: '1140902', admin: '1140821', reg: '1141816' };

/* NGO registration requirements (demo content adapted for this local build) */
const NGO_REQUIREMENTS = {
  authority: 'Ministry of Planning and National Development (MoPND) — NGO Affairs',
  currency: 'USD',
  local: {
    label: 'Local NGO',
    lead: 'A non-governmental organisation founded in Somaliland by resident founders, with its headquarters inside the country.',
    fees: [{ desc: 'Registration fee (one-off)', amount: 150 }],
    items: [
      { req: 'Registration application form', note: 'Completed and signed by the chairperson and secretary-general, three copies.' },
      { req: 'Constitution / by-laws', note: 'Adopted by the founders: name, objectives, membership, governance, accounts and dissolution.' },
      { req: 'Founding members register', note: 'At least seven residents with full name, national ID, occupation, address, phone and signature.' },
      { req: 'Member IDs and photographs', note: 'Copy of each founder\'s Somaliland national ID plus two passport-size photographs.' },
      { req: 'Minutes of the founding assembly', note: 'Record the election of the board, adoption of the constitution and approval of the work plan.' },
      { req: 'Name options', note: 'Three names in order of preference with a short meaning of each, plus the name search result.' },
      { req: 'Work plan and budget', note: 'First-year activities, locations, target groups and budget in USD, signed by the treasurer.' },
      { req: 'Physical office address', note: 'Lease agreement or a utility bill not older than three months for an office inside Somaliland.' },
      { req: 'Police clearance', note: 'Certificate of good conduct for every founder and board member.' },
      { req: 'Bank account and source of funds', note: 'Bank letter confirming the account (or a pending-opening letter) and a declaration of funding sources.' },
      { req: 'Compliance undertaking', note: 'Signed commitment to the NGO Act, anti-corruption, counter-terrorism, safeguarding and labour rules.' },
      { req: 'Fee payment receipt', note: 'Receipt for the registration fee; stamp duty 2.5% and administration tax 2% are added to the invoice.' }
    ],
    process: [
      { title: 'Name clearance', note: 'Run a name search for up to three options and keep the clearance result.' },
      { title: 'Submit the file', note: 'Paper file at the Ministry desk or digital file through NRRS.' },
      { title: 'Completeness check', note: 'The Technical Officer verifies every row of this list (demo: 10 working days).' },
      { title: 'Due diligence', note: 'Background verification of founders with the police and registration authorities (demo: 15 working days).' },
      { title: 'Invoice and payment', note: 'An approved file produces an invoice — pay by ZAAD or eDAHAB.' },
      { title: 'Certificate issued', note: 'Certificate of Registration is signed, issued and downloadable; anyone can verify it on the Verify page.' },
      { title: 'Annual reporting', note: 'Submit audited accounts and the activity report before the renewal date.' }
    ]
  },
  international: {
    label: 'International NGO',
    lead: 'A foreign NGO, affiliate or branch operating in Somaliland through an office and staff appointed by its headquarters.',
    fees: [
      { desc: 'Operating permit fee (annual)', amount: 500 },
      { desc: 'Renewal of permit', amount: 250 }
    ],
    items: [
      { req: 'Parent organisation constitution', note: 'Charter or constitution of the foreign NGO, certified by the competent home authority.' },
      { req: 'Home registration certificate', note: 'Notarised certificate of incorporation or registration issued in the country of origin.' },
      { req: 'Head-office authorisation', note: 'Letter appointing the country director, defining the mandate and confirming the Somaliland office.' },
      { req: 'Representative IDs', note: 'Passport copies for the representative and two senior staff, plus work and residence permits.' },
      { req: 'Memorandum of Understanding', note: 'Signed MoU with the Government of Somaliland covering activities, regions, staff and duration.' },
      { req: 'Local governance documents', note: 'Names, CVs, national IDs and photographs of the local board or advisory committee.' },
      { req: 'Somaliland work plan and budget', note: 'Twelve-month programme plan with regions, beneficiaries, indicators and budget in USD.' },
      { req: 'Funding evidence', note: 'Donor agreements, last two audited financial statements and six months of bank statements.' },
      { req: 'Office and local partners', note: 'Office lease or utility bill in Somaliland and partnership agreements with local organisations.' },
      { req: 'Tax and customs compliance', note: 'Tax identification number from the revenue authority and a declaration for imported goods and equipment.' },
      { req: 'Code of conduct', note: 'Signed commitment to humanitarian principles, safeguarding, data protection and anti-terrorism compliance.' },
      { req: 'Permit fee receipt', note: 'Receipt for the operating permit fee; the permit is renewable annually.' }
    ],
    process: [
      { title: 'Concept note and MoU', note: 'Submit the concept note and negotiate the Memorandum of Understanding with the Ministry (demo: 30 working days).' },
      { title: 'Document check', note: 'The Technical Officer verifies the file against this list and marks every missing document.' },
      { title: 'Inter-agency clearance', note: 'Security, justice and immigration clearances for the foreign representatives (demo: 15 working days).' },
      { title: 'Permit invoice and payment', note: 'Approved file produces the permit invoice — pay by ZAAD or eDAHAB.' },
      { title: 'Operating permit issued', note: 'The permit states the approved activities, regions and validity (demo: 12 months).' },
      { title: 'Renewal', note: 'Apply for renewal with the annual activity and financial report before the expiry date.' },
      { title: 'Reporting and verification', note: 'Periodic reports and verification visits agreed in the MoU, including spot checks on funds used.' }
    ]
  },
  notes: [
    'Demonstration content adapted for this local NRRS build — confirm current forms, fees and timelines with the Ministry of Planning and National Development (MoPND) before submitting.',
    'Every NGO name has to clear a name search first: up to three options, free of charge.',
    'Foreign documents must be notarised in the issuing country and translated into English or Somali.',
    'Incomplete files are returned to the applicant with the officer comment; nothing is approved until every row is supplied.',
    'Stamp Duty 2.5% and Administration Tax 2% are added when the invoice is generated.'
  ]
};

const pct = (a, p) => Math.max(1, Math.round(a * p * 100) / 100);
function licenseLines(categoryId, ownershipId) {
  const cat = FEE_SCHEDULE.find(c => c.id === categoryId);
  const idx = ['sole_local', 'partnership_local', 'sole_foreign', 'partnership_foreign'].indexOf(ownershipId);
  const fee = cat.tiers[idx < 0 ? 0 : idx];
  return [
    { desc: `Operating Permit Fee — ${cat.label}`, code: GOV.trade, amount: fee },
    { desc: 'Stamp Duty (2.5%)',  code: GOV.stamp, amount: pct(fee, 0.025) },
    { desc: 'Administration Tax (2%)', code: GOV.admin, amount: pct(fee, 0.02) }
  ];
}
function registrationLines(entityId) {
  const e = ENTITY_TYPES.find(x => x.id === entityId);
  if (!e) throw new HttpError(400, 'Unknown entity type');
  return [
    { desc: `NGO Registration Fee — ${e.label}`, code: GOV.reg, amount: e.fee },
    { desc: 'Stamp Duty (2.5%)',  code: GOV.stamp, amount: pct(e.fee, 0.025) },
    { desc: 'Administration Tax (2%)', code: GOV.admin, amount: pct(e.fee, 0.02) }
  ];
}
const reservationLines = () =>
  [{ desc: 'Name Reservation Fee (90 days)', code: GOV.reg, amount: RESERVATION_FEE }];

/* ================================ helpers ================================ */
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
function normName(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function hashPassword(pw, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(pw, salt, 64).toString('hex');
  return { salt, hash: h };
}
function checkPassword(pw, user) {
  const h = crypto.scryptSync(pw, user.salt, 64);
  return crypto.timingSafeEqual(h, Buffer.from(user.hash, 'hex'));
}
function sendMail(to, subject, body) {
  db.emails.unshift({ id: uid(), to, subject, body, at: new Date().toISOString() });
  if (db.emails.length > 200) db.emails.length = 200;
  save();
}
function notify(userId, text) {
  db.notifications.unshift({ id: uid(), userId, text, at: new Date().toISOString(), read: false });
  if (db.notifications.length > 500) db.notifications.length = 500;
  save();
}
function addEvent(app, actor, action, comment) {
  app.events.push({
    at: new Date().toISOString(),
    actor: actor ? actor.fullName : 'System',
    role: actor && actor.role !== 'applicant' ? ROLES[actor.role].label : (actor ? 'Applicant' : 'System'),
    action, comment: comment || ''
  });
}
function nameTaken(name) {
  const n = normName(name);
  return db.registry.some(b => normName(b.name) === n && b.status === 'active');
}
function activeReservation(name, userId) {
  const n = normName(name);
  const now = Date.now();
  return db.reservations.find(r => normName(r.name) === n && new Date(r.expires).getTime() > now &&
    (userId === undefined || r.userId === userId));
}

/* ------------------------ close-name analysis -------------------------- */
function tokenise(s) {
  return String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1);
}
function editDistance(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
function wordsClose(x, y) {
  if (x === y) return true;
  const min = Math.min(x.length, y.length);
  if (min < 4) return false;
  return editDistance(x, y) <= (min >= 6 ? 2 : 1);
}
/* Compare submitted NGO name options against registered NGOs and live reservations. */
function setNameSimilarity(names) {
  const targets = [];
  for (const b of db.registry)
    if (b.status === 'active') targets.push({ name: b.name, kind: 'registered NGO', number: b.regNumber });
  const now = Date.now();
  for (const r of db.reservations)
    if (!r.consumed && new Date(r.expires).getTime() > now)
      targets.push({ name: r.name, kind: 'reserved name', number: '' });

  return (names || []).map(name => {
    const sub = tokenise(name);
    const norm = normName(name);
    const matches = [];
    for (const t of targets) {
      const reg = tokenise(t.name);
      const used = new Array(reg.length).fill(false);
      const hit = [], missed = [];
      for (const w of sub) {
        let idx = reg.findIndex((r, i) => !used[i] && r === w);
        if (idx < 0) idx = reg.findIndex((r, i) => !used[i] && wordsClose(w, r));
        if (idx >= 0) { used[idx] = true; hit.push(w); } else missed.push(w);
      }
      const matchedWords = hit.length;
      const score = Math.round((matchedWords / Math.max(sub.length, reg.length)) * 100) / 100;
      const exact = normName(t.name) === norm;
      if (exact || (matchedWords > 0 && (score >= 0.5 || matchedWords >= 2)))
        matches.push({
          registered: t.name, kind: t.kind, number: t.number,
          matchedWords, totalWords: sub.length, matched: hit, missing: missed,
          score, exact,
          sentence: exact
            ? `"${name}" is identical to ${t.kind} "${t.name}"`
            : `${matchedWords} of ${sub.length} submitted words are close to ${t.kind} "${t.name}"`
        });
    }
    matches.sort((x, y) => (y.exact - x.exact) || (y.score - x.score));
    return { name, exactDuplicate: matches.some(m => m.exact), matches: matches.slice(0, 3) };
  });
}
function nameRisk(a) {
  if (!a || a.type !== 'name_search') return false;
  return setNameSimilarity((a.data && a.data.names) || []).some(r => r.exactDuplicate || r.matches.length > 0);
}

/* ============================== seed demo data =========================== */
function seedDemo() {
  /* demo data models an NGO registry, not businesses */
  const mkUser = (email, fullName, role, pw) => {
    const { salt, hash } = hashPassword(pw || 'officer123');
    const u = {
      id: uid(), email, fullName, role, salt, hash, verified: true,
      phone: '+252 63 000 0000', nationalId: 'SL-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
      createdAt: new Date().toISOString(), fcmToken: null
    };
    db.users.push(u);
    return u;
  };
  mkUser('tech@brls.local', 'NGO Technical Officer', 'tech_officer');
  mkUser('senior@brls.local', 'Senior NGO Officer', 'senior_officer');
  mkUser('director@brls.local', 'Director of NGOs', 'director');
  mkUser('ag@brls.local', 'Registrar of NGOs', 'ag');
  mkUser('minister@brls.local', 'Minister of Planning & National Development', 'minister');

  const pw = hashPassword('demo123');
  db.users.push({
    id: uid(), email: 'applicant@brls.local', fullName: 'Amina Yusuf', role: 'applicant',
    salt: pw.salt, hash: pw.hash, verified: true, phone: '+252 63 444 1234',
    nationalId: 'SL-0987654', createdAt: new Date().toISOString(), fcmToken: null
  });

  const owner = db.users.find(u => u.email === 'applicant@brls.local');
  const issued = new Date();
  const exp = new Date(issued.getFullYear() + 1, issued.getMonth(), issued.getDate());
  db.registry.push({
    regNumber: 'SL-NGO-2026-0001',
    name: 'Hargeisa Community Education Initiative',
    entityType: 'local_ngo',
    address: 'Jigjiga Yar, Hargeisa',
    activities: ['Education', 'Water & Sanitation'],
    owners: [{ name: 'Amina Yusuf', nationalId: 'SL-0987654', share: 100 }],
    userId: owner.id,
    status: 'active',
    issuedOn: issued.toISOString(),
    certificate: {
      number: 'NGO/C/2026-0001', type: 'Certificate of Registration',
      issuedOn: issued.toISOString(), verifyCode: 'V' + crypto.randomBytes(5).toString('hex').toUpperCase()
    },
    licenses: [{
      number: 'MoPND/P/2026-0001', category: 'education', ownership: 'sole_local',
      issuedOn: issued.toISOString(), expires: exp.toISOString(), status: 'active',
      verifyCode: 'V' + crypto.randomBytes(5).toString('hex').toUpperCase()
    }]
  });
  /* keep counters ahead of the hard-coded seed numbers */
  db.counters.reg = 2; db.counters.cert = 2; db.counters.lic = 2; db.counters.app = 1; db.counters.inv = 1;
}

/* ================================ sessions =============================== */
function makeSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = { userId, createdAt: Date.now(), exp: Date.now() + 12 * 3600 * 1000 };
  save();
  return token;
}
function authUser(req) {
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  const s = db.sessions[token];
  if (!s || s.exp < Date.now()) { if (s) { delete db.sessions[token]; save(); } return null; }
  const u = db.users.find(x => x.id === s.userId);
  return u || null;
}
function officerOnly(user) {
  if (!user) throw new HttpError(401, 'Not authenticated');
  if (user.role === 'applicant') throw new HttpError(403, 'Officer access only');
}

/* =============================== HTTP utils ============================= */
function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > 1_000_000) { reject(new HttpError(413, 'Payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new HttpError(400, 'Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

/* ============================ workflow engine =========================== */
function createInvoice(applicationId, userId, lines) {
  const inv = {
    id: nextId('inv', 'INV'), applicationId, userId,
    lines: lines.map(l => ({ ...l, amount: Number(l.amount) })),
    total: Math.round(lines.reduce((s, l) => s + Number(l.amount), 0) * 100) / 100,
    currency: 'USD', status: 'unpaid', method: null, msisdn: null,
    createdAt: new Date().toISOString(), paidAt: null
  };
  db.invoices.unshift(inv);
  save();
  return inv;
}
function advance(app) {
  const chain = CHAINS[app.type];
  if (app.chainIndex == null) app.chainIndex = -1;
  app.chainIndex++;
  if (app.chainIndex >= chain.length) { issue(app); return; }
  app.status = chain[app.chainIndex];
}
function issue(app, actor) {
  const now = new Date().toISOString();
  if (app.type === 'registration') {
    const regNumber = nextId('reg', 'SL-NGO');
    const certNo = nextId('cert', 'NGO/C');
    const entry = {
      regNumber, name: app.data.businessName, entityType: app.data.entityType,
      address: app.data.address, activities: app.data.activities || [], owners: app.data.owners || [],
      userId: app.userId, status: 'active', issuedOn: now,
      certificate: {
        number: certNo, type: 'Certificate of Registration', issuedOn: now,
        verifyCode: 'V' + crypto.randomBytes(5).toString('hex').toUpperCase()
      },
      licenses: []
    };
    db.registry.push(entry);
    /* consume name reservation, if any */
    const res = db.reservations.find(r => normName(r.name) === normName(app.data.businessName) && r.userId === app.userId);
    if (res) { res.consumed = true; }
    app.result = { regNumber, certificate: entry.certificate };
    addEvent(app, actor, `Certificate of Registration issued: ${certNo}`, '');
  } else {
    const business = db.registry.find(b => b.regNumber === app.data.regNumber);
    if (!business) throw new HttpError(409, 'Registered NGO not found for permit issuance');
    const licNo = nextId('lic', 'MoPND/P');
    const issued = new Date();
    if (app.type === 'renewal') {
      const old = business.licenses.find(l => l.number === app.data.licenseNumber && l.status === 'active');
      const base = old ? new Date(old.expires) : issued;
      const from = base.getTime() > issued.getTime() ? base : issued;
      const exp = new Date(from.getFullYear() + 1, from.getMonth(), from.getDate());
      if (old) old.status = 'renewed';
      const verifyCode = 'V' + crypto.randomBytes(5).toString('hex').toUpperCase();
      business.licenses.push({
        number: licNo, category: app.data.category, ownership: app.data.ownership,
        issuedOn: now, expires: exp.toISOString(), status: 'active',
        verifyCode, renewalOf: app.data.licenseNumber
      });
      app.result = { licenseNumber: licNo, expires: exp.toISOString(), verifyCode };
      addEvent(app, actor, `Operating permit renewed: ${licNo} (valid to ${exp.toDateString()})`, '');
    } else {
      const exp = new Date(issued.getFullYear() + 1, issued.getMonth(), issued.getDate());
      const verifyCode = 'V' + crypto.randomBytes(5).toString('hex').toUpperCase();
      business.licenses.push({
        number: licNo, category: app.data.category, ownership: app.data.ownership,
        issuedOn: now, expires: exp.toISOString(), status: 'active',
        verifyCode
      });
      app.result = { licenseNumber: licNo, expires: exp.toISOString(), verifyCode };
      addEvent(app, actor, `Operating permit issued: ${licNo} (valid to ${exp.toDateString()})`, '');
    }
  }
  app.status = 'issued';
  app.decidedAt = now;
  save();
  notify(app.userId, `${TYPES[app.type].label} — approved. Your document was issued (application ${app.id}).`);
  sendMail(app.userEmail, `NRRS: ${TYPES[app.type].label} approved`,
    `Your application ${app.id} has been approved and the document issued. Sign in to download it.`);
}

function validateApplicationPayload(type, data, user) {
  const require = (v, msg) => { if (!v || !String(v).trim()) throw new HttpError(400, msg); return String(v).trim(); };
  if (type === 'name_search') {
    const names = (data.names || []).map(s => String(s || '').trim()).filter(Boolean);
    if (names.length < 1) throw new HttpError(400, 'Provide at least one NGO name option');
    if (names.length > 3) throw new HttpError(400, 'A maximum of three name options is allowed');
    return {
      names, intent: data.intent === 'reserve' ? 'reserve' : 'register',
      notes: String(data.notes || '')
    };
  }
  if (type === 'registration') {
    const businessName = require(data.businessName, 'NGO name is required');
    if (nameTaken(businessName) && !activeReservation(businessName, user.id))
      throw new HttpError(409, `"${businessName}" is already registered. Run a name search and reserve it first.`);
    const entityType = require(data.entityType, 'Organisation type is required');
    if (!ENTITY_TYPES.some(e => e.id === entityType)) throw new HttpError(400, 'Unknown organisation type');
    const owners = (data.owners || []).filter(o => o && o.name && o.nationalId);
    if (!owners.length) throw new HttpError(400, 'At least one founder / board member (name + national ID) is required');
    return {
      businessName, entityType,
      address: require(data.address, 'Registered address is required'),
      phone: String(data.phone || ''), email: String(data.email || user.email),
      activities: String(data.activities || '').split(',').map(s => s.trim()).filter(Boolean),
      owners: owners.map(o => ({ name: String(o.name), nationalId: String(o.nationalId), share: Number(o.share) || 0 })),
      nameSource: data.nameSource || (activeReservation(businessName, user.id) ? 'reservation' : 'straight')
    };
  }
  if (type === 'license' || type === 'renewal') {
    if (type === 'license') {
      const regNumber = require(data.regNumber, 'Registered NGO (registration number) is required');
      const b = db.registry.find(x => x.regNumber === regNumber);
      if (!b) throw new HttpError(409, 'No registered NGO matches that registration number');
      const category = require(data.category, 'Programme sector is required');
      if (!FEE_SCHEDULE.some(c => c.id === category)) throw new HttpError(400, 'Unknown programme sector');
      const ownership = require(data.ownership, 'Registration class is required');
      if (!OWNERSHIP.some(o => o.id === ownership)) throw new HttpError(400, 'Unknown registration class');
      return {
        regNumber, businessName: b.name, category, ownership,
        tin: String(data.tin || ''), premises: String(data.premises || b.address || ''),
        plateCount: Number(data.plateCount) || 0
      };
    }
    const licenseNumber = require(data.licenseNumber, 'Active operating permit number is required');
    let found = null;
    for (const b of db.registry) {
      const l = b.licenses.find(x => x.number === licenseNumber && x.status === 'active');
      if (l) { found = { b, l }; break; }
    }
    if (!found) throw new HttpError(409, 'No active operating permit matches that number');
    if (type === 'renewal' && !String(data.tin || '').trim())
      throw new HttpError(400, 'TIN / tax reference is mandatory for renewal');
    return {
      licenseNumber, regNumber: found.b.regNumber, businessName: found.b.name,
      category: found.l.category, ownership: found.l.ownership,
      tin: String(data.tin || ''), premises: String(data.premises || ''),
      notes: String(data.notes || '')
    };
  }
  throw new HttpError(400, 'Unknown application type');
}

/* ============================== API handlers ============================ */
async function handleApi(req, res, url) {
  const p = url.pathname;
  const method = req.method;
  const q = url.searchParams;
  const body = method === 'POST' || method === 'PUT' ? await readBody(req) : {};
  const user = authUser(req);

  /* ---------- public ---------- */
  if (method === 'GET' && p === '/api/fees')
    return json(res, 200, {
      schedule: FEE_SCHEDULE, ownership: OWNERSHIP, entities: ENTITY_TYPES,
      reservationFee: RESERVATION_FEE, currency: 'USD',
      notes: ['Stamp Duty 2.5% and Administration Tax 2% are added to permit and registration fees.',
              'Demo operating-permit fee schedule for NGOs (USD).']
    });

  if (method === 'GET' && p === '/api/requirements')
    return json(res, 200, { requirements: NGO_REQUIREMENTS });

  if (method === 'GET' && p === '/api/public/search') {
    const term = normName(q.get('q') || '');
    if (!term) return json(res, 200, { results: [] });
    const results = db.registry
      .filter(b => normName(b.name).includes(term) || normName(b.regNumber).includes(term))
      .map(b => ({
        name: b.name, regNumber: b.regNumber, status: b.status, entityType: b.entityType,
        issuedOn: b.issuedOn, activities: b.activities,
        licenses: b.licenses.map(l => ({ number: l.number, category: l.category, expires: l.expires, status: l.status }))
      }));
    return json(res, 200, { results });
  }

  if (method === 'GET' && p === '/api/public/verify') {
    const n = String(q.get('number') || '').trim();
    if (!n) return json(res, 400, { ok: false, message: 'Enter a document number' });
    const nn = normName(n);
    for (const b of db.registry) {
      if (normName(b.regNumber) === nn) return json(res, 200, {
        ok: true, kind: 'registration', title: 'NGO Registration (Certificate of Registration)',
        number: b.regNumber, holder: b.name, issuedOn: b.issuedOn, status: b.status,
        verifyCode: b.certificate.verifyCode, detail: 'Entity type: ' + (b.entityType || 'n/a')
      });
      if (b.certificate && (normName(b.certificate.number) === nn ||
          (b.certificate.verifyCode && normName(b.certificate.verifyCode) === nn)))
        return json(res, 200, {
          ok: true, kind: 'certificate', title: b.certificate.type,
          number: b.certificate.number, holder: b.name, issuedOn: b.certificate.issuedOn,
          status: 'Digitally signed — valid', verifyCode: b.certificate.verifyCode,
          detail: 'Registry number: ' + b.regNumber
        });
      for (const l of b.licenses) {
        if (normName(l.number) === nn || (l.verifyCode && normName(l.verifyCode) === nn)) {
          const cat = FEE_SCHEDULE.find(c => c.id === l.category);
          const expired = new Date(l.expires).getTime() < Date.now();
          return json(res, 200, {
            ok: true, kind: 'license', title: 'Operating Permit',
            number: l.number, holder: b.name, issuedOn: l.issuedOn,
            status: expired ? 'EXPIRED' : (l.status === 'renewed' ? 'Superseded (renewed)' : `Valid until ${new Date(l.expires).toDateString()}`),
            verifyCode: l.verifyCode, detail: 'Category: ' + (cat ? cat.label : l.category)
          });
        }
      }
    }
    return json(res, 404, { ok: false, message: 'No document matches that number' });
  }

  if (method === 'GET' && p === '/api/dev/emails')
    return json(res, 200, { emails: db.emails.slice(0, 50) });

  /* ---------- auth ---------- */
  if (p === '/api/auth/register' && method === 'POST') {
    const { fullName, email, phone, nationalId, password } = body;
    if (!fullName || !email || !phone || !password) throw new HttpError(400, 'Name, e-mail, phone and password are required');
    if (String(password).length < 6) throw new HttpError(400, 'Password must be at least 6 characters');
    if (db.users.some(u => u.email.toLowerCase() === String(email).toLowerCase()))
      throw new HttpError(409, 'An account with that e-mail already exists');
    const { salt, hash } = hashPassword(String(password));
    const u = {
      id: uid(), email: String(email).toLowerCase(), fullName: String(fullName), role: 'applicant',
      phone: String(phone || ''), nationalId: String(nationalId || ''),
      salt, hash, verified: true, otp: null, createdAt: new Date().toISOString(), fcmToken: null
    };
    db.users.push(u); save();
    notify(u.id, 'Welcome to NRRS! Your account was created — start with a Name Search.');
    sendMail(u.email, 'Welcome to NRRS',
      `Hello ${u.fullName}, your NRRS account was created for ${u.email}. Sign in anytime with your password.`);
    return json(res, 200, { ok: true, token: makeSession(u.id), user: publicUser(u) });
  }

  if (p === '/api/auth/login' && method === 'POST') {
    const { email, password } = body;
    const u = db.users.find(x => x.email === String(email || '').toLowerCase().trim());
    if (!u || !checkPassword(String(password || ''), u)) throw new HttpError(401, 'Invalid e-mail or password');
    return json(res, 200, { ok: true, token: makeSession(u.id), user: publicUser(u) });
  }

  if (p === '/api/auth/forgot' && method === 'POST') {
    const u = db.users.find(x => x.email === String(body.email || '').toLowerCase());
    if (u) {
      const token = crypto.randomBytes(16).toString('hex');
      u.reset = { token, exp: Date.now() + 30 * 60 * 1000 }; save();
      sendMail(u.email, 'NRRS password reset',
        `Reset your password: http://localhost:${PORT}/#/reset/${token}\nThis link expires in 30 minutes.`);
    }
    /* do not reveal whether the account exists */
    return json(res, 200, { ok: true, message: 'If that e-mail exists, a reset link was sent (see #/mailbox).' });
  }

  if (p === '/api/auth/reset' && method === 'POST') {
    const { token, password } = body;
    const u = db.users.find(x => x.reset && x.reset.token === token && x.reset.exp > Date.now());
    if (!u) throw new HttpError(410, 'Reset link is invalid or expired');
    if (!password || String(password).length < 6) throw new HttpError(400, 'Password must be at least 6 characters');
    const h = hashPassword(String(password));
    u.salt = h.salt; u.hash = h.hash; u.reset = null; save();
    sendMail(u.email, 'NRRS password changed', 'Your NRRS password was changed. If this was not you, contact the Ministry immediately.');
    return json(res, 200, { ok: true, message: 'Password updated — you can sign in now.' });
  }

  if (p === '/api/auth/me' && method === 'GET') {
    if (!user) throw new HttpError(401, 'Not authenticated');
    const unread = db.notifications.filter(n => n.userId === user.id && !n.read).length;
    const reservations = db.reservations.filter(r => r.userId === user.id && !r.consumed)
      .map(r => ({ name: r.name, expires: r.expires }));
    const businesses = db.registry.filter(b => b.userId === user.id).map(b => ({
      regNumber: b.regNumber, name: b.name, status: b.status,
      licenses: b.licenses.filter(l => l.status === 'active')
        .map(l => ({ number: l.number, category: l.category, expires: l.expires }))
    }));
    return json(res, 200, { user: publicUser(user), unread, reservations, businesses });
  }

  /* ---------- applicant: applications ---------- */
  if (p === '/api/applications' && method === 'GET') {
    if (!user) throw new HttpError(401, 'Not authenticated');
    const apps = db.applications.filter(a => a.userId === user.id).map(appSummary);
    return json(res, 200, { applications: apps });
  }

  if (p === '/api/applications' && method === 'POST') {
    if (!user) throw new HttpError(401, 'Not authenticated');
    const type = String(body.type || '');
    if (!TYPES[type]) throw new HttpError(400, 'Unknown application type');
    const data = validateApplicationPayload(type, body.data || {}, user);
    const app = {
      id: nextId('app', 'APP'), type, userId: user.id, userEmail: user.email,
      data, status: 'tech_review', chainIndex: -1, result: null,
      events: [], createdAt: new Date().toISOString(), decidedAt: null
    };
    addEvent(app, user, 'Application submitted', '');
    db.applications.unshift(app); save();
    notify(user.id, `Application ${app.id} (${TYPES[type].label}) submitted — awaiting technical review.`);
    sendMail(user.email, `NRRS application received: ${app.id}`,
      `Your ${TYPES[type].label} application ${app.id} is now under technical review. You will be notified when an invoice is ready or a decision is made.`);
    return json(res, 200, { application: appSummary(app) });
  }

  const mApp = p.match(/^\/api\/applications\/([^/]+)$/);
  if (mApp && method === 'GET') {
    if (!user) throw new HttpError(401, 'Not authenticated');
    const app = db.applications.find(a => a.id === mApp[1]);
    if (!app) throw new HttpError(404, 'Application not found');
    if (app.userId !== user.id && user.role === 'applicant') throw new HttpError(403, 'Forbidden');
    const inv = db.invoices.find(i => i.applicationId === app.id) || null;
    const out = { application: app, invoice: inv };
    if (app.type === 'name_search') out.similarity = setNameSimilarity(app.data.names || []);
    return json(res, 200, out);
  }

  /* ---------- invoices & payment ---------- */
  if (p === '/api/invoices' && method === 'GET') {
    if (!user) throw new HttpError(401, 'Not authenticated');
    const invoices = db.invoices.filter(i => i.userId === user.id);
    return json(res, 200, { invoices });
  }

  const mInvPay = p.match(/^\/api\/invoices\/([^/]+)\/pay$/);
  if (mInvPay && method === 'POST') {
    if (!user) throw new HttpError(401, 'Not authenticated');
    const inv = db.invoices.find(i => i.id === mInvPay[1]);
    if (!inv || inv.userId !== user.id) throw new HttpError(404, 'Invoice not found');
    if (inv.status === 'paid') throw new HttpError(409, 'Invoice already paid');
    const method_ = String(body.method || '');
    if (!['zaad', 'edahab'].includes(method_)) throw new HttpError(400, 'Choose ZAAD or eDAHAB');
    const msisdn = String(body.msisdn || '').trim();
    if (!msisdn) throw new HttpError(400, 'Mobile money number is required');

    inv.status = 'paid'; inv.method = method_; inv.msisdn = msisdn; inv.paidAt = new Date().toISOString();
    save();
    const app = db.applications.find(a => a.id === inv.applicationId);
    if (app) {
      addEvent(app, user, `Payment of ${inv.currency} ${inv.total.toFixed(2)} received via ${method_.toUpperCase()} (${msisdn})`, '');
      if (app.type === 'name_search' && (app.data.intent === 'reserve')) {
        db.reservations.push({
          name: app.data.names[0], userId: user.id, invoiceId: inv.id,
          createdAt: new Date().toISOString(),
          expires: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString()
        });
        app.status = 'reserved';
        notify(user.id, `Name "${app.data.names[0]}" reserved for 90 days (until ${new Date(Date.now() + 90 * 24 * 3600 * 1000).toDateString()}).`);
      } else {
        app.chainIndex = -1;
        advance(app); /* enters first post-payment review stage (or issues) */
        if (app.status !== 'issued')
          notify(user.id, `Payment received for ${app.id} — now with ${STAGE_LABEL[app.status] || 'the next reviewer'}.`);
      }
      save();
    }
    sendMail(user.email, 'NRRS payment received',
      `We received ${inv.currency} ${inv.total.toFixed(2)} for ${inv.id} via ${method_.toUpperCase()}. Your application continues to the next approval stage.`);
    return json(res, 200, { ok: true, invoice: inv, application: app ? appSummary(app) : null });
  }

  /* ---------- notifications ---------- */
  if (p === '/api/notifications' && method === 'GET') {
    if (!user) throw new HttpError(401, 'Not authenticated');
    const items = db.notifications.filter(n => n.userId === user.id).slice(0, 30);
    const unread = items.filter(n => !n.read).length;
    return json(res, 200, { notifications: items, unread });
  }
  if (p === '/api/notifications/read' && method === 'POST') {
    if (!user) throw new HttpError(401, 'Not authenticated');
    db.notifications.forEach(n => { if (n.userId === user.id) n.read = true; });
    save();
    return json(res, 200, { ok: true });
  }

  /* ---------- officer console ---------- */
  if (p === '/api/officer/queue' && method === 'GET') {
    officerOnly(user);
    const mine = db.applications.filter(a => STAGE_ROLE[a.status] === user.role);
    const stats = Object.keys(STAGE_LABEL).map(stage => ({
      stage, label: STAGE_LABEL[stage], role: ROLES[STAGE_ROLE[stage]].label,
      count: db.applications.filter(a => a.status === stage).length
    }));
    return json(res, 200, { queue: mine.map(appSummary), stats });
  }

  const mDec = p.match(/^\/api\/officer\/applications\/([^/]+)\/decision$/);
  if (mDec && method === 'POST') {
    officerOnly(user);
    const app = db.applications.find(a => a.id === mDec[1]);
    if (!app) throw new HttpError(404, 'Application not found');
    const needRole = STAGE_ROLE[app.status];
    if (!needRole) throw new HttpError(409, `Application is at stage "${app.status}" — nothing to decide`);
    if (needRole !== user.role) throw new HttpError(403, `This application is assigned to the ${ROLES[needRole].label}`);
    const approve = body.approve === true || body.approve === 'true';
    const comment = String(body.comment || '').trim();

    if (!approve) {
      app.status = 'rejected'; app.decidedAt = new Date().toISOString();
      addEvent(app, user, 'Rejected', comment);
      save();
      notify(app.userId, `${TYPES[app.type].label} ${app.id} was rejected. ${comment || ''}`);
      sendMail(app.userEmail, `NRRS: application ${app.id} rejected`,
        `Your application ${app.id} was rejected. Comment: ${comment || '(none)'} — you may submit a new application.`);
      return json(res, 200, { application: appSummary(app) });
    }

    addEvent(app, user, `Approved — ${STAGE_LABEL[app.status] || app.status}`, comment);

    if (app.status === 'tech_review') {
      if (app.type === 'name_search') {
        const results = (app.data.names || []).map(n => ({
          name: n,
          available: !db.registry.some(b => normName(b.name) === normName(n) && b.status === 'active') &&
                     !activeReservation(n)
        }));
        app.reviewResult = { names: results, approvedAt: new Date().toISOString() };
        if (app.data.intent === 'reserve') {
          const inv = createInvoice(app.id, app.userId, reservationLines());
          app.status = 'awaiting_payment';
          notify(app.userId, `Name search approved for ${app.id}. Invoice ${inv.id} (USD ${inv.total}) is ready — pay to reserve the name for 90 days.`);
          save();
          sendMail(app.userEmail, `NRRS invoice ${inv.id} ready`,
            `Your name reservation invoice ${inv.id} for USD ${inv.total} is ready. Sign in and press Pay Now (ZAAD / eDAHAB).`);
        } else {
          app.status = 'name_cleared';
          notify(app.userId, `Name search approved for ${app.id} — ${results.filter(r => r.available).map(r => '"' + r.name + '"').join(', ') || 'see results'} available. You can now register.`);
          save();
          sendMail(app.userEmail, `NRRS name search approved: ${app.id}`,
            'One of your NGO name options is cleared. Sign in to continue with NGO Registration.');
        }
        return json(res, 200, { application: appSummary(app), invoice: db.invoices.find(i => i.applicationId === app.id) });
      }
      /* registration / license / renewal → issue invoice */
      const lines = app.type === 'registration'
        ? registrationLines(app.data.entityType)
        : licenseLines(app.data.category, app.data.ownership);
      const inv = createInvoice(app.id, app.userId, lines);
      app.status = 'awaiting_payment';
      save();
      notify(app.userId, `Technical review passed for ${app.id}. Invoice ${inv.id} (USD ${inv.total}) is ready for payment.`);
      sendMail(app.userEmail, `NRRS invoice ${inv.id} ready`,
        `Technical review passed. Invoice ${inv.id} for USD ${inv.total} is ready — sign in and press Pay Now (ZAAD / eDAHAB).`);
      return json(res, 200, { application: appSummary(app), invoice: inv });
    }

    /* post-payment chain stage → advance (may issue at the end) */
    advance(app);
    save();
    if (app.status === 'issued')
      notify(app.userId, `${TYPES[app.type].label} APPROVED — your document ${app.result && (app.result.certificate || {}).number || app.result && app.result.licenseNumber || app.result && app.result.regNumber || ''} is ready to download.`);
    else
      notify(app.userId, `${app.id} approved by ${ROLES[user.role].label} — now with ${STAGE_LABEL[app.status]}.`);
    return json(res, 200, { application: appSummary(app) });
  }

  throw new HttpError(404, 'Unknown API endpoint');
}

function publicUser(u) {
  return {
    id: u.id, email: u.email, fullName: u.fullName, role: u.role,
    roleLabel: ROLES[u.role].label, phone: u.phone, nationalId: u.nationalId, verified: u.verified
  };
}
function appSummary(a) {
  const inv = db.invoices.find(i => i.applicationId === a.id) || null;
  return {
    id: a.id, type: a.type, typeLabel: TYPES[a.type].label, status: a.status,
    statusLabel: statusLabel(a), badge: STATUS_BADGE[a.status] || 'gray',
    nameRisk: nameRisk(a),
    createdAt: a.createdAt, decidedAt: a.decidedAt,
    title: a.data.businessName || (a.data.names || []).join(' / ') || a.data.licenseNumber || a.id,
    intent: a.data.intent || null,
    invoice: inv ? { id: inv.id, total: inv.total, currency: inv.currency, status: inv.status } : null,
    result: a.result
  };
}
function statusLabel(a) {
  switch (a.status) {
    case 'submitted': return 'Submitted';
    case 'tech_review': return 'Awaiting technical review';
    case 'awaiting_payment': return 'Awaiting payment';
    case 'name_cleared': return 'Name cleared — proceed to registration';
    case 'reserved': return 'Name reserved (90 days)';
    case 'paid': return 'Paid — queued for review';
    case 'senior_review': return 'With the Senior NGO Officer';
    case 'director_review': return 'With the Director of NGOs';
    case 'ag_review': return 'With the Registrar of NGOs';
    case 'minister_review': return 'With the Minister of Planning';
    case 'issued': return 'Approved — document issued';
    case 'rejected': return 'Rejected';
    default: return a.status;
  }
}

/* ============================== static + routing ======================== */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
};
function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const full = path.normalize(path.join(PUB, rel));
  if (!full.startsWith(PUB)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(full, (err, buf) => {
    if (err) { /* SPA fallback */
      return fs.readFile(path.join(PUB, 'index.html'), (e2, b2) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': MIME['.html'] }); res.end(b2);
      });
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method === 'GET') return serveStatic(req, res, url.pathname);
    res.writeHead(405); res.end('Method not allowed');
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    json(res, status, { error: e.message || 'Server error' });
  }
});

/* ================================= boot ================================= */
loadOrSeed();
server.listen(PORT, HOST, () => {
  console.log('==========================================================');
  console.log('  Somaliland NRRS — local demo running');
  console.log(`  URL:        http://localhost:${PORT}  (bound to ${HOST})`);
  console.log('  Applicant:  applicant@brls.local  / demo123');
  console.log('  Officers:   tech@brls.local senior@brls.local');
  console.log('              director@brls.local ag@brls.local');
  console.log('              minister@brls.local / officer123');
  console.log('  Dev mail:   http://localhost:' + PORT + '/#/mailbox');
  console.log('==========================================================');
});