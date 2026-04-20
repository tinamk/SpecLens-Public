import assert from "node:assert/strict";
import test from "node:test";
import { resolvePublicCodeLocation } from "@speclens/core";

type MockResponseInit = {
  body: string;
  contentDisposition?: string | null;
  contentType?: string | null;
  url: string;
};

function createMockResponse(init: MockResponseInit): Response {
  return new Response(init.body, {
    status: 200,
    headers: {
      ...(init.contentDisposition ? { "content-disposition": init.contentDisposition } : {}),
      ...(init.contentType ? { "content-type": init.contentType } : {}),
    },
  });
}

async function withMockFetch(
  responses: Record<string, MockResponseInit>,
  run: () => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    const response = responses[url];
    if (!response) {
      throw new Error(`Unexpected fetch for ${url}`);
    }
    return createMockResponse(response);
  };

  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("resolvePublicCodeLocation follows linked archive downloads from an HTML page", async () => {
  await withMockFetch({
    "https://example.com/source": {
      url: "https://example.com/source",
      contentType: "text/html; charset=utf-8",
      body: '<html><body><a href="/download/site-source.zip">Download source</a></body></html>',
    },
  }, async () => {
    const resolved = await resolvePublicCodeLocation("https://example.com/source");
    assert.deepEqual(resolved, {
      kind: "archive",
      url: "https://example.com/download/site-source.zip",
      filename: "site-source.zip",
      discoveredFrom: "https://example.com/source",
    });
  });
});

test("resolvePublicCodeLocation follows linked public repository pages from an HTML page", async () => {
  await withMockFetch({
    "https://example.com/source": {
      url: "https://example.com/source",
      contentType: "text/html; charset=utf-8",
      body: '<html><body><a href="https://github.com/example/spec-source">Source code</a></body></html>',
    },
  }, async () => {
    const resolved = await resolvePublicCodeLocation("https://example.com/source");
    assert.deepEqual(resolved, {
      kind: "git",
      url: "https://github.com/example/spec-source",
      discoveredFrom: "https://example.com/source",
    });
  });
});

test("resolvePublicCodeLocation recognizes direct public repository URLs without fetching", async () => {
  const resolved = await resolvePublicCodeLocation("https://github.com/example/spec-source/tree/main");
  assert.deepEqual(resolved, {
    kind: "git",
    url: "https://github.com/example/spec-source",
    discoveredFrom: "https://github.com/example/spec-source/tree/main",
  });
});

test("resolvePublicCodeLocation fails clearly when an HTML page has no source links", async () => {
  await withMockFetch({
    "https://example.com/source": {
      url: "https://example.com/source",
      contentType: "text/html; charset=utf-8",
      body: "<html><body><p>No source links here.</p></body></html>",
    },
  }, async () => {
    await assert.rejects(
      () => resolvePublicCodeLocation("https://example.com/source"),
      /could not find a linked source archive or public repository/i,
    );
  });
});

test("resolvePublicCodeLocation treats binary download responses as archives", async () => {
  await withMockFetch({
    "https://example.com/source.zip": {
      url: "https://example.com/source.zip",
      contentType: "application/zip",
      contentDisposition: 'attachment; filename="source.zip"',
      body: "PK\u0003\u0004fake",
    },
  }, async () => {
    const resolved = await resolvePublicCodeLocation("https://example.com/source.zip");
    assert.deepEqual(resolved, {
      kind: "archive",
      url: "https://example.com/source.zip",
      filename: "source.zip",
      discoveredFrom: "https://example.com/source.zip",
    });
  });
});
