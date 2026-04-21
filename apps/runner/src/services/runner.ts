import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  createGithubCloneUrl,
  createGithubGitAuthEnv,
  inspectGitRepositoryArchiveFileAsync,
  type ArchiveKind,
} from "@speclens/core";
import {
  appendAnalysisJobLogs,
  checkDatabaseHealth,
  checkObjectStorageHealth,
  checkQueueHealth,
  claimAnalysisJob,
  downloadObjectToFile,
  finalizeAnalysisJobFailure,
  finalizeAnalysisJobSuccess,
  getCodexTokens,
  initializeDatabase,
  isCancellationRequested,
  mirrorArtifactsToObjectStorage,
  parseCodexAuthFile,
  renderCodexAuthFile,
  storeCodexTokens,
  type ObjectStorageConfig,
  putObjectFromFile,
  workRunnerJobs,
  type JobExecutionRecord,
} from "@speclens/db";
import {
  analysisLogEventSchema,
  type AnalysisLogEvent,
  type ArtifactReference,
  type JobEnvelope,
} from "@speclens/contracts";
import { jobEnvelopeSchema, sandboxAnalyzeRequestSchema, type SandboxAnalyzeRequest } from "../contracts";
import { loadRunnerConfig } from "./config";
import { getMetricsContentType, getMetricsSnapshot, recordRunnerJob, recordSandboxDuration } from "./metrics";

type SandboxRunResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  cancelled: boolean;
};

type RawSandboxEnvelope = Partial<JobEnvelope> & {
  job?: Partial<JobEnvelope["job"]>;
  logs?: AnalysisLogEvent[];
  report?: JobEnvelope["report"];
};

let embeddedWorkerStarted = false;

function storageConfig(): ObjectStorageConfig {
  const provider = process.env.OBJECT_STORAGE_PROVIDER;
  const mirrorProvider: ObjectStorageConfig["objectStorageProvider"] = process.env.OBJECT_STORAGE_MIRROR_PROVIDER === "s3-compatible" || process.env.OBJECT_STORAGE_MIRROR_PROVIDER === "digitalocean-spaces"
    ? process.env.OBJECT_STORAGE_MIRROR_PROVIDER
    : "local";
  const objectStorageMirror = process.env.OBJECT_STORAGE_MIRROR_PROVIDER
    ? {
        objectStorageProvider: mirrorProvider,
        objectStorageBucket: process.env.OBJECT_STORAGE_MIRROR_BUCKET ?? null,
        objectStorageEndpoint: process.env.OBJECT_STORAGE_MIRROR_ENDPOINT ?? null,
        objectStoragePublicEndpoint: process.env.OBJECT_STORAGE_MIRROR_PUBLIC_ENDPOINT ?? process.env.OBJECT_STORAGE_MIRROR_ENDPOINT ?? null,
        objectStorageRegion: process.env.OBJECT_STORAGE_MIRROR_REGION ?? null,
        objectStorageForcePathStyle: process.env.OBJECT_STORAGE_MIRROR_FORCE_PATH_STYLE === "true",
        objectStorageAccessKeyId: process.env.OBJECT_STORAGE_MIRROR_ACCESS_KEY_ID ?? null,
        objectStorageSecretAccessKey: process.env.OBJECT_STORAGE_MIRROR_SECRET_ACCESS_KEY ?? null,
      }
    : null;
  return {
    objectStorageProvider:
      provider === "s3-compatible" || provider === "digitalocean-spaces" ? provider : "local",
    objectStorageBucket: process.env.OBJECT_STORAGE_BUCKET ?? process.env.SPACES_BUCKET ?? null,
    objectStorageEndpoint: process.env.OBJECT_STORAGE_ENDPOINT ?? process.env.SPACES_ENDPOINT ?? null,
    objectStoragePublicEndpoint:
      process.env.OBJECT_STORAGE_PUBLIC_ENDPOINT ?? process.env.OBJECT_STORAGE_ENDPOINT ?? process.env.SPACES_ENDPOINT ?? null,
    objectStorageRegion: process.env.OBJECT_STORAGE_REGION ?? process.env.SPACES_REGION ?? null,
    objectStorageForcePathStyle: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE === "true",
    objectStorageAccessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY_ID ?? process.env.SPACES_ACCESS_KEY_ID ?? null,
    objectStorageSecretAccessKey: process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY ?? process.env.SPACES_SECRET_ACCESS_KEY ?? null,
    objectStorageMirror,
    objectStorageMirrorRequired: objectStorageMirror !== null && process.env.OBJECT_STORAGE_MIRROR_REQUIRED !== "false",
  };
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "artifact";
}

