import path from "node:path";
import { resolveSpecLensCacheRoot } from "@speclens/core";

export interface AiWorkerConfig {
  pollIntervalMs: number;
  maxConcurrency: number;
  roleMaxConcurrency: number;
  healthPort: number;
  workerId: string;
  tempRoot: string;
  dockerHost: string | null;
  sandboxImage: string;
  sandboxNetwork: string | null;
  sandboxTimeoutMs: number;
  sandboxCpuLimit: string | null;
  sandboxMemoryLimit: string | null;
  sandboxTempRetentionMs: number;
  sandboxObjectStorageEndpoint: string | null;
  codexTimeoutMs: number;
  executionCommandTimeoutMs: number;
  runtimeBootTimeoutMs: number;
  playwrightCommandTimeoutMs: number;
  codexBin: string;
  codexModel: string | null;
  codexMaxAttempts: number;
  codexRetryDelayMs: number;
  codexUseOutputSchema: boolean;
  codexStreamLogs: boolean;
  codexBypassSandbox: boolean;
  hybridNativeFastPath: boolean;
  promptCapturePath: string | null;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const normalized = value?.trim() ?? "";
  if (!/^\d+$/.test(normalized)) {
    return fallback;
  }
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadAiWorkerConfig(): AiWorkerConfig {
  const cacheRoot = resolveSpecLensCacheRoot(process.env);
  const codexBypassSandbox = process.env.AI_WORKER_CODEX_BYPASS_SANDBOX === "true"
    && process.env.SPECLENS_ALLOW_UNSAFE_CODEX_BYPASS === "true";
  return {
    pollIntervalMs: readPositiveInteger(process.env.AI_WORKER_POLL_INTERVAL_MS, 5000),
    maxConcurrency: readPositiveInteger(process.env.AI_WORKER_MAX_CONCURRENCY, 1),
    roleMaxConcurrency: readPositiveInteger(process.env.AI_WORKER_ROLE_MAX_CONCURRENCY, 4),
    healthPort: readPositiveInteger(process.env.AI_WORKER_HEALTH_PORT, 4520),
    workerId: process.env.AI_WORKER_ID ?? `ai-worker-${process.pid}`,
    tempRoot: process.env.AI_WORKER_TEMP_ROOT ?? path.join(cacheRoot, "ai-worker"),
    dockerHost: process.env.AI_WORKER_DOCKER_HOST ?? process.env.DOCKER_HOST ?? null,
    sandboxImage: process.env.AI_WORKER_SANDBOX_IMAGE ?? "speclens/ai-agent-sandbox:local",
    sandboxNetwork: process.env.AI_WORKER_SANDBOX_NETWORK ?? null,
    sandboxTimeoutMs: readPositiveInteger(process.env.AI_WORKER_SANDBOX_TIMEOUT_MS, 3_600_000),
    sandboxCpuLimit: process.env.AI_WORKER_SANDBOX_CPU_LIMIT ?? null,
    sandboxMemoryLimit: process.env.AI_WORKER_SANDBOX_MEMORY_LIMIT ?? null,
    sandboxTempRetentionMs: readPositiveInteger(process.env.AI_WORKER_SANDBOX_TEMP_RETENTION_MS, 86_400_000),
    sandboxObjectStorageEndpoint: process.env.AI_WORKER_SANDBOX_OBJECT_STORAGE_ENDPOINT ?? null,
    codexTimeoutMs: readPositiveInteger(process.env.AI_WORKER_CODEX_TIMEOUT_MS, 1_800_000),
    executionCommandTimeoutMs: readPositiveInteger(process.env.AI_WORKER_EXECUTION_COMMAND_TIMEOUT_MS, 600_000),
    runtimeBootTimeoutMs: readPositiveInteger(process.env.AI_WORKER_RUNTIME_BOOT_TIMEOUT_MS, 60_000),
    playwrightCommandTimeoutMs: readPositiveInteger(process.env.AI_WORKER_PLAYWRIGHT_COMMAND_TIMEOUT_MS, 900_000),
    codexBin: process.env.CODEX_BIN ?? "codex",
    codexModel: process.env.OPENAI_CODEX_MODEL?.trim() || null,
    codexMaxAttempts: readPositiveInteger(process.env.AI_WORKER_CODEX_MAX_ATTEMPTS, 3),
    codexRetryDelayMs: readPositiveInteger(process.env.AI_WORKER_CODEX_RETRY_DELAY_MS, 10_000),
    codexUseOutputSchema: process.env.AI_WORKER_CODEX_USE_OUTPUT_SCHEMA === "true",
    codexStreamLogs: process.env.AI_WORKER_CODEX_STREAM_LOGS === "true",
    codexBypassSandbox,
    hybridNativeFastPath: process.env.AI_WORKER_HYBRID_NATIVE_FAST_PATH !== "false",
    promptCapturePath: process.env.AI_WORKER_PROMPT_CAPTURE_PATH?.trim() || null,
  };
}
