# Installing Krewe Mystique on Windows

This guide covers a full Windows installation of the Krewe Mystique web
platform: Git, Node.js, PostgreSQL, cloning the repo, initializing the database,
running the app, and configuring it to start automatically as a Windows service
(NSSM).

All commands below are run in **PowerShell** opened as Administrator unless
stated otherwise. Right-click the Start button → "Windows PowerShell (Admin)" or
"Terminal (Admin)".

For Linux, see [INSTALL_LINUX.md](INSTALL_LINUX.md). For a general project
overview, see [README.md](README.md).

---

## Prerequisites

| Requirement | Windows |
|-------------|---------|
| 64-bit OS | Windows 10 v1903+ or Windows Server 2019+ |
| Node.js | 20.x (LTS) |
| PostgreSQL | 15 / 16 |
| RAM | 2 GB minimum, 4 GB recommended |
| Disk | 4 GB free |
| Network | Internet access during install |
| Domain name | Required for public HTTPS |

You need administrator rights for the system-level install steps.

---

## 1. Install Git for Windows

Download the installer from https://git-scm.com/download/win and run it. Accept
the defaults. When the installer asks about the default terminal, choose "Use
Windows' default console window" or "Git Bash" — either works.

After installation, close and reopen PowerShell, then confirm:

```powershell
git --version
```

---

## 2. Install Node.js

Download the **LTS** installer (20.x) from https://nodejs.org/ and run it. Check
the box that says "Automatically install the necessary tools" when prompted —
this installs build tools needed for native modules.

Confirm the installation:

```powershell
node -v
npm -v
```

---

## 3. Install PostgreSQL

Download the Windows installer from
https://www.enterprisedb.com/downloads/postgres-postgresql-downloads and run it.
Choose version **15** or **16**.

During installation:

1. Set a **superuser password** for the `postgres` account. Write this down — you
   will need it once to create the app database user.
2. Leave the default port `5432` unchanged.
3. Leave the default locale.
4. Install all components (server, pgAdmin, command-line tools).

After installation, open the **Services** panel (`Win + R` → `services.msc`).
Find **postgresql-x64-16** (or whichever version you installed). Confirm it is
running and set to **Automatic** startup.

To set it via PowerShell:

```powershell
Set-Service -Name "postgresql-x64-16" -StartupType Automatic
Start-Service -Name "postgresql-x64-16"
```

Adjust the service name to match the version you installed. You can find the
exact name with:

```powershell
Get-Service | Where-Object { $_.Name -like "postgresql*" }
```

Add the PostgreSQL `bin` folder to your system PATH so `psql` is available
anywhere. Replace the path with your actual install location:

```powershell
$pgBin = "C:\Program Files\PostgreSQL\16\bin"
[System.Environment]::SetEnvironmentVariable("PATH", $env:PATH + ";$pgBin", [System.EnvironmentVariableTarget]::Machine)
```

Close and reopen PowerShell after running this, then confirm:

```powershell
psql --version
```

---

## 4. Clone the repository

Choose a location for the app. `C:\srv\kreweweb` is a good choice for servers:

```powershell
mkdir C:\srv\kreweweb
cd C:\srv\kreweweb
git clone https://github.com/dsc1968/KreweWeb.git Krewe
cd Krewe
```

For a development machine you can use any folder:

```powershell
git clone https://github.com/dsc1968/KreweWeb.git C:\krewe
cd C:\krewe
```

---

## 5. Install project dependencies

From the project root (the folder that contains `package.json`):

```powershell
npm install
```

Do not use an Administrator PowerShell for this step unless you have to — running
`npm install` as Administrator can cause permission issues.

> Run `npm install` **once, from the repository root** (the folder that contains
> `package.json`) — do **not** run it from `frontend/` or any nested copy, because
> only the root install populates the `node_modules/` that the backend loads.
> `npm start` runs `node backend/server.js`, which requires these packages.

---

## 6. Initialize the database and .env file

The database init script is written for Bash. On Windows you have two options:

**Option A — Git Bash (recommended)**

Open Git Bash (it was installed with Git for Windows). Navigate to the project
folder:

