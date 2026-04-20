import { z } from "zod";
import {
  analysisRuntimeModeSchema,
  jobEnvelopeSchema,
  roleIdSchema,
  sandboxSecretSchema,
} from "@speclens/contracts";

export { jobEnvelopeSchema };

export const sandboxAnalyzeRequestSchema = z.object({
  jobId: z.string(),
  workspace: z.object({
    id: z.string(),
    slug: z.string(),
  }),
  roles: z.array(roleIdSchema),
  runtimeMode: analysisRuntimeModeSchema,
  secretRefs: z.array(z.string()).default([]),
  secrets: z.array(sandboxSecretSchema).default([]),
  outputRoot: z.string(),
  sourcePath: z.string(),
});
export type SandboxAnalyzeRequest = z.infer<typeof sandboxAnalyzeRequestSchema>;
