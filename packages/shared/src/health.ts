import { z } from "zod";

export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal("sightloop-daemon"),
  version: z.string(),
  now: z.number().int(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
