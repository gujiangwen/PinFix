-- M8a: Playwright acceptance gate runs + baselines + session cache

CREATE TABLE IF NOT EXISTS acceptance_runs (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES sessions(id),
  project_id      TEXT NOT NULL REFERENCES projects(id),
  status          TEXT NOT NULL CHECK(status IN (
                    'queued','running','passed','failed','error','cancelled'
                  )),
  scenario_json   TEXT NOT NULL,
  report_json     TEXT,
  start_url       TEXT NOT NULL,
  temp_commit_sha TEXT,
  fingerprint     TEXT,
  error           TEXT,
  started_at      INTEGER,
  finished_at     INTEGER,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_acceptance_runs_session
  ON acceptance_runs(session_id, created_at);

CREATE TABLE IF NOT EXISTS acceptance_baselines (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id),
  fingerprint   TEXT NOT NULL,
  meta_json     TEXT NOT NULL,
  dir_relpath   TEXT NOT NULL,
  updated_at    INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  UNIQUE(project_id, fingerprint)
);

ALTER TABLE sessions ADD COLUMN last_acceptance_run_id TEXT;
ALTER TABLE sessions ADD COLUMN last_acceptance_status TEXT;

ALTER TABLE projects ADD COLUMN acceptance_gate_json TEXT;
