import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHomeTempDirSync } from "./local-paths";

export interface AiProviderDescriptor {
  id: string;
  kind: "openai" | "openai-codex";
  label: string;
  model: string;
  baseUrl: string;
  apiKey: string | null;
}

export interface GenerateWithProvidersOptions {
  task: string;
  prompt: string;
  providers?: AiProviderDescriptor[];
  maxTokens?: number;
  timeoutMs?: number;
  budgetUsd?: number;
}

interface ProviderExecution {
  ok: boolean;
  content: string | null;
  error?: string;
}

type ProviderExecutor = (provider: AiProviderDescriptor, options: GenerateWithProvidersOptions) => Promise<ProviderExecution>;

export const DEFAULT_REQUEST_COST_USD = 0.01;

export interface AiRuntimeDefaults {
  maxTokens?: number;
  timeoutMs?: number;
  budgetUsd?: number;
}

export interface AiBudgetTracker {
  remainingUsd: number | null;
  reserve: (costUsd?: number) => boolean;
}

function resolveCodexAuthPath(env: NodeJS.ProcessEnv = process.env): string {
  const explicitPath = env.CODEX_AUTH_PATH;
  if (explicitPath) {
    return explicitPath;
  }
  const codexHome = env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
  return path.join(codexHome, "auth.json");
}

function hasCodexAuth(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    return fs.existsSync(resolveCodexAuthPath(env));
  } catch {
    return false;
  }
}

async function runCodexCli(provider: AiProviderDescriptor, options: GenerateWithProvidersOptions): Promise<ProviderExecution> {
  const tempDir = createHomeTempDirSync("speclens-codex-");
  const outputPath = path.join(tempDir, "last-message.txt");
  const prompt = [
    `You are SpecLens helping with the task "${options.task}". Respond concisely in plain text.`,
    "",
    options.prompt,
  ].join("\n");
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--model",
    provider.model,
    "--output-last-message",
    outputPath,
    prompt,
  ];

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.env.CODEX_BIN ?? "codex", args, {
        cwd: process.cwd(),
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];
      const timeoutMs = options.timeoutMs;
      const timeout = Number.isFinite(timeoutMs ?? Number.NaN) && (timeoutMs ?? 0) > 0
        ? setTimeout(() => child.kill("SIGTERM"), timeoutMs)
        : null;

      child.stdout?.on("data", chunk => stdoutChunks.push(String(chunk)));
      child.stderr?.on("data", chunk => stderrChunks.push(String(chunk)));
      child.on("error", reject);
      child.on("close", exitCode => {
        if (timeout) {
          clearTimeout(timeout);
        }
        if (exitCode === 0) {
          resolve();
          return;
        }
        reject(new Error([...stderrChunks, ...stdoutChunks].join("").trim() || `Codex CLI exited with code ${exitCode ?? "unknown"}.`));
      });
    });

    const content = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8").trim() : "";
    if (!content) {
      return {
        ok: false,
        content: null,
        error: "Codex CLI returned no text content.",
      };
    }

    return {
      ok: true,
      content,
    };
  } catch (error) {
    return {
      ok: false,
      content: null,
      error: error instanceof Error ? error.message : "Codex CLI execution failed.",
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export function resolveAiDefaults(env: NodeJS.ProcessEnv = process.env): AiRuntimeDefaults {
  const maxTokens = Number.parseInt(env.AI_MAX_TOKENS ?? "", 10);
  const timeoutMs = Number.parseInt(env.AI_TIMEOUT_MS ?? "", 10);
  const budgetUsd = Number.parseFloat(env.AI_BUDGET_USD ?? "");

  const defaults: AiRuntimeDefaults = {};
  if (Number.isFinite(maxTokens) && maxTokens > 0) {
    defaults.maxTokens = maxTokens;
  }
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    defaults.timeoutMs = timeoutMs;
  }
  if (Number.isFinite(budgetUsd) && budgetUsd > 0) {
    defaults.budgetUsd = budgetUsd;
  }

  return defaults;
}

export function createAiBudgetTracker(budgetUsd?: number | null): AiBudgetTracker {
  const normalized = Number.isFinite(budgetUsd ?? Number.NaN) && (budgetUsd ?? 0) > 0
    ? (budgetUsd as number)
    : null;
  let remaining = normalized;

  return {
    get remainingUsd() {
      return remaining;
    },
    reserve(costUsd = DEFAULT_REQUEST_COST_USD) {
      if (remaining === null) {
        return true;
      }
      if (remaining < costUsd) {
        return false;
      }
      remaining = Math.max(0, remaining - costUsd);
      return true;
    },
  };
}

const defaultExecutor: ProviderExecutor = async (provider, options) => {
  if (provider.kind === "openai-codex" && hasCodexAuth()) {
    return await runCodexCli(provider, options);
  }

  if (!provider.apiKey) {
    return {
      ok: false,
      content: null,
      error: provider.kind === "openai-codex"
        ? `Provider ${provider.id} requires Codex auth or an API key.`
        : `Provider ${provider.id} is missing an API key.`,
    };
  }

  const retryableStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);
  const maxAttempts = 2;
  let attempt = 0;

  const runOnce = async (): Promise<Response> => {
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs;
    const timeout = Number.isFinite(timeoutMs ?? Number.NaN) && (timeoutMs ?? 0) > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;
    try {
      return await fetch(`${provider.baseUrl.replace(/\/+$/, "")}/responses`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify({
          model: provider.model,
          ...(options.maxTokens ? { max_output_tokens: options.maxTokens } : {}),
          input: [
            {
              role: "system",
              content: `You are SpecLens helping with the task "${options.task}". Respond concisely in plain text.`,
            },
            {
              role: "user",
              content: options.prompt,
            },
          ],
        }),
        cache: "no-store",
        signal: controller.signal,
      });
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  };

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const response = await runOnce();
      if (!response.ok) {
        if (attempt < maxAttempts && retryableStatuses.has(response.status)) {
          await new Promise(resolve => setTimeout(resolve, 300 * attempt));
          continue;
        }
        return {
          ok: false,
          content: null,
          error: `Provider ${provider.id} responded with ${response.status}.`,
        };
      }

      const payload = await response.json() as {
        output_text?: string;
        output?: Array<{ content?: Array<{ text?: string }> }>;
      };
      const content = payload.output_text
        ?? payload.output?.flatMap(item => item.content ?? []).map(item => item.text ?? "").join("\n").trim()
        ?? null;

      return {
        ok: Boolean(content),
        content: content?.trim() || null,
        ...(content ? {} : { error: `Provider ${provider.id} returned no text content.` }),
      };
    } catch (error) {
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 300 * attempt));
        continue;
      }
      return {
        ok: false,
        content: null,
        error: error instanceof Error ? error.message : `Provider ${provider.id} failed.`,
      };
    }
  }

  return {
    ok: false,
    content: null,
    error: `Provider ${provider.id} failed.`,
  };
};

