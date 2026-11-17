-- SightLoop schema v1 (M1: projects + scaffolding tables for later milestones)

CREATE TABLE IF NOT EXISTS schema_version (
  version     INTEGER PRIMARY KEY,
  applied_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  repo_path        TEXT NOT NULL UNIQUE,
  origin_pattern   TEXT NOT NULL,
  verify_cmd       TEXT,
  file_whitelist   TEXT NOT NULL DEFAULT '[]',
  mode             TEXT NOT NULL CHECK(mode IN ('hmr','pr')),
  default_branch   TEXT NOT NULL DEFAULT 'main',
  markup_workspace TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id),
  page_url        TEXT NOT NULL,
  status          TEXT NOT NULL CHECK(status IN (
                    'idle','retrieving','acting','awaiting_review',
                    'accepted','refined','reverted','failed','distilling'
                  )),
  sniff_json      TEXT,
  annotation_ref  TEXT,
  max_steps       INTEGER NOT NULL DEFAULT 5,
  step_count      INTEGER NOT NULL DEFAULT 0,
  git_base_sha    TEXT,
  temp_commit_sha TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_steps (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sessions(id),
  idx         INTEGER NOT NULL,
  phase       TEXT NOT NULL CHECK(phase IN ('retrieve','plan','act','verify')),
  tool_name   TEXT,
  input_json  TEXT,
  output_json TEXT,
  error       TEXT,
  created_at  INTEGER NOT NULL,
  UNIQUE(session_id, idx)
);

CREATE TABLE IF NOT EXISTS reviews (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sessions(id),
  decision    TEXT NOT NULL CHECK(decision IN ('accept','refine','revert')),
  note        TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id),
  session_id    TEXT REFERENCES sessions(id),
  kind          TEXT NOT NULL CHECK(kind IN ('pattern','anti_pattern','selector_map','fix_snippet')),
  title         TEXT NOT NULL,
  body_md       TEXT NOT NULL,
  embedding_ref TEXT,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,
  project_id  TEXT,
  session_id  TEXT,
  event       TEXT NOT NULL,
  detail_json TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_steps_session ON agent_steps(session_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_project ON knowledge(project_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
