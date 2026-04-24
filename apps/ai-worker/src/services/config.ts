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
  promptCapturePath: string | null;
}

export function loadAiWorkerConfig(): AiWorkerConfig {
  const cacheRoot = resolveSpecLensCacheRoot(process.env);
  const codexBypassSandbox = process.env.AI_WORKER_CODEX_BYPASS_SANDBOX === "true"
    && process.env.SPECLENS_ALLOW_UNSAFE_CODEX_BYPASS === "true";
  return {
    pollIntervalMs: Number(process.env.AI_WORKER_POLL_INTERVAL_MS ?? 5000),
    maxConcurrency: Number(process.env.AI_WORKER_MAX_CONCURRENCY ?? 1),
    roleMaxConcurrency: Math.max(1, Number(process.env.AI_WORKER_ROLE_MAX_CONCURRENCY ?? 4)),
    healthPort: Number(process.env.AI_WORKER_HEALTH_PORT ?? 4520),
    workerId: process.env.AI_WORKER_ID ?? `ai-worker-${process.pid}`,
    tempRoot: process.env.AI_WORKER_TEMP_ROOT ?? path.join(cacheRoot, "ai-worker"),
    dockerHost: process.env.AI_WORKER_DOCKER_HOST ?? process.env.DOCKER_HOST ?? null,
    sandboxImage: process.env.AI_WORKER_SANDBOX_IMAGE ?? "speclens/ai-agent-sandbox:local",
    sandboxNetwork: process.env.AI_WORKER_SANDBOX_NETWORK ?? null,
    sandboxTimeoutMs: Number(process.env.AI_WORKER_SANDBOX_TIMEOUT_MS ?? 3_600_000),
    sandboxCpuLimit: process.env.AI_WORKER_SANDBOX_CPU_LIMIT ?? null,
    sandboxMemoryLimit: process.env.AI_WORKER_SANDBOX_MEMORY_LIMIT ?? null,
    sandboxTempRetentionMs: Number(process.env.AI_WORKER_SANDBOX_TEMP_RETENTION_MS ?? 86_400_000),
    sandboxObjectStorageEndpoint: process.env.AI_WORKER_SANDBOX_OBJECT_STORAGE_ENDPOINT ?? null,
    codexTimeoutMs: Number(process.env.AI_WORKER_CODEX_TIMEOUT_MS ?? 1_800_000),
    executionCommandTimeoutMs: Number(process.env.AI_WORKER_EXECUTION_COMMAND_TIMEOUT_MS ?? 600_000),
    runtimeBootTimeoutMs: Number(process.env.AI_WORKER_RUNTIME_BOOT_TIMEOUT_MS ?? 60_000),
    playwrightCommandTimeoutMs: Number(process.env.AI_WORKER_PLAYWRIGHT_COMMAND_TIMEOUT_MS ?? 900_000),
    codexBin: process.env.CODEX_BIN ?? "codex",
    codexModel: process.env.OPENAI_CODEX_MODEL?.trim() || null,
    codexMaxAttempts: Number(process.env.AI_WORKER_CODEX_MAX_ATTEMPTS ?? 3),
    codexRetryDelayMs: Number(process.env.AI_WORKER_CODEX_RETRY_DELAY_MS ?? 10_000),
    codexUseOutputSchema: process.env.AI_WORKER_CODEX_USE_OUTPUT_SCHEMA === "true",
    codexStreamLogs: process.env.AI_WORKER_CODEX_STREAM_LOGS === "true",
    codexBypassSandbox,
    promptCapturePath: process.env.AI_WORKER_PROMPT_CAPTURE_PATH?.trim() || null,
  };
}