export function resolveAiProvidersFromEnv(env: NodeJS.ProcessEnv = process.env): AiProviderDescriptor[] {
  const order = String(env.AI_PROVIDER_ORDER ?? "openai,openai-codex")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);

  const definitions: Record<string, AiProviderDescriptor> = {
    openai: {
      id: "openai",
      kind: "openai",
      label: "OpenAI",
      model: env.OPENAI_MODEL ?? "gpt-5.4-mini",
      baseUrl: env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      apiKey: env.OPENAI_API_KEY ?? null,
    },
    "openai-codex": {
      id: "openai-codex",
      kind: "openai-codex",
      label: "OpenAI Codex",
      model: env.OPENAI_CODEX_MODEL ?? "gpt-5.3-codex",
      baseUrl: env.OPENAI_CODEX_BASE_URL ?? env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      apiKey: env.OPENAI_CODEX_API_KEY ?? env.OPENAI_API_KEY ?? null,
    },
  };

  return order
    .map(id => definitions[id])
    .filter((provider): provider is AiProviderDescriptor => Boolean(provider));
}

export async function generateWithOrderedProviders(
  options: GenerateWithProvidersOptions,
  executor: ProviderExecutor = defaultExecutor,
): Promise<{ content: string | null; providerId: string | null; attempted: string[]; errors: string[] }> {
  const defaults = resolveAiDefaults();
  const resolvedOptions: GenerateWithProvidersOptions = {
    ...options,
  };
  if (options.maxTokens === undefined && defaults.maxTokens !== undefined) {
    resolvedOptions.maxTokens = defaults.maxTokens;
  }
  if (options.timeoutMs === undefined && defaults.timeoutMs !== undefined) {
    resolvedOptions.timeoutMs = defaults.timeoutMs;
  }
  if (options.budgetUsd === undefined && defaults.budgetUsd !== undefined) {
    resolvedOptions.budgetUsd = defaults.budgetUsd;
  }
  const providers = resolvedOptions.providers ?? resolveAiProvidersFromEnv();
  const attempted: string[] = [];
  const errors: string[] = [];
  const budgetUsd = resolvedOptions.budgetUsd;
  const budgetValue = typeof budgetUsd === "number" ? budgetUsd : Number.NaN;
  const maxAttempts = Number.isFinite(budgetValue) && budgetValue > 0
    ? Math.max(1, Math.floor(budgetValue / DEFAULT_REQUEST_COST_USD))
    : providers.length;

  for (const provider of providers) {
    if (attempted.length >= maxAttempts) {
      break;
    }
    attempted.push(provider.id);
    try {
      const result = await executor(provider, resolvedOptions);
      if (result.ok && result.content) {
        return {
          content: result.content,
          providerId: provider.id,
          attempted,
          errors,
        };
      }
      if (result.error) {
        errors.push(result.error);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `Provider ${provider.id} failed.`);
    }
  }

  return {
    content: null,
    providerId: null,
    attempted,
    errors,
  };
}
