import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

test("AI Codex provider uses per-request auth path without process-wide env mutation", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "speclens-ai-auth-"));
  const authPath = path.join(tempDir, "auth.json");
  const codexBin = path.join(tempDir, "codex-stub.js");
  fs.writeFileSync(authPath, "{}\n", "utf8");
  fs.writeFileSync(codexBin, [
    "#!/usr/bin/env node",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const args = process.argv.slice(2);",
    "const index = args.indexOf('--output-last-message');",
    "if (index === -1 || !args[index + 1]) process.exit(2);",
    "fs.writeFileSync(args[index + 1], JSON.stringify({",
    "  authPath: process.env.CODEX_AUTH_PATH,",
    "  codexHome: process.env.CODEX_HOME,",
    "  expectedHome: path.dirname(process.env.CODEX_AUTH_PATH || ''),",
    "}));",
  ].join("\n"), "utf8");
  fs.chmodSync(codexBin, 0o755);

  const previousCodexBin = process.env.CODEX_BIN;
  const previousAuthPath = process.env.CODEX_AUTH_PATH;
  const previousCodexHome = process.env.CODEX_HOME;
  delete process.env.CODEX_AUTH_PATH;
  delete process.env.CODEX_HOME;
  process.env.CODEX_BIN = codexBin;

  try {
    const result = await generateWithOrderedProviders({
      task: "unit-test",
      prompt: "hello",
      codexAuthPath: authPath,
      providers: [{
        id: "openai-codex",
        kind: "openai-codex",
        label: "OpenAI Codex",
        model: "gpt-5.3-codex",
        baseUrl: "http://example.invalid/v1",
        apiKey: null,
      }],
    });

    assert.equal(result.providerId, "openai-codex");
    const payload = JSON.parse(result.content ?? "{}") as { authPath?: string; codexHome?: string; expectedHome?: string };
    assert.equal(payload.authPath, authPath);
    assert.equal(payload.codexHome, path.dirname(authPath));
    assert.equal(payload.codexHome, payload.expectedHome);
    assert.equal(process.env.CODEX_AUTH_PATH, undefined);
    assert.equal(process.env.CODEX_HOME, undefined);
  } finally {
    if (previousCodexBin === undefined) {
      delete process.env.CODEX_BIN;
    } else {
      process.env.CODEX_BIN = previousCodexBin;
    }
    if (previousAuthPath === undefined) {
      delete process.env.CODEX_AUTH_PATH;
    } else {
      process.env.CODEX_AUTH_PATH = previousAuthPath;
    }
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
