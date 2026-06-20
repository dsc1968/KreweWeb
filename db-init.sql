CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  phone TEXT UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  password_hash TEXT,
  joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pending_registrations (
  email TEXT PRIMARY KEY,
  phone TEXT,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  verification_method TEXT NOT NULL CHECK (verification_method IN ('email', 'phone')),
  verification_target TEXT NOT NULL,
  verification_code TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS content_blocks (
  page_path TEXT NOT NULL,
  content_key TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('text', 'image')),
  content_value TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (page_path, content_key, content_type)
);

CREATE TABLE IF NOT EXISTS element_overrides (
  page_path TEXT NOT NULL,
  element_key TEXT NOT NULL,
  hidden BOOLEAN NOT NULL DEFAULT FALSE,
  text_align TEXT,
  font_weight TEXT,
  font_style TEXT,
  text_transform TEXT,
  text_color TEXT,
  position INTEGER,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (page_path, element_key)
);

CREATE TABLE IF NOT EXISTS page_sections (
  id SERIAL PRIMARY KEY,
  page_path TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  image_path TEXT NOT NULL,
  background_path TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- Demo seed accounts (run only once in development)
-- To add these, uncomment and run in psql or via the seed endpoint
-- Demo Member: demo@krewe.local / demo123
-- Demo Admin: admin@krewe.local / admin123
-- INSERT INTO users (email, full_name, role, password_hash, joined_at) VALUES
-- ('demo@krewe.local', 'Demo Member', 'member', '$2a$10$YourHashHereForDemo123', NOW()),
-- ('admin@krewe.local', 'Admin User', 'admin', '$2a$10$YourHashHereForAdmin123', NOW());
