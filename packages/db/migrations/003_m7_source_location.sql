-- M7: source location hints + optional Vite/dev server origin on projects

CREATE TABLE IF NOT EXISTS source_location_hints (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id),
  selector     TEXT,
  fingerprint  TEXT,
  file_path    TEXT NOT NULL,
  line         INTEGER,
  confidence   REAL NOT NULL DEFAULT 1.0,
  source       TEXT NOT NULL CHECK(source IN ('human','source_map','heuristic','distill')),
  hit_count    INTEGER NOT NULL DEFAULT 1,
  updated_at   INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_slh_project_selector
  ON source_location_hints(project_id, selector);
CREATE INDEX IF NOT EXISTS idx_slh_project_fp
  ON source_location_hints(project_id, fingerprint);

ALTER TABLE projects ADD COLUMN dev_server_origin TEXT;