function createLog(
  jobId: string,
  scope: string,
  message: string,
  level: AnalysisLogEvent["level"] = "info",
  requestId?: string,
): AnalysisLogEvent {
  return analysisLogEventSchema.parse({
    id: `log_${randomUUID()}`,
    jobId,
    level,
    scope,
    message,
    ...(requestId ? { requestId } : {}),
    createdAt: new Date().toISOString(),
  });
}

async function appendLog(
  jobId: string,
  scope: string,
  message: string,
  level: AnalysisLogEvent["level"] = "info",
  requestId?: string,
): Promise<void> {
  await appendAnalysisJobLogs(jobId, [createLog(jobId, scope, message, level, requestId)]);
}

async function runProcess(command: string, args: string[], options: {
  env?: NodeJS.ProcessEnv | undefined;
  cwd?: string | undefined;
} = {}): Promise<void> {
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

  await new Promise<void>((resolve, reject) => {
    child.stdout.on("data", chunk => {
      stdout.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.stderr.on("data", chunk => {
      stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.on("error", reject);
    child.on("close", status => {
      if (status !== 0) {
        reject(new Error(
          Buffer.concat(stderr).toString("utf8").trim()
          || Buffer.concat(stdout).toString("utf8").trim()
          || `${command} ${args.join(" ")} failed.`,
        ));
        return;
      }
      resolve();
    });
  });
}

async function runProcessCapture(command: string, args: string[]): Promise<{
  status: number;
  stdout: string;
  stderr: string;
}> {
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  return await new Promise((resolve, reject) => {
    child.stdout.on("data", chunk => {
      stdout.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.stderr.on("data", chunk => {
      stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.once("error", reject);
    child.once("close", status => {
      resolve({
        status: status ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

async function removeDockerContainer(containerName: string): Promise<void> {
  const result = await runProcessCapture("docker", ["rm", "-f", containerName]);
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    if (detail && !detail.includes("No such container")) {
      throw new Error(detail);
    }
  }
}

async function extractArchive(archivePath: string, extractedDir: string, kind: ArchiveKind): Promise<void> {
  if (kind === "zip") {
    await runProcess("unzip", ["-q", archivePath, "-d", extractedDir]);
    return;
  }
  if (kind === "tar" || kind === "tar.gz") {
    await runProcess("tar", ["-xf", archivePath, "-C", extractedDir, "--no-same-owner", "--no-same-permissions"]);
    return;
  }
  throw new Error("Unsupported archive format. Use .zip, .tar, .tgz, or .tar.gz.");
}

function collapseSingleRoot(extractedDir: string): string {
  const entries = fs.readdirSync(extractedDir, { withFileTypes: true }).filter(entry => entry.name !== "__MACOSX");
  if (entries.length === 1 && entries[0]?.isDirectory()) {
    return path.join(extractedDir, entries[0].name);
  }
  return extractedDir;
}

async function cloneRepo(repoUrl: string, destination: string, env?: NodeJS.ProcessEnv): Promise<void> {
  const nextEnv = { ...(env ?? process.env) };
  delete nextEnv.GIT_DIR;
  delete nextEnv.GIT_WORK_TREE;
  delete nextEnv.GIT_INDEX_FILE;
  await runProcess("git", ["clone", "--depth=1", repoUrl, destination], {
    cwd: os.tmpdir(),
    env: nextEnv,
  });
}

function stripGitMetadata(repoPath: string): string {
  const gitDir = path.join(repoPath, ".git");
  if (fs.existsSync(gitDir)) {
    fs.rmSync(gitDir, { recursive: true, force: true });
  }
  return repoPath;
}

async function materializeStandaloneSource(source: JobExecutionRecord["source"], targetDir: string, tempDir: string): Promise<string> {
  if (source.type === "upload-archive") {
    if (!source.uploadObjectKey) {
      throw new Error(`Archive source ${source.id} is missing uploadObjectKey.`);
    }
    const archivePath = path.join(tempDir, `${safeSegment(source.id)}-${safeSegment(path.basename(source.location))}`);
    fs.mkdirSync(targetDir, { recursive: true });
    await downloadObjectToFile(storageConfig(), source.uploadObjectKey, archivePath);
    const archiveInspection = await inspectGitRepositoryArchiveFileAsync(archivePath, source.location);
    if (!archiveInspection.ok) {
      throw new Error(archiveInspection.message);
    }
    await extractArchive(archivePath, targetDir, archiveInspection.kind);
    return stripGitMetadata(collapseSingleRoot(targetDir));
  }

  if (source.type === "github-private") {
    if (!source.githubInstallationId) {
      throw new Error(`Private GitHub source ${source.id} is missing githubInstallationId.`);
    }
    await cloneRepo(
      createGithubCloneUrl(source.location),
      targetDir,
      await createGithubGitAuthEnv(source.githubInstallationId, { baseEnv: process.env }),
    );
    return stripGitMetadata(targetDir);
  }

  await cloneRepo(source.location, targetDir);
  return stripGitMetadata(targetDir);
}

function writeCombinedSourceBundle(
  bundleRoot: string,
  primarySource: JobExecutionRecord["source"],
  companionSource: JobExecutionRecord["source"],
): void {
  fs.mkdirSync(bundleRoot, { recursive: true });
  fs.writeFileSync(
    path.join(bundleRoot, "README.speclens.txt"),
    [
      "This directory is a SpecLens-generated paired source bundle.",
      "",
      "Use `primary/` as the main analysis target and `companion/` as the linked supporting source.",
      "",
      `Primary source: ${primarySource.displayName} (${primarySource.type})`,
      `Primary location: ${primarySource.location}`,
      `Companion source: ${companionSource.displayName} (${companionSource.type})`,
      `Companion location: ${companionSource.location}`,
      "",
      "Typical pairing: deployed website in `primary/` and source code in `companion/`.",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(bundleRoot, "speclens-source-bundle.json"),
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      primary: {
        id: primarySource.id,
        displayName: primarySource.displayName,
        type: primarySource.type,
        location: primarySource.location,
      },
      companion: {
        id: companionSource.id,
        displayName: companionSource.displayName,
        type: companionSource.type,
        location: companionSource.location,
      },
    }, null, 2)}\n`,
    "utf8",
  );
}

async function materializeSource(
  execution: JobExecutionRecord,
  tempDir: string,
): Promise<{
  hostSourcePath: string;
}> {
  const sourceRoot = path.join(tempDir, "source");
  const source = execution.source;

  if (execution.companionSource) {
    const bundleRoot = path.join(tempDir, "source-bundle");
    const primaryStageDir = path.join(tempDir, "materialized-primary");
    const companionStageDir = path.join(tempDir, "materialized-companion");
    const primaryMaterializedPath = await materializeStandaloneSource(source, primaryStageDir, tempDir);
    const companionMaterializedPath = await materializeStandaloneSource(execution.companionSource, companionStageDir, tempDir);
    const primaryBundleDir = path.join(bundleRoot, "primary");
    const companionBundleDir = path.join(bundleRoot, "companion");
    fs.mkdirSync(bundleRoot, { recursive: true });
    fs.cpSync(primaryMaterializedPath, primaryBundleDir, { recursive: true });
    fs.cpSync(companionMaterializedPath, companionBundleDir, { recursive: true });
    writeCombinedSourceBundle(bundleRoot, source, execution.companionSource);
    return {
      hostSourcePath: bundleRoot,
    };
  }

  if (source.type === "upload-archive") {
    if (!source.uploadObjectKey) {
      throw new Error(`Archive source ${source.id} is missing uploadObjectKey.`);
    }
    const archivePath = path.join(tempDir, safeSegment(path.basename(source.location)));
    fs.mkdirSync(sourceRoot, { recursive: true });
    await downloadObjectToFile(storageConfig(), source.uploadObjectKey, archivePath);
    const archiveInspection = await inspectGitRepositoryArchiveFileAsync(archivePath, source.location);
    if (!archiveInspection.ok) {
      throw new Error(archiveInspection.message);
    }
    await extractArchive(archivePath, sourceRoot, archiveInspection.kind);
    return {
      hostSourcePath: stripGitMetadata(collapseSingleRoot(sourceRoot)),
    };
  }

  if (source.type === "github-private") {
    if (!source.githubInstallationId) {
      throw new Error(`Private GitHub source ${source.id} is missing githubInstallationId.`);
    }
    await cloneRepo(
      createGithubCloneUrl(source.location),
      sourceRoot,
      await createGithubGitAuthEnv(source.githubInstallationId, { baseEnv: process.env }),
    );
    return {
      hostSourcePath: stripGitMetadata(sourceRoot),
    };
  }

  await cloneRepo(source.location, sourceRoot);
  return {
    hostSourcePath: stripGitMetadata(sourceRoot),
  };
}

function buildSandboxRequest(
  execution: JobExecutionRecord,
  hostSourcePath: string,
  tempDir: string,
): { request: SandboxAnalyzeRequest; requestPath: string; outputRoot: string } {
  const mountRoot = "/speclens-run";
  const outputRoot = path.join(tempDir, "output");
  const requestPath = path.join(tempDir, "request.json");
  fs.mkdirSync(outputRoot, { recursive: true });

  const request = sandboxAnalyzeRequestSchema.parse({
    jobId: execution.job.id,
    workspace: {
      id: execution.workspace.id,
      slug: execution.workspace.slug,
    },
    roles: execution.job.roles,
    runtimeMode: execution.job.runtimeMode,
    secretRefs: execution.job.secretRefs,
    secrets: execution.secrets,
    outputRoot: `${mountRoot}/output`,
    sourcePath: `${mountRoot}/${path.relative(tempDir, hostSourcePath)}`,
  });

  fs.writeFileSync(requestPath, `${JSON.stringify(request, null, 2)}\n`);
  return { request, requestPath, outputRoot };
}

async function stageCodexAuth(tempDir: string): Promise<{ sandboxAuthPath: string | null }> {
  const tokens = await getCodexTokens();
  if (!tokens) {
    return { sandboxAuthPath: null };
  }

  const sandboxAuthDir = path.join(tempDir, "codex");
  const sandboxAuthPath = path.join(sandboxAuthDir, "auth.json");
  fs.mkdirSync(sandboxAuthDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(sandboxAuthPath, renderCodexAuthFile(tokens), { mode: 0o600 });
  return { sandboxAuthPath };
}

async function syncCodexAuth(tempDir: string): Promise<void> {
  const authPath = path.join(tempDir, "codex", "auth.json");
  if (!fs.existsSync(authPath)) {
    return;
  }

  const tokens = parseCodexAuthFile(fs.readFileSync(authPath, "utf8"));
  if (!tokens) {
    return;
  }

  await storeCodexTokens(tokens);
}

function pipeOutput(stream: NodeJS.ReadableStream, filePath: string): void {
  const destination = fs.createWriteStream(filePath, { flags: "a" });
  stream.pipe(destination);
}

async function runSandboxContainer(
  execution: JobExecutionRecord,
  requestPath: string,
  tempDir: string,
  stdoutPath: string,
  stderrPath: string,
): Promise<SandboxRunResult> {
  const config = loadRunnerConfig();
  const mountRoot = "/speclens-run";
  const containerName = `speclens-${safeSegment(execution.job.id)}-${safeSegment(config.runnerId)}`.slice(0, 63);
  const { sandboxAuthPath } = await stageCodexAuth(tempDir);
  const dockerArgs = [
    "run",
    "--rm",
    "--name",
    containerName,
    "--label",
    "speclens.managed=true",
    "--label",
    `speclens.runnerId=${config.runnerId}`,
    "--label",
    `speclens.jobId=${execution.job.id}`,
    "-v",
    `${tempDir}:${mountRoot}`,
  ];
  if (sandboxAuthPath) {
    dockerArgs.push(
      "-e",
      `CODEX_HOME=${mountRoot}/codex`,
      "-e",
      `CODEX_AUTH_PATH=${mountRoot}/${path.relative(tempDir, sandboxAuthPath).replace(/\\/g, "/")}`,
      "-e",
      `CODEX_BIN=${process.env.CODEX_BIN ?? "codex"}`,
    );
  }
  if (config.sandboxCpuLimit) {
    dockerArgs.push("--cpus", config.sandboxCpuLimit);
  }
  if (config.sandboxMemoryLimit) {
    dockerArgs.push("--memory", config.sandboxMemoryLimit);
  }
  if (typeof process.getuid === "function" && typeof process.getgid === "function") {
    dockerArgs.push("--user", `${process.getuid()}:${process.getgid()}`);
  }
  dockerArgs.push(
    config.sandboxImage,
    "node",
    "--import",
    "tsx",
    "/app/apps/runner/src/sandbox.ts",
    `${mountRoot}/${path.basename(requestPath)}`,
  );
  const child = spawn("docker", dockerArgs, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  pipeOutput(child.stdout, stdoutPath);
  pipeOutput(child.stderr, stderrPath);

  return waitForSandbox(execution.job.id, child, containerName);
}

async function waitForSandbox(jobId: string, child: ReturnType<typeof spawn>, containerName: string): Promise<SandboxRunResult> {
  const config = loadRunnerConfig();
  let timedOut = false;
  let cancelled = false;
  let forceKillTimer: NodeJS.Timeout | null = null;

  const terminateChild = (reason: "timeout" | "cancel"): void => {
    if (reason === "timeout") {
      timedOut = true;
    }
    if (reason === "cancel") {
      cancelled = true;
    }
    if (child.killed) {
      return;
    }
    child.kill("SIGTERM");
    forceKillTimer = setTimeout(() => {
      child.kill("SIGKILL");
      void removeDockerContainer(containerName).catch(error => {
        console.warn("[runner] Failed to cleanup timed-out sandbox container:", error);
      });
    }, 5000);
  };

  const timeout = setTimeout(() => {
    void appendLog(jobId, "sandbox", `Sandbox timed out after ${config.sandboxTimeoutMs}ms.`, "error");
    terminateChild("timeout");
  }, config.sandboxTimeoutMs);

  const cancellationPoll = setInterval(() => {
    void isCancellationRequested(jobId).then(requested => {
      if (!requested || cancelled) {
        return;
      }
      void appendLog(jobId, "sandbox", "Cancellation requested. Stopping active sandbox container.", "warn");
      terminateChild("cancel");
    }).catch(() => {
      // Ignore cancellation polling failures; the final job result will surface persistence errors.
    });
  }, 1000);

  try {
    const result = await new Promise<SandboxRunResult>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (exitCode, signal) => {
        resolve({
          exitCode,
          signal,
          timedOut,
          cancelled,
        });
      });
    });
    return result;
  } finally {
    clearTimeout(timeout);
    clearInterval(cancellationPoll);
    if (forceKillTimer) {
      clearTimeout(forceKillTimer);
    }
  }
}

function normalizeSandboxEnvelope(execution: JobExecutionRecord, rawEnvelope: RawSandboxEnvelope): JobEnvelope {
  const rawJob: Partial<JobEnvelope["job"]> = rawEnvelope.job ?? {};
  const report = rawEnvelope.report ? {
    ...rawEnvelope.report,
    workspaceId: execution.workspace.id,
    jobId: execution.job.id,
  } : null;

  return jobEnvelopeSchema.parse({
    ...rawEnvelope,
    job: {
      id: execution.job.id,
      workspaceId: execution.workspace.id,
      sourceId: execution.source.id,
      companionSourceId: execution.companionSource?.id ?? null,
      reportId: report?.id ?? null,
      parentReportId: execution.job.parentReportId,
      jobKind: execution.job.jobKind,
      status: "succeeded",
      agentId: execution.job.agentId,
      queueMessageId: execution.job.queueMessageId,
      claimedRunnerId: execution.job.claimedRunnerId,
      cancelRequestedAt: execution.job.cancelRequestedAt,
      failureReason: null,
      sourceType: execution.source.type,
      sourceLocation: execution.source.location,
      companionSourceType: execution.companionSource?.type ?? null,
      companionSourceLocation: execution.companionSource?.location ?? null,
      roles: rawJob.roles ?? execution.job.roles,
      runtimeMode: rawJob.runtimeMode ?? execution.job.runtimeMode,
      secretRefs: execution.job.secretRefs,
      requestedByUserId: execution.job.requestedByUserId,
      changeset: rawJob.changeset ?? execution.job.changeset,
      startedAt: execution.job.startedAt ?? rawJob.startedAt,
      finishedAt: new Date().toISOString(),
      createdAt: execution.job.createdAt,
    },
    logs: rawEnvelope.logs ?? [],
    report,
    artifacts: rawEnvelope.artifacts ?? report?.artifacts ?? [],
    timing: {
      queueDurationMs: execution.job.startedAt
        ? Math.max(0, new Date(execution.job.startedAt).getTime() - new Date(execution.job.createdAt).getTime())
        : null,
      runDurationMs: execution.job.startedAt
        ? Math.max(0, Date.now() - new Date(execution.job.startedAt).getTime())
        : null,
      totalDurationMs: Math.max(0, Date.now() - new Date(execution.job.createdAt).getTime()),
      elapsedMs: Math.max(0, Date.now() - new Date(execution.job.createdAt).getTime()),
      estimatedTotalMs: rawEnvelope.timing?.estimatedTotalMs ?? null,
      estimatedRemainingMs: 0,
      confidence: "high",
      basis: "Derived from runner execution timestamps and the raw sandbox envelope.",
    },
    qualityScorecard: report?.summary.qualityScorecard ?? rawEnvelope.qualityScorecard ?? null,
    capabilityGaps: report?.summary.capabilityGaps ?? rawEnvelope.capabilityGaps ?? [],
    artifactAnalysis: report?.summary.artifactAnalysis ?? rawEnvelope.artifactAnalysis ?? null,
    executionSteps: report?.summary.executionSteps ?? rawEnvelope.executionSteps ?? [],
  });
}

async function uploadRawLogArtifacts(jobId: string, stdoutPath: string, stderrPath: string): Promise<ArtifactReference[]> {
  const config = storageConfig();
  const artifacts: ArtifactReference[] = [];
  if (fs.existsSync(stdoutPath) && fs.statSync(stdoutPath).size > 0) {
    artifacts.push(await putObjectFromFile(
      config,
      `jobs/${jobId}/runner-stdout.log`,
      stdoutPath,
      "text/plain",
      {
        kind: "runtime-log",
        jobId,
      },
    ));
  }
  if (fs.existsSync(stderrPath) && fs.statSync(stderrPath).size > 0) {
    artifacts.push(await putObjectFromFile(
      config,
      `jobs/${jobId}/runner-stderr.log`,
      stderrPath,
      "text/plain",
      {
        kind: "runtime-log",
        jobId,
      },
    ));
  }
  return artifacts;
}

function readFailureReason(stderrPath: string, fallback: string): string {
  if (!fs.existsSync(stderrPath)) {
    return fallback;
  }
  const content = fs.readFileSync(stderrPath, "utf8").trim();
  if (!content) {
    return fallback;
  }
  return content.split("\n").slice(-10).join("\n").slice(0, 1000);
}

async function cleanupStaleSandboxes(config: ReturnType<typeof loadRunnerConfig>): Promise<void> {
  try {
    const result = await runProcessCapture(
      "docker",
      [
        "ps",
        "-aq",
        "--filter",
        "label=speclens.managed=true",
        "--filter",
        `label=speclens.runnerId=${config.runnerId}`,
        "--filter",
        "status=created",
        "--filter",
        "status=exited",
        "--filter",
        "status=dead",
      ],
    );
    if (result.status !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || "docker ps failed");
    }
    const ids = result.stdout.trim().split("\n").map(value => value.trim()).filter(Boolean);
    for (const id of ids) {
      await removeDockerContainer(id);
    }
  } catch (error) {
    console.warn("[runner] Failed to cleanup stale sandbox containers:", error);
  }

  try {
    if (!fs.existsSync(config.tempRoot)) {
      return;
    }
    const cutoff = Date.now() - config.sandboxTempRetentionMs;
    for (const entry of fs.readdirSync(config.tempRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(config.tempRoot, entry.name);
      const stat = fs.statSync(fullPath);
      if (stat.mtimeMs < cutoff) {
        fs.rmSync(fullPath, { recursive: true, force: true });
      }
    }
  } catch (error) {
    console.warn("[runner] Failed to cleanup stale temp dirs:", error);
  }
}

async function executeQueuedJob(jobId: string, queueMessageId?: string): Promise<void> {
  const config = loadRunnerConfig();
  const execution = await claimAnalysisJob(jobId, config.runnerId, queueMessageId);
  if (!execution) {
    return;
  }

  const startedAt = Date.now();
  let finalStatus: "succeeded" | "failed" | "cancelled" | null = null;
  const requestId = execution.job.queueMessageId ?? undefined;
  const tempDir = path.join(config.tempRoot, `${safeSegment(jobId)}-${Date.now()}`);
  const stdoutPath = path.join(tempDir, "runner-stdout.log");
  const stderrPath = path.join(tempDir, "runner-stderr.log");

  try {
    fs.mkdirSync(tempDir, { recursive: true, mode: 0o700 });
    await appendLog(jobId, "runner", `Runner ${config.runnerId} preparing sandbox workspace.`, "info", requestId);
    const { hostSourcePath } = await materializeSource(execution, tempDir);
    const { outputRoot, requestPath } = buildSandboxRequest(execution, hostSourcePath, tempDir);
    await appendLog(jobId, "runner", `Source materialized for ${execution.source.type} execution.`, "info", requestId);
    await appendLog(jobId, "sandbox", `Starting Docker sandbox ${config.sandboxImage}.`, "info", requestId);

    const sandboxStartedAt = Date.now();
    const sandboxResult = await runSandboxContainer(execution, requestPath, tempDir, stdoutPath, stderrPath);
    recordSandboxDuration(sandboxResult.cancelled ? "cancelled" : sandboxResult.timedOut || sandboxResult.exitCode !== 0 ? "failed" : "succeeded", Date.now() - sandboxStartedAt);
    try {
      await syncCodexAuth(tempDir);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to sync Codex auth after sandbox run.";
      await appendLog(jobId, "sandbox", message, "warn", requestId);
    }
    const rawLogArtifacts = await uploadRawLogArtifacts(jobId, stdoutPath, stderrPath);

    if (sandboxResult.cancelled || await isCancellationRequested(jobId)) {
      finalStatus = "cancelled";
      await finalizeAnalysisJobFailure(jobId, {
        status: "cancelled",
        failureReason: "Cancelled during runner execution.",
        logs: [createLog(jobId, "sandbox", "Sandbox execution cancelled.", "warn", requestId)],
        artifacts: rawLogArtifacts,
      });
      return;
    }

    if (sandboxResult.timedOut) {
      finalStatus = "failed";
      await finalizeAnalysisJobFailure(jobId, {
        failureReason: `Sandbox timed out after ${config.sandboxTimeoutMs}ms.`,
        logs: [createLog(jobId, "sandbox", "Sandbox execution timed out.", "error", requestId)],
        artifacts: rawLogArtifacts,
      });
      return;
    }

    if (sandboxResult.exitCode !== 0) {
      finalStatus = "failed";
      await finalizeAnalysisJobFailure(jobId, {
        failureReason: readFailureReason(stderrPath, `Sandbox exited with code ${sandboxResult.exitCode ?? "unknown"}.`),
        logs: [createLog(jobId, "sandbox", `Sandbox exited with code ${sandboxResult.exitCode ?? "unknown"}.`, "error", requestId)],
        artifacts: rawLogArtifacts,
      });
      return;
    }

    const resultPath = path.join(outputRoot, "result.json");
    if (!fs.existsSync(resultPath)) {
      throw new Error(`Sandbox completed without producing ${resultPath}.`);
    }

    const rawEnvelope = JSON.parse(fs.readFileSync(resultPath, "utf8")) as RawSandboxEnvelope;
    const normalizedEnvelope = normalizeSandboxEnvelope(execution, rawEnvelope);
    const mirroredEnvelope = await mirrorArtifactsToObjectStorage(storageConfig(), normalizedEnvelope, outputRoot);
    await finalizeAnalysisJobSuccess(jobId, mirroredEnvelope, rawLogArtifacts);
    await appendLog(jobId, "runner", `Runner ${config.runnerId} finalized durable hosted analysis.`, "info", requestId);
    finalStatus = "succeeded";
  } catch (error) {
    const rawLogArtifacts = await uploadRawLogArtifacts(jobId, stdoutPath, stderrPath);
    await finalizeAnalysisJobFailure(jobId, {
      failureReason: error instanceof Error ? error.message : "Unknown runner failure.",
      logs: [createLog(jobId, "runner", error instanceof Error ? error.message : "Unknown runner failure.", "error", requestId)],
      artifacts: rawLogArtifacts,
    });
    finalStatus = "failed";
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (finalStatus) {
      recordRunnerJob(finalStatus, Date.now() - startedAt);
    }
  }
}

export async function startEmbeddedRunnerWorker(): Promise<void> {
  if (embeddedWorkerStarted) {
    return;
  }
  embeddedWorkerStarted = true;
  await initializeDatabase();
  await workRunnerJobs(async (payload, queueMessageId) => {
    await executeQueuedJob(payload.jobId, queueMessageId);
  });
}

export function stopEmbeddedRunnerWorker(): void {
  embeddedWorkerStarted = false;
}

export async function startRunnerLoop(): Promise<void> {
  const config = loadRunnerConfig();
  console.log(JSON.stringify({
    event: "runner.start",
    maxConcurrency: config.maxConcurrency,
    image: config.sandboxImage,
  }));
  fs.mkdirSync(config.tempRoot, { recursive: true });
  await cleanupStaleSandboxes(config);

  const server = http.createServer((request, response) => {
    void (async () => {
      const url = request.url ?? "/";
      if (url.startsWith("/metrics")) {
        response.writeHead(200, { "content-type": getMetricsContentType() });
        response.end(await getMetricsSnapshot());
        return;
      }
      if (url.startsWith("/ready")) {
        try {
          await checkDatabaseHealth();
          await checkQueueHealth();
          const storage = await checkObjectStorageHealth(storageConfig());
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ ok: true, storage }));
        } catch (error) {
          response.writeHead(503, { "content-type": "application/json" });
          response.end(JSON.stringify({
            ok: false,
            error: error instanceof Error ? error.message : "Readiness check failed.",
          }));
        }
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        ok: true,
        role: "runner",
        maxConcurrency: config.maxConcurrency,
        runnerId: config.runnerId,
      }));
    })();
  });
  server.listen(config.healthPort, "0.0.0.0", () => {
    console.log(`[runner] health endpoint listening on http://0.0.0.0:${config.healthPort}`);
  });

  await startEmbeddedRunnerWorker();
}
