# Installing Krewe Mystique on Linux (Ubuntu 22.04 / Debian)

This guide covers a full Linux installation of the Krewe Mystique web platform:
system packages, Node.js, PostgreSQL, cloning the repo, initializing the
database, running the app, and configuring it to start automatically with
systemd.

All commands are run in a terminal. Press `Ctrl + Alt + T` to open one.

For Windows, see [INSTALL_WINDOWS.md](INSTALL_WINDOWS.md). For a general project
overview, see [README.md](README.md).

---

## Prerequisites

| Requirement | Linux |
|-------------|-------|
| 64-bit OS | Ubuntu 22.04 LTS or newer / Debian 12+ |
| Node.js | 20.x (LTS) |
| PostgreSQL | 15 / 16 |
| RAM | 1 GB minimum, 2 GB recommended |
| Disk | 2 GB free |
| Network | Internet access during install |
| Domain name | Required for public HTTPS |

You need `sudo` rights for the system-level install steps.

---

## 1. System packages

Update the package index and install the tools this project depends on:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y \
    git \
    curl \
    ca-certificates \
    gnupg \
    build-essential \
    openssl \
    xxd \
    postgresql \
    postgresql-client
```

What each package does:

| Package | Purpose |
|---------|---------|
| `git` | Clone the repository |
| `curl` | Download installer scripts and test API endpoints |
| `ca-certificates`, `gnupg` | Verify signed package sources |
| `build-essential` | Native compiler for npm packages that need it |
| `openssl`, `xxd` | Used by the database init script to generate secrets |
| `postgresql`, `postgresql-client` | Database server and command-line client |

---

## 2. Install Node.js

The project requires Node.js 20 (LTS). Install it from the NodeSource repository
so you get the current version rather than the outdated one packaged with Ubuntu:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

Confirm the versions:

```bash
node -v   # should print v20.x.x
npm -v    # should print 10.x.x or similar
```

---

## 3. Install PostgreSQL

PostgreSQL was already installed in step 1. Confirm it is running:

```bash
sudo systemctl status postgresql
```

You should see `active (running)`. If it is not running, start it:

```bash
sudo systemctl start postgresql
```

Enable PostgreSQL to start automatically every time the server reboots:

```bash
sudo systemctl enable postgresql
```

Verify the connection is reachable:

```bash
sudo -u postgres psql -c "SELECT version();"
```

---

## 4. Clone the repository

For production servers, keep the app under `/srv`:

```bash
sudo mkdir -p /srv/kreweweb
sudo chown -R "$USER":"$USER" /srv/kreweweb
git clone https://github.com/dsc1968/KreweWeb.git /srv/kreweweb/Krewe
cd /srv/kreweweb/Krewe
```

For a local development machine you can clone anywhere:

```bash
git clone https://github.com/dsc1968/KreweWeb.git ~/krewe
cd ~/krewe
```

---

## 5. Install project dependencies

From the project root (the folder that contains `package.json`):

```bash
npm install
```

This downloads every package listed in `package.json` into `node_modules/`. It
does not need root and must not be run with `sudo`.

> Run `npm install` **once, from the repository root** (the folder that contains
> `package.json`) — do **not** run it from `frontend/` or any nested copy, because
> only the root install populates the `node_modules/` that the backend loads.
> `npm start` runs `node backend/server.js`, which requires these packages.

---

## 6. Initialize the database and .env file

The included helper script does everything in one go:

- Creates a PostgreSQL role (`krewe_db_user`)
- Creates the `krewe_db` database
- Applies the schema from `db-init.sql`
- Writes a `.env` file with the database connection string and a random JWT secret
- Creates a default admin account

Run it from the project root:

```bash
npm run init-db
```

The script will prompt you for a password for the database user. Enter something
strong and remember it — the script puts it in `.env` so you will not need to
type it again.

To supply the password non-interactively (less secure because it appears in
shell history):

```bash
npm run init-db -- yourStrongPassword
```

**Default admin credentials created by the initializer:**

> **MFA is enforced for admin accounts.** On first login you must complete an
> MFA sign-in step, so the bootstrap admin needs a **reachable email** to receive
> the code. When you run the initializer interactively it prompts for this email
> and defaults to `admin@krewe.local` — **enter a real, deliverable address** (or
> set `DEFAULT_ADMIN_EMAIL` below) so you can actually log in.

| Field | Value |
|-------|-------|
| Email | prompted (default `admin@krewe.local`) |
| Password | `admin123` |

Change this password immediately after your first login.

To use a custom admin account at creation time:

```bash
DEFAULT_ADMIN_EMAIL=you@yourdomain.com DEFAULT_ADMIN_PASSWORD=StrongPass123! npm run init-db
```

To skip creating the default admin entirely:

```bash
CREATE_DEFAULT_ADMIN=false npm run init-db
```

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
| `DEFAULT_ADMIN_EMAIL` | `admin@krewe.local` | Email for the bootstrap admin account (prompted interactively; must be reachable for MFA) |
| `DEFAULT_ADMIN_NAME` | `Admin User` | Display name for the bootstrap admin account |
| `DEFAULT_ADMIN_PASSWORD` | `admin123` | Password for the bootstrap admin account |

---

## 7. Start the app

```bash
npm start
```

The server listens on port `8000` by default. Open a browser and go to:

```
http://localhost:8000
```

Or test it from the terminal:

```bash
curl http://localhost:8000/api/status
```

A JSON status response means the server and database are both working.

### Optional: demo seed data

After the server is running you can create demo accounts for development and
testing:

```bash
npm run seed
```

Or via the API while the server is running:

```bash
curl -X POST http://localhost:8000/api/dev/seed
```

Do not use demo accounts in production.

---

## 8. Auto-start on boot — systemd

Use systemd to keep the app running as a background service and restart it
automatically after crashes or reboots.

**Step 1 — Find the full path to node:**

```bash
which node
# example output: /usr/bin/node
```

**Step 2 — Create the service file:**

Create `/etc/systemd/system/krewe.service` (replace `your-username` and the path
if you cloned to a different location):

```bash
sudo nano /etc/systemd/system/krewe.service
```

Paste the following, adjusting `User` and `WorkingDirectory`:

```ini
[Unit]
Description=Krewe Mystique Web App
Documentation=https://github.com/dsc1968/KreweWeb
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=your-username
WorkingDirectory=/srv/kreweweb/Krewe
Environment=NODE_ENV=production

