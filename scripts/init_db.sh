#!/usr/bin/env bash
set -euo pipefail

# Initializes Postgres role, database, applies schema, and writes .env
# Usage: ./scripts/init_db.sh [db_password]

DB_NAME=${DB_NAME:-krewe_db}
DB_USER=${DB_USER:-krewe_db_user}
PORT=${PORT:-8000}
CREATE_DEFAULT_ADMIN=${CREATE_DEFAULT_ADMIN:-true}
DEFAULT_ADMIN_EMAIL=${DEFAULT_ADMIN_EMAIL:-admin@krewe.local}
DEFAULT_ADMIN_NAME=${DEFAULT_ADMIN_NAME:-Admin User}
DEFAULT_ADMIN_PASSWORD=${DEFAULT_ADMIN_PASSWORD:-admin123}

echo "== Krewe Mystique DB initializer =="

if ! command -v psql >/dev/null 2>&1; then
  echo "Error: psql not found. Install PostgreSQL client tools and retry." >&2
  exit 1
fi

PW_ARG=${1:-}
if [ -n "$PW_ARG" ]; then
  DB_PASS="$PW_ARG"
else
  read -s -p "Enter password for new DB user '$DB_USER': " DB_PASS
  echo
fi

USE_SUDO_POSTGRES=false
if command -v sudo >/dev/null 2>&1; then
  echo "-> Checking postgres administrative access (sudo may prompt for your password)..."
  if sudo -u postgres psql -v ON_ERROR_STOP=1 --no-psqlrc -c "SELECT 1" >/dev/null; then
    USE_SUDO_POSTGRES=true
  fi
fi

if [ "$USE_SUDO_POSTGRES" = false ]; then
  echo "-> Proceeding without postgres sudo access; ownership repair may be limited."
fi

# helper to run psql as the postgres superuser if possible
run_psql() {
  local sql="$1"
  if [ "$USE_SUDO_POSTGRES" = true ]; then
    sudo -u postgres psql -v ON_ERROR_STOP=1 --no-psqlrc -c "$sql"
  else
    psql -v ON_ERROR_STOP=1 --no-psqlrc -c "$sql"
  fi
}

echo "-> Creating role '$DB_USER' (or updating password)..."
if [ "$USE_SUDO_POSTGRES" = true ]; then
  EXISTS=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | tr -d '[:space:]' || echo)
else
  EXISTS=$(psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | tr -d '[:space:]' || echo)
fi

if [ "$EXISTS" = "1" ]; then
  echo "Role exists; updating password."
  run_psql "ALTER ROLE \"$DB_USER\" WITH LOGIN PASSWORD '$DB_PASS';"
else
  run_psql "CREATE ROLE \"$DB_USER\" WITH LOGIN PASSWORD '$DB_PASS';"
fi

echo "-> Creating database '$DB_NAME' (if not exists) and setting owner to '$DB_USER'..."
if [ "$USE_SUDO_POSTGRES" = true ]; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 --no-psqlrc -c "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 || sudo -u postgres psql -v ON_ERROR_STOP=1 --no-psqlrc -c "CREATE DATABASE \"$DB_NAME\" OWNER \"$DB_USER\";"
  sudo -u postgres psql -v ON_ERROR_STOP=1 --no-psqlrc -c "ALTER DATABASE \"$DB_NAME\" OWNER TO \"$DB_USER\";"
else
  psql -v ON_ERROR_STOP=1 --no-psqlrc -c "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 || psql -v ON_ERROR_STOP=1 --no-psqlrc -c "CREATE DATABASE \"$DB_NAME\" OWNER \"$DB_USER\";"
  psql -v ON_ERROR_STOP=1 --no-psqlrc -c "ALTER DATABASE \"$DB_NAME\" OWNER TO \"$DB_USER\";"
fi

echo "-> Ensuring schema ownership and applying db-init.sql as '$DB_USER'..."
if [ "$USE_SUDO_POSTGRES" = true ]; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB_NAME" -c "ALTER SCHEMA public OWNER TO \"$DB_USER\";" || true
  PGPASSWORD="$DB_PASS" psql -v ON_ERROR_STOP=1 --no-psqlrc -h localhost -U "$DB_USER" -d "$DB_NAME" -f db-init.sql
  OWNER=postgres
else
  psql -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB_NAME" -c "ALTER SCHEMA public OWNER TO \"$DB_USER\";" || true
  PGPASSWORD="$DB_PASS" psql -v ON_ERROR_STOP=1 --no-psqlrc -h localhost -U "$DB_USER" -d "$DB_NAME" -f db-init.sql
  OWNER=$(whoami)
fi

