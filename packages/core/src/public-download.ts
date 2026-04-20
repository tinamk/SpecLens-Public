import fs from "node:fs";
import path from "node:path";

const MAX_PUBLIC_DOWNLOAD_BYTES = 50 * 1024 * 1024;
const ARCHIVE_URL_PATTERN = /\.(zip|tar|tgz|tar\.gz)(?:$|[?#])/i;
const HTML_PREFIX_PATTERN = /^\s*(?:<!doctype|<html|<head|<body|<\?xml)/i;

type PublicLinkCandidate = {
  url: URL;
  text: string;
};

type PublicFetchResult = {
  body: Buffer;
  contentDisposition: string | null;
  contentType: string | null;
  finalUrl: URL;
};

export type ResolvedPublicCodeLocation =
  | {
      kind: "archive";
      url: string;
      filename: string;
      discoveredFrom: string;
    }
  | {
      kind: "git";
      url: string;
      discoveredFrom: string;
    };

function ensureDir(target: string): void {
  fs.mkdirSync(target, { recursive: true });
}

function sanitizeFilename(value: string, fallback: string): string {
  const cleaned = value
    .trim()
    .replace(/[?#].*$/, "")
    .replace(/[/\\]+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

function looksLikeHtml(contentType: string | null, buffer: Buffer): boolean {
  if (contentType?.toLowerCase().includes("html") || contentType?.toLowerCase().includes("xml")) {
    return true;
  }
  const sample = buffer.subarray(0, Math.min(buffer.length, 512)).toString("utf8");
  return HTML_PREFIX_PATTERN.test(sample);
}

function parseContentDispositionFilename(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const utf8Match = value.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }
  const plainMatch = value.match(/filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;]+)/i);
  const candidate = plainMatch?.[1] ?? plainMatch?.[2];
  return candidate ? candidate.trim() : null;
}

function scoreArchiveCandidate(candidate: PublicLinkCandidate): number {
  const haystack = `${candidate.url.toString()} ${candidate.text}`.toLowerCase();
  let score = 0;
  if (ARCHIVE_URL_PATTERN.test(candidate.url.toString())) {
    score += 50;
  }
  if (/download|archive|zip|tar|source/.test(haystack)) {
    score += 20;
  }
  if (/github|gitlab|bitbucket|codeberg/.test(haystack)) {
    score += 5;
  }
  return score;
}

function scoreGitCandidate(candidate: PublicLinkCandidate): number {
  const haystack = `${candidate.url.toString()} ${candidate.text}`.toLowerCase();
  let score = 0;
  if (/github|gitlab|bitbucket|codeberg/.test(haystack)) {
    score += 40;
  }
  if (/repo|repository|source|code|project/.test(haystack)) {
    score += 20;
  }
  return score;
}

function extractAnchorCandidates(html: string, baseUrl: URL): PublicLinkCandidate[] {
  const matches = [...html.matchAll(/<a\b([^>]*)href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const seen = new Set<string>();
  const candidates: PublicLinkCandidate[] = [];

  for (const match of matches) {
    const rawHref = match[2]?.trim();
    if (!rawHref) {
      continue;
    }
    if (
      rawHref.startsWith("mailto:")
      || rawHref.startsWith("tel:")
      || rawHref.startsWith("javascript:")
      || rawHref.startsWith("data:")
    ) {
      continue;
    }
    try {
      const url = new URL(rawHref, baseUrl);
      const key = url.toString();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const text = (match[3] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      candidates.push({ url, text });
    } catch {
      continue;
    }
  }

  return candidates;
}

function normalizeGitRepositoryUrl(value: URL): string | null {
  const hostname = value.hostname.toLowerCase().replace(/^www\./, "");
  if (value.protocol !== "http:" && value.protocol !== "https:") {
    return null;
  }

  if (value.pathname.endsWith(".git")) {
    return `${value.protocol}//${hostname}${value.pathname}`;
  }

  const segments = value.pathname.split("/").filter(Boolean);
  if (hostname === "github.com" || hostname === "codeberg.org" || hostname === "bitbucket.org") {
    if (segments.length < 2) {
      return null;
    }
    return `${value.protocol}//${hostname}/${segments[0]}/${segments[1]}`;
  }

  if (hostname === "gitlab.com") {
    if (segments.length < 2) {
      return null;
    }
    const dashIndex = segments.indexOf("-");
    const repoSegments = dashIndex >= 2 ? segments.slice(0, dashIndex) : segments;
    if (repoSegments.length < 2) {
      return null;
    }
    return `${value.protocol}//${hostname}/${repoSegments.join("/")}`;
  }

  return null;
}

async function fetchPublicResource(url: string): Promise<PublicFetchResult> {
  const response = await fetch(url, {
    headers: {
      "user-agent": "SpecLens/0.4.0 public-source-fetch",
      accept: "application/zip,application/x-tar,application/gzip,application/octet-stream,text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Public download failed with HTTP ${response.status} ${response.statusText}.`);
  }

  const contentLength = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(contentLength) && contentLength > MAX_PUBLIC_DOWNLOAD_BYTES) {
    throw new Error(`Public download exceeded ${MAX_PUBLIC_DOWNLOAD_BYTES} bytes.`);
  }

  const body = Buffer.from(await response.arrayBuffer());
  if (body.length > MAX_PUBLIC_DOWNLOAD_BYTES) {
    throw new Error(`Public download exceeded ${MAX_PUBLIC_DOWNLOAD_BYTES} bytes.`);
  }

  return {
    body,
    contentDisposition: response.headers.get("content-disposition"),
    contentType: response.headers.get("content-type"),
    finalUrl: new URL(response.url || url),
  };
}

export function isValidPublicHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function filenameFromPublicUrl(value: string, fallback = "downloaded-file"): string {
  try {
    const url = new URL(value);
    const last = url.pathname.split("/").filter(Boolean).at(-1);
    return sanitizeFilename(last && last.length > 0 ? last : fallback, fallback);
  } catch {
    return sanitizeFilename(fallback, "downloaded-file");
  }
}

export async function resolvePublicCodeLocation(value: string): Promise<ResolvedPublicCodeLocation> {
  if (!isValidPublicHttpUrl(value)) {
    throw new Error("Public code sources must use an http:// or https:// URL.");
  }

  const directGitUrl = normalizeGitRepositoryUrl(new URL(value));
  if (directGitUrl) {
    return {
      kind: "git",
      url: directGitUrl,
      discoveredFrom: value,
    };
  }

  const fetched = await fetchPublicResource(value);
  if (!looksLikeHtml(fetched.contentType, fetched.body)) {
    const contentDispositionFilename = parseContentDispositionFilename(fetched.contentDisposition);
    return {
      kind: "archive",
      url: fetched.finalUrl.toString(),
      filename: sanitizeFilename(
        contentDispositionFilename ?? filenameFromPublicUrl(fetched.finalUrl.toString(), "public-archive"),
        "public-archive",
      ),
      discoveredFrom: value,
    };
  }

  const html = fetched.body.toString("utf8");
  const links = extractAnchorCandidates(html, fetched.finalUrl);
  const archiveCandidate = links
    .filter(candidate => ARCHIVE_URL_PATTERN.test(candidate.url.toString()))
    .sort((left, right) => scoreArchiveCandidate(right) - scoreArchiveCandidate(left))[0];

  if (archiveCandidate) {
    return {
      kind: "archive",
      url: archiveCandidate.url.toString(),
      filename: filenameFromPublicUrl(archiveCandidate.url.toString(), "public-archive"),
      discoveredFrom: fetched.finalUrl.toString(),
    };
  }

  const gitCandidate = links
    .map(candidate => ({
      candidate,
      normalizedUrl: normalizeGitRepositoryUrl(candidate.url),
    }))
    .filter((entry): entry is { candidate: PublicLinkCandidate; normalizedUrl: string } => Boolean(entry.normalizedUrl))
    .sort((left, right) => scoreGitCandidate(right.candidate) - scoreGitCandidate(left.candidate))[0];

  if (gitCandidate) {
    return {
      kind: "git",
      url: gitCandidate.normalizedUrl,
      discoveredFrom: fetched.finalUrl.toString(),
    };
  }

  throw new Error(
    "The public code URL returned an HTML page instead of a direct archive, and SpecLens could not find a linked source archive or public repository to follow.",
  );
}

export async function downloadPublicFileToPath(url: string, targetPath: string): Promise<string> {
  const fetched = await fetchPublicResource(url);
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, fetched.body);
  return targetPath;
}
