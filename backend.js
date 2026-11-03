'use strict';
/* =========================================================================
   NRRS — in-browser backend (faithful port of the original Node server.js)
   Runs entirely client-side; all state persists in localStorage under
   'nrrs_db_v1'. Exposes the exact same JSON API contract the SPA expects:
     NRRS_BACKEND.handle(method, path, body, token) -> { status, body }
   Demo only — passwords are hashed (SHA-256 + salt), data never leaves
   the browser.
   ========================================================================= */
var NRRS_BACKEND = (function () {

  /* =============================== storage ============================== */
  var STORAGE_KEY = 'nrrs_db_v1';
  var memoryStore = null; /* fallback when localStorage is unavailable */

  function hasLocalStorage() {
    try { return typeof localStorage !== 'undefined' && localStorage !== null; }
    catch (e) { return false; }
  }
  function save() {
    try {
      var s = JSON.stringify(db);
      if (hasLocalStorage()) localStorage.setItem(STORAGE_KEY, s);
      else memoryStore = s;
    } catch (e) { if (typeof console !== 'undefined') console.error('DB save failed:', e.message); }
  }
  function readStore() {
    try { if (hasLocalStorage()) return localStorage.getItem(STORAGE_KEY); }
    catch (e) { /* ignore */ }
    return memoryStore;
  }

  /* ============================ crypto helpers ========================== */
  var SHA_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  function utf8Bytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        var c2 = str.charCodeAt(++i);
        var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
    return out;
  }
  function sha256Bytes(bytes) {
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var len = bytes.length;
    var withPad = len + 1;
    while (withPad % 64 !== 56) withPad++;
    var total = withPad + 8;
    var msg = new Array(total).fill(0);
    for (var i = 0; i < len; i++) msg[i] = bytes[i];
    msg[len] = 0x80;
    var bitLenHi = Math.floor(len / 0x20000000); /* len * 8 / 2^32 */
    var bitLenLo = (len * 8) >>> 0;
    msg[total - 8] = (bitLenHi >>> 24) & 0xff;
    msg[total - 7] = (bitLenHi >>> 16) & 0xff;
    msg[total - 6] = (bitLenHi >>> 8) & 0xff;
    msg[total - 5] = bitLenHi & 0xff;
    msg[total - 4] = (bitLenLo >>> 24) & 0xff;
    msg[total - 3] = (bitLenLo >>> 16) & 0xff;
    msg[total - 2] = (bitLenLo >>> 8) & 0xff;
    msg[total - 1] = bitLenLo & 0xff;

    var w = new Array(64);
    function rr(v, a) { return (v >>> a) | (v << (32 - a)); }
    for (var off = 0; off < total; off += 64) {
      for (var t = 0; t < 16; t++)
        w[t] = ((msg[off + t * 4] << 24) | (msg[off + t * 4 + 1] << 16) | (msg[off + t * 4 + 2] << 8) | msg[off + t * 4 + 3]) >>> 0;
      for (var t2 = 16; t2 < 64; t2++) {
        var s0 = rr(w[t2 - 15], 7) ^ rr(w[t2 - 15], 18) ^ (w[t2 - 15] >>> 3);
        var s1 = rr(w[t2 - 2], 17) ^ rr(w[t2 - 2], 19) ^ (w[t2 - 2] >>> 10);
        w[t2] = (w[t2 - 16] + s0 + w[t2 - 7] + s1) >>> 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (var t3 = 0; t3 < 64; t3++) {
        var S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var temp1 = (h + S1 + ch + SHA_K[t3] + w[t3]) >>> 0;
        var S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var temp2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + temp1) >>> 0;
        d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    var out = '';
    for (var j = 0; j < 8; j++) out += ('00000000' + H[j].toString(16)).slice(-8);
    return out;
  }
  function sha256hex(str) { return sha256Bytes(utf8Bytes(String(str))); }

  function randomHex(bytes) {
    var a = new Uint8Array(bytes);
    try {
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(a);
      else throw new Error('no webcrypto');
    } catch (e) {
      for (var i = 0; i < bytes; i++) a[i] = Math.floor(Math.random() * 256);
    }
    var s = '';
    for (var j = 0; j < bytes; j++) s += ('0' + a[j].toString(16)).slice(-2);
    return s;
  }

  /* ============================== persistence =========================== */
  var db;
  function freshDb() {
    return {
      users: [], applications: [], invoices: [], emails: [], notifications: [],
      sessions: {}, registry: [], reservations: [],
      counters: { app: 1, inv: 1, reg: 1, cert: 1, lic: 1 }
    };
  }
  function loadOrSeed() {
    var usedSeed = false;
    try { db = JSON.parse(readStore()); if (!db || typeof db !== 'object') throw new Error('bad store'); }
    catch (e) { db = freshDb(); usedSeed = true; }
    if (!db.counters) db.counters = { app: 1, inv: 1, reg: 1, cert: 1, lic: 1 };
    if (!db.sessions) db.sessions = {};
    if (usedSeed) { seedDemo(); save(); }
  }
  function nextId(key, prefix) {
    var n = db.counters[key]++;
    save();
    return prefix + '-2026-' + String(n).padStart(4, '0');
  }
  function uid() { return randomHex(16); }

  /* ============================== domain data =========================== */
  var ROLES = {
    applicant:       { label: 'Applicant' },
    tech_officer:    { label: 'NGO Technical Officer' },
    senior_officer:  { label: 'Senior NGO Officer' },
    director:        { label: 'Director of NGOs' },
    ag:              { label: 'Registrar of NGOs' },
    minister:        { label: 'Minister of Planning & National Development' }
  };
  var STAGE_ROLE = {
    tech_review: 'tech_officer',
    senior_review: 'senior_officer',
    director_review: 'director',
    ag_review: 'ag',
    minister_review: 'minister'
  };
  var STAGE_LABEL = {
    tech_review: 'Technical review',
    senior_review: 'Senior NGO Officer review',
    director_review: 'Director of NGOs review',
    ag_review: 'Registrar of NGOs final review',
    minister_review: 'Minister final review'
  };
  var TYPES = {
    name_search:  { label: 'NGO Name Search & Clearance' },
    registration: { label: 'NGO Registration' },
    license:      { label: 'Operating Permit' },
    renewal:      { label: 'Annual Renewal' }
  };
  /* stage chain AFTER payment (name_search has none: it resolves at payment) */
  var CHAINS = {
    registration: ['senior_review', 'director_review', 'ag_review'],
    license:      ['director_review', 'minister_review'],
    renewal:      ['director_review', 'minister_review'],
    name_search:  []
  };
  var STATUS_BADGE = {
    submitted: 'gray', tech_review: 'blue', awaiting_payment: 'amber',
    name_cleared: 'teal', reserved: 'emerald', paid: 'violet',
    senior_review: 'indigo', director_review: 'indigo', ag_review: 'indigo',
    minister_review: 'indigo', issued: 'green', rejected: 'red'
  };

  /* Operating-permit fee schedule for NGOs (demo, USD).
     Columns: local NGO | locally funded NGO | INGO branch | INGO affiliate */
  var FEE_SCHEDULE = [
    { id: 'wash',           label: 'Water, Sanitation & Hygiene (WASH)', tiers: [100, 150, 400, 600] },
    { id: 'education',      label: 'Education & Training',               tiers: [100, 150, 400, 600] },
    { id: 'health',         label: 'Health & Nutrition',                 tiers: [100, 150, 400, 600] },
    { id: 'humanitarian',   label: 'Humanitarian Relief & Emergency',     tiers: [150, 200, 500, 750] },
    { id: 'food_security',  label: 'Food Security & Livelihoods',        tiers: [100, 150, 400, 600] },
    { id: 'child_protection', label: 'Child Protection & Youth',          tiers: [100, 150, 400, 600] },
    { id: 'women_gender',   label: 'Women & Gender Empowerment',         tiers: [100, 150, 400, 600] },
    { id: 'environment',    label: 'Environment & Climate Action',       tiers: [100, 150, 400, 600] },
    { id: 'governance',     label: 'Human Rights & Governance',          tiers: [150, 200, 500, 750] },
    { id: 'capacity',       label: 'Research & Capacity Building',       tiers: [100, 150, 400, 600] },
    { id: 'culture_sports', label: 'Culture, Arts & Sports',             tiers: [100, 150, 300, 500] },
    { id: 'social_services', label: 'Social Services & Community Development', tiers: [100, 150, 400, 600] }
  ];
  var OWNERSHIP = [
    { id: 'sole_local',           label: 'Local NGO — resident founders' },
    { id: 'partnership_local',    label: 'Local NGO — foreign funded' },
    { id: 'sole_foreign',         label: 'International NGO — branch' },
    { id: 'partnership_foreign',  label: 'International NGO — affiliate' }
  ];
  var ENTITY_TYPES = [
    { id: 'local_ngo',           label: 'Local NGO',                    fee: 150 },
    { id: 'community_org',       label: 'Community-Based Organisation', fee: 100 },
    { id: 'faith_based',         label: 'Faith-Based NGO',              fee: 150 },
    { id: 'international_ngo',   label: 'International NGO (INGO)',     fee: 500 }
  ];
  var RESERVATION_FEE = 50;
  var GOV = { trade: '1140808', stamp: '1140902', admin: '1140821', reg: '1141816' };

  /* NGO registration requirements (demo content adapted for this build) */
  var NGO_REQUIREMENTS = {
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

  var pct = function (a, p) { return Math.max(1, Math.round(a * p * 100) / 100); };
  function licenseLines(categoryId, ownershipId) {
    var cat = FEE_SCHEDULE.find(function (c) { return c.id === categoryId; });
    var idx = ['sole_local', 'partnership_local', 'sole_foreign', 'partnership_foreign'].indexOf(ownershipId);
    var fee = cat.tiers[idx < 0 ? 0 : idx];
    return [
      { desc: 'Operating Permit Fee — ' + cat.label, code: GOV.trade, amount: fee },
      { desc: 'Stamp Duty (2.5%)',  code: GOV.stamp, amount: pct(fee, 0.025) },
      { desc: 'Administration Tax (2%)', code: GOV.admin, amount: pct(fee, 0.02) }
    ];
  }
  function registrationLines(entityId) {
    var e = ENTITY_TYPES.find(function (x) { return x.id === entityId; });
    if (!e) throw httpError(400, 'Unknown entity type');
    return [
      { desc: 'NGO Registration Fee — ' + e.label, code: GOV.reg, amount: e.fee },
      { desc: 'Stamp Duty (2.5%)',  code: GOV.stamp, amount: pct(e.fee, 0.025) },
      { desc: 'Administration Tax (2%)', code: GOV.admin, amount: pct(e.fee, 0.02) }
    ];
  }
  var reservationLines = function () {
    return [{ desc: 'Name Reservation Fee (90 days)', code: GOV.reg, amount: RESERVATION_FEE }];
  };

  /* ================================ helpers ============================= */
  function httpError(status, msg) { var e = new Error(msg); e.status = status; return e; }
  function normName(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function hashPassword(pw, salt) {
    salt = salt || randomHex(16);
    return { salt: salt, hash: sha256hex(salt + ':' + pw) };
  }
  function checkPassword(pw, user) {
    var h = hashPassword(String(pw), user.salt).hash;
    if (h.length !== String(user.hash).length) return false;
    var diff = 0;
    for (var i = 0; i < h.length; i++) diff |= h.charCodeAt(i) ^ user.hash.charCodeAt(i);
    return diff === 0;
  }
  function resetBaseUrl() {
    try {
      if (typeof location !== 'undefined' && location.href) return location.href.split('#')[0];
    } catch (e) { /* ignore */ }
    return 'http://localhost:3000/';
  }
  function sendMail(to, subject, body) {
    db.emails.unshift({ id: uid(), to: to, subject: subject, body: body, at: new Date().toISOString() });
    if (db.emails.length > 200) db.emails.length = 200;
    save();
  }
  function notify(userId, text) {
    db.notifications.unshift({ id: uid(), userId: userId, text: text, at: new Date().toISOString(), read: false });
    if (db.notifications.length > 500) db.notifications.length = 500;
    save();
  }
  function addEvent(app, actor, action, comment) {
    app.events.push({
      at: new Date().toISOString(),
      actor: actor ? actor.fullName : 'System',
      role: actor && actor.role !== 'applicant' ? ROLES[actor.role].label : (actor ? 'Applicant' : 'System'),
      action: action, comment: comment || ''
    });
  }
  function nameTaken(name) {
    var n = normName(name);
    return db.registry.some(function (b) { return normName(b.name) === n && b.status === 'active'; });
  }
  function activeReservation(name, userId) {
    var n = normName(name);
    var now = Date.now();
    return db.reservations.find(function (r) {
      return normName(r.name) === n && new Date(r.expires).getTime() > now &&
        (userId === undefined || r.userId === userId);
    });
  }

  /* ------------------------ close-name analysis -------------------------- */
  function tokenise(s) {
    return String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(function (w) { return w.length > 1; });
  }
  function editDistance(a, b) {
    if (a === b) return 0;
    var m = a.length, n = b.length;
    if (!m || !n) return m || n;
    var prev = Array.from({ length: n + 1 }, function (_, j) { return j; });
    for (var i = 1; i <= m; i++) {
      var cur = [i];
      for (var j = 1; j <= n; j++)
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  function wordsClose(x, y) {
    if (x === y) return true;
    var min = Math.min(x.length, y.length);
    if (min < 4) return false;
    return editDistance(x, y) <= (min >= 6 ? 2 : 1);
  }
  /* Compare submitted NGO name options against registered NGOs and live reservations. */
  function setNameSimilarity(names) {
    var targets = [];
    for (var i = 0; i < db.registry.length; i++) {
      var b = db.registry[i];
      if (b.status === 'active') targets.push({ name: b.name, kind: 'registered NGO', number: b.regNumber });
    }
    var now = Date.now();
    for (var r0 = 0; r0 < db.reservations.length; r0++) {
      var rr0 = db.reservations[r0];
      if (!rr0.consumed && new Date(rr0.expires).getTime() > now)
        targets.push({ name: rr0.name, kind: 'reserved name', number: '' });
    }

    return (names || []).map(function (name) {
      var sub = tokenise(name);
      var norm = normName(name);
      var matches = [];
      for (var t = 0; t < targets.length; t++) {
        var tg = targets[t];
        var reg = tokenise(tg.name);
        var used = new Array(reg.length).fill(false);
        var hit = [], missed = [];
        for (var w = 0; w < sub.length; w++) {
          var word = sub[w];
          var idx = reg.findIndex(function (r, i2) { return !used[i2] && r === word; });
          if (idx < 0) idx = reg.findIndex(function (r, i2) { return !used[i2] && wordsClose(word, r); });
          if (idx >= 0) { used[idx] = true; hit.push(word); } else missed.push(word);
        }
        var matchedWords = hit.length;
        var score = Math.round((matchedWords / Math.max(sub.length, reg.length)) * 100) / 100;
        var exact = normName(tg.name) === norm;
        if (exact || (matchedWords > 0 && (score >= 0.5 || matchedWords >= 2)))
          matches.push({
            registered: tg.name, kind: tg.kind, number: tg.number,
            matchedWords: matchedWords, totalWords: sub.length, matched: hit, missing: missed,
            score: score, exact: exact,
            sentence: exact
              ? '"' + name + '" is identical to ' + tg.kind + ' "' + tg.name + '"'
              : matchedWords + ' of ' + sub.length + ' submitted words are close to ' + tg.kind + ' "' + tg.name + '"'
          });
      }
      matches.sort(function (x, y) { return (y.exact - x.exact) || (y.score - x.score); });
      return { name: name, exactDuplicate: matches.some(function (m) { return m.exact; }), matches: matches.slice(0, 3) };
    });
  }
  function nameRisk(a) {
    if (!a || a.type !== 'name_search') return false;
    return setNameSimilarity((a.data && a.data.names) || []).some(function (r) {
      return r.exactDuplicate || r.matches.length > 0;
    });
  }

  /* ============================== seed demo data ========================= */
  function seedDemo() {
    /* demo data models an NGO registry, not businesses */
    var mkUser = function (email, fullName, role, pw) {
      var h = hashPassword(pw || 'officer123');
      var u = {
        id: uid(), email: email, fullName: fullName, role: role, salt: h.salt, hash: h.hash, verified: true,
        phone: '+252 63 000 0000', nationalId: 'SL-' + randomHex(4).toUpperCase(),
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

    var pw = hashPassword('demo123');
    db.users.push({
      id: uid(), email: 'applicant@brls.local', fullName: 'Amina Yusuf', role: 'applicant',
      salt: pw.salt, hash: pw.hash, verified: true, phone: '+252 63 444 1234',
      nationalId: 'SL-0987654', createdAt: new Date().toISOString(), fcmToken: null
    });

    var owner = db.users.find(function (u) { return u.email === 'applicant@brls.local'; });
    var issued = new Date();
    var exp = new Date(issued.getFullYear() + 1, issued.getMonth(), issued.getDate());
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
        issuedOn: issued.toISOString(), verifyCode: 'V' + randomHex(5).toUpperCase()
      },
      licenses: [{
        number: 'MoPND/P/2026-0001', category: 'education', ownership: 'sole_local',
        issuedOn: issued.toISOString(), expires: exp.toISOString(), status: 'active',
        verifyCode: 'V' + randomHex(5).toUpperCase()
      }]
    });
    /* keep counters ahead of the hard-coded seed numbers */
    db.counters.reg = 2; db.counters.cert = 2; db.counters.lic = 2; db.counters.app = 1; db.counters.inv = 1;
  }

  /* ================================ sessions ============================ */
  function makeSession(userId) {
    var token = randomHex(24);
    db.sessions[token] = { userId: userId, createdAt: Date.now(), exp: Date.now() + 12 * 3600 * 1000 };
    save();
    return token;
  }
  function authUser(token) {
    if (!token) return null;
    var s = db.sessions[token];
    if (!s || s.exp < Date.now()) { if (s) { delete db.sessions[token]; save(); } return null; }
    var u = db.users.find(function (x) { return x.id === s.userId; });
    return u || null;
  }
  function officerOnly(user) {
    if (!user) throw httpError(401, 'Not authenticated');
    if (user.role === 'applicant') throw httpError(403, 'Officer access only');
  }

  /* ========================== workflow engine =========================== */
  function createInvoice(applicationId, userId, lines) {
    var inv = {
      id: nextId('inv', 'INV'), applicationId: applicationId, userId: userId,
      lines: lines.map(function (l) { return Object.assign({}, l, { amount: Number(l.amount) }); }),
      total: Math.round(lines.reduce(function (s, l) { return s + Number(l.amount); }, 0) * 100) / 100,
      currency: 'USD', status: 'unpaid', method: null, msisdn: null,
      createdAt: new Date().toISOString(), paidAt: null
    };
    db.invoices.unshift(inv);
    save();
    return inv;
  }
  function advance(app) {
    var chain = CHAINS[app.type];
    if (app.chainIndex == null) app.chainIndex = -1;
    app.chainIndex++;
    if (app.chainIndex >= chain.length) { issue(app); return; }
    app.status = chain[app.chainIndex];
  }
  function issue(app, actor) {
    var now = new Date().toISOString();
    if (app.type === 'registration') {
      var regNumber = nextId('reg', 'SL-NGO');
      var certNo = nextId('cert', 'NGO/C');
      var entry = {
        regNumber: regNumber, name: app.data.businessName, entityType: app.data.entityType,
        address: app.data.address, activities: app.data.activities || [], owners: app.data.owners || [],
        userId: app.userId, status: 'active', issuedOn: now,
        certificate: {
          number: certNo, type: 'Certificate of Registration', issuedOn: now,
          verifyCode: 'V' + randomHex(5).toUpperCase()
        },
        licenses: []
      };
      db.registry.push(entry);
      /* consume name reservation, if any */
      var res = db.reservations.find(function (r) {
        return normName(r.name) === normName(app.data.businessName) && r.userId === app.userId;
      });
      if (res) { res.consumed = true; }
      app.result = { regNumber: regNumber, certificate: entry.certificate };
      addEvent(app, actor, 'Certificate of Registration issued: ' + certNo, '');
    } else {
      var business = db.registry.find(function (b) { return b.regNumber === app.data.regNumber; });
      if (!business) throw httpError(409, 'Registered NGO not found for permit issuance');
      var licNo = nextId('lic', 'MoPND/P');
      var issued = new Date();
      if (app.type === 'renewal') {
        var old = business.licenses.find(function (l) { return l.number === app.data.licenseNumber && l.status === 'active'; });
        var base = old ? new Date(old.expires) : issued;
        var from = base.getTime() > issued.getTime() ? base : issued;
        var exp = new Date(from.getFullYear() + 1, from.getMonth(), from.getDate());
        if (old) old.status = 'renewed';
        var verifyCode = 'V' + randomHex(5).toUpperCase();
        business.licenses.push({
          number: licNo, category: app.data.category, ownership: app.data.ownership,
          issuedOn: now, expires: exp.toISOString(), status: 'active',
          verifyCode: verifyCode, renewalOf: app.data.licenseNumber
        });
        app.result = { licenseNumber: licNo, expires: exp.toISOString(), verifyCode: verifyCode };
        addEvent(app, actor, 'Operating permit renewed: ' + licNo + ' (valid to ' + exp.toDateString() + ')', '');
      } else {
        var exp2 = new Date(issued.getFullYear() + 1, issued.getMonth(), issued.getDate());
        var verifyCode2 = 'V' + randomHex(5).toUpperCase();
        business.licenses.push({
          number: licNo, category: app.data.category, ownership: app.data.ownership,
          issuedOn: now, expires: exp2.toISOString(), status: 'active',
          verifyCode: verifyCode2
        });
        app.result = { licenseNumber: licNo, expires: exp2.toISOString(), verifyCode: verifyCode2 };
        addEvent(app, actor, 'Operating permit issued: ' + licNo + ' (valid to ' + exp2.toDateString() + ')', '');
      }
    }
    app.status = 'issued';
    app.decidedAt = now;
    save();
    notify(app.userId, TYPES[app.type].label + ' — approved. Your document was issued (application ' + app.id + ').');
    sendMail(app.userEmail, 'NRRS: ' + TYPES[app.type].label + ' approved',
      'Your application ' + app.id + ' has been approved and the document issued. Sign in to download it.');
  }

  function validateApplicationPayload(type, data, user) {
    var require_ = function (v, msg) { if (!v || !String(v).trim()) throw httpError(400, msg); return String(v).trim(); };
    if (type === 'name_search') {
      var names = (data.names || []).map(function (s) { return String(s || '').trim(); }).filter(Boolean);
      if (names.length < 1) throw httpError(400, 'Provide at least one NGO name option');
      if (names.length > 3) throw httpError(400, 'A maximum of three name options is allowed');
      return {
        names: names, intent: data.intent === 'reserve' ? 'reserve' : 'register',
        notes: String(data.notes || '')
      };
    }
    if (type === 'registration') {
      var businessName = require_(data.businessName, 'NGO name is required');
      if (nameTaken(businessName) && !activeReservation(businessName, user.id))
        throw httpError(409, '"' + businessName + '" is already registered. Run a name search and reserve it first.');
      var entityType = require_(data.entityType, 'Organisation type is required');
      if (!ENTITY_TYPES.some(function (e) { return e.id === entityType; })) throw httpError(400, 'Unknown organisation type');
      var owners = (data.owners || []).filter(function (o) { return o && o.name && o.nationalId; });
      if (!owners.length) throw httpError(400, 'At least one founder / board member (name + national ID) is required');
      return {
        businessName: businessName, entityType: entityType,
        address: require_(data.address, 'Registered address is required'),
        phone: String(data.phone || ''), email: String(data.email || user.email),
        activities: String(data.activities || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean),
        owners: owners.map(function (o) { return { name: String(o.name), nationalId: String(o.nationalId), share: Number(o.share) || 0 }; }),
        nameSource: data.nameSource || (activeReservation(businessName, user.id) ? 'reservation' : 'straight')
      };
    }
    if (type === 'license' || type === 'renewal') {
      if (type === 'license') {
        var regNumber = require_(data.regNumber, 'Registered NGO (registration number) is required');
        var b = db.registry.find(function (x) { return x.regNumber === regNumber; });
        if (!b) throw httpError(409, 'No registered NGO matches that registration number');
        var category = require_(data.category, 'Programme sector is required');
        if (!FEE_SCHEDULE.some(function (c) { return c.id === category; })) throw httpError(400, 'Unknown programme sector');
        var ownership = require_(data.ownership, 'Registration class is required');
        if (!OWNERSHIP.some(function (o) { return o.id === ownership; })) throw httpError(400, 'Unknown registration class');
        return {
          regNumber: regNumber, businessName: b.name, category: category, ownership: ownership,
          tin: String(data.tin || ''), premises: String(data.premises || b.address || ''),
          plateCount: Number(data.plateCount) || 0
        };
      }
      var licenseNumber = require_(data.licenseNumber, 'Active operating permit number is required');
      var found = null;
      for (var i = 0; i < db.registry.length && !found; i++) {
        var bb = db.registry[i];
        var l = bb.licenses.find(function (x) { return x.number === licenseNumber && x.status === 'active'; });
        if (l) found = { b: bb, l: l };
      }
      if (!found) throw httpError(409, 'No active operating permit matches that number');
      if (type === 'renewal' && !String(data.tin || '').trim())
        throw httpError(400, 'TIN / tax reference is mandatory for renewal');
      return {
        licenseNumber: licenseNumber, regNumber: found.b.regNumber, businessName: found.b.name,
        category: found.l.category, ownership: found.l.ownership,
        tin: String(data.tin || ''), premises: String(data.premises || ''),
        notes: String(data.notes || '')
      };
    }
    throw httpError(400, 'Unknown application type');
  }

  /* ============================ API handlers =========================== */
  function publicUser(u) {
    return {
      id: u.id, email: u.email, fullName: u.fullName, role: u.role,
      roleLabel: ROLES[u.role].label, phone: u.phone, nationalId: u.nationalId, verified: u.verified
    };
  }
  function appSummary(a) {
    var inv = db.invoices.find(function (i) { return i.applicationId === a.id; }) || null;
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

  function ok(obj) { return { status: 200, body: obj }; }

  function dispatch(method, path, body, token) {
    var url;
    try { url = new URL(path, 'http://nrrs.local'); }
    catch (e) { return { status: 400, body: { error: 'Bad request' } }; }
    var p = url.pathname;
    var q = url.searchParams;
    var user = authUser(token);

    /* ---------- public ---------- */
    if (method === 'GET' && p === '/api/fees')
      return ok({
        schedule: FEE_SCHEDULE, ownership: OWNERSHIP, entities: ENTITY_TYPES,
        reservationFee: RESERVATION_FEE, currency: 'USD',
        notes: ['Stamp Duty 2.5% and Administration Tax 2% are added to permit and registration fees.',
                'Demo operating-permit fee schedule for NGOs (USD).']
      });

    if (method === 'GET' && p === '/api/requirements')
      return ok({ requirements: NGO_REQUIREMENTS });

    if (method === 'GET' && p === '/api/public/search') {
      var term = normName(q.get('q') || '');
      if (!term) return ok({ results: [] });
      var results = db.registry
        .filter(function (b) { return normName(b.name).includes(term) || normName(b.regNumber).includes(term); })
        .map(function (b) {
          return {
            name: b.name, regNumber: b.regNumber, status: b.status, entityType: b.entityType,
            issuedOn: b.issuedOn, activities: b.activities,
            licenses: b.licenses.map(function (l) { return { number: l.number, category: l.category, expires: l.expires, status: l.status }; })
          };
        });
      return ok({ results: results });
    }

    if (method === 'GET' && p === '/api/public/verify') {
      var n = String(q.get('number') || '').trim();
      if (!n) return { status: 400, body: { ok: false, message: 'Enter a document number' } };
      var nn = normName(n);
      for (var i = 0; i < db.registry.length; i++) {
        var b = db.registry[i];
        if (normName(b.regNumber) === nn) return ok({
          ok: true, kind: 'registration', title: 'NGO Registration (Certificate of Registration)',
          number: b.regNumber, holder: b.name, issuedOn: b.issuedOn, status: b.status,
          verifyCode: b.certificate.verifyCode, detail: 'Entity type: ' + (b.entityType || 'n/a')
        });
        if (b.certificate && (normName(b.certificate.number) === nn ||
            (b.certificate.verifyCode && normName(b.certificate.verifyCode) === nn)))
          return ok({
            ok: true, kind: 'certificate', title: b.certificate.type,
            number: b.certificate.number, holder: b.name, issuedOn: b.certificate.issuedOn,
            status: 'Digitally signed — valid', verifyCode: b.certificate.verifyCode,
            detail: 'Registry number: ' + b.regNumber
          });
        for (var li = 0; li < b.licenses.length; li++) {
          var l = b.licenses[li];
          if (normName(l.number) === nn || (l.verifyCode && normName(l.verifyCode) === nn)) {
            var cat = FEE_SCHEDULE.find(function (c) { return c.id === l.category; });
            var expired = new Date(l.expires).getTime() < Date.now();
            return ok({
              ok: true, kind: 'license', title: 'Operating Permit',
              number: l.number, holder: b.name, issuedOn: l.issuedOn,
              status: expired ? 'EXPIRED' : (l.status === 'renewed' ? 'Superseded (renewed)' : 'Valid until ' + new Date(l.expires).toDateString()),
              verifyCode: l.verifyCode, detail: 'Category: ' + (cat ? cat.label : l.category)
            });
          }
        }
      }
      return { status: 404, body: { ok: false, message: 'No document matches that number' } };
    }

    if (method === 'GET' && p === '/api/dev/emails')
      return ok({ emails: db.emails.slice(0, 50) });

    /* ---------- auth ---------- */
    if (p === '/api/auth/register' && method === 'POST') {
      var fullName = body.fullName, email = body.email, phone = body.phone,
          nationalId = body.nationalId, password = body.password;
      if (!fullName || !email || !phone || !password) throw httpError(400, 'Name, e-mail, phone and password are required');
      if (String(password).length < 6) throw httpError(400, 'Password must be at least 6 characters');
      if (db.users.some(function (u) { return u.email.toLowerCase() === String(email).toLowerCase(); }))
        throw httpError(409, 'An account with that e-mail already exists');
      var h = hashPassword(String(password));
      var u = {
        id: uid(), email: String(email).toLowerCase(), fullName: String(fullName), role: 'applicant',
        phone: String(phone || ''), nationalId: String(nationalId || ''),
        salt: h.salt, hash: h.hash, verified: true, otp: null, createdAt: new Date().toISOString(), fcmToken: null
      };
      db.users.push(u); save();
      notify(u.id, 'Welcome to NRRS! Your account was created — start with a Name Search.');
      sendMail(u.email, 'Welcome to NRRS',
        'Hello ' + u.fullName + ', your NRRS account was created for ' + u.email + '. Sign in anytime with your password.');
      return ok({ ok: true, token: makeSession(u.id), user: publicUser(u) });
    }

    if (p === '/api/auth/login' && method === 'POST') {
      var lu = db.users.find(function (x) { return x.email === String(body.email || '').toLowerCase().trim(); });
      if (!lu || !checkPassword(String(body.password || ''), lu)) throw httpError(401, 'Invalid e-mail or password');
      return ok({ ok: true, token: makeSession(lu.id), user: publicUser(lu) });
    }

    if (p === '/api/auth/forgot' && method === 'POST') {
      var fu = db.users.find(function (x) { return x.email === String(body.email || '').toLowerCase(); });
      if (fu) {
        var token2 = randomHex(16);
        fu.reset = { token: token2, exp: Date.now() + 30 * 60 * 1000 }; save();
        sendMail(fu.email, 'NRRS password reset',
          'Reset your password: ' + resetBaseUrl() + '#/reset/' + token2 + '\nThis link expires in 30 minutes.');
      }
      /* do not reveal whether the account exists */
      return ok({ ok: true, message: 'If that e-mail exists, a reset link was sent (see #/mailbox).' });
    }

    if (p === '/api/auth/reset' && method === 'POST') {
      var ru = db.users.find(function (x) { return x.reset && x.reset.token === body.token && x.reset.exp > Date.now(); });
      if (!ru) throw httpError(410, 'Reset link is invalid or expired');
      if (!body.password || String(body.password).length < 6) throw httpError(400, 'Password must be at least 6 characters');
      var rh = hashPassword(String(body.password));
      ru.salt = rh.salt; ru.hash = rh.hash; ru.reset = null; save();
      sendMail(ru.email, 'NRRS password changed', 'Your NRRS password was changed. If this was not you, contact the Ministry immediately.');
      return ok({ ok: true, message: 'Password updated — you can sign in now.' });
    }

    if (p === '/api/auth/me' && method === 'GET') {
      if (!user) throw httpError(401, 'Not authenticated');
      var unread = db.notifications.filter(function (n) { return n.userId === user.id && !n.read; }).length;
      var reservations = db.reservations.filter(function (r) { return r.userId === user.id && !r.consumed; })
        .map(function (r) { return { name: r.name, expires: r.expires }; });
      var businesses = db.registry.filter(function (b) { return b.userId === user.id; }).map(function (b) {
        return {
          regNumber: b.regNumber, name: b.name, status: b.status,
          licenses: b.licenses.filter(function (l) { return l.status === 'active'; })
            .map(function (l) { return { number: l.number, category: l.category, expires: l.expires }; })
        };
      });
      return ok({ user: publicUser(user), unread: unread, reservations: reservations, businesses: businesses });
    }

    /* ---------- applicant: applications ---------- */
    if (p === '/api/applications' && method === 'GET') {
      if (!user) throw httpError(401, 'Not authenticated');
      var apps = db.applications.filter(function (a) { return a.userId === user.id; }).map(appSummary);
      return ok({ applications: apps });
    }

    if (p === '/api/applications' && method === 'POST') {
      if (!user) throw httpError(401, 'Not authenticated');
      var type = String(body.type || '');
      if (!TYPES[type]) throw httpError(400, 'Unknown application type');
      var data = validateApplicationPayload(type, body.data || {}, user);
      var app = {
        id: nextId('app', 'APP'), type: type, userId: user.id, userEmail: user.email,
        data: data, status: 'tech_review', chainIndex: -1, result: null,
        events: [], createdAt: new Date().toISOString(), decidedAt: null
      };
      addEvent(app, user, 'Application submitted', '');
      db.applications.unshift(app); save();
      notify(user.id, 'Application ' + app.id + ' (' + TYPES[type].label + ') submitted — awaiting technical review.');
      sendMail(user.email, 'NRRS application received: ' + app.id,
        'Your ' + TYPES[type].label + ' application ' + app.id + ' is now under technical review. You will be notified when an invoice is ready or a decision is made.');
      return ok({ application: appSummary(app) });
    }

    var mApp = p.match(/^\/api\/applications\/([^/]+)$/);
    if (mApp && method === 'GET') {
      if (!user) throw httpError(401, 'Not authenticated');
      var appD = db.applications.find(function (a) { return a.id === mApp[1]; });
      if (!appD) throw httpError(404, 'Application not found');
      if (appD.userId !== user.id && user.role === 'applicant') throw httpError(403, 'Forbidden');
      var invD = db.invoices.find(function (i) { return i.applicationId === appD.id; }) || null;
      var out = {
        application: Object.assign({}, appD, { badge: STATUS_BADGE[appD.status] || 'gray' }),
        invoice: invD
      };
      if (appD.type === 'name_search') out.similarity = setNameSimilarity(appD.data.names || []);
      return ok(out);
    }

    /* ---------- invoices & payment ---------- */
    if (p === '/api/invoices' && method === 'GET') {
      if (!user) throw httpError(401, 'Not authenticated');
      var invoices = db.invoices.filter(function (i) { return i.userId === user.id; });
      return ok({ invoices: invoices });
    }

    var mInvPay = p.match(/^\/api\/invoices\/([^/]+)\/pay$/);
    if (mInvPay && method === 'POST') {
      if (!user) throw httpError(401, 'Not authenticated');
      var inv = db.invoices.find(function (i) { return i.id === mInvPay[1]; });
      if (!inv || inv.userId !== user.id) throw httpError(404, 'Invoice not found');
      if (inv.status === 'paid') throw httpError(409, 'Invoice already paid');
      var method_ = String(body.method || '');
      if (!['zaad', 'edahab'].includes(method_)) throw httpError(400, 'Choose ZAAD or eDAHAB');
      var msisdn = String(body.msisdn || '').trim();
      if (!msisdn) throw httpError(400, 'Mobile money number is required');

      inv.status = 'paid'; inv.method = method_; inv.msisdn = msisdn; inv.paidAt = new Date().toISOString();
      save();
      var appP = db.applications.find(function (a) { return a.id === inv.applicationId; });
      if (appP) {
        addEvent(appP, user, 'Payment of ' + inv.currency + ' ' + inv.total.toFixed(2) + ' received via ' + method_.toUpperCase() + ' (' + msisdn + ')', '');
        if (appP.type === 'name_search' && (appP.data.intent === 'reserve')) {
          db.reservations.push({
            name: appP.data.names[0], userId: user.id, invoiceId: inv.id,
            createdAt: new Date().toISOString(),
            expires: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString()
          });
          appP.status = 'reserved';
          notify(user.id, 'Name "' + appP.data.names[0] + '" reserved for 90 days (until ' + new Date(Date.now() + 90 * 24 * 3600 * 1000).toDateString() + ').');
        } else {
          appP.chainIndex = -1;
          advance(appP); /* enters first post-payment review stage (or issues) */
          if (appP.status !== 'issued')
            notify(user.id, 'Payment received for ' + appP.id + ' — now with ' + (STAGE_LABEL[appP.status] || 'the next reviewer') + '.');
        }
        save();
      }
      sendMail(user.email, 'NRRS payment received',
        'We received ' + inv.currency + ' ' + inv.total.toFixed(2) + ' for ' + inv.id + ' via ' + method_.toUpperCase() + '. Your application continues to the next approval stage.');
      return ok({ ok: true, invoice: inv, application: appP ? appSummary(appP) : null });
    }

    /* ---------- notifications ---------- */
    if (p === '/api/notifications' && method === 'GET') {
      if (!user) throw httpError(401, 'Not authenticated');
      var items = db.notifications.filter(function (n) { return n.userId === user.id; }).slice(0, 30);
      var unreadN = items.filter(function (n) { return !n.read; }).length;
      return ok({ notifications: items, unread: unreadN });
    }
    if (p === '/api/notifications/read' && method === 'POST') {
      if (!user) throw httpError(401, 'Not authenticated');
      db.notifications.forEach(function (n) { if (n.userId === user.id) n.read = true; });
      save();
      return ok({ ok: true });
    }

    /* ---------- officer console ---------- */
    if (p === '/api/officer/queue' && method === 'GET') {
      officerOnly(user);
      var mine = db.applications.filter(function (a) { return STAGE_ROLE[a.status] === user.role; });
      var stats = Object.keys(STAGE_LABEL).map(function (stage) {
        return {
          stage: stage, label: STAGE_LABEL[stage], role: ROLES[STAGE_ROLE[stage]].label,
          count: db.applications.filter(function (a) { return a.status === stage; }).length
        };
      });
      return ok({ queue: mine.map(appSummary), stats: stats });
    }

    var mDec = p.match(/^\/api\/officer\/applications\/([^/]+)\/decision$/);
    if (mDec && method === 'POST') {
      officerOnly(user);
      var appO = db.applications.find(function (a) { return a.id === mDec[1]; });
      if (!appO) throw httpError(404, 'Application not found');
      var needRole = STAGE_ROLE[appO.status];
      if (!needRole) throw httpError(409, 'Application is at stage "' + appO.status + '" — nothing to decide');
      if (needRole !== user.role) throw httpError(403, 'This application is assigned to the ' + ROLES[needRole].label);
      var approve = body.approve === true || body.approve === 'true';
      var comment = String(body.comment || '').trim();

      if (!approve) {
        appO.status = 'rejected'; appO.decidedAt = new Date().toISOString();
        addEvent(appO, user, 'Rejected', comment);
        save();
        notify(appO.userId, TYPES[appO.type].label + ' ' + appO.id + ' was rejected. ' + (comment || ''));
        sendMail(appO.userEmail, 'NRRS: application ' + appO.id + ' rejected',
          'Your application ' + appO.id + ' was rejected. Comment: ' + (comment || '(none)') + ' — you may submit a new application.');
        return ok({ application: appSummary(appO) });
      }

      addEvent(appO, user, 'Approved — ' + (STAGE_LABEL[appO.status] || appO.status), comment);

      if (appO.status === 'tech_review') {
        if (appO.type === 'name_search') {
          var results2 = (appO.data.names || []).map(function (nm) {
            return {
              name: nm,
              available: !db.registry.some(function (b) { return normName(b.name) === normName(nm) && b.status === 'active'; }) &&
                         !activeReservation(nm)
            };
          });
          appO.reviewResult = { names: results2, approvedAt: new Date().toISOString() };
          if (appO.data.intent === 'reserve') {
            var invR = createInvoice(appO.id, appO.userId, reservationLines());
            appO.status = 'awaiting_payment';
            notify(appO.userId, 'Name search approved for ' + appO.id + '. Invoice ' + invR.id + ' (USD ' + invR.total + ') is ready — pay to reserve the name for 90 days.');
            save();
            sendMail(appO.userEmail, 'NRRS invoice ' + invR.id + ' ready',
              'Your name reservation invoice ' + invR.id + ' for USD ' + invR.total + ' is ready. Sign in and press Pay Now (ZAAD / eDAHAB).');
          } else {
            appO.status = 'name_cleared';
            notify(appO.userId, 'Name search approved for ' + appO.id + ' — ' + (results2.filter(function (r) { return r.available; }).map(function (r) { return '"' + r.name + '"'; }).join(', ') || 'see results') + ' available. You can now register.');
            save();
            sendMail(appO.userEmail, 'NRRS name search approved: ' + appO.id,
              'One of your NGO name options is cleared. Sign in to continue with NGO Registration.');
          }
          return ok({ application: appSummary(appO), invoice: db.invoices.find(function (i) { return i.applicationId === appO.id; }) });
        }
        /* registration / license / renewal → issue invoice */
        var lines = appO.type === 'registration'
          ? registrationLines(appO.data.entityType)
          : licenseLines(appO.data.category, appO.data.ownership);
        var invT = createInvoice(appO.id, appO.userId, lines);
        appO.status = 'awaiting_payment';
        save();
        notify(appO.userId, 'Technical review passed for ' + appO.id + '. Invoice ' + invT.id + ' (USD ' + invT.total + ') is ready for payment.');
        sendMail(appO.userEmail, 'NRRS invoice ' + invT.id + ' ready',
          'Technical review passed. Invoice ' + invT.id + ' for USD ' + invT.total + ' is ready — sign in and press Pay Now (ZAAD / eDAHAB).');
        return ok({ application: appSummary(appO), invoice: invT });
      }

      /* post-payment chain stage → advance (may issue at the end) */
      advance(appO);
      save();
      if (appO.status === 'issued')
        notify(appO.userId, TYPES[appO.type].label + ' APPROVED — your document ' +
          ((appO.result && appO.result.certificate && appO.result.certificate.number) ||
           (appO.result && appO.result.licenseNumber) ||
           (appO.result && appO.result.regNumber) || '') + ' is ready to download.');
      else
        notify(appO.userId, appO.id + ' approved by ' + ROLES[user.role].label + ' — now with ' + STAGE_LABEL[appO.status] + '.');
      return ok({ application: appSummary(appO) });
    }

    throw httpError(404, 'Unknown API endpoint');
  }

  /* ============================== entry point =========================== */
  function handle(method, path, body, token) {
    try {
      return dispatch(String(method || 'GET').toUpperCase(), path, body || {}, token || null);
    } catch (e) {
      var status = e && e.status ? e.status : 500;
      if (status === 500 && typeof console !== 'undefined') console.error(e);
      return { status: status, body: { error: (e && e.message) || 'Server error' } };
    }
  }

  loadOrSeed();

  return {
    handle: handle,
    /* exposed for tests / debugging */
    _sha256hex: sha256hex,
    _db: function () { return db; },
    _reset: function () { db = freshDb(); seedDemo(); save(); }
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = NRRS_BACKEND;
