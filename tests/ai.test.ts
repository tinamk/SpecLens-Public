import assert from "node:assert/strict";
import test from "node:test";
import { generateWithOrderedProviders, resolveAiProvidersFromEnv, type AiProviderDescriptor } from "@speclens/core";

test("AI provider resolution honors ordered provider list including OpenAI Codex", () => {
  const providers = resolveAiProvidersFromEnv({
    ...process.env,
    AI_PROVIDER_ORDER: "openai-codex,openai",
    OPENAI_API_KEY: "openai-key",
    OPENAI_CODEX_API_KEY: "codex-key",
    OPENAI_MODEL: "gpt-5.4-mini",
    OPENAI_CODEX_MODEL: "gpt-5.3-codex",
  });

  assert.deepEqual(providers.map(provider => provider.id), ["openai-codex", "openai"]);
  assert.equal(providers[0]?.model, "gpt-5.3-codex");
});

test("AI generation tries providers in order until one succeeds", async () => {
  const result = await generateWithOrderedProviders({
    task: "unit-test",
    prompt: "hello",
    providers: [
      {
        id: "openai-codex",
        kind: "openai-codex",
        label: "OpenAI Codex",
        model: "gpt-5.3-codex",
        baseUrl: "http://example.invalid/v1",
        apiKey: "codex-key",
      },
      {
        id: "openai",
        kind: "openai",
        label: "OpenAI",
        model: "gpt-5.4-mini",
        baseUrl: "http://example.invalid/v1",
        apiKey: "openai-key",
      },
    ],
  }, async (provider: AiProviderDescriptor) => {
    if (provider.id === "openai-codex") {
      return {
        ok: false,
        content: null,
        error: "codex failed",
      };
    }
    return {
      ok: true,
      content: "second provider succeeded",
    };
  });

  assert.equal(result.providerId, "openai");
  assert.equal(result.content, "second provider succeeded");
  assert.deepEqual(result.attempted, ["openai-codex", "openai"]);
  assert.deepEqual(result.errors, ["codex failed"]);
});
