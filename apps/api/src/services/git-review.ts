import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type {
  CodeReviewPayload,
  CodeTreeEntry,
  GitReference,
  Source,
} from "@speclens/contracts";
import type { ObjectStorageConfig } from "@speclens/db";
import { downloadObjectToFile } from "@speclens/db";
import {
  createGithubCloneUrl,
  createGithubGitAuthEnv,
  createHomeTempDirSync,
  extractArchiveFileAsync,
  inspectGitRepositoryArchiveFileAsync,
  resolveSpecLensCacheRoot,
} from "@speclens/core";

const cacheLocks = new Map<string, Promise<void>>();
const prewarmJobs = new Map<string, Promise<void>>();
const mirrorRefreshJobs = new Map<string, Promise<void>>();

export class CodeReviewCacheNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodeReviewCacheNotReadyError";
  }
}

export class CodeReviewReferenceNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodeReviewReferenceNotFoundError";
  }
}

class ProcessExecutionError extends Error {
  constructor(
    message: string,
    readonly command: string,
    readonly args: string[],
    readonly exitCode: number | null,
    readonly stdout: string,
    readonly stderr: string,
  ) {
    super(message);
    this.name = "ProcessExecutionError";
  }
}

function safeKey(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function lockRoot(): string {
  return path.join(cacheRoot(), ".locks");
}

function cacheLockDir(cachePath: string): string {
  return path.join(lockRoot(), safeKey(cachePath));
}

function getGitReviewLockTimeoutMs(): number {
  const value = Number.parseInt(process.env.GIT_REVIEW_CACHE_LOCK_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : 30_000;
}

function getGitReviewLockStaleMs(): number {
  const value = Number.parseInt(process.env.GIT_REVIEW_CACHE_LOCK_STALE_MS ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : 10 * 60 * 1000;
}

function isProcessExecutionError(error: unknown): error is ProcessExecutionError {
  return error instanceof ProcessExecutionError;
}

function isGitMissingObjectError(error: unknown): boolean {
  if (!isProcessExecutionError(error)) {
    return false;
  }
  const detail = `${error.stderr}\n${error.stdout}`;
  return /not a valid object name/i.test(detail)
    || /path '.*' does not exist in/i.test(detail)
    || /exists on disk, but not in/i.test(detail);
}

async function acquireFilesystemLock(cachePath: string): Promise<() => void> {
  const lockDir = cacheLockDir(cachePath);
  fs.mkdirSync(lockRoot(), { recursive: true });
  const deadline = Date.now() + getGitReviewLockTimeoutMs();
  while (true) {
    try {
      fs.mkdirSync(lockDir);
      fs.writeFileSync(path.join(lockDir, "owner.json"), JSON.stringify({
        pid: process.pid,
        acquiredAt: new Date().toISOString(),
      }));
      return () => {
        fs.rmSync(lockDir, { recursive: true, force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code !== "EEXIST") {
        throw error;
      }
      try {
        const lockStats = fs.statSync(lockDir);
        if (Date.now() - lockStats.mtimeMs >= getGitReviewLockStaleMs()) {
          fs.rmSync(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for cache lock: ${cachePath}`);
      }
      await sleep(50);
    }
  }
}

async function runProcess(command: string, args: string[], options: {
  cwd?: string;
  env?: NodeJS.ProcessEnv | undefined;
  maxBufferBytes?: number;
} = {}): Promise<string> {
  const env = {
    ...(options.env ?? process.env),
    PATH: options.env?.PATH ?? process.env.PATH ?? "/usr/bin:/bin",
  };
  const child = spawn(command, args, {
    cwd: options.cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  const maxBufferBytes = options.maxBufferBytes ?? 10 * 1024 * 1024;

  return await new Promise((resolve, reject) => {
    child.stdout.on("data", chunk => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdout.push(buffer);
      stdoutBytes += buffer.length;
      if (stdoutBytes > maxBufferBytes) {
        child.kill("SIGKILL");
        reject(new Error(`${command} ${args.join(" ")} exceeded stdout buffer limit.`));
      }
    });
    child.stderr.on("data", chunk => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stderr.push(buffer);
      stderrBytes += buffer.length;
      if (stderrBytes > maxBufferBytes) {
        child.kill("SIGKILL");
        reject(new Error(`${command} ${args.join(" ")} exceeded stderr buffer limit.`));
      }
    });
    child.on("error", reject);
    child.on("close", status => {
      const stdoutText = Buffer.concat(stdout).toString("utf8");
      const stderrText = Buffer.concat(stderr).toString("utf8");
      if (status !== 0) {
        reject(new ProcessExecutionError(
          stderrText.trim() || stdoutText.trim() || `${command} ${args.join(" ")} failed`,
          command,
          args,
          status,
          stdoutText,
          stderrText,
        ));
        return;
      }
      resolve(stdoutText);
    });
  });
}

async function runGit(args: string[], cwd: string): Promise<string> {
  return await runProcess("git", ["-c", `safe.directory=${path.resolve(cwd)}`, ...args], { cwd });
}

async function withCacheLock<T>(cachePath: string, task: () => Promise<T>): Promise<T> {
  const previous = cacheLocks.get(cachePath) ?? Promise.resolve();
  let release: (() => void) | undefined;
  let releaseFilesystemLock: (() => void) | undefined;
  const current = new Promise<void>(resolve => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  cacheLocks.set(cachePath, tail);

  await previous.catch(() => undefined);
  try {
    releaseFilesystemLock = await acquireFilesystemLock(cachePath);
    return await task();
  } finally {
    if (releaseFilesystemLock) {
      releaseFilesystemLock();
    }
    if (release) {
      release();
    }
    if (cacheLocks.get(cachePath) === tail) {
      cacheLocks.delete(cachePath);
    }
  }
}

function logPrewarmFailure(source: Source, stage: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[code-review] ${stage} failed for ${source.id} (${source.displayName}): ${message}`);
}

function cacheRoot(): string {
  return path.join(resolveSpecLensCacheRoot(process.env), "git-review");
}

function getGitReviewCacheRetentionMs(): number {
  const value = Number.parseInt(process.env.GIT_REVIEW_CACHE_RETENTION_MS ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : 3 * 24 * 60 * 60 * 1000;
}

function getGitReviewMirrorRefreshMs(): number {
  const value = Number.parseInt(process.env.GIT_REVIEW_MIRROR_REFRESH_MS ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : 15 * 60 * 1000;
}

function cacheAccessMarkerPath(target: string): string {
  return path.join(target, ".speclens-last-access");
}

function cacheFetchMarkerPath(target: string): string {
  return path.join(target, ".speclens-last-fetch");
}

function touchCacheAccess(target: string): void {
  try {
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(cacheAccessMarkerPath(target), String(Date.now()));
  } catch {
    // Cache access tracking is best-effort only.
  }
}

function touchCacheFetch(target: string): void {
  try {
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(cacheFetchMarkerPath(target), String(Date.now()));
  } catch {
    // Cache freshness tracking is best-effort only.
  }
}

function readCacheMarkerMs(markerPath: string): number {
  try {
    return fs.existsSync(markerPath) ? fs.statSync(markerPath).mtimeMs : 0;
  } catch {
    return 0;
  }
}

function readCacheLastAccessMs(target: string): number {
  try {
    const markerMs = readCacheMarkerMs(cacheAccessMarkerPath(target));
    if (markerMs > 0) {
      return markerMs;
    }
    return fs.statSync(target).mtimeMs;
  } catch {
    return 0;
  }
}

function readCacheLastFetchMs(target: string): number {
  const markerMs = readCacheMarkerMs(cacheFetchMarkerPath(target));
  if (markerMs > 0) {
    return markerMs;
  }
  try {
    return fs.statSync(target).mtimeMs;
  } catch {
    return 0;
  }
}

function isMirrorRefreshDue(target: string): boolean {
  const lastFetchMs = readCacheLastFetchMs(target);
  return lastFetchMs <= 0 || Date.now() - lastFetchMs >= getGitReviewMirrorRefreshMs();
}

function cleanupGitReviewCache(): void {
  const root = cacheRoot();
  if (!fs.existsSync(root)) {
    return;
  }
  const cutoff = Date.now() - getGitReviewCacheRetentionMs();
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === ".locks") {
      continue;
    }
    const fullPath = path.join(root, entry.name);
    if (cacheLocks.has(fullPath) || fs.existsSync(cacheLockDir(fullPath))) {
      continue;
    }
    try {
      const lastAccessMs = readCacheLastAccessMs(fullPath);
      if (lastAccessMs < cutoff) {
        fs.rmSync(fullPath, { recursive: true, force: true });
      }
    } catch {
      // Ignore cache cleanup races and stale filesystem entries.
    }
  }
}

function sourceCachePath(source: Source): string {
  const suffix = source.type === "upload-archive" ? "archive" : "mirror.git";
  return path.join(cacheRoot(), `${safeKey(`${source.id}:${source.location}`)}-${suffix}`);
}

async function resolveGitTransport(source: Source): Promise<{
  cloneUrl: string;
  env?: NodeJS.ProcessEnv;
}> {
  if (source.type === "github-private") {
    if (!source.githubInstallationId) {
      throw new Error(`Private GitHub source ${source.id} is missing githubInstallationId.`);
    }
    return {
      cloneUrl: createGithubCloneUrl(source.location),
      env: await createGithubGitAuthEnv(source.githubInstallationId, { baseEnv: process.env }),
    };
  }
  return { cloneUrl: source.location };
}

function collapseSingleRoot(extractedDir: string): string {
  const entries = fs.readdirSync(extractedDir, { withFileTypes: true }).filter(entry =>
    entry.name !== "__MACOSX"
    && entry.name !== path.basename(cacheAccessMarkerPath(extractedDir))
    && entry.name !== path.basename(cacheFetchMarkerPath(extractedDir)),
  );
  if (entries.length === 1 && entries[0]?.isDirectory()) {
    return path.join(extractedDir, entries[0].name);
  }
  return extractedDir;
}

function resolveCachedArchiveRoot(target: string): string {
  if (hasGitDirectory(target)) {
    return target;
  }
  if (!fs.existsSync(target)) {
    return target;
  }
  return collapseSingleRoot(target);
}

function archiveMaterializationErrorMessage(): string {
  return "Uploaded archives must unpack to a Git repository root or a single top-level directory containing the repository root.";
}

function hasGitDirectory(target: string): boolean {
  try {
    return fs.lstatSync(path.join(target, ".git")).isDirectory();
  } catch {
    return false;
  }
}

async function ensureArchiveCache(source: Source): Promise<string> {
  const target = sourceCachePath(source);
  return await withCacheLock(target, async () => {
    const cachedRoot = resolveCachedArchiveRoot(target);
    if (hasGitDirectory(cachedRoot)) {
      touchCacheAccess(target);
      return cachedRoot;
    }
    throw new CodeReviewCacheNotReadyError(`Code review cache for ${source.displayName} is warming. Retry shortly.`);
  });
}

async function materializeArchiveCache(source: Source, storageConfig: ObjectStorageConfig): Promise<string> {
  const target = sourceCachePath(source);
  return await withCacheLock(target, async () => {
    const cachedRoot = resolveCachedArchiveRoot(target);
    if (hasGitDirectory(cachedRoot)) {
      touchCacheAccess(target);
      return cachedRoot;
    }
    if (!source.uploadObjectKey) {
      throw new Error(`Archive source ${source.id} is missing uploadObjectKey.`);
    }
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true });
    const tempDir = createHomeTempDirSync("speclens-code-review-");
    try {
      const archivePath = path.join(tempDir, path.basename(source.location));
      await downloadObjectToFile(storageConfig, source.uploadObjectKey, archivePath);
      const archiveInspection = await inspectGitRepositoryArchiveFileAsync(archivePath, source.location);
      if (!archiveInspection.ok) {
        throw new Error(archiveInspection.message);
      }
      await extractArchiveFileAsync(archivePath, target, archiveInspection.kind);
      const extractedRoot = collapseSingleRoot(target);
      if (!hasGitDirectory(extractedRoot)) {
        fs.rmSync(target, { recursive: true, force: true });
        throw new Error(archiveMaterializationErrorMessage());
      }
      touchCacheAccess(target);
      return extractedRoot;
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
}

async function refreshMirrorCache(source: Source, target: string): Promise<void> {
  const transport = await resolveGitTransport(source);
  await runProcess("git", ["-c", `safe.directory=${path.resolve(target)}`, "remote", "set-url", "origin", transport.cloneUrl], {
    cwd: target,
    env: transport.env,
  });
  await runProcess("git", ["-c", `safe.directory=${path.resolve(target)}`, "fetch", "--all", "--prune", "--tags"], {
    cwd: target,
    env: transport.env,
  });
  touchCacheFetch(target);
  touchCacheAccess(target);
}

function queueMirrorRefresh(source: Source, target: string): void {
  const existing = mirrorRefreshJobs.get(target);
  if (existing) {
    return;
  }
  const job = withCacheLock(target, async () => {
    if (!fs.existsSync(target) || !isMirrorRefreshDue(target)) {
      return;
    }
    await refreshMirrorCache(source, target);
  })
    .catch(error => {
      logPrewarmFailure(source, "mirror refresh", error);
    })
    .finally(() => {
      if (mirrorRefreshJobs.get(target) === job) {
        mirrorRefreshJobs.delete(target);
      }
    });
  mirrorRefreshJobs.set(target, job);
}

async function ensureMirrorCache(source: Source, options: { requireReadyCache: boolean }): Promise<string> {
  const target = sourceCachePath(source);
  return await withCacheLock(target, async () => {
    fs.mkdirSync(cacheRoot(), { recursive: true });
    if (!fs.existsSync(target)) {
      if (options.requireReadyCache) {
        throw new CodeReviewCacheNotReadyError(`Code review cache for ${source.displayName} is warming. Retry shortly.`);
      }
      const transport = await resolveGitTransport(source);
      await runProcess("git", ["clone", "--mirror", transport.cloneUrl, target], {
        cwd: cacheRoot(),
        env: transport.env,
      });
      touchCacheFetch(target);
      touchCacheAccess(target);
      return target;
    }
    touchCacheAccess(target);
    if (isMirrorRefreshDue(target)) {
      if (options.requireReadyCache) {
        queueMirrorRefresh(source, target);
        throw new CodeReviewCacheNotReadyError(`Code review cache for ${source.displayName} is refreshing. Retry shortly.`);
      } else {
        await refreshMirrorCache(source, target);
      }
    }
    return target;
  });
}

export async function ensureGitReviewRepo(
  source: Source,
  storageConfig: ObjectStorageConfig,
  options: { requireReadyCache?: boolean } = {},
): Promise<string> {
  if (!options.requireReadyCache) {
    cleanupGitReviewCache();
  }
  if (source.type === "upload-archive") {
    return options.requireReadyCache
      ? ensureArchiveCache(source)
      : materializeArchiveCache(source, storageConfig);
  }
  return ensureMirrorCache(source, { requireReadyCache: options.requireReadyCache === true });
}

export async function prewarmCodeReviewSource(source: Source, storageConfig: ObjectStorageConfig): Promise<void> {
  await ensureGitReviewRepo(source, storageConfig, { requireReadyCache: false });
}

export function scheduleCodeReviewPrewarm(source: Source, storageConfig: ObjectStorageConfig): Promise<void> {
  const key = sourceCachePath(source);
  const existing = prewarmJobs.get(key);
  if (existing) {
    return existing;
  }
  const job = prewarmCodeReviewSource(source, storageConfig)
    .catch(error => {
      logPrewarmFailure(source, "prewarm", error);
      throw error;
    })
    .finally(() => {
      if (prewarmJobs.get(key) === job) {
        prewarmJobs.delete(key);
      }
    });
  prewarmJobs.set(key, job);
  return job;
}

async function resolveHeadRef(repoPath: string): Promise<string> {
  const symbolic = (await runGit(["symbolic-ref", "--quiet", "HEAD"], repoPath)).trim();
  return symbolic.replace(/^refs\/heads\//, "");
}

export async function listGitReferences(repoPath: string): Promise<GitReference[]> {
  const raw = (await runGit(["show-ref"], repoPath))
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);
  const resolvedHead = await resolveHeadRef(repoPath).catch(() => "");
  const refs: GitReference[] = [];
  for (const line of raw) {
    const separator = line.indexOf(" ");
    if (separator <= 0) {
      throw new Error(`Malformed git ref listing for ${repoPath}.`);
    }
    const target = line.slice(0, separator);
    const fullName = line.slice(separator + 1);
    const name = fullName?.replace(/^refs\/(heads|remotes\/origin)\//, "") ?? "";
    const isRemote = fullName?.startsWith("refs/remotes/") ?? false;
    refs.push({
      name,
      target: target ?? null,
      isHead: name === resolvedHead || fullName === `refs/heads/${resolvedHead}`,
      isRemote,
    });
  }
  return refs;
}

export function resolveSelectedRef(refs: GitReference[], requestedRef: string | null | undefined): string {
  if (requestedRef && refs.some(ref => ref.name === requestedRef)) {
    return requestedRef;
  }
  return refs.find(ref => ref.isHead)?.name ?? refs.find(ref => !ref.isRemote)?.name ?? refs[0]?.name ?? "HEAD";
}

async function canResolveGitRevision(repoPath: string, revision: string): Promise<boolean> {
  try {
    await runGit(["rev-parse", "--verify", "--quiet", "--end-of-options", `${revision}^{commit}`], repoPath);
    return true;
  } catch {
    return false;
  }
}

async function listMissingGitRevisions(repoPath: string, revisions: string[]): Promise<string[]> {
  const uniqueRevisions = [...new Set(
    revisions
      .map(revision => revision.trim())
      .filter(Boolean),
  )];
  const results = await Promise.all(uniqueRevisions.map(async revision => ({
    revision,
    found: await canResolveGitRevision(repoPath, revision),
  })));
  return results.filter(result => !result.found).map(result => result.revision);
}

async function ensureRequestedGitRevisions(
  source: Source,
  repoPath: string,
  revisions: string[],
): Promise<GitReference[]> {
  let refs = await listGitReferences(repoPath);
  let missing = await listMissingGitRevisions(repoPath, revisions);
  if (missing.length === 0) {
    return refs;
  }

  if (source.type !== "upload-archive") {
    await withCacheLock(repoPath, async () => {
      if (!fs.existsSync(repoPath)) {
        return;
      }
      const unresolved = await listMissingGitRevisions(repoPath, revisions);
      if (unresolved.length > 0) {
        await refreshMirrorCache(source, repoPath);
      }
    });
    refs = await listGitReferences(repoPath);
    missing = await listMissingGitRevisions(repoPath, revisions);
    if (missing.length === 0) {
      return refs;
    }
  }

  throw new CodeReviewReferenceNotFoundError(`Git ref not found: ${missing[0]}.`);
}

export async function listCodeTree(repoPath: string, ref: string, requestedPath: string | null | undefined): Promise<CodeTreeEntry[]> {
  const normalizedPath = requestedPath?.replace(/^\/+|\/+$/g, "") ?? "";
  const args = normalizedPath
    ? ["ls-tree", "-z", "--long", ref, "--", `${normalizedPath}/`]
    : ["ls-tree", "-z", "--long", ref];
  const output = (await runGit(args, repoPath))
    .split("\0")
    .filter(Boolean);
  return output.map(record => {
    const separator = record.indexOf("\t");
    const header = separator >= 0 ? record.slice(0, separator) : record;
    const entryPath = separator >= 0 ? record.slice(separator + 1) : "";
    const [, kind] = header.match(/^\d+\s+(\w+)\s+[0-9a-f]+\s+(-|\d+)$/) ?? [];
    return {
      path: entryPath,
      name: path.basename(entryPath),
      kind: kind === "tree" ? "directory" : "file",
      changed: false,
      hasFindings: false,
    };
  });
}

export async function readCodeFile(repoPath: string, ref: string, requestedPath: string | null | undefined): Promise<string | null> {
  const normalizedPath = requestedPath?.replace(/^\/+/, "") ?? "";
  if (!normalizedPath) {
    return null;
  }
  try {
    const objectType = (await runGit(["cat-file", "-t", `${ref}:${normalizedPath}`], repoPath)).trim();
    if (objectType !== "blob") {
      return null;
    }
    return await runGit(["show", `${ref}:${normalizedPath}`], repoPath);
  } catch (error) {
    if (isGitMissingObjectError(error)) {
      return null;
    }
    throw error;
  }
}

async function readGitDiff(repoPath: string, args: string[]): Promise<string> {
  return await runGit(args, repoPath);
}

export async function readCodeDiff(repoPath: string, ref: string, compareRef: string | null | undefined, requestedPath: string | null | undefined): Promise<string | null> {
  if (!compareRef) {
    return null;
  }
  const args = ["diff", "--no-ext-diff", "--no-textconv", "--unified=3", `${compareRef}..${ref}`];
  const normalizedPath = requestedPath?.replace(/^\/+/, "") ?? "";
  if (normalizedPath) {
    args.push("--", normalizedPath);
  }
  return await readGitDiff(repoPath, args);
}

async function resolveTreePath(repoPath: string, ref: string, requestedPath: string | null): Promise<string | null> {
  if (!requestedPath) {
    return null;
  }
  const normalizedPath = requestedPath.replace(/^\/+|\/+$/g, "");
  if (!normalizedPath) {
    return null;
  }
  try {
    const objectType = (await runGit(["cat-file", "-t", `${ref}:${normalizedPath}`], repoPath)).trim();
    if (objectType === "tree") {
      return normalizedPath;
    }
  } catch {
    return normalizedPath.includes("/") ? path.dirname(normalizedPath) : null;
  }
  return normalizedPath.includes("/") ? path.dirname(normalizedPath) : null;
}

export async function readCodeReviewFromSource(
  source: Source,
  storageConfig: ObjectStorageConfig,
  options: {
    ref?: string | null;
    path?: string | null;
    compare?: string | null;
    requireReadyCache?: boolean;
  } = {},
): Promise<Pick<CodeReviewPayload, "refs" | "selectedRef" | "selectedPath" | "compareRef" | "tree" | "fileContent" | "diff">> {
  const repoPath = await ensureGitReviewRepo(source, storageConfig, {
    requireReadyCache: options.requireReadyCache === true,
  });
  const refs = await ensureRequestedGitRevisions(
    source,
    repoPath,
    [options.ref, options.compare].filter((value): value is string => Boolean(value)),
  );
  const selectedRef = options.ref ?? resolveSelectedRef(refs, null);
  const selectedPath = options.path?.replace(/^\/+/, "") ?? null;
  const treePath = await resolveTreePath(repoPath, selectedRef, selectedPath);
  return {
    refs,
    selectedRef,
    selectedPath,
    compareRef: options.compare ?? null,
    tree: await listCodeTree(repoPath, selectedRef, treePath),
    fileContent: await readCodeFile(repoPath, selectedRef, selectedPath),
    diff: await readCodeDiff(repoPath, selectedRef, options.compare, selectedPath),
  };
}
