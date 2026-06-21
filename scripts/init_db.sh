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
REQUIRED_PUBLIC_TABLES=(
  users
  pending_registrations
  content_blocks
  element_overrides
  page_sections
  photo_albums
  album_images
)
PERMISSION_CRITICAL_PUBLIC_TABLES=(
  page_sections
  element_overrides
  content_blocks
  pending_registrations
)

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
  DB_EXISTS=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | tr -d '[:space:]' || echo)
  if [ "$DB_EXISTS" != "1" ]; then
    sudo -u postgres psql -v ON_ERROR_STOP=1 --no-psqlrc -c "CREATE DATABASE \"$DB_NAME\" OWNER \"$DB_USER\";"
  else
    echo "-> Database '$DB_NAME' already exists. Reapplying ownership and permissions..."
  fi
  sudo -u postgres psql -v ON_ERROR_STOP=1 --no-psqlrc -c "ALTER DATABASE \"$DB_NAME\" OWNER TO \"$DB_USER\";"
else
  DB_EXISTS=$(psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | tr -d '[:space:]' || echo)
  if [ "$DB_EXISTS" != "1" ]; then
    psql -v ON_ERROR_STOP=1 --no-psqlrc -c "CREATE DATABASE \"$DB_NAME\" OWNER \"$DB_USER\";"
  else
    echo "-> Database '$DB_NAME' already exists. Reapplying ownership and permissions..."
  fi
  psql -v ON_ERROR_STOP=1 --no-psqlrc -c "ALTER DATABASE \"$DB_NAME\" OWNER TO \"$DB_USER\";"
fi

echo "-> Ensuring schema ownership and applying db-init.sql as '$DB_USER'..."
if [ "$USE_SUDO_POSTGRES" = true ]; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB_NAME" -c "ALTER SCHEMA public OWNER TO \"$DB_USER\";" || true
  PGPASSWORD="$DB_PASS" psql -v ON_ERROR_STOP=1 --no-psqlrc -h localhost -U "$DB_USER" -d "$DB_NAME" -f db-init.sql
else
  psql -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB_NAME" -c "ALTER SCHEMA public OWNER TO \"$DB_USER\";" || true
  PGPASSWORD="$DB_PASS" psql -v ON_ERROR_STOP=1 --no-psqlrc -h localhost -U "$DB_USER" -d "$DB_NAME" -f db-init.sql
fi

if [ "$USE_SUDO_POSTGRES" = true ]; then
  echo "-> Repairing ownership of app objects in schema 'public' to '$DB_USER'..."
  sudo -u postgres psql -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB_NAME" <<SQL
DO $$
DECLARE
  r RECORD;
BEGIN
  EXECUTE format('ALTER SCHEMA %I OWNER TO %I', 'public', '$DB_USER');

  FOR r IN
    SELECT c.relname AS relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'f')
      AND NOT EXISTS (
        SELECT 1
        FROM pg_depend d
        WHERE d.classid = 'pg_class'::regclass
          AND d.objid = c.oid
          AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO %I', r.relname, '$DB_USER');
  END LOOP;

  FOR r IN
    SELECT c.relname AS relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'S'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_depend d
        WHERE d.classid = 'pg_class'::regclass
          AND d.objid = c.oid
          AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO %I', r.relname, '$DB_USER');
  END LOOP;
END $$;
SQL

  # Explicitly enforce owner for permission-critical runtime tables.
  sudo -u postgres psql -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB_NAME" -c "ALTER TABLE IF EXISTS public.element_overrides OWNER TO \"$DB_USER\";"
  sudo -u postgres psql -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB_NAME" -c "ALTER TABLE IF EXISTS public.content_blocks OWNER TO \"$DB_USER\";"
  sudo -u postgres psql -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB_NAME" -c "ALTER TABLE IF EXISTS public.pending_registrations OWNER TO \"$DB_USER\";"

  echo "-> Enforcing owner '$DB_USER' on required public tables..."
  for table_name in "${REQUIRED_PUBLIC_TABLES[@]}"; do
    sudo -u postgres psql -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB_NAME" -c "ALTER TABLE IF EXISTS public.\"$table_name\" OWNER TO \"$DB_USER\";"
  done
else
  echo "-> Attempting ownership reapply as '$DB_USER' (limited without postgres admin access)..."
  PGPASSWORD="$DB_PASS" psql -v ON_ERROR_STOP=1 --no-psqlrc -h localhost -U "$DB_USER" -d "$DB_NAME" <<SQL || true
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname AS relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'f')
      AND NOT EXISTS (
        SELECT 1
        FROM pg_depend d
        WHERE d.classid = 'pg_class'::regclass
          AND d.objid = c.oid
          AND d.deptype = 'e'
      )
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE public.%I OWNER TO %I', r.relname, '$DB_USER');
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;
    END;
  END LOOP;

  FOR r IN
    SELECT c.relname AS relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'S'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_depend d
        WHERE d.classid = 'pg_class'::regclass
          AND d.objid = c.oid
          AND d.deptype = 'e'
      )
  LOOP
    BEGIN
      EXECUTE format('ALTER SEQUENCE public.%I OWNER TO %I', r.relname, '$DB_USER');
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;
    END;
  END LOOP;
