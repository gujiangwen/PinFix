-- M12d: issue-level sticky checkpoints (R4 N-cap+GC, R8 project/repo bind)
CREATE TABLE IF NOT EXISTS session_checkpoints (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL,
  project_id    TEXT NOT NULL,
  repo_path     TEXT NOT NULL DEFAULT '',
  issue_ids     TEXT NOT NULL DEFAULT '[]',
  plan_json     TEXT,
  refine_ir     TEXT,
  wip_commit    TEXT,
  graph_state   TEXT,
  status        TEXT NOT NULL CHECK(status IN ('suspended','resumed','consumed')) DEFAULT 'suspended',
  note          TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON session_checkpoints(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkpoints_project ON session_checkpoints(project_id, status);
