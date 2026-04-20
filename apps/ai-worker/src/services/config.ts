import path from "node:path";
import { resolveSpecLensCacheRoot } from "@speclens/core";

export interface AiWorkerConfig {
  pollIntervalMs: number;
  maxConcurrency: number;
  healthPort: number;
  workerId: string;
  tempRoot: string;
  codexTimeoutMs: number;
  executionCommandTimeoutMs: number;
  runtimeBootTimeoutMs: number;
  playwrightCommandTimeoutMs: number;
  codexBin: string;
  codexModel: string | null;
  codexMaxAttempts: number;
  codexRetryDelayMs: number;
  codexUseOutputSchema: boolean;
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
    healthPort: Number(process.env.AI_WORKER_HEALTH_PORT ?? 4520),
    workerId: process.env.AI_WORKER_ID ?? `ai-worker-${process.pid}`,
    tempRoot: process.env.AI_WORKER_TEMP_ROOT ?? path.join(cacheRoot, "ai-worker"),
    codexTimeoutMs: Number(process.env.AI_WORKER_CODEX_TIMEOUT_MS ?? 1_800_000),
    executionCommandTimeoutMs: Number(process.env.AI_WORKER_EXECUTION_COMMAND_TIMEOUT_MS ?? 600_000),
    runtimeBootTimeoutMs: Number(process.env.AI_WORKER_RUNTIME_BOOT_TIMEOUT_MS ?? 60_000),
    playwrightCommandTimeoutMs: Number(process.env.AI_WORKER_PLAYWRIGHT_COMMAND_TIMEOUT_MS ?? 900_000),
    codexBin: process.env.CODEX_BIN ?? "codex",
    codexModel: process.env.OPENAI_CODEX_MODEL?.trim() || null,
    codexMaxAttempts: Number(process.env.AI_WORKER_CODEX_MAX_ATTEMPTS ?? 3),
    codexRetryDelayMs: Number(process.env.AI_WORKER_CODEX_RETRY_DELAY_MS ?? 10_000),
    codexUseOutputSchema: process.env.AI_WORKER_CODEX_USE_OUTPUT_SCHEMA === "true",
    codexBypassSandbox,
    promptCapturePath: process.env.AI_WORKER_PROMPT_CAPTURE_PATH?.trim() || null,
  };
}