```bash
cd /c/srv/kreweweb/Krewe
npm run init-db
```

The script will prompt for a password for the database user. Enter something
strong.

**Option B — WSL (Windows Subsystem for Linux)**

If you have WSL 2 with Ubuntu installed, open an Ubuntu terminal and follow the
Linux instructions from step 4 onward.

After `npm run init-db` completes it creates a `.env` file in the project root.
Open it in Notepad to confirm it looks similar to this:

```env
DATABASE_URL=postgresql://krewe_db_user:yourpassword@localhost:5432/krewe_db
JWT_SECRET=some-random-secret
PORT=8000
```

**Default admin credentials:**

| Field | Value |
|-------|-------|
| Email | `admin@krewe.local` |
| Password | `admin123` |

The bootstrap admin (`admin@krewe.local`) is exempt from MFA so the initial
login works before email/SMS delivery is configured. Change this password
after your first login.

### Variables used by `npm run init-db`

These are read by the database initializer (`scripts/init_db.sh`) — **not** by
the running server — and can be passed as environment variables or inline
arguments:

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_NAME` | `krewe_db` | Name of the database to create |
| `DB_USER` | `krewe_db_user` | Database role to create |
| `PORT` | `8000` | Port written into `.env` |
| `CREATE_DEFAULT_ADMIN` | `true` | Set `false` to skip creating the default admin account |
| `DEFAULT_ADMIN_EMAIL` | `admin@krewe.local` | Email for the bootstrap admin account (exempt from MFA on first login) |
| `DEFAULT_ADMIN_NAME` | `Admin User` | Display name for the bootstrap admin account |
| `DEFAULT_ADMIN_PASSWORD` | `admin123` | Password for the bootstrap admin account |

---

## 7. Start the app

In PowerShell (no Admin needed) from the project root:

```powershell
npm start
```

Open a browser and go to `http://localhost:8000`. Test it in PowerShell:

```powershell
Invoke-WebRequest -Uri http://localhost:8000/api/status -UseBasicParsing
```

A `StatusCode: 200` response means the server and database are both working.

### Optional: demo seed data

After the server is running you can create demo accounts for development and
testing:

```powershell
npm run seed
```

Or via the API while the server is running:

```powershell
Invoke-WebRequest -Method POST -Uri http://localhost:8000/api/dev/seed -UseBasicParsing
```

Do not use demo accounts in production.

---

## 8. Auto-start on boot — NSSM Windows service

NSSM (Non-Sucking Service Manager) wraps any executable as a proper Windows
service so it starts at boot and restarts after crashes.

**Step 1 — Download NSSM**

Go to https://nssm.cc/download and download the latest release. Extract the zip
file and copy `nssm.exe` from the `win64` folder to `C:\Windows\System32\` so it
is available in PATH everywhere.

**Step 2 — Install the Krewe app as a service**

Open PowerShell **as Administrator**.

Find the full path to node.exe:

```powershell
where.exe node
# example: C:\Program Files\nodejs\node.exe
```

Create the logs folder first:

```powershell
mkdir C:\srv\kreweweb\Krewe\logs
```

Install the service:

```powershell
nssm install krewe "C:\Program Files\nodejs\node.exe" "C:\srv\kreweweb\Krewe\server.js"
nssm set krewe AppDirectory "C:\srv\kreweweb\Krewe"
nssm set krewe DisplayName "Krewe Mystique Web App"
nssm set krewe Description "Express Node.js server for Krewe Mystique"
nssm set krewe Start SERVICE_AUTO_START
nssm set krewe AppStdout "C:\srv\kreweweb\Krewe\logs\service-out.log"
nssm set krewe AppStderr "C:\srv\kreweweb\Krewe\logs\service-err.log"
nssm set krewe AppRotateFiles 1
```

**Step 3 — Set environment variables for the service**

The service needs to know where `.env` is. NSSM can inject environment
variables:

```powershell
nssm set krewe AppEnvironmentExtra "NODE_ENV=production"
```

**Step 4 — Start the service and confirm:**

```powershell
nssm start krewe
Get-Service krewe
```

Status should be `Running`.

**Step 5 — Manage the service:**

```powershell
# Stop
nssm stop krewe