ExecStart=/usr/bin/node /srv/kreweweb/Krewe/backend/server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=krewe

[Install]
WantedBy=multi-user.target
```

Save with `Ctrl + O`, then `Enter`, then `Ctrl + X`.

**Step 3 — Enable and start the service:**

```bash
sudo systemctl daemon-reload
sudo systemctl enable krewe.service
sudo systemctl start krewe.service
```

**Step 4 — Check it is running:**

```bash
sudo systemctl status krewe.service
```

You should see `Active: active (running)`.

**Step 5 — View live logs:**

```bash
sudo journalctl -u krewe.service -f
```

Press `Ctrl + C` to stop following the log.

From this point on, the app starts automatically every time the server boots,
after PostgreSQL has finished starting.

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
| `PAYMENT_SIMULATE` | No | `false` | Set `true` to simulate payments without contacting PayPal |
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

### Install Docker and Docker Compose

**Step 1 — Remove old Docker packages if present:**

```bash
sudo apt remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true
```

**Step 2 — Add Docker's official GPG key and repository:**

```bash
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
    sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
```

**Step 3 — Install Docker Engine and the Compose plugin:**

```bash
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

**Step 4 — Add your user to the docker group** (so you can run docker without sudo):

```bash
sudo usermod -aG docker "$USER"
newgrp docker
```

**Step 5 — Enable Docker to start on boot:**

```bash
sudo systemctl enable docker
sudo systemctl start docker
```

**Step 6 — Confirm Docker is working:**

```bash
docker --version
docker compose version
```

### Deploy Nginx Proxy Manager

**Step 1 — Create a folder for NPM's data:**

```bash
sudo mkdir -p /srv/nginx-proxy-manager/data
sudo mkdir -p /srv/nginx-proxy-manager/letsencrypt
cd /srv/nginx-proxy-manager
```

**Step 2 — Create the Docker Compose file:**

```bash
nano docker-compose.yml
```

