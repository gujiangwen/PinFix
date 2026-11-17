import type Database from "better-sqlite3";
import {
  type AgentStep,
  type AgentStepPhase,
} from "@sightloop/shared";
import { ulid } from "ulid";

type StepRow = {
  id: string;
  session_id: string;
  idx: number;
  phase: AgentStepPhase;
  tool_name: string | null;
  input_json: string | null;
  output_json: string | null;
  error: string | null;
  created_at: number;
};

function rowToStep(row: StepRow): AgentStep {
  return {
    id: row.id,
    session_id: row.session_id,
    idx: row.idx,
    phase: row.phase,
    tool_name: row.tool_name,
    input: row.input_json ? (JSON.parse(row.input_json) as unknown) : null,
    output: row.output_json ? (JSON.parse(row.output_json) as unknown) : null,
    error: row.error,
    created_at: row.created_at,
  };
}

export function insertAgentStep(
  db: Database.Database,
  input: {
    session_id: string;
    idx: number;
    phase: AgentStepPhase;
    tool_name?: string | null;
    input?: unknown;
    output?: unknown;
    error?: string | null;
  },
): AgentStep {
  const step: AgentStep = {
    id: ulid(),
    session_id: input.session_id,
    idx: input.idx,
    phase: input.phase,
    tool_name: input.tool_name ?? null,
    input: input.input ?? null,
    output: input.output ?? null,
    error: input.error ?? null,
    created_at: Date.now(),
  };

  db.prepare(
    `INSERT INTO agent_steps (
      id, session_id, idx, phase, tool_name, input_json, output_json, error, created_at
    ) VALUES (
      @id, @session_id, @idx, @phase, @tool_name, @input_json, @output_json, @error, @created_at
    )`,
  ).run({
    id: step.id,
    session_id: step.session_id,
    idx: step.idx,
    phase: step.phase,
    tool_name: step.tool_name,
    input_json: step.input == null ? null : JSON.stringify(step.input),
    output_json: step.output == null ? null : JSON.stringify(step.output),
    error: step.error,
    created_at: step.created_at,
  });

  return step;
}

export function listAgentSteps(
  db: Database.Database,
  sessionId: string,
): AgentStep[] {
  const rows = db
    .prepare(
      `SELECT * FROM agent_steps WHERE session_id = ? ORDER BY idx ASC`,
    )
    .all(sessionId) as StepRow[];
  return rows.map(rowToStep);
}
