# Krewe Mystique Modern Site

This repository contains a modern static website for Krewe Mystique de la Capitale plus an optional Express backend with Postgres integration.

Repository: https://github.com/dsc1968/KreweWeb.git

## Quickstart (commands only)

Run these commands in order on Ubuntu:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl ca-certificates gnupg build-essential openssl postgresql postgresql-client xxd
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

sudo mkdir -p /srv/kreweweb
sudo chown -R "$USER":"$USER" /srv/kreweweb
git clone https://github.com/dsc1968/KreweWeb.git /srv/kreweweb/Krewe
cd /srv/kreweweb/Krewe

npm install
npm run init-db
npm start
```

Verify:

```bash
curl http://localhost:8000/api/status
```

## What you need first

This guide is written for a fresh Ubuntu machine. If you do not have admin rights on the computer, ask the person who does to run the system install steps once. After that, you can finish the project setup with your normal user account.

You will need:

- Ubuntu 22.04 or newer
- An internet connection
- A terminal window
- A user account that can run `sudo` for the system install steps

## Ubuntu setup from zero

### 1. Open Terminal

On Ubuntu, press `Ctrl + Alt + T` to open a terminal.

### 2. Update Ubuntu first

Run these commands so your package lists are current:

```bash
sudo apt update
sudo apt upgrade -y
```

If Ubuntu asks for your password, that is the password for your Linux user account.

### 3. Install the basic tools this project needs

Install Git, curl, PostgreSQL client tools, and a few helper packages:

```bash
sudo apt install -y git curl ca-certificates gnupg build-essential openssl postgresql-client xxd
```

If one of these packages is already installed, Ubuntu will skip it.

### 4. Install Node.js and npm

This project uses Node.js. The safest simple choice on Ubuntu is the current LTS release from NodeSource.

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

Check that Node.js was installed correctly:

```bash
node -v
npm -v
```

If those commands print version numbers, you are ready for the next step.

### 5. Install PostgreSQL if it is not already on the machine

If this computer does not already have PostgreSQL server tools installed, add them now:

```bash
sudo apt install -y postgresql
```

If PostgreSQL is already installed, this command will simply confirm it.

### 6. Get the project files onto your computer

For server installs, place the app under `/srv` instead of a user home directory.

Create the folder and give your current user access:

```bash
sudo mkdir -p /srv/kreweweb
sudo chown -R "$USER":"$USER" /srv/kreweweb
```

Then clone the repository into `/srv/kreweweb`.

Example using Git:

```bash
git clone https://github.com/dsc1968/KreweWeb.git /srv/kreweweb/Krewe
cd /srv/kreweweb/Krewe
```

If you already have the folder open in VS Code, just open a terminal in that folder and continue.

### 7. Install the project dependencies

From the project root:

```bash
npm install
```

This downloads the packages listed in `package.json`.

### 8. Set up the database and create the `.env` file

This project includes a helper script that does the following:

- creates a PostgreSQL role
- creates the database
- applies the schema from `db-init.sql`
- applies the schema as the DB app user and repairs ownership for all app tables
- writes a `.env` file with the connection details
- creates a default admin user (first run)

If the database already exists, `npm run init-db` reapplies ownership and permissions for app tables/sequences in the `public` schema and skips system/extension-managed objects. It does not run global role reassignment.

It explicitly enforces owner `krewe_db_user` (or your configured `DB_USER`) for required tables including:

- `public.element_overrides`
- `public.content_blocks`
- `public.users`
- `public.pending_registrations`
- `public.page_sections`
- `public.photo_albums`
- `public.album_images`

Run it from the project root:

```bash
npm run init-db
```

The script will ask you for a password for the new database user.

If you want to supply the password directly instead of typing it at the prompt, you can do this:

```bash
npm run init-db -- yourpassword
```

That is easier, but it is less secure because the password may be visible in your shell history.

If a `.env` file already exists, the script keeps a backup as `.env.bak`.

Default admin credentials created by `npm run init-db`:

- Email: `admin@krewe.local`
- Password: `admin123`

Change this password after your first login.

To customize or skip bootstrap admin creation:

```bash
# Custom bootstrap admin
DEFAULT_ADMIN_EMAIL=owner@example.com DEFAULT_ADMIN_PASSWORD=ChangeMeNow123 npm run init-db

