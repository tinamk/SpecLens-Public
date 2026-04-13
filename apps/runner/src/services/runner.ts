import http from "node:http";
import { setTimeout as wait } from "node:timers/promises";
import { analyzeRepo, type AnalyzeRepoOptions } from "@speclens/core";
import { loadRunnerConfig } from "./config";

export async function executeRunnerJob(job: AnalyzeRepoOptions): Promise<void> {
  const startedAt = Date.now();
  console.log(`[runner] executing source=${job.source.location}`);
  const result = await analyzeRepo(job);
  console.log(
    `[runner] completed job=${result.job.id} runtime=${result.job.runtimeMode} findings=${result.report?.summary.totalFindings ?? 0} durationMs=${Date.now() - startedAt}`,
  );
}

export async function startRunnerLoop(): Promise<void> {
  const config = loadRunnerConfig();
  console.log(`[runner] starting with maxConcurrency=${config.maxConcurrency} image=${config.sandboxImage}`);
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      ok: true,
      role: "runner",
      maxConcurrency: config.maxConcurrency,
    }));
  });
  server.listen(config.healthPort, "0.0.0.0", () => {
    console.log(`[runner] health endpoint listening on http://0.0.0.0:${config.healthPort}`);
  });

  const sourceLocation = process.env.RUNNER_ONESHOT_SOURCE;
  if (sourceLocation) {
    const oneshotJob: AnalyzeRepoOptions = {
      workspace: {
        rootDir: process.cwd(),
        name: process.env.RUNNER_ONESHOT_WORKSPACE ?? "runner-oneshot",
      },
      source: {
        type: (process.env.RUNNER_ONESHOT_SOURCE_TYPE as "path" | "git" | "workspace" | undefined) ?? "path",
        location: sourceLocation,
      },
      preset: (process.env.RUNNER_ONESHOT_PRESET as AnalyzeRepoOptions["preset"] | undefined) ?? "auto",
      mode: "hosted",
    };
    const runtimeMode = process.env.RUNNER_ONESHOT_RUNTIME_MODE as AnalyzeRepoOptions["runtimeMode"] | undefined;
    if (runtimeMode) {
      oneshotJob.runtimeMode = runtimeMode;
    }
    await executeRunnerJob(oneshotJob);
    return;
  }

  for (;;) {
    console.log("[runner] polling for queued jobs");
    await wait(config.pollIntervalMs);
  }
}
