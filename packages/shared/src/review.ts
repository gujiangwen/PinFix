import { z } from "zod";

export const ReviewDecisionSchema = z.enum(["accept", "refine", "revert"]);
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;

export const ReviewInputSchema = z.object({
  decision: ReviewDecisionSchema,
  note: z.string().max(8000).optional(),
});
export type ReviewInput = z.infer<typeof ReviewInputSchema>;

export const ReviewSchema = z.object({
  id: z.string().min(1),
  session_id: z.string().min(1),
  decision: ReviewDecisionSchema,
  note: z.string().nullable(),
  created_at: z.number().int(),
});
export type Review = z.infer<typeof ReviewSchema>;

export const AgentStepPhaseSchema = z.enum([
  "retrieve",
  "plan",
  "act",
  "verify",
]);
export type AgentStepPhase = z.infer<typeof AgentStepPhaseSchema>;

export const AgentStepSchema = z.object({
  id: z.string().min(1),
  session_id: z.string().min(1),
  idx: z.number().int().min(0),
  phase: AgentStepPhaseSchema,
  tool_name: z.string().nullable(),
  input: z.unknown().nullable(),
  output: z.unknown().nullable(),
  error: z.string().nullable(),
  summary: z.string().nullable().optional(),
  duration_ms: z.number().int().nullable().optional(),
  tokens_in: z.number().int().nullable().optional(),
  tokens_out: z.number().int().nullable().optional(),
  created_at: z.number().int(),
});
export type AgentStep = z.infer<typeof AgentStepSchema>;

export const KnowledgeKindSchema = z.enum([
  "pattern",
  "anti_pattern",
  "selector_map",
  "fix_snippet",
]);
export type KnowledgeKind = z.infer<typeof KnowledgeKindSchema>;

export const KnowledgeSchema = z.object({
  id: z.string().min(1),
  project_id: z.string().min(1),
  session_id: z.string().nullable(),
  kind: KnowledgeKindSchema,
  title: z.string().min(1),
  body_md: z.string(),
  embedding_ref: z.string().nullable(),
  tags: z.array(z.string()).default([]),
  stack: z.string().nullable().optional(),
  pinned: z.boolean().default(false),
  archived: z.boolean().default(false),
  created_at: z.number().int(),
  updated_at: z.number().int().nullable().optional(),
});
export type Knowledge = z.infer<typeof KnowledgeSchema>;

export const SessionDiffResponseSchema = z.object({
  session_id: z.string(),
  git_base_sha: z.string().nullable(),
  temp_commit_sha: z.string().nullable(),
  patch: z.string(),
});
export type SessionDiffResponse = z.infer<typeof SessionDiffResponseSchema>;
