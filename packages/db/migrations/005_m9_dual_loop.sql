-- M9a: dual-loop plan/review cache + expanded agent_steps.phase

ALTER TABLE sessions ADD COLUMN plan_json TEXT;
ALTER TABLE sessions ADD COLUMN agent_review_json TEXT;
ALTER TABLE sessions ADD COLUMN inner_refine_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN dual_loop_enabled INTEGER NOT NULL DEFAULT 0;

-- Recreate agent_steps to widen phase CHECK (SQLite cannot ALTER CHECK)
CREATE TABLE IF NOT EXISTS agent_steps_m9 (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sessions(id),
  idx         INTEGER NOT NULL,
  phase       TEXT NOT NULL CHECK(phase IN ('retrieve','plan','act','verify','review')),
  tool_name   TEXT,
  input_json  TEXT,
  output_json TEXT,
  error       TEXT,
  created_at  INTEGER NOT NULL,
  duration_ms INTEGER,
  tokens_in   INTEGER,
  tokens_out  INTEGER,
  summary     TEXT,
  UNIQUE(session_id, idx)
);

INSERT INTO agent_steps_m9 (
  id, session_id, idx, phase, tool_name, input_json, output_json, error,
  created_at, duration_ms, tokens_in, tokens_out, summary
)
SELECT
  id, session_id, idx, phase, tool_name, input_json, output_json, error,
  created_at, duration_ms, tokens_in, tokens_out, summary
FROM agent_steps;

DROP TABLE agent_steps;
ALTER TABLE agent_steps_m9 RENAME TO agent_steps;
CREATE INDEX IF NOT EXISTS idx_steps_session ON agent_steps(session_id);