END $$;
SQL

  echo "-> Attempting owner enforcement on required public tables as '$DB_USER'..."
  for table_name in "${REQUIRED_PUBLIC_TABLES[@]}"; do
    PGPASSWORD="$DB_PASS" psql -v ON_ERROR_STOP=1 --no-psqlrc -h localhost -U "$DB_USER" -d "$DB_NAME" -c "ALTER TABLE IF EXISTS public.\"$table_name\" OWNER TO \"$DB_USER\";" || true
  done
fi

  # Re-apply grants and default privileges for app objects.
  echo "-> Re-applying grants for schema 'public'..."
if [ "$USE_SUDO_POSTGRES" = true ]; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB_NAME" <<SQL
DO $$
DECLARE
BEGIN
  EXECUTE format('GRANT ALL PRIVILEGES ON SCHEMA public TO %I', '$DB_USER');
  EXECUTE format('GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO %I', '$DB_USER');
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', '$DB_USER');
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO %I', '$DB_USER');
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I', '$DB_USER');
END $$;
SQL

    # Explicit grants for permission-critical runtime tables.
    for table_name in "${PERMISSION_CRITICAL_PUBLIC_TABLES[@]}"; do
      sudo -u postgres psql -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB_NAME" -c "GRANT ALL PRIVILEGES ON TABLE public.\"$table_name\" TO \"$DB_USER\";"
    done
else
  psql -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB_NAME" <<SQL || true
DO $$
DECLARE
BEGIN
  EXECUTE format('GRANT ALL PRIVILEGES ON SCHEMA public TO %I', '$DB_USER');
  EXECUTE format('GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO %I', '$DB_USER');
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', '$DB_USER');
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO %I', '$DB_USER');
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I', '$DB_USER');
END $$;
SQL

  # Attempt explicit grants for permission-critical runtime tables.
  for table_name in "${PERMISSION_CRITICAL_PUBLIC_TABLES[@]}"; do
    PGPASSWORD="$DB_PASS" psql -v ON_ERROR_STOP=1 --no-psqlrc -h localhost -U "$DB_USER" -d "$DB_NAME" -c "GRANT ALL PRIVILEGES ON TABLE public.\"$table_name\" TO \"$DB_USER\";" || true
  done
fi

echo "-> Verifying ownership of all non-system tables..."
NOT_OWNED_TABLES=$(PGPASSWORD="$DB_PASS" psql -v ON_ERROR_STOP=1 --no-psqlrc -h localhost -U "$DB_USER" -d "$DB_NAME" -tA <<SQL
SELECT n.nspname || '.' || c.relname || ' -> ' || pg_get_userbyid(c.relowner)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p', 'f')
  AND n.nspname = 'public'
  AND NOT EXISTS (
    SELECT 1
    FROM pg_depend d
    WHERE d.classid = 'pg_class'::regclass
      AND d.objid = c.oid
      AND d.deptype = 'e'
  )
  AND pg_get_userbyid(c.relowner) <> '$DB_USER'
ORDER BY 1;
SQL
)

if [ -n "$NOT_OWNED_TABLES" ]; then
  echo "Error: one or more tables are not owned by '$DB_USER':" >&2
  echo "$NOT_OWNED_TABLES" >&2
  echo "Repair ownership with postgres admin access and rerun npm run init-db:" >&2
  echo "  sudo -u postgres psql -d $DB_NAME -c \"ALTER TABLE public.element_overrides OWNER TO \\\"$DB_USER\\\";\"" >&2
  echo "  sudo -u postgres psql -d $DB_NAME -c \"ALTER TABLE public.content_blocks OWNER TO \\\"$DB_USER\\\";\"" >&2
  exit 1
fi

echo "-> Verifying required public tables are owned by '$DB_USER'..."
NOT_OWNED_REQUIRED=$(PGPASSWORD="$DB_PASS" psql -v ON_ERROR_STOP=1 --no-psqlrc -h localhost -U "$DB_USER" -d "$DB_NAME" -tA <<SQL
SELECT tablename || ' -> ' || tableowner
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename = ANY (ARRAY['users','pending_registrations','content_blocks','element_overrides','page_sections','photo_albums','album_images'])
  AND tableowner <> '$DB_USER'
ORDER BY 1;
SQL
)

if [ -n "$NOT_OWNED_REQUIRED" ]; then
  echo "Error: one or more required public tables are not owned by '$DB_USER':" >&2
  echo "$NOT_OWNED_REQUIRED" >&2
  exit 1
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
