import { z } from "zod";

export const SessionStatusSchema = z.enum([
  "idle",
  "retrieving",
  "acting",
  "awaiting_review",
  "accepted",
  "refined",
  "reverted",
  "failed",
  "distilling",
]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

/** Opaque sniff payload from the extension / @sightloop/sniff. */
export const SniffPayloadSchema = z.union([
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
]);
export type SniffPayload = z.infer<typeof SniffPayloadSchema>;

export const AnnotationSchema = z.object({
  note: z.string().max(8000).optional(),
  selector: z.string().max(2000).optional(),
  screenshot_ref: z.string().max(1000).nullable().optional(),
});
export type Annotation = z.infer<typeof AnnotationSchema>;

export const SessionSchema = z.object({
  id: z.string().min(1),
  project_id: z.string().min(1),
  page_url: z.string().min(1).max(4000),
  status: SessionStatusSchema,
  sniff: z.unknown().nullable(),
  annotation_ref: z.string().nullable(),
  annotation: AnnotationSchema.nullable().optional(),
  max_steps: z.number().int().min(1).max(5),
  step_count: z.number().int().min(0),
  git_base_sha: z.string().nullable(),
  temp_commit_sha: z.string().nullable(),
  created_at: z.number().int(),
  updated_at: z.number().int(),
});
export type Session = z.infer<typeof SessionSchema>;

export const CreateSessionInputSchema = z.object({
  project_id: z.string().min(1),
  page_url: z.string().min(1).max(4000),
  /** Single sniff result or a batch array. */
  sniff: SniffPayloadSchema,
  annotation: AnnotationSchema.optional(),
  annotation_ref: z.string().max(500).nullable().optional(),
  max_steps: z.number().int().min(1).max(5).optional(),
});
export type CreateSessionInput = z.infer<typeof CreateSessionInputSchema>;

export const SessionListResponseSchema = z.object({
  sessions: z.array(SessionSchema),
});
export type SessionListResponse = z.infer<typeof SessionListResponseSchema>;

/** Client → server WS ops */
export const WsClientMessageSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("subscribe"),
    session_id: z.string().min(1),
  }),
  z.object({
    op: z.literal("unsubscribe"),
    session_id: z.string().min(1),
  }),
  z.object({
    op: z.literal("ping"),
  }),
]);
export type WsClientMessage = z.infer<typeof WsClientMessageSchema>;

export const SessionStepEventSchema = z.object({
  idx: z.number().int(),
  phase: z.enum(["retrieve", "plan", "act", "verify"]),
  tool_name: z.string().nullable().optional(),
  summary: z.string().optional(),
});
export type SessionStepEvent = z.infer<typeof SessionStepEventSchema>;

/** Server → client WS events */
export const WsServerEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session.status"),
    session_id: z.string(),
    status: SessionStatusSchema,
    step_count: z.number().int(),
  }),
  z.object({
    type: z.literal("session.step"),
    session_id: z.string(),
    step: SessionStepEventSchema,
  }),
  z.object({
    type: z.literal("session.awaiting_review"),
    session_id: z.string(),
    preview: z.object({
      temp_commit_sha: z.string().nullable(),
      summary: z.string(),
      mode: z.enum(["hmr", "pr"]).optional(),
    }),
  }),
  z.object({
    type: z.literal("session.terminal"),
    session_id: z.string(),
    status: SessionStatusSchema,
  }),
  z.object({
    type: z.literal("security.alert"),
    event: z.string(),
    detail: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    type: z.literal("subscribed"),
    session_id: z.string(),
  }),
  z.object({
    type: z.literal("pong"),
  }),
  z.object({
    type: z.literal("error"),
    code: z.string(),
    message: z.string(),
  }),
]);
export type WsServerEvent = z.infer<typeof WsServerEventSchema>;