# Restart
nssm restart krewe

# Remove (uninstall)
nssm remove krewe confirm
```

You can also control it from the Services panel (`services.msc`) like any other
Windows service.

From this point on, the Krewe app starts automatically when Windows boots, after
PostgreSQL has started.

---

## Environment variables reference

The `.env` file in the project root controls all runtime settings. The init
script creates it for you, but you can edit it manually at any time.

### Runtime variables

These are read by the running server (after `npm start`).

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `JWT_SECRET` | Yes | — | Secret key for signing JWT tokens. Use a long random string in production |
| `PORT` | No | `8000` | Port the Express server listens on |
| `NODE_ENV` | No | `development` | Set to `production` in production |
| `REGISTRATION_CODE_TTL_MINUTES` | No | `10` | How long registration / verification codes stay valid (minutes) |
| `SMTP_HOST` | No | — | SMTP server hostname for outbound email |
| `SMTP_PORT` | No | `587` | SMTP server port |
| `SMTP_SECURE` | No | `false` | Set to `true` to use TLS on the SMTP connection |
| `SMTP_USER` | No | — | SMTP login username |
| `SMTP_PASS` | No | — | SMTP login password |
| `SMTP_FROM` | No | — | From address for outbound email |
| `SMTP_REPLY_TO` | No | — | Reply-To address for outbound email |
| `CONTACT_RECIPIENT` | No | `dougscobb@hotmail.com` | Address that receives contact form submissions |
| `PLIVO_AUTH_ID` | No | — | Plivo Auth ID for SMS verification / MFA |
| `PLIVO_AUTH_TOKEN` | No | — | Plivo Auth Token |
| `PLIVO_SOURCE_NUMBER` | No | — | Plivo sender phone number (E.164 format) |
| `PLIVO_VERIFY_APP_ID` | No | — | Plivo Verify application ID (if using Plivo Verify) |
| `PAYPAL_CLIENT_ID` | No | — | PayPal app client ID for shop payments |
| `PAYPAL_CLIENT_SECRET` | No | — | PayPal app secret |
| `PAYPAL_MODE` | No | `sandbox` | `sandbox` or `live` |
| `STRIPE_SECRET_KEY` | No | — | Stripe secret key for shop payments (leave blank to disable Stripe) |
| `STRIPE_PUBLISHABLE_KEY` | No | — | Stripe publishable key (exposed to the browser) |
| `STRIPE_MODE` | No | `test` | `test` or `live` |
| `PAYMENT_SIMULATE` | No | `false` | Set `true` to simulate payments without contacting PayPal (applies to both PayPal and Stripe) |
| `SEASON_END_DATE` | No | (computed) | Season-end rule, e.g. `fixed:7:15` or `relative:-1:5:8`. Defaults to Ash Wednesday when unset |
| `BACKUP_PROVIDER` | No | `local` | Backup storage backend: `local`, `s3`, or `rclone` |
| `BACKUP_S3_BUCKET` | No* | — | S3 bucket name (required when `BACKUP_PROVIDER=s3`) |
| `BACKUP_S3_REGION` | No* | — | S3 region |
| `BACKUP_S3_PREFIX` | No | `krewe-backups/` | Key prefix / path inside the bucket |
| `BACKUP_S3_ENDPOINT` | No | — | Custom endpoint for R2 / MinIO / B2 (leave blank for AWS) |
| `BACKUP_AWS_ACCESS_KEY_ID` | No* | — | S3 access key id |
| `BACKUP_AWS_SECRET_ACCESS_KEY` | No* | — | S3 secret access key |
| `RCLONE_CONFIG` | No | — | Path to `rclone.conf` when running as a service with `BACKUP_PROVIDER=rclone` |

\* Required only when using the S3 backup provider. The `BACKUP_*` settings are
also editable from the **Backup & Restore** page in the admin dashboard.

Keep `.env` private. It is listed in `.gitignore` and must never be committed to
the repository.

---

## Nginx Proxy Manager — reverse proxy and SSL certificates

### Why Nginx Proxy Manager

Nginx Proxy Manager (NPM) is a browser-based GUI that sits in front of the
Node.js app. It handles:

- Routing your domain name to the Node app running on port `8000`
- Obtaining and automatically renewing free Let's Encrypt SSL certificates
- Forcing all HTTP traffic to HTTPS
- Supporting multiple domains and subdomains from one interface

NPM runs in Docker, which keeps it isolated from the rest of the system and
makes it easy to update.

### Install Docker Desktop

Docker Desktop bundles Docker Engine, Docker Compose, and a GUI all in one
installer.

1. Go to https://www.docker.com/products/docker-desktop/ and download **Docker
   Desktop for Windows**.
2. Run the installer. When asked, choose **Use WSL 2 instead of Hyper-V**
   (recommended).
3. Restart Windows when prompted.
4. Open Docker Desktop from the Start menu and wait for it to finish starting
   (the whale icon in the system tray turns solid when it is ready).
5. Open PowerShell and confirm:

```powershell
docker --version
docker compose version
```

Docker Desktop sets itself to start with Windows automatically. You can change
this in Docker Desktop → Settings → General → "Start Docker Desktop when you
sign in".

### Deploy Nginx Proxy Manager

**Step 1 — Create a folder for NPM's data:**

```powershell
mkdir C:\srv\nginx-proxy-manager\data
mkdir C:\srv\nginx-proxy-manager\letsencrypt
cd C:\srv\nginx-proxy-manager
```

**Step 2 — Create the Docker Compose file:**

```powershell
notepad docker-compose.yml
```

Paste this content exactly (use absolute paths on Windows):

```yaml
version: '3.8'
services:
  app:
    image: 'jc21/nginx-proxy-manager:latest'
    restart: unless-stopped
    ports:
      - '80:80'    # HTTP — must be reachable from the internet
      - '443:443'  # HTTPS — must be reachable from the internet
      - '81:81'    # NPM admin panel
    volumes:
      - C:\srv\nginx-proxy-manager\data:/data
      - C:\srv\nginx-proxy-manager\letsencrypt:/etc/letsencrypt
