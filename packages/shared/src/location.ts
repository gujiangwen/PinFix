import { z } from "zod";

export const LocationMethodSchema = z.enum([
  "fiber_debug_source",
  "vue_file",
  "source_map",
  "vite_module_graph",
  "selector_memory",
  "component_heuristic",
  "human",
  "unknown",
]);
export type LocationMethod = z.infer<typeof LocationMethodSchema>;

export const ConfidenceLevelSchema = z.enum(["high", "medium", "low"]);
export type ConfidenceLevel = z.infer<typeof ConfidenceLevelSchema>;

export const SourceLocationSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().nullable().optional(),
  column: z.number().int().nullable().optional(),
  confidence: z.number().min(0).max(1),
  confidence_level: ConfidenceLevelSchema,
  method: LocationMethodSchema,
  alternates: z
    .array(
      z.object({
        file: z.string(),
        confidence: z.number().min(0).max(1),
        method: LocationMethodSchema.optional(),
      }),
    )
    .optional(),
});
export type SourceLocation = z.infer<typeof SourceLocationSchema>;

export const SourceCorrectInputSchema = z.object({
  file: z.string().min(1).max(1000),
  line: z.number().int().positive().optional(),
  note: z.string().max(2000).optional(),
  selector: z.string().max(2000).optional(),
  fingerprint: z.string().max(200).optional(),
});
export type SourceCorrectInput = z.infer<typeof SourceCorrectInputSchema>;

export const LocateInputSchema = z.object({
  selector: z.string().max(2000).optional(),
  fingerprint: z.string().max(200).optional(),
  component_name: z.string().max(200).optional(),
  source_mapping_urls: z.array(z.string().max(4000)).max(20).optional(),
  page_url: z.string().max(4000).optional(),
});
export type LocateInput = z.infer<typeof LocateInputSchema>;

export const SourceLocationHintSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  selector: z.string().nullable(),
  fingerprint: z.string().nullable(),
  file_path: z.string(),
  line: z.number().int().nullable(),
  confidence: z.number(),
  source: z.enum(["human", "source_map", "heuristic", "distill"]),
  hit_count: z.number().int(),
  updated_at: z.number().int(),
  created_at: z.number().int(),
});
export type SourceLocationHint = z.infer<typeof SourceLocationHintSchema>;
