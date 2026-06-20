# Krewe Mystique Modern Site

This repository contains a modern static website for Krewe Mystique de la Capitale plus an optional Express backend with Postgres integration.

## Prerequisites

### Linux (Ubuntu/Debian)
## Full setup — frontend + Postgres backend

### 1. Install Node dependencies

From the project root:
```bash
npm install
```

### 2. Initialize the database and `.env` (recommended)

Use the provided initializer script to create the database role `krewe_db_user` (default), create the database, apply the schema from `db-init.sql`, and write a secure `.env` containing `DATABASE_URL`, `PORT`, and `JWT_SECRET`.

Run the initializer:

```bash
npm run init-db
```

You will be prompted for the new DB user's password. To provide it non-interactively (not recommended for security reasons):

```bash
npm run init-db -- yourpassword
```

The script will back up an existing `.env` to `.env.bak` if present.

### 3. Start the backend server

From the project root:
```bash
npm start
```

Open `http://localhost:8000` in the browser.

### 4. Seed demo accounts (development only)

After the server is running you can seed demo accounts for development:

```bash
npm run seed
# or while server running:
curl -X POST http://localhost:8000/api/dev/seed
```

### Advanced: manual database setup

If you prefer to set up Postgres manually, the previous detailed instructions are available in the repository history. The initializer script covers the common cases and is the recommended approach.

### 5. Verify the API

Use a browser or curl to check status:
```bash
curl http://localhost:8000/api/status
```

Linux / macOS example:
```bash
cp .env.example .env
```

Windows PowerShell example:
```powershell
Copy-Item .env.example .env
```

Then edit `.env` (DO NOT COMMIT your `.env` to source control). Replace the placeholders with your real credentials:

```text
# Example .env — replace placeholders with your credentials
DATABASE_URL=postgres://krewe_user:YourStrongPasswordHere@localhost:5432/krewe_db
PORT=8000
JWT_SECRET=replace_me
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_smtp_username
SMTP_PASS=your_smtp_password
SMTP_FROM="Krewe Mystique <no-reply@example.com>"
```

If your password or username contains special characters (such as `@`, `:` or `/`), URL-encode them (for example `%40` for `@`). Example:

```
DATABASE_URL=postgres://krewe_user:pa%40ssw0rd%21@localhost:5432/krewe_db
```

### 4. Start the backend server

From the project root:
```bash
npm start
```

Open `http://localhost:8000` in the browser.

### 5. Verify the API

Use a browser or curl to check status:
```bash
curl http://localhost:8000/api/status
```

## Project layout

- `app/index.html` — homepage
- `app/styles.css` — modern landing page styling
- `app/script.js` — countdown timer script
- `server.js` — Express server for API and static content
- `package.json` — Node dependencies and startup script
- `.env.example` — Postgres connection environment variables
- `db-init.sql` — Postgres schema for user data

## Member Portal & Authentication

This site includes a member registration and login system with JWT authentication.

Verification emails are sent over SMTP. Phone verification can also be supported through an email-to-SMS gateway if your carrier or provider gives you an address template such as `{number}@gateway.example`.

### Default Demo Credentials (Development Only)

When you first set up the database, no accounts exist. You can either:

**Option A: Seed demo accounts via Node script**
```bash
npm run seed
```

This creates two accounts:
- **Member Account:** `demo@krewe.local` / `demo123`
- **Admin Account:** `admin@krewe.local` / `admin123`

**Option B: Seed demo accounts via API endpoint (dev mode only)**
```bash
curl -X POST http://localhost:8000/api/dev/seed
```

Returns:
```json
{
  "message": "Demo users seeded",
  "users": [
    { "email": "demo@krewe.local", "role": "member", "password": "demo123", "status": "created" },
    { "email": "admin@krewe.local", "role": "admin", "password": "admin123", "status": "created" }
  ]
}
```

**Option C: Register manually**
1. Navigate to `http://localhost:8000/register.html`
2. Fill in your name, email, password, and choose email or phone verification
3. Request a verification code, then enter the code before the account is created

### Using Demo Credentials

1. Go to `http://localhost:8000/login.html`
2. Click one of the demo account buttons ("Demo Member" or "Demo Admin") to auto-fill the form
3. Click "Log in" and you'll be redirected to the member dashboard

### Features

- **Public Pages:** History, Events, Photos, Contact (no login required)
- **Member Pages:** Dashboard with profile info, member resources (login required)
- **Authentication:** JWT tokens stored in browser localStorage (7-day expiry)
- **User Roles:** `member` (default) or `admin` (for future admin features)

## API Endpoints

### Authentication
- `POST /api/auth/register/request-code` — start account registration and send a verification code
  - Body: `{ "email": "user@example.com", "phone": "+12225550123", "full_name": "John Doe", "password": "secure123", "verificationMethod": "email" }`
  - Returns: `{ "verificationRequired": true, "message": "...", "expiresInMinutes": 10 }`

- `POST /api/auth/register/verify-code` — verify the registration code and create the account
  - Body: `{ "email": "user@example.com", "code": "123456" }`
  - Returns: `{ "user": {...}, "token": "eyJ..." }`

- `POST /api/auth/login` — log in with email and password
  - Body: `{ "email": "user@example.com", "password": "secure123" }`
  - Returns: `{ "user": {...}, "token": "eyJ..." }`

- `GET /api/profile` — fetch authenticated user profile (requires `Authorization: Bearer <token>` header)
  - Returns: `{ "id": 1, "email": "...", "full_name": "...", "role": "...", "joined_at": "..." }`

### Public
- `GET /api/status` — health check
- `GET /api/users` — list all users
- `GET /api/members` — list members only

### Development Only
- `POST /api/dev/seed` — seed demo accounts (only available when `NODE_ENV !== 'production'`)

## Notes

- If you only need the frontend, upload the contents of `app/` to any static host.
- In production, email verification requires valid `SMTP_*` settings. Phone verification also requires `SMS_GATEWAY_TEMPLATE` unless you change the implementation to use a dedicated SMS provider.
- For the full backend-enabled site, run `npm install`, configure `.env`, initialize Postgres, and then run `npm start`.
- **Important:** Before seeding demo accounts or using the member portal, you must first initialize the Postgres database by running `db-init.sql` (see section 3 above).
- Demo accounts are **only available in development mode** (when `NODE_ENV` is not `production`). In production, users must register manually.
- JWT tokens expire after 7 days. Users can log in again to refresh their token.
- Never commit `.env` to source control—use environment variables or secrets management.
