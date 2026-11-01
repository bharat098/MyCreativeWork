-- ============================================================
-- MyCreativeWork — Motion Vault  (FRESH / FULL RESET)
-- Run this entire file in: Supabase Dashboard → SQL Editor → Run
-- Safe to re-run: uses DROP IF EXISTS + IF NOT EXISTS throughout
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- DROP OLD TABLES (cascade removes all FK deps)
-- ============================================================
DROP TABLE IF EXISTS share_links  CASCADE;
DROP TABLE IF EXISTS files        CASCADE;
DROP TABLE IF EXISTS projects     CASCADE;
DROP TABLE IF EXISTS events       CASCADE;
DROP TABLE IF EXISTS folders      CASCADE;
DROP TABLE IF EXISTS categories   CASCADE;
DROP TABLE IF EXISTS visitors     CASCADE;

-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE categories (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       TEXT NOT NULL UNIQUE,
  color      TEXT DEFAULT '#11965B',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE folders (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  parent_id   UUID REFERENCES folders(id) ON DELETE CASCADE,
  path        TEXT NOT NULL DEFAULT '/',
  description TEXT,
  event_id    UUID REFERENCES events(id),
  is_deleted  BOOLEAN DEFAULT FALSE,
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  description     TEXT,
  event_date      DATE,
  event_year      INTEGER,
  event_month     INTEGER,
  cover_image_url TEXT,
  is_deleted      BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE files (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  original_name TEXT NOT NULL,
  file_path     TEXT NOT NULL,
  file_url      TEXT,
  file_size     BIGINT DEFAULT 0,
  mime_type     TEXT,
  file_type     TEXT CHECK (file_type IN ('video','image','document','archive','design','other')),
  extension     TEXT,
  folder_id     UUID REFERENCES folders(id),
  event_id      UUID REFERENCES events(id),
  thumbnail_url TEXT,
  duration      INTEGER,
  width         INTEGER,
  height        INTEGER,
  is_favorite   BOOLEAN DEFAULT FALSE,
  is_deleted    BOOLEAN DEFAULT FALSE,
  deleted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE share_links (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token           TEXT NOT NULL UNIQUE,
  folder_id       UUID REFERENCES folders(id) ON DELETE CASCADE,
  expires_at      TIMESTAMPTZ,
  allow_download  BOOLEAN DEFAULT TRUE,
  view_count      INTEGER DEFAULT 0,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_files_file_type   ON files(file_type);
CREATE INDEX idx_files_is_deleted  ON files(is_deleted);
CREATE INDEX idx_files_folder_id   ON files(folder_id);
CREATE INDEX idx_folders_parent_id ON folders(parent_id);
CREATE INDEX idx_folders_is_deleted ON folders(is_deleted);
CREATE INDEX idx_share_links_token ON share_links(token);

-- ============================================================
-- AUTO-UPDATE updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_folders_updated BEFORE UPDATE ON folders FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE OR REPLACE TRIGGER trg_files_updated   BEFORE UPDATE ON files   FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE OR REPLACE TRIGGER trg_events_updated  BEFORE UPDATE ON events  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE categories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE folders     ENABLE ROW LEVEL SECURITY;
ALTER TABLE events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE files       ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_links ENABLE ROW LEVEL SECURITY;

-- Public can READ (non-deleted)
DROP POLICY IF EXISTS "public_read_categories"  ON categories;
CREATE POLICY "public_read_categories"  ON categories  FOR SELECT USING (true);

DROP POLICY IF EXISTS "public_read_folders"     ON folders;
CREATE POLICY "public_read_folders"     ON folders     FOR SELECT USING (NOT is_deleted);

DROP POLICY IF EXISTS "public_read_events"      ON events;
CREATE POLICY "public_read_events"      ON events      FOR SELECT USING (NOT is_deleted);

DROP POLICY IF EXISTS "public_read_files"       ON files;
CREATE POLICY "public_read_files"       ON files       FOR SELECT USING (NOT is_deleted);

DROP POLICY IF EXISTS "public_read_share_links" ON share_links;
CREATE POLICY "public_read_share_links" ON share_links FOR SELECT USING (is_active);

-- Only authenticated users can WRITE
DROP POLICY IF EXISTS "auth_write_categories"   ON categories;
CREATE POLICY "auth_write_categories"   ON categories  FOR ALL USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "auth_write_folders"      ON folders;
CREATE POLICY "auth_write_folders"      ON folders     FOR ALL USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "auth_write_events"       ON events;
CREATE POLICY "auth_write_events"       ON events      FOR ALL USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "auth_write_files"        ON files;
CREATE POLICY "auth_write_files"        ON files       FOR ALL USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "auth_write_share_links"  ON share_links;
CREATE POLICY "auth_write_share_links"  ON share_links FOR ALL USING (auth.uid() IS NOT NULL);

-- ============================================================
-- STORAGE BUCKETS
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit)
  VALUES ('media', 'media', true, NULL)
  ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = NULL;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
  VALUES ('thumbnails', 'thumbnails', true, 10485760)
  ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 10485760;

-- Storage policies (safe to re-run)
DROP POLICY IF EXISTS "public_read_media"       ON storage.objects;
CREATE POLICY "public_read_media"       ON storage.objects FOR SELECT USING (bucket_id = 'media');

DROP POLICY IF EXISTS "public_read_thumbnails"  ON storage.objects;
CREATE POLICY "public_read_thumbnails"  ON storage.objects FOR SELECT USING (bucket_id = 'thumbnails');

DROP POLICY IF EXISTS "auth_upload_media"       ON storage.objects;
CREATE POLICY "auth_upload_media"       ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'media'       AND auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "auth_upload_thumbnails"  ON storage.objects;
CREATE POLICY "auth_upload_thumbnails"  ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'thumbnails' AND auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "auth_delete_media"       ON storage.objects;
CREATE POLICY "auth_delete_media"       ON storage.objects FOR DELETE USING (bucket_id = 'media' AND auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "auth_update_media"       ON storage.objects;
CREATE POLICY "auth_update_media"       ON storage.objects FOR UPDATE USING (bucket_id = 'media' AND auth.uid() IS NOT NULL);

-- ============================================================
-- SEED DATA — categories only (no demo projects/files)
-- ============================================================
INSERT INTO categories (name, color) VALUES
  ('Motion Graphics', '#11965B'),
  ('Video Editing',   '#0D7A4A'),
  ('Event Videos',    '#1AA368'),
  ('Corporate Videos','#16856F'),
  ('Product Launches','#0E8A5C'),
  ('Animations',      '#22C55E'),
  ('Social Media',    '#15A260'),
  ('Branding',        '#178A57'),
  ('Personal Projects','#173B2F'),
  ('Other',           '#71877B')
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- VISITOR TRACKING
-- ============================================================
CREATE TABLE visitors (
  id            UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  browser_id    TEXT        UNIQUE NOT NULL,
  name          TEXT        NOT NULL,
  visit_count   INTEGER     DEFAULT 1,
  first_seen    TIMESTAMPTZ DEFAULT NOW(),
  last_seen     TIMESTAMPTZ DEFAULT NOW(),
  is_active     BOOLEAN     DEFAULT TRUE
);
ALTER TABLE visitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitors REPLICA IDENTITY FULL;
-- Allow anonymous visitors to insert/update their own record, admin reads all
CREATE POLICY "visitors_anon_rw"  ON visitors FOR ALL TO anon          USING (true) WITH CHECK (true);
CREATE POLICY "visitors_auth_all" ON visitors FOR ALL TO authenticated  USING (true) WITH CHECK (true);