```

**Step 3 — Start Nginx Proxy Manager:**

```powershell
docker compose up -d
```

**Step 4 — Confirm the container is running:**

```powershell
docker compose ps
```

The `app` service should show `Up` with ports `80`, `443`, and `81` listed.

**Step 5 — Make NPM start automatically with Docker:**

Because the Compose file sets `restart: unless-stopped` and Docker is enabled on
boot, NPM will start automatically whenever Docker starts. No extra steps are
needed.

### First-time login

Open a browser and go to:

```
http://your-server-ip:81
```

If you are setting this up on the same machine you are working on, use:

```
http://localhost:81
```

**Default credentials:**

| Field | Value |
|-------|-------|
| Email | `admin@example.com` |
| Password | `changeme` |

NPM will immediately ask you to change the email address and password. Do this
before going any further.

### Add a Proxy Host for the Krewe app

A Proxy Host tells NPM to forward traffic for your domain to the Node.js app.

**Before you start:** Make sure your domain's DNS A record points to your
server's public IP address. DNS changes can take up to 24 hours to propagate,
but usually take a few minutes.

1. In the NPM admin panel, click **Proxy Hosts** in the left menu.
2. Click **Add Proxy Host**.
3. Fill in the **Details** tab:
   - **Domain Names:** enter your domain, e.g. `krewe.yourdomain.com`. Press Enter
     to add it. Add `www.krewe.yourdomain.com` as a second entry if you want to
     support `www`.
   - **Scheme:** `http`
   - **Forward Hostname / IP:** `host.docker.internal` (Docker Desktop on Windows)
   - **Forward Port:** `8000`
   - Enable **Block Common Exploits**
   - Enable **Websockets Support** (the admin editor uses WebSocket-like
     long-polling)
4. Click **Save**.

Test that the proxy works before setting up SSL:

```
http://krewe.yourdomain.com
```

You should see the Krewe site served over plain HTTP. Fix any errors at this
stage before adding SSL.

### Request a free SSL certificate

1. In the NPM admin panel, click **Proxy Hosts** and click the **three-dot menu**
   (⋮) on the host you just created. Choose **Edit**.
2. Click the **SSL** tab.
3. Under **SSL Certificate**, choose **Request a new SSL Certificate**.
4. Enable **Force SSL** — this redirects all HTTP requests to HTTPS
   automatically.
5. Enable **HTTP/2 Support** for better performance.
6. Enter your email address in the **Let's Encrypt Email** field. Let's Encrypt
   sends certificate expiry warnings to this address.
7. Check the **I Agree to the Let's Encrypt Terms of Service** box.
8. Click **Save**.

NPM contacts Let's Encrypt, completes the domain verification challenge, and
installs the certificate. This takes about 30 seconds. When it completes, the
Proxy Host list will show a green padlock next to your domain.

Test HTTPS:

```
https://krewe.yourdomain.com
```

**Certificate renewal is automatic.** NPM renews Let's Encrypt certificates
before they expire (every 90 days). You do not need to do anything.

### Firewall rules

For everything to work, your server's firewall must allow inbound traffic on
these ports:

| Port | Protocol | Purpose |
|------|----------|---------|
| 80 | TCP | HTTP (used by Let's Encrypt challenge and redirect to HTTPS) |
| 443 | TCP | HTTPS |
| 81 | TCP | NPM admin panel — restrict this to your IP only in production |

**Windows Firewall (PowerShell as Administrator):**

```powershell
New-NetFirewallRule -DisplayName "HTTP"  -Direction Inbound -Protocol TCP -LocalPort 80  -Action Allow
New-NetFirewallRule -DisplayName "HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow
# Restrict NPM admin panel to your IP only
New-NetFirewallRule -DisplayName "NPM Admin" -Direction Inbound -Protocol TCP -LocalPort 81 -RemoteAddress YOUR.ADMIN.IP.ADDRESS -Action Allow
```

Port `8000` (the Node app) does not need to be open to the internet because
Nginx Proxy Manager proxies through Docker's internal network to reach it.

---

## Backup & cloud storage

The admin Backup & Restore page supports three storage providers. You choose one
from the **Backup & Restore** page in the admin dashboard; the setting is saved
in `.env`.

### Provider 1 — Local filesystem (default)

Backups are written to the `_backups/` folder inside the project directory (or
any absolute path you specify). No extra configuration is needed.

### Provider 2 — AWS S3 / S3-compatible (R2, MinIO, Backblaze B2…)

Set the following variables in your `.env` (or fill them in on the Backup &
Restore page):

```
BACKUP_PROVIDER=s3
BACKUP_S3_BUCKET=your-bucket-name
BACKUP_S3_REGION=us-east-1
BACKUP_S3_PREFIX=krewe-backups/         # optional, default: krewe-backups/
BACKUP_S3_ENDPOINT=                     # leave blank for AWS; set for R2/MinIO/B2
BACKUP_AWS_ACCESS_KEY_ID=AKIA…
BACKUP_AWS_SECRET_ACCESS_KEY=…
```

For Cloudflare R2 the endpoint looks like
`https://<account-id>.r2.cloudflarestorage.com`.

