import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";

const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: "speclens_runner_" });

const runnerJobsTotal = new Counter({
  name: "speclens_runner_jobs_total",
  help: "Runner job completions by status.",
  labelNames: ["status"],
  registers: [registry],
});

const runnerJobDurationMs = new Histogram({
  name: "speclens_runner_job_duration_ms",
  help: "Runner job duration in milliseconds.",
  labelNames: ["status"],
  buckets: [100, 500, 1000, 2000, 5000, 10_000, 30_000, 60_000, 120_000],
  registers: [registry],
});

const sandboxDurationMs = new Histogram({
  name: "speclens_runner_sandbox_duration_ms",
  help: "Sandbox execution duration in milliseconds.",
  labelNames: ["status"],
  buckets: [100, 500, 1000, 2000, 5000, 10_000, 30_000, 60_000, 120_000],
  registers: [registry],
});

export function recordRunnerJob(status: "succeeded" | "failed" | "cancelled", durationMs: number): void {
  runnerJobsTotal.inc({ status });
  runnerJobDurationMs.observe({ status }, durationMs);
}

export function recordSandboxDuration(status: "succeeded" | "failed" | "cancelled", durationMs: number): void {
  sandboxDurationMs.observe({ status }, durationMs);
}

export function getMetricsContentType(): string {
  return registry.contentType;
}

export async function getMetricsSnapshot(): Promise<string> {
  return registry.metrics();
}
