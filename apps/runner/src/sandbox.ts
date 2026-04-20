import fs from "node:fs";
import path from "node:path";
import { analyzeRepo } from "@speclens/core";
import { jobEnvelopeSchema, sandboxAnalyzeRequestSchema } from "./contracts";

async function main(): Promise<void> {
  const requestPath = process.argv[2];
  if (!requestPath) {
    throw new Error("Sandbox request path is required.");
  }

  const request = sandboxAnalyzeRequestSchema.parse(JSON.parse(fs.readFileSync(requestPath, "utf8")));
  fs.mkdirSync(request.outputRoot, { recursive: true });

  const envelope = await analyzeRepo({
    jobId: request.jobId,
    workspace: {
      rootDir: request.outputRoot,
      name: request.workspace.slug,
    },
    repoPath: request.sourcePath,
    roles: request.roles,
    runtimeMode: request.runtimeMode,
    secretRefs: request.secretRefs,
    secrets: request.secrets.map(secret => ({
      id: secret.id,
      kind: secret.kind,
      value: secret.value,
      ...(secret.name ? { name: secret.name } : {}),
    })),
    mode: "hosted",
    allowHostExecution: true,
  });

  const resultPath = path.join(request.outputRoot, "result.json");
  fs.writeFileSync(resultPath, `${JSON.stringify(jobEnvelopeSchema.parse(envelope), null, 2)}\n`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
