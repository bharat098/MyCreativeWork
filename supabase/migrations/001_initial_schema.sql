-- Motion Vault - Initial Database Schema
-- Run this in your Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- CATEGORIES
-- ============================================
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT '#11965B',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO categories (name, slug, color) VALUES
  ('Motion Graphics', 'motion-graphics', '#11965B'),
  ('Video Editing', 'video-editing', '#0D7A4A'),
  ('Event Videos', 'event-videos', '#1AA368'),
  ('Corporate Videos', 'corporate-videos', '#16856F'),
  ('Product Launches', 'product-launches', '#0E8A5C'),
  ('Animations', 'animations', '#22C55E'),
  ('Social Media', 'social-media', '#15A260'),
  ('Branding', 'branding', '#178A57'),
  ('Personal Projects', 'personal-projects', '#12905A'),
  ('Other', 'other', '#71877B')
ON CONFLICT (slug) DO NOTHING;

-- ============================================
-- FOLDERS
-- ============================================
CREATE TABLE IF NOT EXISTS folders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  parent_id UUID REFERENCES folders(id) ON DELETE CASCADE,
  path TEXT NOT NULL DEFAULT '/',
  color TEXT DEFAULT '#11965B',
  description TEXT,
  is_deleted BOOLEAN DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_folders_parent_id ON folders(parent_id);
CREATE INDEX idx_folders_path ON folders(path);
CREATE INDEX idx_folders_is_deleted ON folders(is_deleted);

-- ============================================
-- EVENTS
-- ============================================
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  event_date DATE,
  event_year INTEGER,
  event_month INTEGER,
  cover_image_url TEXT,
  cover_image_path TEXT,
  folder_id UUID REFERENCES folders(id),
  is_deleted BOOLEAN DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_events_event_year ON events(event_year);
CREATE INDEX idx_events_is_deleted ON events(is_deleted);

-- ============================================
-- PROJECTS
-- ============================================
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  thumbnail_url TEXT,
  thumbnail_path TEXT,
  client TEXT,
  event_name TEXT,
  event_id UUID REFERENCES events(id),
  category_id UUID REFERENCES categories(id),
  project_type TEXT,
  start_date DATE,
  completion_date DATE,
  month INTEGER,
  year INTEGER,
  tags TEXT[] DEFAULT '{}',
  software_used TEXT[] DEFAULT '{}',
  my_role TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'archived', 'draft')),
  folder_id UUID REFERENCES folders(id),
  is_featured BOOLEAN DEFAULT FALSE,
  is_favorite BOOLEAN DEFAULT FALSE,
  is_deleted BOOLEAN DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,
  share_enabled BOOLEAN DEFAULT FALSE,
  share_token TEXT UNIQUE,
  share_expires_at TIMESTAMPTZ,
  share_password TEXT,
  share_allow_download BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_projects_folder_id ON projects(folder_id);
CREATE INDEX idx_projects_category_id ON projects(category_id);
CREATE INDEX idx_projects_year ON projects(year);
CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_projects_is_deleted ON projects(is_deleted);
CREATE INDEX idx_projects_is_favorite ON projects(is_favorite);
CREATE INDEX idx_projects_share_token ON projects(share_token);
CREATE INDEX idx_projects_tags ON projects USING GIN(tags);

-- ============================================
-- FILES / ASSETS
-- ============================================
CREATE TABLE IF NOT EXISTS files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  original_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_url TEXT,
  file_size BIGINT DEFAULT 0,
  mime_type TEXT,
  file_type TEXT CHECK (file_type IN ('video', 'image', 'document', 'archive', 'design', 'other')),
  extension TEXT,
  folder_id UUID REFERENCES folders(id),
  project_id UUID REFERENCES projects(id),
  event_id UUID REFERENCES events(id),
  thumbnail_url TEXT,
  thumbnail_path TEXT,
  duration INTEGER,
  width INTEGER,
  height INTEGER,
  is_favorite BOOLEAN DEFAULT FALSE,
  is_deleted BOOLEAN DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_files_folder_id ON files(folder_id);
CREATE INDEX idx_files_project_id ON files(project_id);
CREATE INDEX idx_files_file_type ON files(file_type);
CREATE INDEX idx_files_is_deleted ON files(is_deleted);
CREATE INDEX idx_files_is_favorite ON files(is_favorite);
CREATE INDEX idx_files_extension ON files(extension);

