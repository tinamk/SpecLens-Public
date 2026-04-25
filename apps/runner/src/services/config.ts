import path from "node:path";
import { resolveSpecLensCacheRoot } from "@speclens/core";

export interface RunnerConfig {
  pollIntervalMs: number;
  maxConcurrency: number;
  sandboxImage: string;
  healthPort: number;
  runnerId: string;
  sandboxTimeoutMs: number;
  sandboxCpuLimit: string | null;
  sandboxMemoryLimit: string | null;
  sandboxTempRetentionMs: number;
  tempRoot: string;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const normalized = value?.trim() ?? "";
  if (!/^\d+$/.test(normalized)) {
    return fallback;
  }
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadRunnerConfig(): RunnerConfig {
  const cacheRoot = resolveSpecLensCacheRoot(process.env);
  return {
    pollIntervalMs: readPositiveInteger(process.env.RUNNER_POLL_INTERVAL_MS, 5000),
    maxConcurrency: readPositiveInteger(process.env.RUNNER_MAX_CONCURRENCY, 2),
    sandboxImage: process.env.SANDBOX_IMAGE ?? "speclens/analysis-runner:local",
    healthPort: readPositiveInteger(process.env.RUNNER_HEALTH_PORT, 4510),
    runnerId: process.env.RUNNER_ID ?? `runner-${process.pid}`,
    sandboxTimeoutMs: readPositiveInteger(process.env.SANDBOX_TIMEOUT_MS, 900_000),
    sandboxCpuLimit: process.env.SANDBOX_CPU_LIMIT ?? null,
    sandboxMemoryLimit: process.env.SANDBOX_MEMORY_LIMIT ?? null,
    sandboxTempRetentionMs: readPositiveInteger(process.env.SANDBOX_TEMP_RETENTION_MS, 86_400_000),
    tempRoot: process.env.RUNNER_TEMP_ROOT ?? path.join(cacheRoot, "runner"),
  };
}
