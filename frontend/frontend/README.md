# Krewe Mystique Modern Site

This repository contains a modern static website for Krewe Mystique de la Capitale plus an Express backend with PostgreSQL integration, JWT authentication, file management, and a built-in admin editor.

Repository: https://github.com/dsc1968/KreweWeb.git

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Linux Installation (Ubuntu 22.04 / Debian)](#linux-installation-ubuntu-2204--debian)
   - [1. System packages](#1-system-packages)
   - [2. Install Node.js](#2-install-nodejs)
   - [3. Install PostgreSQL](#3-install-postgresql)
   - [4. Clone the repository](#4-clone-the-repository)
   - [5. Install project dependencies](#5-install-project-dependencies)
   - [6. Initialize the database and .env file](#6-initialize-the-database-and-env-file)
   - [7. Start the app](#7-start-the-app)
   - [8. Auto-start on boot — systemd](#8-auto-start-on-boot--systemd)
4. [Windows Installation](#windows-installation)
   - [1. Install Git for Windows](#1-install-git-for-windows)
   - [2. Install Node.js](#2-install-nodejs-1)
   - [3. Install PostgreSQL](#3-install-postgresql-1)
   - [4. Clone the repository](#4-clone-the-repository-1)
   - [5. Install project dependencies](#5-install-project-dependencies-1)
   - [6. Initialize the database and .env file](#6-initialize-the-database-and-env-file-1)
   - [7. Start the app](#7-start-the-app-1)
   - [8. Auto-start on boot — NSSM Windows service](#8-auto-start-on-boot--nssm-windows-service)
5. [Environment Variables Reference](#environment-variables-reference)
6. [Nginx Proxy Manager — Reverse Proxy and SSL Certificates](#nginx-proxy-manager--reverse-proxy-and-ssl-certificates)
   - [Why Nginx Proxy Manager](#why-nginx-proxy-manager)
   - [Install Docker and Docker Compose (Linux)](#install-docker-and-docker-compose-linux)
   - [Install Docker Desktop (Windows)](#install-docker-desktop-windows)
   - [Deploy Nginx Proxy Manager](#deploy-nginx-proxy-manager)
   - [First-time login](#first-time-login)
   - [Add a Proxy Host for the Krewe app](#add-a-proxy-host-for-the-krewe-app)
   - [Request a free SSL certificate](#request-a-free-ssl-certificate)
   - [Firewall rules](#firewall-rules)
7. [Backup & Cloud Storage](#backup--cloud-storage)
   - [Provider 1 — Local filesystem (default)](#provider-1--local-filesystem-default)
   - [Provider 2 — AWS S3 / S3-compatible](#provider-2--aws-s3--s3-compatible-r2-minio-backblaze-b2)
   - [Provider 3 — rclone (OneDrive, Google Drive, Dropbox…)](#provider-3--rclone-onedrive-personal--m365-google-drive-dropbox-and-70-others)
8. [Troubleshooting](#troubleshooting)
9. [Optional: demo seed data](#optional-demo-seed-data)
10. [Project layout](#project-layout)
11. [Account and login features](#account-and-login-features)
12. [Notes](#notes)

---

## Overview

| Component | Role |
|-----------|------|
| **Node.js / Express** | HTTP server and REST API (default port `8000`) |
| **PostgreSQL** | Relational database for users, content, photos |
| **Nginx Proxy Manager** | Reverse proxy, HTTPS termination, Let's Encrypt certificates |
| **Docker / Docker Compose** | Container runtime for Nginx Proxy Manager |

The Node.js app handles all HTTP traffic on port `8000`. Nginx Proxy Manager sits in front of it, handles domain routing, and terminates TLS so the app itself never needs to deal with certificates.

---


## Prerequisites

| Requirement | Linux | Windows |
|-------------|-------|---------|
| 64-bit OS | Ubuntu 22.04 LTS or newer / Debian 12+ | Windows 10 v1903+ or Windows Server 2019+ |
| RAM | 1 GB minimum, 2 GB recommended | 2 GB minimum, 4 GB recommended |
| Disk | 2 GB free | 4 GB free |
| Network | Internet access during install | Internet access during install |
| Domain name | Required for public HTTPS | Required for public HTTPS |

You need administrator / sudo rights for the system-level install steps.

---

## Linux Installation (Ubuntu 22.04 / Debian)

All commands are run in a terminal. Press `Ctrl + Alt + T` to open one.

### 1. System packages

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

### 2. Install Node.js

The project requires Node.js 20 (LTS). Install it from the NodeSource repository so you get the current version rather than the outdated one packaged with Ubuntu:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

Confirm the versions:

```bash
node -v   # should print v20.x.x
npm -v    # should print 10.x.x or similar
```

### 3. Install PostgreSQL

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

### 4. Clone the repository

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

### 5. Install project dependencies

From the project root (the folder that contains `package.json`):

```bash
npm install
```

This downloads every package listed in `package.json` into `node_modules/`. It does not need root and must not be run with `sudo`.

### 6. Initialize the database and .env file

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

The script will prompt you for a password for the database user. Enter something strong and remember it — the script puts it in `.env` so you will not need to type it again.

To supply the password non-interactively (less secure because it appears in shell history):

```bash
npm run init-db -- yourStrongPassword
```

**Default admin credentials created by the initializer:**

| Field | Value |
|-------|-------|
| Email | `admin@krewe.local` |
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

### 7. Start the app

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

### 8. Auto-start on boot — systemd

Use systemd to keep the app running as a background service and restart it automatically after crashes or reboots.

**Step 1 — Find the full path to node:**

```bash
which node
# example output: /usr/bin/node
```

**Step 2 — Create the service file:**

Create `/etc/systemd/system/krewe.service` (replace `your-username` and the path if you cloned to a different location):

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
ExecStart=/usr/bin/node /srv/kreweweb/Krewe/server.js
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

From this point on, the app starts automatically every time the server boots, after PostgreSQL has finished starting.

---

## Windows Installation

All commands below are run in **PowerShell** opened as Administrator unless stated otherwise.  
Right-click the Start button → "Windows PowerShell (Admin)" or "Terminal (Admin)".

### 1. Install Git for Windows

Download the installer from https://git-scm.com/download/win and run it. Accept the defaults. When the installer asks about the default terminal, choose "Use Windows' default console window" or "Git Bash" — either works.

After installation, close and reopen PowerShell, then confirm:

```powershell
git --version
```

### 2. Install Node.js

Download the **LTS** installer (20.x) from https://nodejs.org/ and run it. Check the box that says "Automatically install the necessary tools" when prompted — this installs build tools needed for native modules.

Confirm the installation:

```powershell
node -v
npm -v
```

### 3. Install PostgreSQL

Download the Windows installer from https://www.enterprisedb.com/downloads/postgres-postgresql-downloads and run it. Choose version **15** or **16**.

During installation:

1. Set a **superuser password** for the `postgres` account. Write this down — you will need it once to create the app database user.
2. Leave the default port `5432` unchanged.
3. Leave the default locale.
4. Install all components (server, pgAdmin, command-line tools).

After installation, open the **Services** panel (`Win + R` → `services.msc`). Find **postgresql-x64-16** (or whichever version you installed). Confirm it is running and set to **Automatic** startup.

To set it via PowerShell:

```powershell
Set-Service -Name "postgresql-x64-16" -StartupType Automatic
Start-Service -Name "postgresql-x64-16"
```

Adjust the service name to match the version you installed. You can find the exact name with:

```powershell
Get-Service | Where-Object { $_.Name -like "postgresql*" }
```

Add the PostgreSQL `bin` folder to your system PATH so `psql` is available anywhere. Replace the path with your actual install location:

```powershell
$pgBin = "C:\Program Files\PostgreSQL\16\bin"
[System.Environment]::SetEnvironmentVariable("PATH", $env:PATH + ";$pgBin", [System.EnvironmentVariableTarget]::Machine)
```

Close and reopen PowerShell after running this, then confirm:

```powershell
psql --version
```

### 4. Clone the repository

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

### 5. Install project dependencies

From the project root (the folder that contains `package.json`):

```powershell
npm install
```

Do not use an Administrator PowerShell for this step unless you have to — running `npm install` as Administrator can cause permission issues.

### 6. Initialize the database and .env file

The database init script is written for Bash. On Windows you have two options:

**Option A — Git Bash (recommended)**

Open Git Bash (it was installed with Git for Windows). Navigate to the project folder:

```bash
cd /c/srv/kreweweb/Krewe
npm run init-db
```

The script will prompt for a password for the database user. Enter something strong.

**Option B — WSL (Windows Subsystem for Linux)**

If you have WSL 2 with Ubuntu installed, open an Ubuntu terminal and follow the Linux instructions from step 4 onward.

After `npm run init-db` completes it creates a `.env` file in the project root. Open it in Notepad to confirm it looks similar to this:

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

Change this password after your first login.

### 7. Start the app

In PowerShell (no Admin needed) from the project root:

```powershell
npm start
```

Open a browser and go to `http://localhost:8000`. Test it in PowerShell:

```powershell
Invoke-WebRequest -Uri http://localhost:8000/api/status -UseBasicParsing
```

A `StatusCode: 200` response means the server and database are both working.

### 8. Auto-start on boot — NSSM Windows service

NSSM (Non-Sucking Service Manager) wraps any executable as a proper Windows service so it starts at boot and restarts after crashes.

**Step 1 — Download NSSM**

Go to https://nssm.cc/download and download the latest release. Extract the zip file and copy `nssm.exe` from the `win64` folder to `C:\Windows\System32\` so it is available in PATH everywhere.

**Step 2 — Install the Krewe app as a service**

Open PowerShell **as Administrator**.

Find the full path to node.exe:

```powershell
where.exe node
# example: C:\Program Files\nodejs\node.exe
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

Create the logs folder first:

```powershell
mkdir C:\srv\kreweweb\Krewe\logs
```

**Step 3 — Set environment variables for the service**

The service needs to know where `.env` is. NSSM can inject environment variables:

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

You can also control it from the Services panel (`services.msc`) like any other Windows service.

From this point on, the Krewe app starts automatically when Windows boots, after PostgreSQL has started.

---

## Environment Variables Reference

The `.env` file in the project root controls all runtime settings. The init script creates it for you, but you can edit it manually at any time.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `JWT_SECRET` | Yes | — | Secret key for signing JWT tokens. Use a long random string in production |
| `PORT` | No | `8000` | Port the Express server listens on |
| `NODE_ENV` | No | — | Set to `production` in production |
| `SMTP_HOST` | No | — | SMTP server hostname for outbound email |
| `SMTP_PORT` | No | `587` | SMTP server port |
| `SMTP_SECURE` | No | `false` | Set to `true` to use TLS on the SMTP connection |
| `SMTP_USER` | No | — | SMTP login username |
| `SMTP_PASS` | No | — | SMTP login password |
| `SMTP_FROM` | No | — | From address for outbound email |
| `SMTP_REPLY_TO` | No | — | Reply-To address for outbound email |
| `CONTACT_RECIPIENT` | No | — | Address that receives contact form submissions |

Keep `.env` private. It is listed in `.gitignore` and must never be committed to the repository.

---

## Nginx Proxy Manager — Reverse Proxy and SSL Certificates

### Why Nginx Proxy Manager

Nginx Proxy Manager (NPM) is a browser-based GUI that sits in front of the Node.js app. It handles:

- Routing your domain name to the Node app running on port `8000`
- Obtaining and automatically renewing free Let's Encrypt SSL certificates
- Forcing all HTTP traffic to HTTPS
- Supporting multiple domains and subdomains from one interface

NPM runs in Docker, which keeps it isolated from the rest of the system and makes it easy to update.

### Install Docker and Docker Compose (Linux)

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

### Install Docker Desktop (Windows)

Docker Desktop bundles Docker Engine, Docker Compose, and a GUI all in one installer.

1. Go to https://www.docker.com/products/docker-desktop/ and download **Docker Desktop for Windows**.
2. Run the installer. When asked, choose **Use WSL 2 instead of Hyper-V** (recommended).
3. Restart Windows when prompted.
4. Open Docker Desktop from the Start menu and wait for it to finish starting (the whale icon in the system tray turns solid when it is ready).
5. Open PowerShell and confirm:

```powershell
docker --version
docker compose version
```

Docker Desktop sets itself to start with Windows automatically. You can change this in Docker Desktop → Settings → General → "Start Docker Desktop when you sign in".

### Deploy Nginx Proxy Manager

These steps are the same on Linux and Windows. Run them in a terminal (Linux) or PowerShell (Windows).

**Step 1 — Create a folder for NPM's data:**

Linux:
```bash
sudo mkdir -p /srv/nginx-proxy-manager/data
sudo mkdir -p /srv/nginx-proxy-manager/letsencrypt
cd /srv/nginx-proxy-manager
```

Windows (PowerShell):
```powershell
mkdir C:\srv\nginx-proxy-manager\data
mkdir C:\srv\nginx-proxy-manager\letsencrypt
cd C:\srv\nginx-proxy-manager
```

**Step 2 — Create the Docker Compose file:**

Linux:
```bash
nano docker-compose.yml
```

Windows (PowerShell):
```powershell
notepad docker-compose.yml
```

Paste this content exactly (replace `./data` and `./letsencrypt` with absolute paths on Windows):

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

On Windows use absolute paths:

```yaml
    volumes:
      - C:\srv\nginx-proxy-manager\data:/data
      - C:\srv\nginx-proxy-manager\letsencrypt:/etc/letsencrypt
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

Because the Compose file sets `restart: unless-stopped` and Docker is enabled on boot, NPM will start automatically whenever Docker starts. No extra steps are needed.

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

NPM will immediately ask you to change the email address and password. Do this before going any further.

### Add a Proxy Host for the Krewe app

A Proxy Host tells NPM to forward traffic for your domain to the Node.js app.

**Before you start:** Make sure your domain's DNS A record points to your server's public IP address. DNS changes can take up to 24 hours to propagate, but usually take a few minutes.

1. In the NPM admin panel, click **Proxy Hosts** in the left menu.
2. Click **Add Proxy Host**.
3. Fill in the **Details** tab:
   - **Domain Names:** enter your domain, e.g. `krewe.yourdomain.com`. Press Enter to add it. Add `www.krewe.yourdomain.com` as a second entry if you want to support `www`.
   - **Scheme:** `http`
   - **Forward Hostname / IP:** 
     - On Linux: `172.17.0.1` (the Docker bridge gateway that reaches the host machine) or use `host.docker.internal` if your Docker version supports it.
     - On Windows (Docker Desktop): `host.docker.internal`
   - **Forward Port:** `8000`
   - Enable **Block Common Exploits**
   - Enable **Websockets Support** (the admin editor uses WebSocket-like long-polling)
4. Click **Save**.

Test that the proxy works before setting up SSL:

```
http://krewe.yourdomain.com
```

You should see the Krewe site served over plain HTTP. Fix any errors at this stage before adding SSL.

### Request a free SSL certificate

1. In the NPM admin panel, click **Proxy Hosts** and click the **three-dot menu** (⋮) on the host you just created. Choose **Edit**.
2. Click the **SSL** tab.
3. Under **SSL Certificate**, choose **Request a new SSL Certificate**.
4. Enable **Force SSL** — this redirects all HTTP requests to HTTPS automatically.
5. Enable **HTTP/2 Support** for better performance.
6. Enter your email address in the **Let's Encrypt Email** field. Let's Encrypt sends certificate expiry warnings to this address.
7. Check the **I Agree to the Let's Encrypt Terms of Service** box.
8. Click **Save**.

NPM contacts Let's Encrypt, completes the domain verification challenge, and installs the certificate. This takes about 30 seconds. When it completes, the Proxy Host list will show a green padlock next to your domain.

Test HTTPS:

```
https://krewe.yourdomain.com
```

**Certificate renewal is automatic.** NPM renews Let's Encrypt certificates before they expire (every 90 days). You do not need to do anything.

### Firewall rules

For everything to work, your server's firewall must allow inbound traffic on these ports:

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

Port `8000` (the Node app) does not need to be open to the internet because Nginx Proxy Manager proxies through Docker's internal network to reach it.

**Windows Firewall:**

Open PowerShell as Administrator:

```powershell
New-NetFirewallRule -DisplayName "HTTP"  -Direction Inbound -Protocol TCP -LocalPort 80  -Action Allow
New-NetFirewallRule -DisplayName "HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow
# Restrict NPM admin panel to your IP only
New-NetFirewallRule -DisplayName "NPM Admin" -Direction Inbound -Protocol TCP -LocalPort 81 -RemoteAddress YOUR.ADMIN.IP.ADDRESS -Action Allow
```

---

## Backup & Cloud Storage

The admin Backup & Restore page supports three storage providers. You choose one from the **Backup & Restore** page in the admin dashboard; the setting is saved in `.env`.

### Provider 1 — Local filesystem (default)

Backups are written to the `_backups/` folder inside the project directory (or any absolute path you specify). No extra configuration is needed.

---

### Provider 2 — AWS S3 / S3-compatible (R2, MinIO, Backblaze B2…)

Set the following variables in your `.env` (or fill them in on the Backup & Restore page):

```
BACKUP_PROVIDER=s3
BACKUP_S3_BUCKET=your-bucket-name
BACKUP_S3_REGION=us-east-1
BACKUP_S3_PREFIX=krewe-backups/         # optional, default: krewe-backups/
BACKUP_S3_ENDPOINT=                     # leave blank for AWS; set for R2/MinIO/B2
BACKUP_AWS_ACCESS_KEY_ID=AKIA…
BACKUP_AWS_SECRET_ACCESS_KEY=…
```

For Cloudflare R2 the endpoint looks like `https://<account-id>.r2.cloudflarestorage.com`.

---

### Provider 3 — rclone (OneDrive personal & M365, Google Drive, Dropbox, and 70+ others)

rclone is a free, open-source CLI tool that handles cloud-storage authentication for you. For personal OneDrive it uses Microsoft's own built-in credentials — **no Azure app registration is required**.

#### Step 1 — Install rclone on the server

**Linux:**

```bash
sudo -v && curl https://rclone.org/install.sh | sudo bash
```

Verify the installation:

```bash
rclone version
```

**Windows:**

Download the installer from <https://rclone.org/downloads/> and run it, or use winget:

```powershell
winget install Rclone.Rclone
```

#### Step 2 — Configure a remote

Run the interactive configuration wizard on the server:

```bash
rclone config
```

Follow the prompts:

1. Press **n** to create a new remote.
2. Enter a short name — this is what you will type in the admin dashboard (e.g. `onedrive`, `gdrive`, `dropbox`).
3. Choose the storage type by number (e.g. **Microsoft OneDrive**, **Google Drive**, **Dropbox**, etc.).
4. For most providers rclone will open a browser window for you to sign in. If the server has no browser (headless), rclone prints a URL — open it on any device and paste the resulting code back into the terminal.
5. Accept the defaults for the remaining prompts and confirm with **q** (quit and save).

**OneDrive personal example session (abridged):**

```
$ rclone config
n/s/q> n
name> onedrive
Storage> onedrive          # or the number shown for Microsoft OneDrive
...
Use auto config?
 * Say Y if not sure
 * Say N if you are working on a remote or headless machine
y/n> y          # opens browser — sign in with your personal Microsoft account
...
Configuration complete.
```

**Headless server (no browser):**

```bash
rclone config
# when asked "Use auto config?", press n
# rclone prints a URL — open it on your PC, authenticate, copy the code back
```

#### Step 3 — Test the remote

```bash
rclone lsd onedrive:          # lists top-level folders in your OneDrive
```

Replace `onedrive` with whatever name you gave the remote.

#### Step 4 — Configure in the admin dashboard

1. Go to **Admin → Backup & Restore**.
2. Select **rclone** as the storage provider.
3. Enter the **remote name** (exactly as typed in `rclone config`, e.g. `onedrive`).
4. Enter the **folder path** where backups should be stored (e.g. `krewe-backups`).
5. Click **Save Location**.
6. Click **Test Connection** — you should see a green ✅ confirmation.

#### Keeping rclone config when running as a service

When Krewe runs as a systemd service (Linux) or NSSM service (Windows), it runs under the system account which may not have the rclone config that your user account created. Fix this with one of the following options:

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

Linux — find and kill it:

```bash
sudo lsof -i :8000
sudo kill -9 <PID>
```

Windows:

```powershell
netstat -ano | findstr :8000
taskkill /PID <PID> /F
```

### PostgreSQL refuses connection on Windows

Open Services (`services.msc`) and confirm the PostgreSQL service is running. If it stopped, right-click it and choose Start. Check the PostgreSQL log in `C:\Program Files\PostgreSQL\16\data\log\` for errors.

### Nginx Proxy Manager shows `502 Bad Gateway`

This means NPM can reach your domain but cannot connect to the Node.js app on port 8000. Check:

1. Is the Krewe app actually running? Run `curl http://localhost:8000/api/status` on the server.
2. Is the **Forward Hostname / IP** correct in the Proxy Host settings? On Linux use `172.17.0.1`; on Windows use `host.docker.internal`.
3. Is port 8000 blocked by the server's local firewall? The firewall should allow Docker to reach localhost — if in doubt, temporarily disable it and test.

### Let's Encrypt certificate request fails

- Confirm your domain's DNS A record points to the server's **public** IP address (`dig krewe.yourdomain.com` or `nslookup krewe.yourdomain.com`).
- Confirm port 80 is open to the internet (Let's Encrypt requires it for the HTTP challenge).
- Wait a few minutes after a DNS change and try again.
- Check the NPM logs: click **Nginx Proxy Manager → Audit Log** or run `docker compose logs app`.

---

## Optional: demo seed data

After the server is running you can create demo accounts for development and testing:

```bash
npm run seed
```

Or via the API while the server is running:

```bash
curl -X POST http://localhost:8000/api/dev/seed
```

Do not use demo accounts in production.

---

## Project layout

| Path | Description |
|------|-------------|
| `app/index.html` | Homepage |
| `app/styles.css` | Landing page styling |
| `app/script.js` | Front-end behavior |
| `server.js` | Express server — API and static file serving |
| `package.json` | Node dependencies and npm scripts |
| `db-init.sql` | PostgreSQL schema |
| `scripts/init_db.sh` | Database and `.env` initializer |
| `seed.js` | Demo data seeder |
| `_backups/` | Server-managed database backups |

---

## Account and login features

The site includes member registration and login with JWT authentication and email verification.

To create a real account:

1. Open `http://localhost:8000/register.html`
2. Fill in your name, email, password, and verification method
3. Request the verification code and enter it when prompted

To log in:

1. Open `http://localhost:8000/login.html`
2. Enter your email and password

---

## Notes

- Keep `.env` private. It is in `.gitignore` and must never be committed to the repository.
- In production, email verification requires valid `SMTP_*` settings in `.env`.
- JWT tokens expire after 7 days.
- The server listens on port `8000` unless you change `PORT` in `.env`.
- The NPM admin panel (port `81`) should be restricted to your IP address in production — it has full control over all proxy rules and certificates.

