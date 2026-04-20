import { z } from "zod";

export const presetIdSchema = z.enum([
  "auto",
  "generic",
  "node-repo",
  "python-service",
  "go-service",
  "svelte-web",
  "tagtwo",
]);
export type PresetId = z.infer<typeof presetIdSchema>;
