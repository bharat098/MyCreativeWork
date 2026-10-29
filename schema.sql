-- ============================================================
-- MyCreativeWork — Motion Vault
-- Run this entire file in: Supabase Dashboard → SQL Editor → Run
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT '#11965B',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS folders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  parent_id UUID REFERENCES folders(id) ON DELETE CASCADE,
  path TEXT NOT NULL DEFAULT '/',
  description TEXT,
  is_deleted BOOLEAN DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  event_date DATE,
  event_year INTEGER,
  event_month INTEGER,
  cover_image_url TEXT,
  is_deleted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  thumbnail_url TEXT,
  client TEXT,
  event_name TEXT,
  category_id UUID REFERENCES categories(id),
  start_date DATE,
  completion_date DATE,
  month INTEGER,
  year INTEGER,
  tags TEXT[] DEFAULT '{}',
  software_used TEXT[] DEFAULT '{}',
  my_role TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active','archived','draft')),
  folder_id UUID REFERENCES folders(id),
  is_featured BOOLEAN DEFAULT FALSE,
  is_favorite BOOLEAN DEFAULT FALSE,
  is_deleted BOOLEAN DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,
  share_token TEXT UNIQUE,
  share_enabled BOOLEAN DEFAULT FALSE,
  share_allow_download BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  original_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_url TEXT,
  file_size BIGINT DEFAULT 0,
  mime_type TEXT,
  file_type TEXT CHECK (file_type IN ('video','image','document','archive','design','other')),
  extension TEXT,
  folder_id UUID REFERENCES folders(id),
  project_id UUID REFERENCES projects(id),
  thumbnail_url TEXT,
  duration INTEGER,
  width INTEGER,
  height INTEGER,
  is_favorite BOOLEAN DEFAULT FALSE,
  is_deleted BOOLEAN DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS share_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token TEXT NOT NULL UNIQUE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ,
  allow_download BOOLEAN DEFAULT TRUE,
  view_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_year ON projects(year);
CREATE INDEX IF NOT EXISTS idx_projects_is_deleted ON projects(is_deleted);
CREATE INDEX IF NOT EXISTS idx_projects_is_favorite ON projects(is_favorite);
CREATE INDEX IF NOT EXISTS idx_files_file_type ON files(file_type);
CREATE INDEX IF NOT EXISTS idx_files_is_deleted ON files(is_deleted);
CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_share_links_token ON share_links(token);

-- ============================================================
-- AUTO-UPDATE updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_folders_updated BEFORE UPDATE ON folders FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE OR REPLACE TRIGGER trg_projects_updated BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE OR REPLACE TRIGGER trg_files_updated BEFORE UPDATE ON files FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_links ENABLE ROW LEVEL SECURITY;

-- Public can READ everything (non-deleted)
CREATE POLICY "public_read_categories" ON categories FOR SELECT USING (true);
CREATE POLICY "public_read_folders" ON folders FOR SELECT USING (NOT is_deleted);
CREATE POLICY "public_read_events" ON events FOR SELECT USING (NOT is_deleted);
CREATE POLICY "public_read_projects" ON projects FOR SELECT USING (NOT is_deleted);
CREATE POLICY "public_read_files" ON files FOR SELECT USING (NOT is_deleted);
CREATE POLICY "public_read_share_links" ON share_links FOR SELECT USING (is_active);

-- Only authenticated users can WRITE
CREATE POLICY "auth_write_categories" ON categories FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth_write_folders" ON folders FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth_write_events" ON events FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth_write_projects" ON projects FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth_write_files" ON files FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth_write_share_links" ON share_links FOR ALL USING (auth.uid() IS NOT NULL);

-- ============================================================
-- STORAGE BUCKETS
-- Run these lines too (or create buckets in Storage UI)
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit) VALUES ('media', 'media', true, NULL) ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = NULL;
INSERT INTO storage.buckets (id, name, public, file_size_limit) VALUES ('thumbnails', 'thumbnails', true, 10485760) ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 10485760;

-- Remove per-file size limit on media bucket (allows large video uploads, subject to plan storage quota)
UPDATE storage.buckets SET file_size_limit = NULL WHERE id = 'media';

-- Storage: public read
CREATE POLICY "public_read_media" ON storage.objects FOR SELECT USING (bucket_id = 'media');
CREATE POLICY "public_read_thumbnails" ON storage.objects FOR SELECT USING (bucket_id = 'thumbnails');
-- Storage: authenticated upload
CREATE POLICY "auth_upload_media" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'media' AND auth.uid() IS NOT NULL);
CREATE POLICY "auth_upload_thumbnails" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'thumbnails' AND auth.uid() IS NOT NULL);
CREATE POLICY "auth_delete_media" ON storage.objects FOR DELETE USING (bucket_id = 'media' AND auth.uid() IS NOT NULL);

-- ============================================================
-- SEED DATA (demo examples — clearly labelled)
-- ============================================================
INSERT INTO categories (name, color) VALUES
  ('Motion Graphics', '#11965B'),
  ('Video Editing', '#0D7A4A'),
  ('Event Videos', '#1AA368'),
  ('Corporate Videos', '#16856F'),
  ('Product Launches', '#0E8A5C'),
  ('Animations', '#22C55E'),
  ('Social Media', '#15A260'),
  ('Branding', '#178A57'),
  ('Personal Projects', '#173B2F'),
  ('Other', '#71877B')
ON CONFLICT (name) DO NOTHING;

-- Demo folders
WITH f1 AS (
  INSERT INTO folders (name, path, description) VALUES ('2026', '/2026', 'Current year') RETURNING id
), f2 AS (
  INSERT INTO folders (name, path, description) VALUES ('2025', '/2025', 'Previous year') RETURNING id
), f3 AS (
  INSERT INTO folders (name, parent_id, path, description)
  SELECT 'January', id, '/2026/January', 'Jan 2026 work' FROM f1 RETURNING id
)
INSERT INTO folders (name, parent_id, path, description)
SELECT 'Product Launch', id, '/2026/January/Product Launch', 'Launch assets' FROM f3;

-- Demo projects
INSERT INTO projects (name, description, client, event_name, year, month, tags, software_used, my_role, status, is_featured, is_favorite)
VALUES
  ('Annual Gala 2025 Highlights',
   '[DEMO] Full event coverage and highlight reel. Cinematic 4K footage with color grading and motion graphics.',
   'Acme Corp', 'Annual Gala 2025', 2025, 12,
   ARRAY['event','highlight','corporate','gala'],
   ARRAY['Adobe Premiere Pro','After Effects','DaVinci Resolve'],
   'Video Editor & Colorist', 'active', true, true),
  ('Product X Launch Campaign',
   '[DEMO] Full launch campaign — teaser, main reveal video, and social media cuts.',
   'TechBrand Inc', 'Product Launch Summit', 2026, 1,
   ARRAY['product','launch','campaign','social'],
   ARRAY['After Effects','Cinema 4D','Adobe Premiere Pro'],
   'Motion Designer & Editor', 'active', true, false),
  ('Brand Identity Motion Pack',
   '[DEMO] Custom motion graphics — logo reveals, lower thirds, transitions and outros.',
   'Studio Delta', NULL, 2025, 10,
   ARRAY['motion','branding','package','logo'],
   ARRAY['After Effects','Illustrator'],
   'Motion Graphics Designer', 'active', false, true);