### Provider 3 — rclone (OneDrive personal & M365, Google Drive, Dropbox, and 70+ others)

rclone is a free, open-source CLI tool that handles cloud-storage authentication
for you. For personal OneDrive it uses Microsoft's own built-in credentials —
**no Azure app registration is required**.

**Step 1 — Install rclone on the server:**

Download the installer from <https://rclone.org/downloads/> and run it, or use
winget:

```powershell
winget install Rclone.Rclone
```

**Step 2 — Configure a remote:**

Run the interactive configuration wizard on the server:

```powershell
rclone config
```

Follow the prompts:

1. Press **n** to create a new remote.
2. Enter a short name — this is what you will type in the admin dashboard
   (e.g. `onedrive`, `gdrive`, `dropbox`).
3. Choose the storage type by number (e.g. **Microsoft OneDrive**, **Google
   Drive**, **Dropbox**, etc.).
4. For most providers rclone will open a browser window for you to sign in. If the
   server has no browser (headless), rclone prints a URL — open it on any device
   and paste the resulting code back into the terminal.
5. Accept the defaults for the remaining prompts and confirm with **q** (quit and
   save).

**Headless server (no browser):**

```powershell
rclone config
# when asked "Use auto config?", press n
# rclone prints a URL — open it on your PC, authenticate, copy the code back
```

