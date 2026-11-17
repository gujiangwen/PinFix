import { z } from "zod";
import { KnowledgeSchema, KnowledgeKindSchema } from "./review.js";
import { SessionStatusSchema } from "./session.js";

export const AuditEventSchema = z.object({
  id: z.string().min(1),
  project_id: z.string().nullable(),
  session_id: z.string().nullable(),
  event: z.string().min(1),
  detail: z.unknown().nullable(),
  created_at: z.number().int(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const MetricsSchema = z.object({
  sessions_total: z.number().int(),
  sessions_by_status: z.record(z.string(), z.number().int()),
  failure_rate: z.number(),
  avg_steps: z.number(),
  knowledge_total: z.number().int(),
  knowledge_pinned: z.number().int(),
  audit_total: z.number().int(),
  reviews_by_decision: z.record(z.string(), z.number().int()),
  vec_ready: z.boolean().optional(),
  vec_indexed: z.number().int().optional(),
});
export type Metrics = z.infer<typeof MetricsSchema>;

export const KnowledgeFilterSchema = z.object({
  project_id: z.string().optional(),
  stack: z.string().optional(),
  tag: z.string().optional(),
  kind: KnowledgeKindSchema.optional(),
  pinned: z.coerce.boolean().optional(),
  include_archived: z.coerce.boolean().optional(),
  q: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export type KnowledgeFilter = z.infer<typeof KnowledgeFilterSchema>;

export const UpdateKnowledgeInputSchema = z
  .object({
    title: z.string().min(1).max(500).optional(),
    body_md: z.string().max(100_000).optional(),
    kind: KnowledgeKindSchema.optional(),
    tags: z.array(z.string().min(1).max(64)).max(40).optional(),
    stack: z.string().max(120).nullable().optional(),
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field is required",
  });
export type UpdateKnowledgeInput = z.infer<typeof UpdateKnowledgeInputSchema>;

export const CreateKnowledgeInputSchema = z.object({
  project_id: z.string().min(1),
  session_id: z.string().nullable().optional(),
  kind: KnowledgeKindSchema.default("pattern"),
  title: z.string().min(1).max(500),
  body_md: z.string().max(100_000),
  tags: z.array(z.string().min(1).max(64)).max(40).optional(),
  stack: z.string().max(120).nullable().optional(),
  pinned: z.boolean().optional(),
});
export type CreateKnowledgeInput = z.infer<typeof CreateKnowledgeInputSchema>;

/** Extended knowledge card used by Knowledge Hub (M4). */
export const KnowledgeCardSchema = KnowledgeSchema.extend({
  tags: z.array(z.string()),
  stack: z.string().nullable(),
  pinned: z.boolean(),
  archived: z.boolean(),
  updated_at: z.number().int().nullable(),
});
export type KnowledgeCard = z.infer<typeof KnowledgeCardSchema>;

export const SyncAgentsMdInputSchema = z.object({
  /** When omitted, sync all pinned non-archived cards for the project. */
  knowledge_ids: z.array(z.string().min(1)).max(50).optional(),
  /** dry_run returns the suggested markdown without writing. */
  dry_run: z.boolean().optional(),
});
export type SyncAgentsMdInput = z.infer<typeof SyncAgentsMdInputSchema>;

export const SyncAgentsMdResultSchema = z.object({
  path: z.string(),
  wrote: z.boolean(),
  dry_run: z.boolean(),
  bytes: z.number().int(),
  markdown: z.string(),
  knowledge_ids: z.array(z.string()),
});
export type SyncAgentsMdResult = z.infer<typeof SyncAgentsMdResultSchema>;

export const SessionListFilterSchema = z.object({
  project_id: z.string().optional(),
  status: SessionStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export type SessionListFilter = z.infer<typeof SessionListFilterSchema>;