# Skip bootstrap admin creation
CREATE_DEFAULT_ADMIN=false npm run init-db
```

### 9. Start the app

Once the database is ready, start the server:

```bash
npm start
```

Open this address in your browser:

```text
http://localhost:8000
```

### 10. Check that everything works

Use the status endpoint to confirm the server is running:

```bash
curl http://localhost:8000/api/status
```

If the server is working, the command will return a small status response in your terminal.

If you see `must be owner of table element_overrides` when starting the app, run `npm run init-db` again and allow sudo access when prompted. The initializer repairs ownership of existing tables and sequences so the configured DB app user owns them.

If that still fails, repair the owner manually (replace names if you changed defaults):

```bash
sudo -u postgres psql -d krewe_db -c "ALTER TABLE public.element_overrides OWNER TO \"krewe_db_user\";"
sudo -u postgres psql -d krewe_db -c "ALTER TABLE public.content_blocks OWNER TO \"krewe_db_user\";"
sudo -u postgres psql -d krewe_db -c "ALTER TABLE public.pending_registrations OWNER TO \"krewe_db_user\";"
sudo -u postgres psql -d krewe_db -c "ALTER TABLE public.page_sections OWNER TO \"krewe_db_user\";"
```

Then run:

```bash
npm run init-db
npm start
```

## Optional: demo accounts for local testing

After the server is running, you can create demo accounts for development:

```bash
npm run seed
```

You can also seed them through the API while the server is running:

```bash
curl -X POST http://localhost:8000/api/dev/seed
```

This is development-only. Do not use demo accounts in production.

Note: the initializer already creates a starter admin account (`admin@krewe.local` / `admin123`), so running the seed step is optional.

## Optional: set up HTTPS with Let's Encrypt

Use this only if you are putting the site on a public Ubuntu server with a real domain name. You need admin access for these steps.

Before you start, make sure:

- your domain name points to the server's public IP address
- ports 80 and 443 are open in your firewall or hosting panel
- the app is already running on the server, usually on port 8000

### 1. Install Nginx and Certbot

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

### 2. Create an Nginx site that forwards traffic to the app

Create a server block for your domain and proxy requests to the Node app on port 8000. Replace `example.com` with your real domain.

```nginx
server {
	listen 80;
	server_name example.com www.example.com;

	location / {
		proxy_pass http://localhost:8000;
		proxy_http_version 1.1;
		proxy_set_header Host $host;
		proxy_set_header X-Real-IP $remote_addr;
		proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto $scheme;
	}
}
```

Enable the site and reload Nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### 3. Ask Let's Encrypt for a certificate

Run Certbot and let it update Nginx for you:

```bash
sudo certbot --nginx -d example.com -d www.example.com
```

If you only use one name, remove the extra `-d www.example.com` part.

### 4. Test automatic renewal

```bash
sudo certbot renew --dry-run
```

If that command works, your certificate should renew automatically.

## Optional: start app automatically on server startup (systemd)

Use this on Ubuntu servers so the app starts automatically after reboot.

### 1. Find full paths for node and npm

```bash
which node
which npm
```

Typical result is `/usr/bin/node` and `/usr/bin/npm`.

### 2. Create a systemd service file

Create `/etc/systemd/system/krewe.service`:

```ini
[Unit]
Description=Krewe Web App
After=network.target postgresql.service

[Service]
Type=simple
User=doug
WorkingDirectory=/srv/kreweweb/Krewe
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Replace `User` and `WorkingDirectory` with your server values.

### 3. Enable and start the service

```bash
sudo systemctl daemon-reload
sudo systemctl enable krewe.service
sudo systemctl start krewe.service
```

### 4. Check status and logs

```bash
sudo systemctl status krewe.service
sudo journalctl -u krewe.service -f
```

If the service is active and running, the app will auto-start on reboot.

## If you only want the front-end

If you do not want the database-backed features, you can upload the contents of `app/` to any static web host.

## Project layout

- `app/index.html` — homepage
- `app/styles.css` — landing page styling
- `app/script.js` — front-end behavior
- `server.js` — Express server for API and static content
- `package.json` — Node dependencies and startup script
- `db-init.sql` — Postgres schema for user data

## Account and login features

This site includes member registration and login with JWT authentication.

If you want to create a real account instead of using demo data:

1. Open `http://localhost:8000/register.html`
2. Fill in your name, email, password, and verification method
3. Request the verification code and enter it when prompted

To log in with a demo account:

1. Open `http://localhost:8000/login.html`
2. Use the demo buttons to fill in the form
3. Sign in and go to the dashboard

## Notes

- Keep `.env` private and never commit it to source control.
- In production, email verification requires valid `SMTP_*` settings.
- JWT tokens expire after 7 days.
- The server listens on port `8000` unless you change `PORT` in `.env`.
