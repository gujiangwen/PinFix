import { z } from "zod";

export const ProjectModeSchema = z.enum(["hmr", "pr"]);
export type ProjectMode = z.infer<typeof ProjectModeSchema>;

/** Glob-like allowlist of editable paths relative to repo_path (e.g. "src/**", "apps/web/**"). */
export const FileWhitelistSchema = z
  .array(z.string().min(1).max(512))
  .max(200)
  .default([]);

export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  /** Absolute path to the business repo; must fall under allowed roots. */
  repo_path: z.string().min(1),
  /**
   * Origin URL / host pattern that may attach to this project
   * (e.g. "http://localhost:5173/*" or "https://*.example.com/*").
   */
  origin_pattern: z.string().min(1).max(512),
  /** Optional shell command run after agent edits (e.g. "pnpm test"). */
  verify_cmd: z.string().max(2000).nullable(),
  /** Relative path globs the agent may edit. Empty = no extra restriction beyond repo_path lock. */
  file_whitelist: FileWhitelistSchema,
  mode: ProjectModeSchema,
  default_branch: z.string().min(1).max(200).default("main"),
  markup_workspace: z.string().nullable(),
  /** Optional Vite/dev server origin for module-graph locate (e.g. http://localhost:5175). */
  dev_server_origin: z.string().max(512).nullable().optional(),
  created_at: z.number().int(),
  updated_at: z.number().int(),
});

export type Project = z.infer<typeof ProjectSchema>;

export const CreateProjectInputSchema = z.object({
  name: z.string().min(1).max(200),
  repo_path: z.string().min(1),
  origin_pattern: z.string().min(1).max(512),
  verify_cmd: z.string().max(2000).nullable().optional(),
  file_whitelist: FileWhitelistSchema.optional(),
  mode: ProjectModeSchema.default("hmr"),
  default_branch: z.string().min(1).max(200).optional(),
  markup_workspace: z.string().nullable().optional(),
  dev_server_origin: z.string().max(512).nullable().optional(),
});

export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;

export const UpdateProjectInputSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    origin_pattern: z.string().min(1).max(512).optional(),
    verify_cmd: z.string().max(2000).nullable().optional(),
    file_whitelist: FileWhitelistSchema.optional(),
    mode: ProjectModeSchema.optional(),
    default_branch: z.string().min(1).max(200).optional(),
    markup_workspace: z.string().nullable().optional(),
    dev_server_origin: z.string().max(512).nullable().optional(),
    /** Changing repo_path re-runs allowed-roots checks. */
    repo_path: z.string().min(1).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field is required",
  });

export type UpdateProjectInput = z.infer<typeof UpdateProjectInputSchema>;

export const ProjectListResponseSchema = z.object({
  projects: z.array(ProjectSchema),
});

export type ProjectListResponse = z.infer<typeof ProjectListResponseSchema>;