Paste this content exactly:

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
      - ./data:/data
      - ./letsencrypt:/etc/letsencrypt
```

**Step 3 — Start Nginx Proxy Manager:**

```bash
docker compose up -d
```

**Step 4 — Confirm the container is running:**

```bash
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
   - **Forward Hostname / IP:** `172.17.0.1` (the Docker bridge gateway that
     reaches the host machine) or use `host.docker.internal` if your Docker
     version supports it.
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

**Linux — ufw example:**

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow from YOUR.ADMIN.IP.ADDRESS to any port 81   # restrict panel to your IP
sudo ufw enable
sudo ufw status
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

```bash
sudo -v && curl https://rclone.org/install.sh | sudo bash
```

Verify the installation:

```bash
rclone version
```

**Step 2 — Configure a remote:**

Run the interactive configuration wizard on the server:

```bash
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

```bash
rclone config
# when asked "Use auto config?", press n
# rclone prints a URL — open it on your PC, authenticate, copy the code back
```

**Step 3 — Test the remote:**

```bash
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

When Krewe runs as a systemd service, it runs under the system account which may
not have the rclone config that your user account created. Fix this with one of
the following options:

**Option A — Copy the config to the service user's home:**

```bash
# If the service runs as root:
cp ~/.config/rclone/rclone.conf /root/.config/rclone/rclone.conf

# If the service runs as a dedicated user (e.g. "krewe"):
sudo mkdir -p /home/krewe/.config/rclone
sudo cp ~/.config/rclone/rclone.conf /home/krewe/.config/rclone/rclone.conf
sudo chown -R krewe:krewe /home/krewe/.config/rclone
```

**Option B — Set `RCLONE_CONFIG` in the service environment:**

Add to `/etc/systemd/system/krewe.service` under `[Service]`:

```ini
Environment=RCLONE_CONFIG=/home/YOUR_USER/.config/rclone/rclone.conf
```

Then reload and restart:

```bash
sudo systemctl daemon-reload
sudo systemctl restart krewe
```

---

## Troubleshooting

### `must be owner of table element_overrides`

Run the init script again to repair table ownership:

```bash
npm run init-db
```

If it still fails, repair manually:

```bash
sudo -u postgres psql -d krewe_db -c "ALTER TABLE public.element_overrides OWNER TO krewe_db_user;"
sudo -u postgres psql -d krewe_db -c "ALTER TABLE public.content_blocks OWNER TO krewe_db_user;"
sudo -u postgres psql -d krewe_db -c "ALTER TABLE public.pending_registrations OWNER TO krewe_db_user;"
sudo -u postgres psql -d krewe_db -c "ALTER TABLE public.page_sections OWNER TO krewe_db_user;"
sudo -u postgres psql -d krewe_db -c "ALTER TABLE public.photo_albums OWNER TO krewe_db_user;"
sudo -u postgres psql -d krewe_db -c "ALTER TABLE public.album_images OWNER TO krewe_db_user;"
sudo -u postgres psql -d krewe_db -c "ALTER TABLE public.users OWNER TO krewe_db_user;"
```

Then restart the app:

```bash
npm start
```

### `EADDRINUSE: address already in use :::8000`

Another process is already using port 8000.

```bash
sudo lsof -i :8000
sudo kill -9 <PID>
```

### Nginx Proxy Manager shows `502 Bad Gateway`

This means NPM can reach your domain but cannot connect to the Node.js app on
port 8000. Check:

1. Is the Krewe app actually running? Run `curl http://localhost:8000/api/status`
   on the server.
2. Is the **Forward Hostname / IP** correct in the Proxy Host settings? On Linux
   use `172.17.0.1`.
3. Is port 8000 blocked by the server's local firewall? The firewall should allow
   Docker to reach localhost — if in doubt, temporarily disable it and test.

### Let's Encrypt certificate request fails

- Confirm your domain's DNS A record points to the server's **public** IP address
  (`dig krewe.yourdomain.com` or `nslookup krewe.yourdomain.com`).
- Confirm port 80 is open to the internet (Let's Encrypt requires it for the HTTP
  challenge).
- Wait a few minutes after a DNS change and try again.
- Check the NPM logs: click **Nginx Proxy Manager → Audit Log** or run
  `docker compose logs app`.