**Step 3 — Test the remote:**

```powershell
rclone lsd onedrive:          # lists top-level folders in your OneDrive
```

Replace `onedrive` with whatever name you gave the remote.

**Step 4 — Configure in the admin dashboard:**

1. Go to **Admin → Backup & Restore**.
2. Select **rclone** as the storage provider.
3. Enter the **remote name** (exactly as typed in `rclone config`, e.g.
   `onedrive`).
4. Enter the **folder path** where backups should be stored (e.g.
   `krewe-backups`).
5. Click **Save Location**.
6. Click **Test Connection** — you should see a green ✅ confirmation.

#### Keeping rclone config when running as a service

When Krewe runs as an NSSM service, it runs under the system account which may
not have the rclone config that your user account created. Copy the config to the
service account's location, or set `RCLONE_CONFIG` in the service environment:

```powershell
nssm set krewe AppEnvironmentExtra "NODE_ENV=production" "RCLONE_CONFIG=C:\Users\YOUR_USER\.config\rclone\rclone.conf"
```

Then restart the service:

```powershell
nssm restart krewe
```

---

## Troubleshooting

### `must be owner of table element_overrides`

Run the init script again (via Git Bash) to repair table ownership:

```bash
npm run init-db
```

If it still fails, repair manually (in Git Bash):

```bash
psql -U postgres -d krewe_db -c "ALTER TABLE public.element_overrides OWNER TO krewe_db_user;"
psql -U postgres -d krewe_db -c "ALTER TABLE public.content_blocks OWNER TO krewe_db_user;"
psql -U postgres -d krewe_db -c "ALTER TABLE public.pending_registrations OWNER TO krewe_db_user;"
psql -U postgres -d krewe_db -c "ALTER TABLE public.page_sections OWNER TO krewe_db_user;"
psql -U postgres -d krewe_db -c "ALTER TABLE public.photo_albums OWNER TO krewe_db_user;"
psql -U postgres -d krewe_db -c "ALTER TABLE public.album_images OWNER TO krewe_db_user;"
psql -U postgres -d krewe_db -c "ALTER TABLE public.users OWNER TO krewe_db_user;"
```

Then restart the app:

```powershell
npm start
```

### `EADDRINUSE: address already in use :::8000`

Another process is already using port 8000.

```powershell
netstat -ano | findstr :8000
taskkill /PID <PID> /F
```

### PostgreSQL refuses connection on Windows

Open Services (`services.msc`) and confirm the PostgreSQL service is running. If
it stopped, right-click it and choose Start. Check the PostgreSQL log in
`C:\Program Files\PostgreSQL\16\data\log\` for errors.

### Nginx Proxy Manager shows `502 Bad Gateway`

This means NPM can reach your domain but cannot connect to the Node.js app on
port 8000. Check:

1. Is the Krewe app actually running? Run
   `Invoke-WebRequest -Uri http://localhost:8000/api/status -UseBasicParsing` on
   the server.
2. Is the **Forward Hostname / IP** correct in the Proxy Host settings? On Windows
   use `host.docker.internal`.
3. Is port 8000 blocked by the server's local firewall? The firewall should allow
   Docker to reach localhost — if in doubt, temporarily disable it and test.

### Let's Encrypt certificate request fails

- Confirm your domain's DNS A record points to the server's **public** IP address
  (`nslookup krewe.yourdomain.com`).
- Confirm port 80 is open to the internet (Let's Encrypt requires it for the HTTP
  challenge).
- Wait a few minutes after a DNS change and try again.
- Check the NPM logs: click **Nginx Proxy Manager → Audit Log** or run
  `docker compose logs app`.