if [ "$USE_SUDO_POSTGRES" = true ]; then
  echo "-> Repairing ownership of existing public tables/sequences to '$DB_USER'..."
  sudo -u postgres psql -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB_NAME" <<SQL
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE %I.%I OWNER TO %I', r.schemaname, r.tablename, '$DB_USER');
  END LOOP;

  FOR r IN SELECT sequence_schema, sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public' LOOP
    EXECUTE format('ALTER SEQUENCE %I.%I OWNER TO %I', r.sequence_schema, r.sequence_name, '$DB_USER');
  END LOOP;
END $$;
SQL
fi

# Reassign ownership of any objects created by the schema to the DB user
echo "-> Reassigning owned objects from '$OWNER' to '$DB_USER' (if any)"
if [ "$USE_SUDO_POSTGRES" = true ]; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB_NAME" -c "REASSIGN OWNED BY \"$OWNER\" TO \"$DB_USER\";" || true
  sudo -u postgres psql -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB_NAME" -c "GRANT ALL PRIVILEGES ON SCHEMA public TO \"$DB_USER\";" || true
  sudo -u postgres psql -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB_NAME" -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO \"$DB_USER\";" || true
  sudo -u postgres psql -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB_NAME" -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO \"$DB_USER\";" || true
  sudo -u postgres psql -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB_NAME" -c "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO \"$DB_USER\";" || true
  sudo -u postgres psql -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB_NAME" -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO \"$DB_USER\";" || true
else
  psql -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB_NAME" -c "REASSIGN OWNED BY \"$OWNER\" TO \"$DB_USER\";" || true
  psql -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB_NAME" -c "GRANT ALL PRIVILEGES ON SCHEMA public TO \"$DB_USER\";" || true
  psql -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB_NAME" -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO \"$DB_USER\";" || true
  psql -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB_NAME" -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO \"$DB_USER\";" || true
  psql -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB_NAME" -c "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO \"$DB_USER\";" || true
  psql -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB_NAME" -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO \"$DB_USER\";" || true
fi

if [ "$CREATE_DEFAULT_ADMIN" = "true" ]; then
  echo "-> Ensuring default admin account exists..."
  ADMIN_HASH=$(node -e "const bcrypt=require('bcryptjs'); console.log(bcrypt.hashSync(process.argv[1], 10));" "$DEFAULT_ADMIN_PASSWORD" 2>/dev/null || true)

  if [ -z "$ADMIN_HASH" ]; then
    echo "Warning: could not generate password hash for default admin."
    echo "         Make sure dependencies are installed (run: npm install), then run npm run init-db again."
  else
    if [ "$USE_SUDO_POSTGRES" = true ]; then
      sudo -u postgres psql -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB_NAME" <<SQL
INSERT INTO users (email, full_name, role, password_hash)
VALUES ('$DEFAULT_ADMIN_EMAIL', '$DEFAULT_ADMIN_NAME', 'admin', '$ADMIN_HASH')
ON CONFLICT (email) DO NOTHING;
SQL
    else
      psql -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB_NAME" <<SQL
INSERT INTO users (email, full_name, role, password_hash)
VALUES ('$DEFAULT_ADMIN_EMAIL', '$DEFAULT_ADMIN_NAME', 'admin', '$ADMIN_HASH')
ON CONFLICT (email) DO NOTHING;
SQL
    fi
  fi
else
  echo "-> Skipping default admin creation (CREATE_DEFAULT_ADMIN=$CREATE_DEFAULT_ADMIN)."
fi

ENV_FILE=.env
if [ -f "$ENV_FILE" ]; then
  echo "Warning: $ENV_FILE already exists. It will be backed up to $ENV_FILE.bak"
  cp "$ENV_FILE" "$ENV_FILE.bak"
fi

JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p -c 32)

echo "-> Writing $ENV_FILE with connection details (DO NOT COMMIT this file)"
cat > "$ENV_FILE" <<EOF
DATABASE_URL=postgres://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME
PORT=$PORT
JWT_SECRET=$JWT_SECRET
EOF

echo "Done. .env created and DB initialized."
if [ "$CREATE_DEFAULT_ADMIN" = "true" ] && [ -n "${ADMIN_HASH:-}" ]; then
  echo "Bootstrap admin credentials:"
  echo "  - Email: $DEFAULT_ADMIN_EMAIL"
  echo "  - Password: $DEFAULT_ADMIN_PASSWORD"
  echo "  - Change this password after first login."
fi
echo
echo "Next steps:"
echo "  - Start server: npm start"
echo "  - Seed demo accounts (dev only): curl -X POST http://localhost:$PORT/api/dev/seed"

exit 0
