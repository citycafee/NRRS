'use strict';
/* ============================ NRRS SPA (local) ============================ */
const TOKEN_KEY = 'brls_token';
const S = { token: localStorage.getItem(TOKEN_KEY) || null, me: null, unread: 0, reservations: [], businesses: [] };

const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const appEl = () => document.getElementById('app');

function esc(v) {
  const AMP = String.fromCharCode(38); /* "&" built at runtime to keep source simple */
  const ENT = { "&": "amp", "<": "lt", ">": "gt", "\"": "quot", "'": "#x27" };
  return String(v == null ? "" : v).replace(/[&<>"']/g, c => AMP + ENT[c] + ";");
}
function fmtDate(v) { return v ? new Date(v).toLocaleString() : '—'; }
function fmtDay(v)  { return v ? new Date(v).toLocaleDateString() : '—'; }
function money(n)   { return 'USD ' + Number(n).toFixed(2); }
function go(h) { location.hash = h; }

async function api(path, opts = {}) {
  /* The whole backend runs in the browser (backend.js) — no network calls.
     Same contract as the original server: { status, body } with body.error on failure. */
  const r = NRRS_BACKEND.handle(opts.method || 'GET', path, opts.body, S.token);
  if (r.status >= 400) {
    const err = new Error((r.body && (r.body.error || r.body.message)) || 'Request failed');
    err.status = r.status;
    throw err;
  }
  return r.body;
}
function setToken(t) {
  S.token = t;
  if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY);
}
function toast(msg, kind) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || '');
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .4s'; }, 3400);
  setTimeout(() => el.remove(), 3900);
}
function closeModal() { $('#modal-root').innerHTML = ''; }
function openModal(html) {
  $('#modal-root').innerHTML = `<div class="overlay" data-close="1"><div class="modal" onclick="event.stopPropagation()">${html}</div></div>`;
  $('#modal-root .overlay').addEventListener('click', e => { if (e.target.dataset.close) closeModal(); });
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

async function loadMe() {
  if (!S.token) { S.me = null; S.unread = 0; renderHeader(); return; }
  try {
    const d = await api('/api/auth/me');
    S.me = d.user; S.unread = d.unread;
    S.reservations = d.reservations || []; S.businesses = d.businesses || [];
  } catch (e) { setToken(null); S.me = null; S.unread = 0; }
  renderHeader();
}
function isOfficer() { return S.me && S.me.role !== 'applicant'; }

/* =============================== header ================================= */
async function renderHeader() {
  const right = $('#topbar-right');
  if (!S.me) {
    right.innerHTML = `<a class="btn-ghost" href="#/register">Register</a>
      <button class="btn" onclick="go('#/login')" style="padding:8px 16px">Login</button>`;
  } else {
    const officerBtn = isOfficer()
      ? `<a class="btn-ghost" href="#/officer">Officer console</a>`
      : `<a class="btn-ghost" href="#/dashboard">Dashboard</a>`;
    right.innerHTML = `
      ${officerBtn}
      <button class="bell" id="bellBtn" title="Notifications">&#128276;${S.unread ? `<span class="dot">${S.unread}</span>` : ''}</button>
      <span class="userchip"><span class="avatar">${esc((S.me.fullName || '?').slice(0, 1).toUpperCase())}</span><span>${esc(S.me.fullName)}</span></span>
      <button class="btn-ghost" id="logoutBtn">Logout</button>
      <div id="notifMount"></div>`;
    $('#logoutBtn').onclick = () => { setToken(null); S.me = null; renderHeader(); toast('Signed out'); go('#/'); };
    $('#bellBtn').onclick = toggleNotifications;
  }
  const path = '/' + (location.hash.replace(/^#\/?/, '').split('?')[0].split('/')[0]);
  $$('#nav-main > a').forEach(a => a.classList.toggle('active',
    (a.dataset.nav === '/' ? path === '/' : path === a.dataset.nav)));
  const drop = $('#navServices');
  if (drop) {
    const btn = drop.querySelector('.nav-drop-btn');
    btn.classList.toggle('active', path === '/apply');
    btn.setAttribute('aria-expanded', 'false');
    btn.onclick = e => {
      e.stopPropagation();
      drop.classList.toggle('open');
      btn.setAttribute('aria-expanded', drop.classList.contains('open'));
    };
  }
  const mob = $('#nav-mobile');
  mob.innerHTML = $$('#nav-main > a').map(a => a.outerHTML).join('')
    + `<span class="mob-section">Services</span>`
    + $$('#navServices .nav-sub a').map(a => a.outerHTML).join('');
  $$('#nav-mobile a').forEach(a => {
    a.classList.toggle('active', (a.dataset.nav || '').length > 0 &&
      (a.dataset.nav === '/' ? path === '/' : path === a.dataset.nav));
    a.setAttribute('onclick', "document.getElementById('nav-mobile').hidden=true");
  });
}
document.addEventListener('click', () => $$('.nav-drop.open').forEach(d => {
  d.classList.remove('open');
  const b = d.querySelector('.nav-drop-btn');
  if (b) b.setAttribute('aria-expanded', 'false');
}));
function toggleNotifications() {
  const mount = $('#notifMount');
  if (mount.dataset.open === '1') { mount.innerHTML = ''; mount.dataset.open = '0'; return; }
  api('/api/notifications').then(d => {
    mount.dataset.open = '1';
    mount.innerHTML = `<div class="notif-panel">${d.notifications.length
      ? d.notifications.map(n => `<div class="n ${n.read ? '' : 'unread'}">${esc(n.text)}<div class="time">${fmtDate(n.at)}</div></div>`).join('')
      : '<div class="n muted">No notifications yet</div>'}</div>`;
    if (d.unread) api('/api/notifications/read', { method: 'POST' }).then(() => { S.unread = 0; renderHeader(); });
  }).catch(e => toast(e.message, 'err'));
}
$('#burger').onclick = () => { const m = $('#nav-mobile'); m.hidden = !m.hidden; };

/* =============================== router ================================= */
window.addEventListener('hashchange', route);
window.addEventListener('load', async () => { await loadMe(); route(); });

async function route() {
  renderHeader();
  const raw = location.hash.replace(/^#\/?/, '');
  const [pathPart, queryPart] = raw.split('?');
  const seg = pathPart.split('/').filter(Boolean);
  const q = new URLSearchParams(queryPart || '');
  const root = seg[0] || '';
  const el = appEl();
  try {
    switch (root) {
      case '':          return await pageHome(el);
      case 'login':     return await pageLogin(el);
      case 'register':  return await pageRegister(el);
      case 'forgot':    return await pageForgot(el);
      case 'reset':     return await pageReset(el, seg[1]);
      case 'dashboard': return await pageDashboard(el);
      case 'apply':     return await pageApply(el, seg[1], q);
      case 'app':       return await pageApp(el, seg[1]);
      case 'cert':      return await pageCert(el, seg[1]);
      case 'officer':   return await pageOfficer(el);
      case 'search':    return await pageSearch(el, q.get('q') || '');
      case 'verify':    return await pageVerify(el, q.get('number') || '');
      case 'requirements': return await pageRequirements(el);
      case 'fees':      return await pageRequirements(el);
      case 'mailbox':   return await pageMailbox(el);
      default:          el.innerHTML = notFound();
    }
  } catch (e) {
    if (e.status === 401) { setToken(null); S.me = null; renderHeader(); toast('Session expired — please sign in', 'err'); go('#/login'); return; }
    el.innerHTML = `<div class="card center"><h1>Something went wrong</h1><p class="sub">${esc(e.message)}</p>
      <button class="btn sec" onclick="route()">Retry</button></div>`;
  }
}
function notFound() {
  return `<div class="card center"><div style="font-size:40px">404</div>
    <h1>Page not found</h1><p class="sub">You seem to have landed on a restricted area of the system.</p>
    <a class="btn" href="#/">Back home</a></div>`;
}
function requireLogin() {
  if (!S.me) { toast('Please sign in first', 'err'); go('#/login'); return false; }
  return true;
}

/* ============================== NGO steps ================================ */
const NGO_STEPS = [
  { tag: 'Step 1', title: 'Name Search and Portal Signup',
    summary: 'Search MoPND records for an available NGO name, then create your official administrator profile on the MoPND digital portal or the Aid Coordination Portal.',
    items: [
      ['Name Availability Check', 'Search the Ministry of Planning and National Development (MoPND) records to ensure your proposed NGO name is unique, appropriate, and does not conflict with existing registered organizations.'],
      ['Portal Account Creation', 'Once your organization name is cleared, create an official administrator profile on the Somaliland MoPND digital portal or the Aid Coordination Portal.']
    ] },
  { tag: 'Step 2', title: 'Full NGO Registration',
    summary: 'Submit your constitution, board CVs, IDs and office proof, plus a one-year work plan — MoPND issues your Certificate of Registration under Law No. 43/2010.',
    items: [
      ['Document Submission', "Upload your organization's constitution or bylaws, executive board members' CVs, national ID/passport copies, and proof of a physical office address in Somaliland."],
      ['Operational Planning', 'Submit a detailed one-year work plan mapping out your target sectors (e.g., water, education, health), projected budget, and verified funding sources.'],
      ['Certificate Issuance', 'International NGOs (INGOs) must additionally provide home-country registration and background checks. Once MoPND approves the application under Law No. 43/2010, your official Certificate of Registration is issued.']
    ] },
  { tag: 'Step 3', title: 'Annual Renewal and Compliance',
    summary: 'Report yearly performance, provide an independent financial audit, and submit the next 12-month work plan with renewal fees to keep your certificate valid.',
    items: [
      ['Performance Reporting', 'Submit a comprehensive annual progress report detailing project achievements, locations served, and community impact from the previous year.'],
      ['Financial Auditing', 'Provide an independent financial audit report accounting for all funds received and utilized during the operational cycle.'],
      ['Subsequent Work Plan', 'Upload your updated budget and strategic work plan for the upcoming 12 months, and clear the required administrative renewal fees to receive your valid operational certificate.']
    ] }
];
function openNgoStep(i) {
  const s = NGO_STEPS[i];
  if (!s) return;
  openModal(`<span class="tag mdl-tag">${esc(s.tag)}</span><h3>${esc(s.title)}</h3>
    <ul class="step-detail">${s.items.map(it => `<li><b>${esc(it[0])}:</b> ${esc(it[1])}</li>`).join('')}</ul>
    <div class="btnrow"><button class="btn sec" onclick="closeModal()">Close</button></div>`);
}
function ngoStepCards() {
  return NGO_STEPS.map((s, i) => `
      <div class="lp-step clickable" onclick="openNgoStep(${i})">
        <span class="tag">${esc(s.tag)}</span><h3>${esc(s.title)}</h3>
        <p>${esc(s.summary)}</p>
        <a class="more" href="#" onclick="event.preventDefault();event.stopPropagation();openNgoStep(${i})">Learn More</a>
      </div>`).join('');
}

/* ================================ HOME ================================== */
async function pageHome(el) {
  el.innerHTML = `
    <section class="hero">
      <div style="position:relative;z-index:1">
        <img class="hero-mot" src="assets/logo-motit.png" alt="Government of Somaliland" />
        <h1>Registering NGOs Made Easier</h1>
        <p class="lp-kicker">NGO Registration and Renewing System(NRRS)</p>
        <p>A unified system for NGO registration and renewal in Somaliland —
        name search and clearance, NGO registration, operating permits, annual renewals,
        online invoices and ZAAD / eDAHAB payment.</p>
        <div class="btnrow">
          <a class="btn btn-y" href="#/register">Register Now</a>
          <a class="btn btn-blue" href="#/search">CLICK TO RUN AN NGO SEARCH</a>
          <a class="btn sec" href="#/login">LOGIN</a>
        </div>
      </div>
      <img class="hero-logo" src="assets/logo-brls.png" alt="NRRS" />
    </section>

    <div class="lp-band">
      <h2>A unified system for NGO registration and renewing services in Somaliland</h2>
      <a class="btn" href="#/search">CLICK TO RUN AN NGO SEARCH</a>
    </div>

    <h2>How to register NGO</h2>
    <div class="lp-steps">${ngoStepCards()}</div>

    <h2>Services</h2>
    <div class="grid g4">
      ${svcCard('NS', 'Name Search', 'Search and clear NGO names (up to 3 options).', '#/apply/name_search')}
      ${svcCard('NG', 'NGO Registration', 'Register a local or international NGO.', '#/apply/registration')}
      ${svcCard('OP', 'Operating Permit', 'Apply for an NGO operating permit.', '#/apply/license')}
      ${svcCard('RN', 'Annual Renewal', 'Renew before expiry to stay compliant.', '#/apply/renewal')}
    </div>

    <div class="grid g3 mt2">
      <div class="card"><h3>Approval workflow</h3>
        <p class="muted">Technical review → invoice & payment → Senior NGO Officer →
        Director of NGOs → Registrar of NGOs (registration) or Minister of Planning & National
        Development (permits and renewals).</p></div>
      <div class="card"><h3>Payments</h3>
        <p class="muted">After approval an invoice is issued. Pay online from your dashboard with
        <b>ZAAD</b> or <b>eDAHAB</b> mobile money — 24/7.</p></div>
      <div class="card"><h3>Legal basis</h3>
        <p class="muted">Law No. 43/2010 (registration and renewing of NGOs) — supervised by the
        Ministry of Planning and National Development (MoPND) through the NGO Affairs desk,
        with annual reporting and independent financial audit.</p></div>
    </div>

    <h2>Useful Links & Contacts</h2>
    <div class="lp-links">
      <div class="card"><h3 class="mt0">Useful Links</h3>
        <ul>
          <li><a href="https://www.govsomaliland.org/" target="_blank" rel="noopener">Somaliland Government</a></li>
          <li><a href="https://mott.govsomaliland.org/" target="_blank" rel="noopener">Ministry of Trade &amp; Tourism</a></li>
          <li><a href="https://mfa.govsomaliland.org/" target="_blank" rel="noopener">Ministry of Foreign Affairs</a></li>
          <li><a href="https://mopnd.govsomaliland.org/" target="_blank" rel="noopener">Ministry of Planning & National Development (MoPND)</a></li>
          <li><a href="https://mofd.govsomaliland.org/" target="_blank" rel="noopener">Ministry of Finance</a></li>
        </ul>
      </div>
      <div class="card lp-contacts"><h3 class="mt0">Contacts</h3>
        <div class="kvline"><span>Phone</span><b>+252 520616 | +252 300505</b></div>
        <div class="kvline"><span>Xogsiiye</span><b>9444</b></div>
        <div class="kvline"><span>E-mail</span><b>info.mott@sldgov.org</b></div>
        <div class="kvline"><span>Address</span><b>Behind Presidency Office, 26 June Avenue, Hargeisa, Somaliland</b></div>
        <div class="lp-social">
          <a href="https://www.facebook.com/Somaliland-Government-Web-Portal-103520081522660" target="_blank" rel="noopener">Facebook</a>
          <a href="https://twitter.com/GovernmentWeb" target="_blank" rel="noopener">Twitter</a>
          <a href="https://www.youtube.com/channel/UCjEklrYXvMthLi06cEU4WZQ/" target="_blank" rel="noopener">Youtube</a>
          <a href="https://www.instagram.com/govsomaliland/" target="_blank" rel="noopener">Instagram</a>
        </div>
      </div>
    </div>`;
}
function svcCard(tag, title, text, href) {
  return `<a class="svc" href="${href}" style="color:inherit;text-decoration:none">
    <div class="ico">${tag}</div><h3>${title}</h3><p>${text}</p>
    <b style="color:#078019;font-size:13.5px">Open service →</b></a>`;
}

/* ================================ AUTH ================================== */
async function pageLogin(el) {
  el.innerHTML = `
    <div class="authwrap">
      <div class="card">
        <h1>Sign in</h1><p class="sub">Applicant & officer access</p>
        <form id="loginForm">
          <label>E-mail</label><input id="email" type="email" required autocomplete="username" />
          <label>Password</label><input id="password" type="password" required autocomplete="current-password" />
          <div class="flex mt2">
            <button class="btn" type="submit">Sign in</button>
            <a href="#/forgot" class="hint">Forgot password?</a>
          </div>
        </form>
        <label>Demo accounts — click to fill</label>
        <div class="demo-chips">
          <span class="chip" data-e="applicant@brls.local" data-p="demo123">applicant@brls.local / demo123</span>
          <span class="chip" data-e="tech@brls.local" data-p="officer123">tech@ (NGO Technical Officer)</span>
          <span class="chip" data-e="senior@nrrs.local" data-p="officer123">senior@nrrs.local (Senior NGO Officer)</span>
          <span class="chip" data-e="director@brls.local" data-p="officer123">director@</span>
          <span class="chip" data-e="ag@nrrs.local" data-p="officer123">ag@nrrs.local (Registrar of NGOs)</span>
          <span class="chip" data-e="minister@nrrs.local" data-p="officer123">minister@nrrs.local (Minister)</span>
        </div>
        <p class="hint mt2">No account yet? <a href="#/register"><b>Create your NGO portal account</b></a></p>
      </div>
      <div class="auth-art">
        <h2 style="margin-top:0">Somaliland NRRS</h2>
        <p>With one account you can:</p>
        <ul>
          <li>Search & clear NGO names</li>
          <li>Register an NGO online</li>
          <li>Apply for operating permits and annual renewals</li>
          <li>Pay invoices via ZAAD / eDAHAB</li>
          <li>Download digitally signed documents</li>
        </ul>
        <p class="hint" style="color:#c9f2d1">Guided demo: full workflow from application to
        MoPND Certificate of Registration, entirely local.</p>
      </div>
    </div>`;
  $$('.chip').forEach(c => c.onclick = () => { $('#email').value = c.dataset.e; $('#password').value = c.dataset.p; });
  $('#loginForm').onsubmit = async e => {
    e.preventDefault();
    try {
      const d = await api('/api/auth/login', { method: 'POST', body: { email: $('#email').value, password: $('#password').value } });
      setToken(d.token); await loadMe(); toast('Welcome back, ' + d.user.fullName);
      go(d.user.role === 'applicant' ? '#/dashboard' : '#/officer');
    } catch (err) { toast(err.message, 'err'); }
  };
}

async function pageRegister(el) {
  el.innerHTML = `
    <div class="authwrap">
      <div class="card">
        <h1>Create your NGO portal account</h1>
        <p class="sub">Fill your details below — your account is created instantly and you are
        signed in automatically.</p>
        <form id="regForm">
          <label>Full name</label><input id="fullName" required placeholder="e.g. Amina Yusuf" />
          <div class="row">
            <div><label>E-mail</label><input id="email" type="email" required placeholder="you@example.com" /></div>
            <div><label>Phone (ZAAD / eDAHAB)</label><input id="phone" required placeholder="+252 63 ..." /></div>
          </div>
          <div class="row">
            <div><label>National ID / Passport (optional)</label><input id="nationalId" placeholder="SL-..." /></div>
            <div><label>Password (min 6 chars)</label><input id="password" type="password" required minlength="6" /></div>
          </div>
          <button class="btn mt2" type="submit">Create account & continue</button>
        </form>
        <p class="hint mt2">Already registered? <a href="#/login"><b>Sign in</b></a></p>
      </div>
      <div class="auth-art">
        <h2 style="margin-top:0">No verification codes</h2>
        <p>Registration is instant in this build:</p>
        <ul>
          <li>Enter e-mail + phone</li>
          <li>Choose a password</li>
          <li>You land straight in your dashboard</li>
        </ul>
        <p class="hint" style="color:#c9f2d1">Then: name search → registration → payment →
        approvals → Certificate of Registration.</p>
      </div>
    </div>`;
  $('#regForm').onsubmit = async e => {
    e.preventDefault();
    try {
      const d = await api('/api/auth/register', {
        method: 'POST',
        body: {
          fullName: $('#fullName').value, email: $('#email').value, phone: $('#phone').value,
          nationalId: $('#nationalId').value, password: $('#password').value
        }
      });
      setToken(d.token); await loadMe();
      toast('Account created — welcome to NRRS');
      go('#/dashboard');
    } catch (err) { toast(err.message, 'err'); }
  };
}

async function pageForgot(el) {
  el.innerHTML = `<div class="formbox card">
    <h1>Forgot password</h1><p class="sub">We will email you a reset link (local demo).</p>
    <form id="f"><label>E-mail</label><input id="email" type="email" required />
    <button class="btn mt2" type="submit">Send reset link</button></form>
    <p class="hint mt2"><a href="#/login">Back to login</a></p></div>`;
  $('#f').onsubmit = async e => {
    e.preventDefault();
    try { const d = await api('/api/auth/forgot', { method: 'POST', body: { email: $('#email').value } }); toast(d.message); }
    catch (err) { toast(err.message, 'err'); }
  };
}

async function pageReset(el, token) {
  el.innerHTML = `<div class="formbox card">
    <h1>Reset password</h1><p class="sub">Token: <span class="pill">${esc(token || 'missing')}</span></p>
    <form id="f"><label>New password</label><input id="password" type="password" required minlength="6" />
    <button class="btn mt2" type="submit">Update password</button></form></div>`;
  $('#f').onsubmit = async e => {
    e.preventDefault();
    try { const d = await api('/api/auth/reset', { method: 'POST', body: { token, password: $('#password').value } }); toast(d.message); go('#/login'); }
    catch (err) { toast(err.message, 'err'); }
  };
}

/* ============================== DASHBOARD =============================== */
async function pageDashboard(el) {
  if (!requireLogin()) return;
  if (isOfficer()) { go('#/officer'); return; }
  const [a, i, n] = await Promise.all([
    api('/api/applications'), api('/api/invoices'), api('/api/notifications')
  ]);
  const inProgress = a.applications.filter(x => !['issued', 'rejected'].includes(x.status)).length;
  const due = i.invoices.filter(x => x.status === 'unpaid');
  const issued = a.applications.filter(x => x.status === 'issued').length;
  const reserved = S.reservations || [];

  el.innerHTML = `
    <div class="spread">
      <div><h1>Welcome, ${esc(S.me.fullName)}</h1>
      <p class="sub">Applicant dashboard — everything you apply for appears here.</p></div>
      <div class="flex"><a class="btn" href="#/apply/name_search">+ New application</a></div>
    </div>

    <div class="grid g4">
      <div class="stat"><div class="v">${inProgress}</div><div class="l">In progress</div></div>
      <div class="stat"><div class="v">${due.length}</div><div class="l">Invoices to pay</div></div>
      <div class="stat"><div class="v">${issued}</div><div class="l">Documents issued</div></div>
      <div class="stat"><div class="v">${reserved.length}</div><div class="l">Reserved names</div></div>
    </div>

    <div class="grid g4 mt2">
      ${svcCard('NS', 'Name Search', 'Check & clear NGO names.', '#/apply/name_search')}
      ${svcCard('NG', 'Register an NGO', 'Certificate of Registration.', '#/apply/registration')}
      ${svcCard('OP', 'Operating permit', 'NGO operating permit.', '#/apply/license')}
      ${svcCard('RN', 'Annual renewal', 'Extend an active permit.', '#/apply/renewal')}
    </div>

    ${reserved.length ? `<h2>Your name reservations</h2><div class="card"><table class="tbl">
      <tr><th>Name</th><th>Reserved until</th><th></th></tr>
      ${reserved.map(r => `<tr><td><b>${esc(r.name)}</b></td><td>${fmtDay(r.expires)}</td>
        <td class="right"><a class="btn sm" href="#/apply/registration?name=${encodeURIComponent(r.name)}">Use in registration</a></td></tr>`).join('')}
    </table></div>` : ''}

    ${(S.businesses || []).length ? `<h2>My registered NGOs</h2><div class="card"><table class="tbl">
      <tr><th>NGO</th><th>Reg. number</th><th>Active permits</th><th></th></tr>
      ${S.businesses.map(b => `<tr><td><b>${esc(b.name)}</b></td><td class="pill">${esc(b.regNumber)}</td>
        <td>${(b.licenses || []).map(l => esc(l.number)).join('<br>') || '—'}</td>
        <td class="right"><a class="btn sm sec" href="#/apply/license?reg=${encodeURIComponent(b.regNumber)}">New permit</a>
        ${(b.licenses || []).length ? `<a class="btn sm" href="#/apply/renewal?lic=${encodeURIComponent(b.licenses[0].number)}">Renew</a>` : ''}</td></tr>`).join('')}
    </table></div>` : ''}

    <div class="spread"><h2>Your applications</h2><span class="pill">${a.applications.length} total</span></div>
    <div class="card">${a.applications.length ? `<table class="tbl">
      <tr><th>ID</th><th>Service</th><th>Subject</th><th>Status</th><th>Invoice</th><th>Submitted</th></tr>
      ${a.applications.map(x => `<tr class="clickable" onclick="go('#/app/${x.id}')">
        <td><b>${x.id}</b></td><td>${esc(x.typeLabel)}</td><td>${esc(x.title)}</td>
        <td><span class="badge b-${x.badge}">${esc(x.statusLabel)}</span></td>
        <td>${x.invoice ? `${x.invoice.id} <span class="badge b-${x.invoice.status === 'paid' ? 'green' : 'amber'}">${x.invoice.status}</span>` : '—'}</td>
        <td>${fmtDay(x.createdAt)}</td></tr>`).join('')}
    </table>` : `<div class="empty"><div class="ico">[]</div>No applications yet — start with a <a href="#/apply/name_search"><b>name search</b></a>.</div>`}</div>

    <h2>Invoices</h2>
    <div class="card">${i.invoices.length ? `<table class="tbl">
      <tr><th>Invoice</th><th>Application</th><th class="num">Amount</th><th>Status</th><th></th></tr>
      ${i.invoices.map(v => `<tr><td><b>${v.id}</b></td><td><a href="#/app/${v.applicationId}">${v.applicationId}</a></td>
        <td class="num">${money(v.total)}</td>
        <td><span class="badge b-${v.status === 'paid' ? 'green' : 'amber'}">${v.status === 'paid' ? 'Paid via ' + String(v.method || '').toUpperCase() : 'Unpaid'}</span></td>
        <td class="right">${v.status === 'unpaid'
          ? `<button class="btn sm amber" onclick="payModal('${v.id}')">Pay now</button>`
          : `<a class="btn sm sec" href="#/app/${v.applicationId}">View</a>`}</td></tr>`).join('')}
    </table>` : `<div class="empty">No invoices yet — they appear after officer approval.</div>`}</div>

    <h2>Notifications</h2>
    <div class="card">${n.notifications.length ? n.notifications.map(x => `
      <div class="kvline"><span>${esc(x.text)}</span><span class="muted">${fmtDate(x.at)}</span></div>`).join('')
      : '<div class="empty muted">No notifications</div>'}</div>`;
}

/* ============================== APPLY FORMS ============================= */
async function pageApply(el, type, q) {
  if (!requireLogin()) return;
  if (isOfficer()) { toast('Officer accounts cannot submit applications', 'err'); go('#/officer'); return; }
  const types = { name_search: 'NGO Name Search & Clearance', registration: 'NGO Registration', license: 'Operating Permit', renewal: 'Annual Renewal' };
  if (!types[type]) return el.innerHTML = notFound();
  let fees = null;
  if (type === 'license' || type === 'registration') fees = await api('/api/fees');

  let body = '';
  if (type === 'name_search') {
    const pre = q.get('name') || '';
    body = `
      <p class="sub">Provide up to <b>three NGO name options</b>. Officers verify availability against
      the NGO registry of MoPND.</p>
      <label>Option 1 (preferred)</label><input id="n1" required value="${esc(pre)}" />
      <label>Option 2</label><input id="n2" />
      <label>Option 3</label><input id="n3" />
      <label>What do you want to do next?</label>
      <select id="intent">
        <option value="register">Proceed to NGO registration once cleared (free search)</option>
        <option value="reserve">Reserve the first name for 90 days (invoice: ${money(50)})</option>
      </select>
      <label>Notes (optional)</label><textarea id="notes"></textarea>`;
  } else if (type === 'registration') {
    const pre = q.get('name') || '';
    body = `
      <p class="sub">Organisation details. The NGO name must be free or reserved by you.</p>
      <label>NGO name</label><input id="businessName" required value="${esc(pre)}" />
      <div class="row">
        <div><label>Organisation type</label><select id="entityType" required>
          ${fees.entities.map(e => `<option value="${e.id}">${esc(e.label)} — registration ${money(e.fee)}</option>`).join('')}
        </select></div>
        <div><label>Phone</label><input id="phone" value="${esc(S.me.phone || '')}" /></div>
      </div>
      <label>Registered office address</label><input id="address" required placeholder="Street, city" />
      <label>Target sectors (comma separated)</label><input id="activities" placeholder="Water, education, health, ..." />
      <label>Founders / board members</label>
      <div id="owners">
        <div class="row3 owner-row" style="margin-bottom:8px">
          <input class="o-name" placeholder="Full name" required />
          <input class="o-id" placeholder="National ID" required />
          <input class="o-share" type="number" min="0" max="100" placeholder="Voting share %" value="100" />
        </div>
      </div>
      <button class="btn sec sm" type="button" id="addOwner">+ Add board member</button>`;
  } else if (type === 'license') {
    const myRegs = (S.businesses || []);
    const pre = q.get('reg') || '';
    body = `
      <p class="sub">An operating permit is issued to a <b>registered NGO</b>. Fees follow the
      NRRS schedule (permit fee + 2.5% stamp duty + 2% administration tax).</p>
      ${myRegs.length ? `<label>Your registered NGOs</label><select id="regNumber">
          <option value="">— select —</option>
          ${myRegs.map(b => `<option value="${esc(b.regNumber)}" ${pre === b.regNumber ? 'selected' : ''}>${esc(b.name)} (${esc(b.regNumber)})</option>`).join('')}
        </select>
        <p class="hint">Or enter any registration number manually below.</p>` : ''}
      <label>Registration number</label><input id="regNumberInput" value="${esc(pre)}" placeholder="SL-NGO-2026-0001" />
      <div class="row">
        <div><label>Programme sector</label><select id="category" required>
          ${fees.schedule.map(c => `<option value="${c.id}">${esc(c.label)}</option>`).join('')}
        </select></div>
        <div><label>Registration class</label><select id="ownership" required>
          ${fees.ownership.map(o => `<option value="${o.id}">${esc(o.label)}</option>`).join('')}
        </select></div>
      </div>
      <div class="row">
        <div><label>TIN (optional for new permit)</label><input id="tin" /></div>
        <div><label>Office address</label><input id="premises" /></div>
      </div>
      <div class="invoice-box mt2" id="feePreview"></div>`;
  } else { /* renewal */
    const lics = [];
    (S.businesses || []).forEach(b => (b.licenses || []).forEach(l => lics.push({ ...l, biz: b.name })));
    const pre = q.get('lic') || '';
    body = `
      <p class="sub">Renew an <b>active</b> operating permit with your annual performance report,
      audited accounts and next-year work plan. TIN is mandatory for renewal. Late renewal
      (more than one month after expiry) attracts penalties.</p>
      ${lics.length ? `<label>Active permits</label><select id="licenseNumber">
          <option value="">— select —</option>
          ${lics.map(l => `<option value="${esc(l.number)}" ${pre === l.number ? 'selected' : ''}>${esc(l.number)} — ${esc(l.biz)}</option>`).join('')}
        </select>` : ''}
      <label>Operating permit number</label><input id="licenseNumberInput" value="${esc(pre)}" placeholder="MoPND/P/2026-0001" />
      <label>TIN (required for renewal)</label><input id="tin" required placeholder="TIN..." />
      <label>Office address</label><input id="premises" />
      <label>Annual report notes</label><textarea id="notes"></textarea>`;
  }

  el.innerHTML = `
    <div class="flex noprint" style="margin-bottom:14px">
      <a class="btn sec sm" href="#/dashboard">← Dashboard</a><span class="pill">${esc(types[type])}</span>
    </div>
    <div class="formbox wide card">
      <h1>${esc(types[type])}</h1>
      <form id="applyForm">${body}
        <div class="flex mt2">
          <button class="btn" type="submit">Submit application</button>
          <button class="btn sec" type="button" onclick="history.back()">Cancel</button>
        </div>
      </form>
    </div>`;

  if (type === 'registration') {
    $('#addOwner').onclick = () => {
      const div = document.createElement('div');
      div.className = 'row3 owner-row';
      div.style.marginBottom = '8px';
      div.innerHTML = `<input class="o-name" placeholder="Full name" required />
        <input class="o-id" placeholder="National ID" required />
        <input class="o-share" type="number" min="0" max="100" placeholder="Voting share %" />`;
      $('#owners').appendChild(div);
    };
  }
  if (type === 'license') {
    const regSel = $('#regNumber');
    const updateFee = () => {
      const reg = (regSel && regSel.value) || $('#regNumberInput').value;
      const cat = $('#category').value, own = $('#ownership').value;
      const c = fees.schedule.find(x => x.id === cat);
      const idx = ['sole_local', 'partnership_local', 'sole_foreign', 'partnership_foreign'].indexOf(own);
      const fee = c.tiers[idx < 0 ? 0 : idx];
      const stamp = Math.max(1, Math.round(fee * 0.025 * 100) / 100), admin = Math.max(1, Math.round(fee * 0.02 * 100) / 100);
      $('#feePreview').innerHTML = `<b>Fee preview</b>
        <div class="kvline"><span>Operating Permit Fee — ${esc(c.label)}</span><b>${money(fee)}</b></div>
        <div class="kvline"><span>Stamp Duty (2.5%)</span><b>${money(stamp)}</b></div>
        <div class="kvline"><span>Administration Tax (2%)</span><b>${money(admin)}</b></div>
        <div class="totals"><span>Estimated invoice total</span><span>${money(fee + stamp + admin)}</span></div>
        <p class="hint">Organisation: ${esc(reg || '—')}</p>`;
    };
    ['#category', '#ownership', '#regNumberInput'].forEach(s => $(s).addEventListener('change', updateFee));
    if (regSel) { regSel.addEventListener('change', () => { $('#regNumberInput').value = regSel.value; updateFee(); }); if (regSel.value) $('#regNumberInput').value = regSel.value; }
    updateFee();
  }

  $('#applyForm').onsubmit = async e => {
    e.preventDefault();
    let data = {};
    try {
      if (type === 'name_search') {
        data = { names: [$('#n1'), $('#n2'), $('#n3')].map(x => x.value.trim()).filter(Boolean), intent: $('#intent').value, notes: $('#notes').value };
      } else if (type === 'registration') {
        const owners = $$('#owners .owner-row').map(r => ({
          name: r.querySelector('.o-name').value, nationalId: r.querySelector('.o-id').value, share: Number(r.querySelector('.o-share').value) || 0
        }));
        data = {
          businessName: $('#businessName').value, entityType: $('#entityType').value,
          address: $('#address').value, phone: $('#phone').value, email: S.me.email,
          activities: $('#activities').value, owners
        };
      } else if (type === 'license') {
        const regSel = $('#regNumber');
        data = {
          regNumber: (regSel && regSel.value) || $('#regNumberInput').value,
          category: $('#category').value, ownership: $('#ownership').value,
          tin: $('#tin').value, premises: $('#premises').value, plateCount: 0
        };
      } else {
        const licSel = $('#licenseNumber');
        data = {
          licenseNumber: (licSel && licSel.value) || $('#licenseNumberInput').value,
          tin: $('#tin').value, premises: $('#premises').value, notes: $('#notes').value
        };
      }
      const d = await api('/api/applications', { method: 'POST', body: { type, data } });
      toast('Application ' + d.application.id + ' submitted');
      go('#/app/' + d.application.id);
    } catch (err) { toast(err.message, 'err'); }
  };
}

/* =========================== APPLICATION DETAIL ========================= */
async function pageApp(el, id) {
  if (!requireLogin()) return;
  const d = await api('/api/applications/' + encodeURIComponent(id));
  const a = d.application, inv = d.invoice, sim = d.similarity || null;
  const mine = S.me.role === 'applicant' && a.userId === S.me.id;

  const dataRows = [
    ['Type', TYPES_LABEL(a.type)], ['Status', statusText(a)], ['Submitted', fmtDate(a.createdAt)]
  ];
  const dsrc = a.data || {};
  if (dsrc.businessName) dataRows.push(['NGO name', dsrc.businessName]);
  if (dsrc.names) dataRows.push(['Name options', dsrc.names.map((n, i) => (i + 1) + '. ' + esc(n)).join('<br>')]);
  if (dsrc.intent) dataRows.push(['Requested outcome', dsrc.intent === 'reserve' ? 'Reserve name for 90 days' : 'Proceed to NGO registration']);
  if (dsrc.notes) dataRows.push(['Applicant notes', esc(dsrc.notes)]);
  if (dsrc.entityType) dataRows.push(['Organisation type', dsrc.entityType]);
  if (dsrc.address) dataRows.push(['Office address', dsrc.address]);
  if (dsrc.activities) dataRows.push(['Target sectors', dsrc.activities.join(', ')]);
  if (dsrc.owners) dataRows.push(['Founders / board members', dsrc.owners.map(o => `${esc(o.name)} (${esc(o.nationalId)}) — ${o.share}%`).join('<br>')]);
  if (dsrc.regNumber) dataRows.push(['Registration no.', dsrc.regNumber]);
  if (dsrc.licenseNumber) dataRows.push(['Permit being renewed', dsrc.licenseNumber]);
  if (dsrc.category) dataRows.push(['Programme sector', dsrc.category]);
  if (dsrc.ownership) dataRows.push(['Registration class', dsrc.ownership]);
  if (dsrc.tin) dataRows.push(['TIN', dsrc.tin]);
  if (dsrc.premises) dataRows.push(['Office address', dsrc.premises]);
  if (a.reviewResult) dataRows.push(['Officer name check', a.reviewResult.names.map(n =>
    `${esc(n.name)} — <span class="badge b-${n.available ? 'green' : 'red'}">${n.available ? 'AVAILABLE' : 'TAKEN'}</span>`).join('<br>')]);
  if (a.result && a.result.regNumber) dataRows.push(['Issued reg. number', a.result.regNumber]);
  if (a.result && a.result.licenseNumber) dataRows.push(['Issued permit', a.result.licenseNumber + ' (to ' + fmtDay(a.result.expires) + ')']);
  if (a.result && a.result.certificate) dataRows.push(['Certificate number', a.result.certificate.number]);

  let invoiceHtml = '<div class="empty muted">No invoice generated yet.</div>';
  if (inv) {
    invoiceHtml = `
      <table class="tbl">
        <tr><th>Description</th><th>Revenue code</th><th class="num">Amount</th></tr>
        ${inv.lines.map(l => `<tr><td>${esc(l.desc)}</td><td class="pill">${esc(l.code)}</td><td class="num">${money(l.amount)}</td></tr>`).join('')}
      </table>
      <div class="totals"><span>Total (${inv.id})</span><span>${money(inv.total)}</span></div>
      <div class="spread mt1">
        <span class="badge b-${inv.status === 'paid' ? 'green' : 'amber'}">${inv.status === 'paid'
          ? `Paid ${inv.method ? inv.method.toUpperCase() : ''} · ${fmtDate(inv.paidAt)}` : 'Awaiting payment'}</span>
        ${inv.status === 'unpaid' && mine
          ? `<button class="btn amber" onclick="payModal('${inv.id}')">Pay now — ZAAD / eDAHAB</button>` : ''}
      </div>`;
  }

  const actions = [];
  if (mine && a.status === 'name_cleared') {
    const avail = ((a.reviewResult && a.reviewResult.names.find(n => n.available)) || { name: (a.data.names || [''])[0] }).name;
    actions.push(`<a class="btn" href="#/apply/registration?name=${encodeURIComponent(avail)}">Proceed to NGO registration with “${esc(avail)}”</a>`);
  }
  if (mine && a.status === 'issued') {
    if (a.type === 'registration') actions.push(`<a class="btn" href="#/cert/${a.id}">View / print Certificate of Registration</a>`);
    if (a.type === 'license' || a.type === 'renewal') actions.push(`<a class="btn" href="#/cert/${a.id}">View / print operating permit</a>`);
    actions.push(`<button class="btn sec" id="copyDocNo" data-copy="${esc((a.result && (a.result.licenseNumber || (a.result.certificate || {}).number || a.result.regNumber)) || a.id)}">Copy document number</button>`);
  }
  if (mine && a.status === 'rejected')
    actions.push(`<a class="btn" href="#/apply/${a.type}">Re-apply</a>`);

  el.innerHTML = `
    <div class="flex noprint" style="margin-bottom:14px">
      <a class="btn sec sm" href="#/dashboard">← Dashboard</a>
      <span class="pill">${a.id}</span>
      <span class="badge b-${a.badge}">${esc(statusText(a))}</span>
    </div>

    <div class="grid g2">
      <div class="card">
        <h2 class="mt0">Application details</h2>
        <table class="tbl">${dataRows.map(r => `<tr><td class="muted" style="width:42%">${r[0]}</td><td><b>${r[1]}</b></td></tr>`).join('')}</table>
        ${actions.length ? `<div class="flex mt2 noprint">${actions.join('')}</div>` : ''}
      </div>
      <div>
        <div class="card">
          <h2 class="mt0">Invoice</h2>
          <div class="invoice-box">${invoiceHtml}</div>
        </div>
        <div class="card mt2">
          <h2 class="mt0">Workflow & comments</h2>
          <ul class="timeline">${a.events.map(ev => `
            <li><div class="t">${esc(ev.action)}</div>
              <div class="m">${esc(ev.actor)} · ${esc(ev.role)} · ${fmtDate(ev.at)}</div>
              ${ev.comment ? `<div class="c">${esc(ev.comment)}</div>` : ''}</li>`).join('')}
          </ul>
        </div>
      </div>
    </div>
    ${sim ? similarityPanel(sim) : ''}`;
  const cd = $('#copyDocNo');
  if (cd) cd.onclick = () => {
    if (navigator.clipboard) navigator.clipboard.writeText(cd.dataset.copy);
    toast('Copied: ' + cd.dataset.copy);
  };
}
function similarityPanel(sim) {
  return `
    <div class="card mt2">
      <h2 class="mt0">Close-name analysis</h2>
      <p class="hint">Every submitted option is compared with registered NGOs and live name
      reservations. The NGO Technical Officer uses this result to approve or reject the name search.</p>
      ${sim.map(r => `
        <div class="card" style="box-shadow:none;padding:14px;margin-bottom:10px">
          <div class="spread"><b>“${esc(r.name)}”</b>
            <span class="badge b-${r.exactDuplicate ? 'red' : r.matches.length ? 'amber' : 'green'}">
              ${r.exactDuplicate ? 'DUPLICATE — already registered' : r.matches.length ? 'CLOSE NAME MATCH' : 'NO CLOSE MATCH'}</span></div>
          ${r.matches.map(m => `
            <div class="kvline"><span><b>${m.matchedWords} of ${m.totalWords}</b> submitted words are close to
              ${esc(m.kind)} “${esc(m.registered)}”${m.number ? ' · ' + esc(m.number) : ''}</span><b>${Math.round(m.score * 100)}%</b></div>
            <div class="hint">Close words: ${m.matched.map(esc).join(', ')}${m.missing.length ? ' · not close: ' + m.missing.map(esc).join(', ') : ''}</div>`).join('')}
        </div>`).join('')}
    </div>`;
}
function TYPES_LABEL(t) {
  return { name_search: 'NGO Name Search & Clearance', registration: 'NGO Registration', license: 'Operating Permit', renewal: 'Annual Renewal' }[t] || t;
}
function statusText(a) {
  return {
    submitted: 'Submitted', tech_review: 'Awaiting technical review', awaiting_payment: 'Awaiting payment',
    name_cleared: 'Name cleared — proceed to registration', reserved: 'Name reserved (90 days)',
    paid: 'Paid — queued for review', senior_review: 'With the Senior NGO Officer',
    director_review: 'With the Director of NGOs', ag_review: 'With the Registrar of NGOs',
    minister_review: 'With the Minister of Planning', issued: 'Approved — document issued', rejected: 'Rejected'
  }[a.status] || a.status;
}

/* =============================== PAYMENT =============================== */
function payModal(invId) {
  openModal(`
    <h3>Pay invoice ${esc(invId)}</h3>
    <p class="muted" style="margin-top:-4px">Mobile money — choose a wallet and confirm.</p>
    <label>Wallet</label>
    <select id="payMethod"><option value="zaad">ZAAD</option><option value="edahab">eDAHAB</option></select>
    <label>Mobile number</label><input id="payMsisdn" value="+252 63 " placeholder="+252 63 ..." />
    <div class="btnrow">
      <button class="btn sec" onclick="closeModal()">Cancel</button>
      <button class="btn amber" id="payConfirm">Confirm payment</button>
    </div>`);
  $('#payConfirm').onclick = async () => {
    try {
      const d = await api(`/api/invoices/${invId}/pay`, { method: 'POST', body: { method: $('#payMethod').value, msisdn: $('#payMsisdn').value } });
      closeModal(); toast('Payment successful — application advanced');
      await loadMe();
      if (d.application) go('#/app/' + d.application.id); else route();
    } catch (e) { toast(e.message, 'err'); }
  };
}

/* ============================= CERTIFICATE ============================== */
async function pageCert(el, appId) {
  if (!requireLogin()) return;
  const d = await api('/api/applications/' + encodeURIComponent(appId));
  const a = d.application;
  if (a.status !== 'issued') {
    el.innerHTML = `<div class="card center"><h1>Not issued yet</h1>
      <p class="sub">The document is only generated after final approval.</p>
      <a class="btn" href="#/app/${a.id}">Back to application</a></div>`;
    return;
  }
  const data = a.data || {};
  const issuedOn = fmtDay((a.result && (a.result.certificate ? a.result.certificate.issuedOn : a.decidedAt)) || a.decidedAt);
  let inner = '';

  if (a.type === 'registration') {
    const cert = a.result.certificate;
    inner = `
      <div class="verify-code">Verification code<br><b>${esc(cert.verifyCode)}</b></div>
      <div class="seal">MoPND<br>SOMALILAND</div>
      <div style="font-size:13px;letter-spacing:3px;color:#667085">REPUBLIC OF SOMALILAND</div>
      <h2>CERTIFICATE OF REGISTRATION</h2>
      <p class="muted">Ministry of Planning and National Development (MoPND) · NGO Affairs — Law No. 43/2010</p>
      <div class="big">“${esc(data.businessName)}”</div>
      <div class="kv"><span>Certificate number</span><b>${esc(cert.number)}</b></div>
      <div class="kv"><span>Registration number</span><b>${esc(a.result.regNumber)}</b></div>
      <div class="kv"><span>Organisation type</span><b>${esc(data.entityType || '')}</b></div>
      <div class="kv"><span>Registered office</span><b>${esc(data.address || '')}</b></div>
      <div class="kv"><span>Target sectors</span><b>${esc((data.activities || []).join(', '))}</b></div>
      <div class="kv"><span>Founders / board members</span><b>${(data.owners || []).map(o => esc(o.name) + ' (' + o.share + '%)').join(', ')}</b></div>
      <div class="kv"><span>Date of issue</span><b>${issuedOn}</b></div>
      <div class="sign">
        <div>Director of NGOs</div><div>Registrar of NGOs</div>
      </div>`;
  } else {
    const lic = a.result.licenseNumber, exp = a.result.expires;
    const cat = a.data.category;
    inner = `
      <div class="verify-code">Verification code<br><b>${esc(a.result.verifyCode || '')}</b></div>
      <div class="seal">MoPND<br>PERMIT</div>
      <div style="font-size:13px;letter-spacing:3px;color:#667085">MINISTRY OF PLANNING & NATIONAL DEVELOPMENT</div>
      <h2>${a.type === 'renewal' ? 'OPERATING PERMIT (RENEWED)' : 'OPERATING PERMIT'}</h2>
      <div class="big">“${esc(data.businessName || '')}”</div>
      <div class="kv"><span>Permit number</span><b>${esc(lic)}</b></div>
      <div class="kv"><span>Registration number</span><b>${esc(data.regNumber || '')}</b></div>
      <div class="kv"><span>Programme sector</span><b>${esc(cat || '')}</b></div>
      <div class="kv"><span>Valid from</span><b>${issuedOn}</b></div>
      <div class="kv"><span>Valid until</span><b>${fmtDay(exp)}</b></div>
      <div class="kv"><span>Office address</span><b>${esc(data.premises || '—')}</b></div>
      <div class="sign">
        <div>Director of NGOs</div><div>Minister of Planning & National Development</div>
      </div>`;
  }

  el.innerHTML = `
    <div class="flex noprint" style="margin-bottom:14px;justify-content:center">
      <a class="btn sec sm" href="#/app/${a.id}">← Application</a>
      <button class="btn sm" onclick="window.print()">Print / save as PDF</button>
      <button class="btn sec sm" id="copyNo">Copy number</button>
    </div>
    <div class="cert">${inner}</div>
    <p class="center hint noprint">Anyone can verify this document at
      <a href="#/verify?number=${encodeURIComponent(a.result.licenseNumber || (a.result.certificate || {}).number || a.result.regNumber || '')}">#/verify</a></p>`;
  $('#copyNo').onclick = () => {
    const n = a.result.licenseNumber || (a.result.certificate || {}).number || a.result.regNumber || '';
    if (navigator.clipboard) navigator.clipboard.writeText(n);
    toast('Copied: ' + n);
  };
}
/* =========================== OFFICER CONSOLE ============================ */
async function pageOfficer(el) {
  if (!requireLogin()) return;
  if (!isOfficer()) { toast('Officer accounts only', 'err'); go('#/dashboard'); return; }
  const q = await api('/api/officer/queue');
  const stageRows = q.stats.map(s => `
    <div class="mini"><div class="v">${s.count}</div><div class="l">${esc(s.label)}</div></div>`).join('');

  el.innerHTML = `
    <div class="spread">
      <div><h1>Officer console</h1>
      <p class="sub">${esc(S.me.roleLabel)} — you decide applications assigned to your stage.</p></div>
      <a class="btn sec" href="#/dashboard">Applicant view</a>
    </div>
    <div class="mini-stats">${stageRows}</div>

    <div class="spread"><h2>Your queue</h2><span class="pill">${q.queue.length} pending</span></div>
    <div class="card" id="queueCard">
      ${q.queue.length ? q.queue.map(a => `
        <div class="card" style="box-shadow:none;padding:14px;margin-bottom:12px" id="row-${a.id}">
          <div class="spread">
            <div>
              <b>${esc(a.title)}</b> <span class="pill">${a.id}</span><br>
              <span class="muted">${esc(a.typeLabel)} · submitted ${fmtDay(a.createdAt)}</span>
              ${a.nameRisk ? `<span class="badge b-amber">CLOSE NAME MATCH</span>` : ''}
              ${a.invoice ? `<span class="badge b-${a.invoice.status === 'paid' ? 'green' : 'amber'}">Invoice ${a.invoice.id} · ${money(a.invoice.total)} · ${a.invoice.status}</span>` : ''}
            </div>
            <div class="flex">
              <a class="btn sec sm" href="#/app/${a.id}">Inspect</a>
            </div>
          </div>
          <div class="decide">
            <label style="margin-top:0">Decision comment</label>
            <textarea class="cmt" rows="2" placeholder="Optional comment for the applicant"></textarea>
            <div class="flex mt1">
              <button class="btn sm" data-approve="${a.id}">Approve</button>
              <button class="btn danger sm" data-reject="${a.id}">Reject</button>
              ${a.status === 'tech_review' && a.type !== 'name_search'
                ? `<span class="hint">Approval generates the invoice.</span>`
                : a.status === 'tech_review' && a.type === 'name_search'
                  ? `<span class="hint">Approval runs the name availability check${a.intent === 'reserve' ? ' and issues the reservation invoice' : ''}.</span>` : ''}
            </div>
          </div>
        </div>`).join('')
      : `<div class="empty"><div class="ico">OK</div>Queue is clear — no applications waiting for ${esc(S.me.roleLabel)}.</div>`}
    </div>

    <h2>Recent decisions needed at other stages</h2>
    <div class="card"><table class="tbl">
      <tr><th>Stage</th><th>Assigned to</th><th class="num">Pending</th></tr>
      ${q.stats.map(s => `<tr><td>${esc(s.label)}</td><td>${esc(s.role)}</td><td class="num">${s.count}</td></tr>`).join('')}
    </table></div>`;

  $$('[data-approve]').forEach(b => b.onclick = () => decide(b.dataset.approve, true));
  $$('[data-reject]').forEach(b => b.onclick = () => decide(b.dataset.reject, false));
  async function decide(id, approve) {
    const row = document.getElementById('row-' + id);
    const comment = row.querySelector('.cmt').value;
    try {
      const d = await api(`/api/officer/applications/${id}/decision`, { method: 'POST', body: { approve, comment } });
      toast(approvedMsg(d.application, approve), 'ok');
      await loadMe();
      pageOfficer(el);
    } catch (e) { toast(e.message, 'err'); }
  }
  function approvedMsg(app, approve) {
    if (!approve) return 'Application rejected';
    return app.status === 'awaiting_payment' ? 'Approved — invoice issued'
      : app.status === 'name_cleared' ? 'Name search approved'
      : app.status === 'reserved' ? 'Reservation complete'
      : app.status === 'issued' ? 'FINAL APPROVAL — document issued'
      : 'Approved — forwarded to next stage';
  }
}

/* ====================== PUBLIC: SEARCH / VERIFY ========================= */
async function pageSearch(el, term) {
  let results = null;
  if (term) results = await api('/api/public/search?q=' + encodeURIComponent(term));
  el.innerHTML = `
    <h1>NGO search</h1>
    <p class="sub">Free public search of the Somaliland NGO registry (MoPND) — no login required.</p>
    <div class="card">
      <form id="sForm" class="flex" style="gap:10px">
        <input id="q" style="flex:1" placeholder="NGO name or registration number" value="${esc(term)}" />
        <button class="btn" type="submit">Search</button>
      </form>
    </div>
    ${results === null ? '' : results.results.length ? `
      <div class="card mt2"><table class="tbl">
        <tr><th>NGO</th><th>Registration</th><th>Status</th><th>Permits</th></tr>
        ${results.results.map(b => `<tr>
          <td><b>${esc(b.name)}</b><div class="muted">${esc((b.activities || []).join(', '))}</div></td>
          <td class="pill">${esc(b.regNumber)}</td>
          <td><span class="badge b-green">${esc(b.status)}</span></td>
          <td>${(b.licenses || []).map(l => `<span class="pill">${esc(l.number)} · ${l.status === 'active' ? 'valid to ' + fmtDay(l.expires) : esc(l.status)}</span>`).join('<br>') || '—'}</td>
        </tr>`).join('')}
      </table></div>` : `<div class="card mt2"><div class="empty">No NGO matches “${esc(term)}”.</div></div>`}`;
  $('#sForm').onsubmit = e => { e.preventDefault(); go('#/search?q=' + encodeURIComponent($('#q').value.trim())); };
}

async function pageVerify(el, number) {
  let res = null, err = null;
  if (number) {
    try { res = await api('/api/public/verify?number=' + encodeURIComponent(number)); }
    catch (e) { err = e.message; }
  }
  el.innerHTML = `
    <h1>Verify a document</h1>
    <p class="sub">Confirm a Certificate of Registration, registration number or operating permit
    issued by NRRS — no login required.</p>
    <div class="card">
      <form id="vForm" class="flex" style="gap:10px">
        <input id="n" style="flex:1" placeholder="e.g. NGO/C/2026-0001 · MoPND/P/2026-0001 · SL-NGO-2026-0001" value="${esc(number)}" />
        <button class="btn" type="submit">Verify</button>
      </form>
    </div>
    ${number ? (res ? `
      <div class="result-ok mt2">
        <div class="spread"><h2 class="mt0" style="color:#166534;flex:1">${res.ok ? 'VALID DOCUMENT' : 'NOT FOUND'}</h2>
          <span class="badge b-green">${esc(res.title)}</span></div>
        <div class="kvline"><span>Document number</span><b>${esc(res.number)}</b></div>
        <div class="kvline"><span>Holder</span><b>${esc(res.holder)}</b></div>
        <div class="kvline"><span>Status</span><b>${esc(res.status)}</b></div>
        <div class="kvline"><span>Issued</span><b>${fmtDay(res.issuedOn)}</b></div>
        <div class="kvline"><span>Details</span><b>${esc(res.detail || '—')}</b></div>
        <div class="kvline"><span>Verification code</span><b>${esc(res.verifyCode)}</b></div>
      </div>` : `
      <div class="result-err mt2"><h2 class="mt0" style="color:#912018">DOCUMENT NOT FOUND</h2>
      <p>${esc(err || 'No document matches that number.')}</p></div>`) : ''}`;
  $('#vForm').onsubmit = e => { e.preventDefault(); go('#/verify?number=' + encodeURIComponent($('#n').value.trim())); };
}

/* ============================= REQUIREMENTS ============================= */
async function pageRequirements(el) {
  const r = (await api('/api/requirements')).requirements;
  const kindCard = (k, id) => `
    <div class="card${id === 'local' ? '' : ' mt2'}">
      <div class="spread">
        <h2 class="mt0">${esc(k.label)}</h2>
        <span class="pill">${k.items.length} requirements</span>
      </div>
      <p class="sub">${esc(k.lead)}</p>
      <div class="invoice-box">
        ${k.fees.map(f => `<div class="kvline"><span>${esc(f.desc)}</span><b>${money(f.amount)}</b></div>`).join('')}
        <div class="kvline"><span>Name search (up to 3 options)</span><b>Free</b></div>
      </div>
      <h3>Documents to submit</h3>
      <table class="tbl">
        <tr><th style="width:34%">Requirement</th><th>What the officer checks</th></tr>
        ${k.items.map(i => `<tr><td><b>${esc(i.req)}</b></td><td>${esc(i.note)}</td></tr>`).join('')}
      </table>
      <h3>How the application is processed</h3>
      <ul class="timeline">${k.process.map(s => `<li><div class="t">${esc(s.title)}</div><div class="m">${esc(s.note)}</div></li>`).join('')}</ul>
    </div>`;

  el.innerHTML = `
    <h1>Requirements</h1>
    <p class="sub"><b>NGO Requirements</b> — documents, fees and process for registering a
    Local NGO or an International NGO with the ${esc(r.authority)}. Amounts in ${esc(r.currency)}.</p>

    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
      <div class="step"><span class="n">1</span><h3>Local NGO</h3>
        <p>Founded and headquartered in Somaliland by resident founders.</p></div>
      <div class="step"><span class="n">2</span><h3>International NGO</h3>
        <p>Foreign NGO, affiliate or branch operating here for headquarters abroad.</p></div>
      <div class="step"><span class="n">3</span><h3>Name clearance first</h3>
        <p>Both kinds start with a free name search for up to three options.</p></div>
    </div>

    ${kindCard(r.local, 'local')}
    ${kindCard(r.international, 'international')}

    <div class="card mt2"><h2 class="mt0">Before you submit</h2>
      ${r.notes.map(n => `<p class="hint">• ${esc(n)}</p>`).join('')}
      <div class="flex mt1"><a class="btn" href="#/search">Run a name search</a>
      <a class="btn sec" href="#/">Back to home</a></div>
    </div>`;
}

/* ============================== MAILBOX ================================= */
async function pageMailbox(el) {
  const d = await api('/api/dev/emails');
  el.innerHTML = `
    <h1>Dev mailbox <span class="badge b-amber">local demo</span></h1>
    <p class="sub">In this local build no real e-mail is sent — every message the system “sends”
    (OTP codes, invoices, approvals) lands here instead.</p>
    ${d.emails.length ? d.emails.map(m => `
      <div class="email"><div class="spread"><b>${esc(m.subject)}</b><span class="muted">${fmtDate(m.at)}</span></div>
      <div class="muted" style="font-size:13px">To: ${esc(m.to)}</div>
      <pre>${esc(m.body)}</pre></div>`).join('')
      : `<div class="card"><div class="empty">Mailbox is empty.</div></div>`}`;
}