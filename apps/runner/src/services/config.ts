export interface RunnerConfig {
  pollIntervalMs: number;
  maxConcurrency: number;
  sandboxImage: string;
  healthPort: number;
}

export function loadRunnerConfig(): RunnerConfig {
  return {
    pollIntervalMs: Number(process.env.RUNNER_POLL_INTERVAL_MS ?? 5000),
    maxConcurrency: Number(process.env.RUNNER_MAX_CONCURRENCY ?? 2),
    sandboxImage: process.env.SANDBOX_IMAGE ?? "speclens/analysis-runner:local",
    healthPort: Number(process.env.RUNNER_HEALTH_PORT ?? 4510),
  };
}
