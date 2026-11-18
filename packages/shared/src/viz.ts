import { z } from "zod";
import { KnowledgeKindSchema } from "./review.js";
import { SessionStatusSchema } from "./session.js";

export const DiffFileSummarySchema = z.object({
  path: z.string(),
  additions: z.number().int(),
  deletions: z.number().int(),
});
export type DiffFileSummary = z.infer<typeof DiffFileSummarySchema>;

export const DiffSummarySchema = z.object({
  files: z.array(DiffFileSummarySchema),
  additions: z.number().int(),
  deletions: z.number().int(),
  truncated: z.boolean().optional(),
});
export type DiffSummary = z.infer<typeof DiffSummarySchema>;

export const VerifyResultSchema = z.object({
  ok: z.boolean(),
  exit_code: z.number().int().nullable().optional(),
  log_tail: z.string(),
  command: z.string().nullable().optional(),
});
export type VerifyResult = z.infer<typeof VerifyResultSchema>;

export const RecallHitSchema = z.object({
  knowledge_id: z.string().nullable(),
  title: z.string(),
  score: z.number().nullable().optional(),
  distance: z.number().nullable().optional(),
  retrieve: z.string().nullable().optional(),
  kind: z.string().nullable().optional(),
  body_preview: z.string().optional(),
  source_session_id: z.string().nullable().optional(),
});
export type RecallHit = z.infer<typeof RecallHitSchema>;

export const TimelineEventSchema = z.object({
  at: z.number().int(),
  kind: z.enum([
    "step",
    "status",
    "refine_note",
    "verify",
    "recall",
    "distill",
    "review",
  ]),
  label: z.string(),
  detail: z.string().nullable().optional(),
  phase: z.string().nullable().optional(),
  tool_name: z.string().nullable().optional(),
  idx: z.number().int().nullable().optional(),
});
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;

export const DistilledKnowledgePreviewSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: KnowledgeKindSchema,
  body_preview: z.string(),
});
export type DistilledKnowledgePreview = z.infer<
  typeof DistilledKnowledgePreviewSchema
>;

export const SessionReadModelExtrasSchema = z.object({
  timeline: z.array(TimelineEventSchema),
  verify: VerifyResultSchema.nullable(),
  recall_hits: z.array(RecallHitSchema),
  diff_summary: DiffSummarySchema.nullable(),
  latest_knowledge: DistilledKnowledgePreviewSchema.nullable().optional(),
});
export type SessionReadModelExtras = z.infer<typeof SessionReadModelExtrasSchema>;