-- ============================================
-- FAVORITES (unified)
-- ============================================
CREATE TABLE IF NOT EXISTS favorites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_type TEXT NOT NULL CHECK (item_type IN ('project', 'file', 'folder')),
  item_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(item_type, item_id)
);

CREATE INDEX idx_favorites_item_type ON favorites(item_type);
CREATE INDEX idx_favorites_item_id ON favorites(item_id);

-- ============================================
-- SHARE LINKS
-- ============================================
CREATE TABLE IF NOT EXISTS share_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token TEXT NOT NULL UNIQUE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  folder_id UUID REFERENCES folders(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ,
  password_hash TEXT,
  allow_download BOOLEAN DEFAULT TRUE,
  view_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_share_links_token ON share_links(token);
CREATE INDEX idx_share_links_project_id ON share_links(project_id);

-- ============================================
-- ACTIVITY HISTORY
-- ============================================
CREATE TABLE IF NOT EXISTS activity (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  entity_name TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_activity_entity_type ON activity(entity_type);
CREATE INDEX idx_activity_created_at ON activity(created_at DESC);

-- ============================================
-- FULL TEXT SEARCH
-- ============================================
ALTER TABLE projects ADD COLUMN IF NOT EXISTS search_vector TSVECTOR;

CREATE OR REPLACE FUNCTION projects_search_update() RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    COALESCE(NEW.name, '') || ' ' ||
    COALESCE(NEW.description, '') || ' ' ||
    COALESCE(NEW.client, '') || ' ' ||
    COALESCE(NEW.event_name, '') || ' ' ||
    COALESCE(NEW.my_role, '') || ' ' ||
    COALESCE(array_to_string(NEW.tags, ' '), '') || ' ' ||
    COALESCE(array_to_string(NEW.software_used, ' '), '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER projects_search_update
BEFORE INSERT OR UPDATE ON projects
FOR EACH ROW EXECUTE FUNCTION projects_search_update();

CREATE INDEX idx_projects_search ON projects USING GIN(search_vector);

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_folders_updated_at BEFORE UPDATE ON folders FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_files_updated_at BEFORE UPDATE ON files FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_events_updated_at BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_share_links_updated_at BEFORE UPDATE ON share_links FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity ENABLE ROW LEVEL SECURITY;

-- Public READ policies (for viewing shared content via API)
CREATE POLICY "public_read_categories" ON categories FOR SELECT USING (true);
CREATE POLICY "public_read_projects" ON projects FOR SELECT USING (NOT is_deleted);
CREATE POLICY "public_read_files" ON files FOR SELECT USING (NOT is_deleted);
CREATE POLICY "public_read_folders" ON folders FOR SELECT USING (NOT is_deleted);
CREATE POLICY "public_read_events" ON events FOR SELECT USING (NOT is_deleted);
CREATE POLICY "public_read_favorites" ON favorites FOR SELECT USING (true);
CREATE POLICY "public_read_share_links" ON share_links FOR SELECT USING (is_active);

-- WRITE via service role only (API routes use service role key - never exposed to browser)
CREATE POLICY "service_write_folders" ON folders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_write_projects" ON projects FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_write_files" ON files FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_write_events" ON events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_write_categories" ON categories FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_write_favorites" ON favorites FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_write_share_links" ON share_links FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_write_activity" ON activity FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- STORAGE BUCKETS
-- ============================================
-- Run these separately in Supabase Storage UI or via the dashboard:
-- 1. Create bucket: "media" (public: true) for videos, images
-- 2. Create bucket: "thumbnails" (public: true) for generated thumbnails
-- 3. Create bucket: "files" (public: false) for design files, archives

-- Storage policies (execute after creating buckets)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('media', 'media', true) ON CONFLICT DO NOTHING;
-- INSERT INTO storage.buckets (id, name, public) VALUES ('thumbnails', 'thumbnails', true) ON CONFLICT DO NOTHING;
-- INSERT INTO storage.buckets (id, name, public) VALUES ('assets', 'assets', true) ON CONFLICT DO NOTHING;

-- ============================================
-- DEMO SEED DATA (development only)
-- ============================================
DO $$
DECLARE
  cat_motion UUID;
  cat_event UUID;
  cat_corporate UUID;
  cat_product UUID;
  folder_2025 UUID;
  folder_2026 UUID;
  folder_events UUID;
  folder_jan UUID;
  project1 UUID;
  project2 UUID;
  project3 UUID;
BEGIN
  SELECT id INTO cat_motion FROM categories WHERE slug = 'motion-graphics';
  SELECT id INTO cat_event FROM categories WHERE slug = 'event-videos';
  SELECT id INTO cat_corporate FROM categories WHERE slug = 'corporate-videos';
  SELECT id INTO cat_product FROM categories WHERE slug = 'product-launches';

  -- Create demo folders
  INSERT INTO folders (id, name, path, description) VALUES
    (uuid_generate_v4(), '2026', '/2026', 'Current year projects') RETURNING id INTO folder_2026;

  INSERT INTO folders (id, name, parent_id, path, description) VALUES
    (uuid_generate_v4(), '2025', NULL, '/2025', 'Previous year projects') RETURNING id INTO folder_2025;

  INSERT INTO folders (id, name, parent_id, path, description) VALUES
    (uuid_generate_v4(), 'January', folder_2026, '/2026/January', 'January 2026 projects') RETURNING id INTO folder_jan;

  INSERT INTO folders (id, name, parent_id, path, description) VALUES
    (uuid_generate_v4(), 'Event Videos', folder_2025, '/2025/Event Videos', 'All event coverage videos');

  INSERT INTO folders (id, name, parent_id, path, description) VALUES
    (uuid_generate_v4(), 'Product Campaigns', folder_2025, '/2025/Product Campaigns', 'Product launch campaigns');

  INSERT INTO folders (id, name, parent_id, path, description) VALUES
    (uuid_generate_v4(), 'Product Launch', folder_jan, '/2026/January/Product Launch', 'Product launch project files');

  INSERT INTO folders (id, name, path, description) VALUES
    (uuid_generate_v4(), 'Personal Projects', '/Personal Projects', 'Personal creative experiments');

  -- Create demo events
  INSERT INTO events (id, name, description, event_year, event_month, event_date) VALUES
    (uuid_generate_v4(), 'Annual Gala 2025', 'Company annual gala event coverage', 2025, 12, '2025-12-15'),
    (uuid_generate_v4(), 'Product Launch Summit', 'New product line launch event', 2026, 1, '2026-01-20'),
    (uuid_generate_v4(), 'Brand Campaign Q1', 'Q1 2026 brand awareness campaign', 2026, 1, '2026-01-10')
  ;

  -- Create demo projects
  INSERT INTO projects (id, name, description, category_id, client, event_name, year, month, tags, software_used, my_role, status, is_featured, is_favorite)
  VALUES
    (
      uuid_generate_v4(),
      'Annual Gala 2025 Highlights',
      'Full event coverage and highlight reel for the company annual gala. Cinematic 4K footage with color grading and motion graphics overlays.',
      cat_event,
      'Acme Corp',
      'Annual Gala 2025',
      2025, 12,
      ARRAY['event', 'highlight', 'corporate', 'gala'],
      ARRAY['Adobe Premiere Pro', 'After Effects', 'DaVinci Resolve'],
      'Video Editor & Colorist',
      'active', true, true
    ),
    (
      uuid_generate_v4(),
      'Product X Launch Campaign',
      'Full campaign for new product launch including teaser, main reveal video, and social media cuts.',
      cat_product,
      'TechBrand Inc',
      'Product Launch Summit',
      2026, 1,
      ARRAY['product', 'launch', 'campaign', 'social'],
      ARRAY['After Effects', 'Cinema 4D', 'Adobe Premiere Pro'],
      'Motion Designer & Editor',
      'active', true, false
    ),
    (
      uuid_generate_v4(),
      'Brand Identity Motion Pack',
      'Custom motion graphics package including logo reveals, lower thirds, transitions and outro cards.',
      cat_motion,
      'Studio Delta',
      NULL,
      2025, 10,
      ARRAY['motion', 'branding', 'package', 'logo'],
      ARRAY['After Effects', 'Illustrator'],
      'Motion Graphics Designer',
      'active', false, true
    )
  ;
END $$;
