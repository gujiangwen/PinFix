-- M4: knowledge hub metadata + step timing / summaries for Admin

ALTER TABLE knowledge ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE knowledge ADD COLUMN stack TEXT;
ALTER TABLE knowledge ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE knowledge ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
ALTER TABLE knowledge ADD COLUMN updated_at INTEGER;

ALTER TABLE agent_steps ADD COLUMN duration_ms INTEGER;
ALTER TABLE agent_steps ADD COLUMN tokens_in INTEGER;
ALTER TABLE agent_steps ADD COLUMN tokens_out INTEGER;
ALTER TABLE agent_steps ADD COLUMN summary TEXT;

CREATE INDEX IF NOT EXISTS idx_knowledge_pinned ON knowledge(pinned DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_archived ON knowledge(archived);
CREATE INDEX IF NOT EXISTS idx_audit_project ON audit_log(project_id);
CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_log(session_id);
