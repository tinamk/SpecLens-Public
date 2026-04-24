import fs from "node:fs";
import path from "node:path";
import { agentSandboxRequestSchema } from "@speclens/contracts";
import { executeAgentSandboxRequest } from "./worker";

async function main(): Promise<void> {
  const requestPath = process.argv[2];
  if (!requestPath) {
    throw new Error("Sandbox request path is required.");
  }

  const request = agentSandboxRequestSchema.parse(JSON.parse(fs.readFileSync(requestPath, "utf8")));
  fs.mkdirSync(request.execution.outputRoot, { recursive: true });
  const result = await executeAgentSandboxRequest(request);
  const resultPath = path.join(request.execution.outputRoot, "result.json");
  fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
