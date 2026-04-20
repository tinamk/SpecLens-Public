import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: "speclens_ai_worker_" });

const aiWorkerJobsTotal = new Counter({
  name: "speclens_ai_worker_jobs_total",
  help: "AI worker job completions by job kind and final status.",
  labelNames: ["kind", "status"],
  registers: [registry],
});

const aiWorkerJobDurationMs = new Histogram({
  name: "speclens_ai_worker_job_duration_ms",
  help: "AI worker job duration in milliseconds.",
  labelNames: ["kind", "status"],
  buckets: [500, 1000, 2000, 5000, 10_000, 30_000, 60_000, 120_000, 300_000, 900_000, 1_800_000],
  registers: [registry],
});

const aiWorkerActiveJobs = new Gauge({
  name: "speclens_ai_worker_active_jobs",
  help: "Number of active AI worker jobs by kind.",
  labelNames: ["kind"],
  registers: [registry],
});

type AiWorkerJobStatus = "succeeded" | "failed" | "cancelled" | "unknown";

export function beginAiWorkerJob(kind: string): (status: AiWorkerJobStatus) => void {
  const startedAt = Date.now();
  aiWorkerActiveJobs.inc({ kind });
  let finished = false;
  return (status: AiWorkerJobStatus) => {
    if (finished) {
      return;
    }
    finished = true;
    aiWorkerActiveJobs.dec({ kind });
    aiWorkerJobsTotal.inc({ kind, status });
    aiWorkerJobDurationMs.observe({ kind, status }, Date.now() - startedAt);
  };
}

export function getMetricsContentType(): string {
  return registry.contentType;
}

export async function getMetricsSnapshot(): Promise<string> {
  return registry.metrics();
}
