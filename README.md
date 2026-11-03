# NRRS — NGO Registration and Renewing System

**Somaliland Ministry of Planning & National Development (MoPND) — NGO Affairs**

A complete, self-contained web application for registering and renewing NGOs under **Law No. 43/2010**. It mirrors the real-world workflow end to end: name search → registration → operating permit → annual renewal, with invoicing, mobile-money payment, and a five-stage officer approval chain that ends in a signed, publicly verifiable certificate.

> **Demo build.** Content, fees and timelines are demonstration data adapted for this build — confirm current forms and fees with MoPND before submitting anything for real.

---

## Highlights

- **Zero dependencies** — pure Node.js (`http`, `fs`, `path`, `crypto`). No `npm install` needed.
- **Full workflow engine** mirroring the statutory process:
  1. Applicant submits (name search / registration / operating permit / renewal)
  2. NGO Technical Officer reviews → generates invoice
  3. Applicant pays by **ZAAD** or **eDAHAB**
  4. Post-payment approval chain (varies by service):
     - *Registration:* Senior Officer → Director of NGOs → Registrar
     - *Permit / Renewal:* Director of NGOs → Minister
  5. Certificate or permit is issued, downloadable and publicly verifiable
- **NGO name search** with fuzzy close-name analysis against registered NGOs and live reservations (edit-distance + token matching, up to 3 name options).
- **Fee schedule** per programme sector and registration class, with Stamp Duty 2.5 % and Administration Tax 2 % automatically added.
- **Public registry search & document verification** (registration numbers, certificates, permits, verify codes).
- **Officer console** with per-stage queues, role-based access, audit trail on every application.
- **Notifications + dev mailbox** (all "emails" are viewable in-app at `#/mailbox`).
- **Single-page frontend** — hash routing, no build step, no framework.

## Quick start

```bash
git clone https://github.com/<your-account>/<repo>.git
cd <repo>
node server.js
```

Then open **http://localhost:3000**

Configuration (optional environment variables):

| Variable | Default        | Purpose                    |
|----------|----------------|----------------------------|
| `PORT`   | `3000`         | HTTP port                  |
| `HOST`   | `127.0.0.1`    | Bind address (`0.0.0.0` to expose) |

The first run automatically creates `data/db.json` and seeds demo data.

## Demo accounts

| Role                     | Password     | E-mail                  |
|--------------------------|--------------|-------------------------|
| Applicant                | `demo123`    | `applicant@brls.local`  |
| NGO Technical Officer    | `officer123` | `tech@brls.local`       |
| Senior NGO Officer       | `officer123` | `senior@brls.local`     |
| Director of NGOs         | `officer123` | `director@brls.local`   |
| Registrar of NGOs (AG)   | `officer123` | `ag@brls.local`         |
| Minister (MoPND)         | `officer123` | `minister@brls.local`   |

## Project structure

```
├── server.js          # HTTP server, REST API, workflow engine, seed data
├── package.json
├── public/            # Static frontend (no build step)
│   ├── index.html
│   ├── app.js         # SPA: hash router, views, API client
│   ├── styles.css
│   └── assets/
└── data/              # Runtime state (git-ignored, auto-seeded)
    └── db.json
```

## API overview

All endpoints are JSON under `/api/`:

- **Public** — `GET /api/fees`, `GET /api/requirements`, `GET /api/public/search?q=`, `GET /api/public/verify?number=`
- **Auth** — `POST /api/auth/register|login|forgot|reset`, `GET /api/auth/me`
- **Applicant** — `GET|POST /api/applications`, `GET /api/invoices`, `POST /api/invoices/:id/pay`
- **Officer** — `GET /api/officer/queue`, `POST /api/officer/applications/:id/decision`
- **Misc** — `GET /api/notifications`, `POST /api/notifications/read`, `GET /api/dev/emails`

Authentication uses a `Bearer` token header issued at login (12-hour sessions).

## Resetting the demo

Stop the server and delete the data folder — it is re-created and re-seeded on the next start:

```bash
rm -rf data
node server.js
```

## Legal basis

Law No. 43/2010 (registration and regulation of NGOs), Somaliland. Operated by the Ministry of Planning and National Development — NGO Affairs, Hargeisa.
