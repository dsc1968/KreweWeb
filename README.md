# Krewe Mystique de la Capitale — Web Platform

A modern web platform for **Krewe Mystique de la Capitale**, Baton Rouge's
parading Mardi Gras krewe. It pairs a fast static front-end with a Node.js /
Express back-end and a PostgreSQL database, and ships with a built-in admin
editor so non-developers can manage pages, photos, and content.

Repository: https://github.com/dsc1968/KreweWeb.git

---

## What this project is

The site is the public face of the krewe: home page, history, royal court,
veterans, photo galleries/albums, events, shop, contact, and member
registration. Behind the pages is a full application that handles accounts,
authentication, file uploads, and a visual page editor — all driven from a
single Express server.

Out of the box it provides:

- **Public marketing site** — themed pages served as static assets (home,
  history, royal court, veterans, events, photos, contact).
- **Member accounts** — registration with email (and optional SMS) verification,
  JWT auth, and two-factor (MFA) sign-in with an admin-configurable MFA policy.
- **Scoped admin roles** — a full `admin` plus limited roles (`store_admin`,
  `float_admin`, `finance_admin`) that each unlock only their part of the
  dashboard.
- **Photo albums** — a gallery system with cover images, captions, and a
  lightbox viewer.
- **Events** — a calendar/event listing.
- **Admin editor** — edit page text, images, and sections in the browser, with
  the ability to revert to an original snapshot.
- **Custom theming** — change site colors and styling from the admin dashboard;
  the theme is applied to every page (including login and marketing pages).
- **Float management** — assign members, spouses, guests, and riders to floats,
  designate float captains, and lock float assignments once finalized.
- **Finance & dues** — track member dues and payments, and export member,
  float, and order reports.
- **Shop** — product listings and member donations with (optional) simulated,
  PayPal, or Stripe (credit-card) payments.
- **Backup & restore** — manual and automatic scheduled database/file backups to
  local disk, S3-compatible storage, or rclone (OneDrive, Google Drive, Dropbox,
  and 70+ others).
- **Season reset** — automatically clears per-season member data on a
  configurable season-end date.

## What it is made of

| Component | Role |
|-----------|------|
| **Node.js / Express** | HTTP server and REST API (default port `8000`) |
| **PostgreSQL** | Relational database for users, content, photos, albums, events |
| **Static front-end** (`frontend/`) | HTML / CSS / JS site served by the backend |
| **Nginx Proxy Manager** (optional) | Reverse proxy, HTTPS termination, Let's Encrypt certificates |
| **Docker / Docker Compose** (optional) | Container runtime for Nginx Proxy Manager |

The Node.js app handles all HTTP traffic on port `8000`. When exposed publicly,
Nginx Proxy Manager normally sits in front of it to handle domain routing and
terminate TLS, so the app itself never deals with certificates.

### Key technologies

- **express** — HTTP server and API framework
- **pg** — PostgreSQL client / connection pool
- **jsonwebtoken** — signs and verifies JWT auth tokens
- **bcryptjs** — hashes user passwords
- **cors** — cross-origin resource sharing middleware
- **multer** — multipart file uploads (photos, images)
- **nodemailer** — sends email (verification codes, contact form)
- **archiver** / **unzipper** — creates and restores `.zip` database backups
- **@aws-sdk/client-s3** — S3 / S3-compatible backup storage
- **plivo** — SMS provider (declared; called via REST using `PLIVO_*` env vars)
- **@zapier/zapier-sdk** — Zapier integration (declared; optional)

> `plivo` and `@zapier/zapier-sdk` are listed in `package.json` but are not
> directly `require`d by the shipped backend — they are kept for optional
> integrations. There are no `devDependencies`, and a committed
> `package-lock.json` pins exact versions.

## Project layout

| Path | Description |
|------|-------------|
| `frontend/` | Static site (HTML / CSS / JS). Served by the backend at runtime |
| `frontend/index.html` | Homepage |
| `frontend/styles.css` | Site styling |
| `frontend/script.js` | Front-end behavior (including the admin editor) |
| `backend/server.js` | Express entry point — starts the API + static server (`npm start`) |
| `backend/app.js` | Express app: middleware, static assets, and API routers |
| `backend/` | API routes, controllers, config, and utils (Node / Express backend) |
| `package.json` | Node dependencies and npm scripts — run `npm install` here |
| `package-lock.json` | Pinned dependency versions |
| `db-init.sql` | PostgreSQL base schema (applied by the init script) |
| `scripts/init_db.sh` | Database and `.env` initializer (`npm run init-db`) |
| `seed.js` | Demo data seeder (`npm run seed`) |
| `_backups/` | Server-managed database backups |

> The repository also contains duplicate copies under `frontend/frontend/…`
> (and a `frontend/package.json`). The canonical install and run location is
> the **repository root** — ignore the nested copies.

## Requirements at a glance

| Requirement | Linux | Windows |
|-------------|-------|---------|
| 64-bit OS | Ubuntu 22.04 LTS+ / Debian 12+ | Windows 10 v1903+ / Server 2019+ |
| Node.js | 20.x (LTS) | 20.x (LTS) |
| PostgreSQL | 15 / 16 | 15 / 16 |
| RAM | 1 GB min, 2 GB recommended | 2 GB min, 4 GB recommended |
| Disk | 2 GB free | 4 GB free |
| Domain name | Required for public HTTPS | Required for public HTTPS |

You need administrator / sudo rights for the system-level install steps.

## Documentation

Detailed, step-by-step setup lives in separate install guides:

- **[INSTALL_LINUX.md](INSTALL_LINUX.md)** — Ubuntu / Debian installation,
  database init, running the app, and systemd auto-start.
- **[INSTALL_WINDOWS.md](INSTALL_WINDOWS.md)** — Windows installation
  (Git Bash / WSL), database init, running the app, and NSSM auto-start.

Both guides cover the environment variables, Nginx Proxy Manager (reverse proxy
+ free SSL), backup providers, and troubleshooting.

## Quick start (summary)

```bash
git clone https://github.com/dsc1968/KreweWeb.git
cd Krewe
npm install            # from the repository root only
npm run init-db       # creates the DB role, database, .env, and a default admin
npm start              # serves http://localhost:8000
```

See the install guides for the full, platform-specific instructions (system
packages, PostgreSQL, auto-start services, reverse proxy, and backups).

## Notes

- Keep `.env` private. It is in `.gitignore` and must never be committed.
- In production, email verification requires valid `SMTP_*` settings in `.env`.
- JWT tokens expire after 7 days.
- The server listens on port `8000` unless you change `PORT` in `.env`.
- The Nginx Proxy Manager admin panel (port `81`) should be restricted to your
  IP address in production — it has full control over all proxy rules and
  certificates.
