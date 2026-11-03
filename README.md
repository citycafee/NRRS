# NRRS — NGO Registration and Renewing System

**Somaliland Ministry of Planning & National Development (MoPND) — NGO Affairs**

A complete web application for registering and renewing NGOs under **Law No. 43/2010**. It mirrors the real-world workflow end to end: name search → registration → operating permit → annual renewal, with invoicing, ZAAD / eDAHAB mobile-money payment, and a multi-stage officer approval chain that ends in a signed, publicly verifiable certificate.

**Runs entirely in the browser — no server, no build step, no dependencies.**

> **Demo build.** Content, fees and timelines are demonstration data. Confirm current forms and fees with MoPND before submitting anything for real.

## Live site

Once GitHub Pages is enabled for this repository the app is served at:

```
https://citycafee.github.io/NRRS/
```

Enable it once under **Settings → Pages → Deploy from a branch → `main` → `/ (root)`**.

## Quick start (local)

Just open `index.html` in a browser, or serve the folder with any static file server:

```bash
# option 1 — no server at all
start index.html

# option 2 — any static server (Python, Node, ...)
npx serve .            # or:  python -m http.server 8000
```

## Demo accounts

| Role                   | Password     | E-mail                 |
|------------------------|--------------|------------------------|
| Applicant              | `demo123`    | `applicant@brls.local` |
| NGO Technical Officer  | `officer123` | `tech@brls.local`      |
| Senior NGO Officer     | `officer123` | `senior@nrrs.local`    |
| Director of NGOs       | `officer123` | `director@brls.local`  |
| Registrar of NGOs (AG) | `officer123` | `ag@nrrs.local`        |
| Minister (MoPND)       | `officer123` | `minister@nrrs.local`  |

The sign-in page has clickable demo chips that fill these in for you.

## How it works

- **`index.html`** — page shell and navigation
- **`app.js`** — single-page app: hash router, all views, forms, officer console
- **`backend.js`** — the entire backend ported to the browser: workflow engine,
  invoices, fee schedule, name-collision analysis, auth and the public registry.
  All state persists in `localStorage` under `nrrs_db_v1`
- **`styles.css`**, **`assets/`** — styling and logos

There is no network traffic: every “API” call is dispatched in-process by
`NRRS_BACKEND.handle(...)`, using the same contract as the original server.

### Workflow implemented

1. Applicant submits a service request (name search / registration / permit / renewal)
2. **NGO Technical Officer** reviews → system generates an invoice
3. Applicant pays by **ZAAD** or **eDAHAB**
4. Post-payment approval chain:
   - *Registration:* Senior Officer → Director of NGOs → Registrar
   - *Permit / Renewal:* Director of NGOs → Minister
5. Certificate or permit is issued, printable, and publicly verifiable

### Features

- Fuzzy **close-name analysis** against registered NGOs and live reservations
  (up to 3 name options, edit-distance matching)
- Fee schedule per programme sector and registration class, with automatic
  Stamp Duty 2.5 % and Administration Tax 2 %
- **Public registry search** and **document verification** (registration numbers,
  certificates, permits, verification codes) — no login required
- Officer console with per-stage queues, role-based access and a full audit trail
- Notifications and an in-app **dev mailbox** (`#/mailbox`) — no real e-mail is sent
- Printable certificates / permits (`Print → save as PDF`)

## Data & privacy

Everything lives in **your browser's localStorage** — nothing is sent anywhere.
Consequences of the demo design:

- Each browser/device has its own independent data
- Clearing site data (or `localStorage.clear()`) resets the demo to its seed state
- Passwords are hashed (SHA-256 + salt) but this is a demo, not a production auth system

## Legal basis

Law No. 43/2010 (registration and regulation of NGOs), Somaliland.
Operated by the Ministry of Planning and National Development — NGO Affairs, Hargeisa.
