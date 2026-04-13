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
}

interface ProviderExecution {
  ok: boolean;
  content: string | null;
  error?: string;
}

type ProviderExecutor = (provider: AiProviderDescriptor, options: GenerateWithProvidersOptions) => Promise<ProviderExecution>;

const defaultExecutor: ProviderExecutor = async (provider, options) => {
  if (!provider.apiKey) {
    return {
      ok: false,
      content: null,
      error: `Provider ${provider.id} is missing an API key.`,
    };
  }

  const response = await fetch(`${provider.baseUrl.replace(/\/+$/, "")}/responses`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
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
  });

  if (!response.ok) {
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
  const providers = options.providers ?? resolveAiProvidersFromEnv();
  const attempted: string[] = [];
  const errors: string[] = [];

  for (const provider of providers) {
    attempted.push(provider.id);
    try {
      const result = await executor(provider, options);
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
