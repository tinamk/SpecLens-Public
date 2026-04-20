import fs from "node:fs";
import path from "node:path";

type SnapshotResource = {
  url: string;
  savedAs: string;
  contentType: string | null;
};

type SnapshotFailure = {
  url: string;
  reason: string;
};

const MAX_ASSET_COUNT = 40;
const MAX_RESOURCE_BYTES = 2_000_000;

function ensureDir(target: string): void {
  fs.mkdirSync(target, { recursive: true });
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function sanitizePathSegment(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "index";
}

function buildLocalPathFromUrl(target: URL): string {
  const rawPath = target.pathname === "/" ? "/index.html" : target.pathname;
  const segments = rawPath.split("/").filter(Boolean).map(sanitizePathSegment);
  const last = segments[segments.length - 1] ?? "index.html";
  if (!last.includes(".")) {
    segments.push("index.html");
  }
  return segments.join("/");
}

function extractResourceUrls(html: string, baseUrl: URL): URL[] {
  const matches = [
    ...html.matchAll(/\b(?:src|href)=["']([^"'#]+)["']/gi),
  ];
  const urls: URL[] = [];
  const seen = new Set<string>();

  for (const match of matches) {
    const candidate = match[1]?.trim();
    if (!candidate) {
      continue;
    }
    if (
      candidate.startsWith("data:")
      || candidate.startsWith("mailto:")
      || candidate.startsWith("tel:")
      || candidate.startsWith("javascript:")
    ) {
      continue;
    }
    try {
      const resolved = new URL(candidate, baseUrl);
      if (resolved.origin !== baseUrl.origin) {
        continue;
      }
      const key = resolved.toString();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      urls.push(resolved);
    } catch {
      continue;
    }
    if (urls.length >= MAX_ASSET_COUNT) {
      break;
    }
  }

  return urls;
}

async function fetchIntoFile(
  url: URL,
  outputRoot: string,
): Promise<SnapshotResource> {
  const response = await fetch(url, {
    headers: {
      "user-agent": "SpecLens/0.4.0 website-snapshot",
      accept: "*/*",
    },
    redirect: "follow",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const contentLength = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(contentLength) && contentLength > MAX_RESOURCE_BYTES) {
    throw new Error(`Resource exceeded ${MAX_RESOURCE_BYTES} bytes.`);
  }

  const contentType = response.headers.get("content-type");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_RESOURCE_BYTES) {
    throw new Error(`Resource exceeded ${MAX_RESOURCE_BYTES} bytes.`);
  }

  const relativePath = buildLocalPathFromUrl(url);
  const targetPath = path.join(outputRoot, relativePath);
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, buffer);

  return {
    url: url.toString(),
    savedAs: relativePath,
    contentType,
  };
}

export async function snapshotPublicWebsite(siteUrl: string, outputRoot: string): Promise<{ repoPath: string }> {
  if (!isHttpUrl(siteUrl)) {
    throw new Error("Public website sources must use an http:// or https:// URL.");
  }

  ensureDir(outputRoot);
  const rootUrl = new URL(siteUrl);
  const response = await fetch(rootUrl, {
    headers: {
      "user-agent": "SpecLens/0.4.0 website-snapshot",
      accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Website fetch failed with HTTP ${response.status} ${response.statusText}.`);
  }

  const contentType = response.headers.get("content-type");
  const html = await response.text();
  const finalUrl = new URL(response.url || rootUrl.toString());

  if (!contentType?.includes("html") && !html.trimStart().startsWith("<")) {
    throw new Error("The public website source did not return HTML content.");
  }

  fs.writeFileSync(path.join(outputRoot, "index.html"), html, "utf8");

  const resources: SnapshotResource[] = [];
  const failures: SnapshotFailure[] = [];
  for (const resourceUrl of extractResourceUrls(html, finalUrl)) {
    try {
      resources.push(await fetchIntoFile(resourceUrl, outputRoot));
    } catch (error) {
      failures.push({
        url: resourceUrl.toString(),
        reason: error instanceof Error ? error.message : "Resource fetch failed.",
      });
    }
  }

  fs.writeFileSync(
    path.join(outputRoot, "speclens-website-snapshot.json"),
    `${JSON.stringify({
      sourceUrl: siteUrl,
      fetchedUrl: finalUrl.toString(),
      fetchedAt: new Date().toISOString(),
      rootContentType: contentType,
      resourceCount: resources.length,
      resources,
      failures,
    }, null, 2)}\n`,
    "utf8",
  );

  fs.writeFileSync(
    path.join(outputRoot, "README.speclens.txt"),
    [
      "This directory is a SpecLens-generated snapshot of a public website source.",
      `Original URL: ${siteUrl}`,
      `Fetched URL: ${finalUrl.toString()}`,
      "",
      "Primary file: index.html",
      "Metadata: speclens-website-snapshot.json",
      "",
      "Assets were fetched from the same origin where possible and stored as local files for analysis.",
    ].join("\n"),
    "utf8",
  );

  return { repoPath: outputRoot };
}
