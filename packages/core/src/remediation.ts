import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ChangesetSummary, CreateRemediationTaskInput, Source, AnalysisReport } from "@speclens/contracts";
import { extractArchiveFileAsync, inspectGitRepositoryArchiveFileAsync } from "./archive";
import { createGithubCloneUrl, createGithubGitAuthEnv } from "./github-app";
import { createHomeTempDirSync } from "./local-paths";

function safeFilename(value: string): string {
  return path.basename(value).replace(/[^a-zA-Z0-9._-]+/g, "-") || "upload.bin";
}

async function runCommand(args: string[], options: {
  cwd?: string;
  env?: NodeJS.ProcessEnv | undefined;
  label: string;
}): Promise<{
  status: number;
  stdout: string;
  stderr: string;
}> {
  return await new Promise((resolve, reject) => {
    const env = {
      ...(options.env ?? process.env),
      PATH: options.env?.PATH ?? process.env.PATH ?? "/usr/bin:/bin",
    };
    const child = spawn(args[0]!, args.slice(1), {
      cwd: options.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", chunk => {
      stdout.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.stderr.on("data", chunk => {
      stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.once("error", error => {
      reject(new Error(`${options.label} failed: ${error.message}`));
    });
    child.once("close", status => {
      resolve({
        status: status ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

export async function runGit(args: string[], cwd: string): Promise<string> {
  const result = await runCommand(["git", "-c", `safe.directory=${path.resolve(cwd)}`, ...args], {
    cwd,
    label: `git ${args.join(" ")}`,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `git ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

async function runGitWithEnv(args: string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<string> {
  const result = await runCommand(["git", "-c", `safe.directory=${path.resolve(cwd)}`, ...args], {
    cwd,
    env,
    label: `git ${args.join(" ")}`,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `git ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

function collapseSingleRoot(extractedDir: string): string {
  const entries = fs.readdirSync(extractedDir, { withFileTypes: true }).filter(entry => entry.name !== "__MACOSX");
  if (entries.length === 1 && entries[0]?.isDirectory()) {
    return path.join(extractedDir, entries[0].name);
  }
  return extractedDir;
}

function detectPackageManager(repoPath: string): "npm" | "pnpm" | "yarn" | "bun" {
  if (fs.existsSync(path.join(repoPath, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(repoPath, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(repoPath, "bun.lockb")) || fs.existsSync(path.join(repoPath, "bun.lock"))) return "bun";
  return "npm";
}

function buildRunScriptCommand(packageManager: "npm" | "pnpm" | "yarn" | "bun", scriptName: string): string {
  if (packageManager === "yarn") return `yarn ${scriptName}`;
  if (packageManager === "pnpm") return `pnpm ${scriptName}`;
  if (packageManager === "bun") return `bun run ${scriptName}`;
  return `npm run ${scriptName}`;
}

function containsUnsafeShellSyntax(command: string): boolean {
  return /[|&;<>()`$]/.test(command)
    || /[\r\n]/.test(command)
    || /(?:^|\s)[A-Za-z_][A-Za-z0-9_]*=/.test(command);
}

function parseCommandArgv(command: string): string[] {
  const trimmed = command.trim();
  if (!trimmed) {
    throw new Error("Validation command cannot be empty.");
  }
  if (containsUnsafeShellSyntax(trimmed)) {
    throw new Error(
      "Validation command contains shell-only syntax. "
      + "Set SPECLENS_ALLOW_UNSAFE_VALIDATION_COMMANDS=true to opt into shell execution intentionally.",
    );
  }

  const args: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index]!;
    if (quote === null) {
      if (/\s/.test(char)) {
        if (current) {
          args.push(current);
          current = "";
        }
        continue;
      }
      if (char === "'" || char === "\"") {
        quote = char;
        continue;
      }
      current += char;
      continue;
    }
    if (char === quote) {
      quote = null;
      continue;
    }
    if (quote === "\"" && char === "\\") {
      index += 1;
      if (index >= trimmed.length) {
        throw new Error(`Validation command has an invalid escape sequence: ${command}`);
      }
      current += trimmed[index]!;
      continue;
    }
    current += char;
  }
  if (quote !== null) {
    throw new Error(`Validation command has an unterminated quote: ${command}`);
  }
  if (current) {
    args.push(current);
  }
  if (args.length === 0) {
    throw new Error("Validation command cannot be empty.");
  }
  return args;
}

export function resolveValidationCommands(repoPath: string, report: AnalysisReport): string[] {
  const explicit = [
    ...(report.summary.fixHandoff?.validationCommands ?? []),
    ...((report.summary.fixHandoff?.entries ?? []).flatMap(entry => entry.validationCommands)),
  ];
  if (explicit.length > 0) {
    return [...new Set(explicit)];
  }

  const packageJsonPath = path.join(repoPath, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return [];
  }

  let scripts: Record<string, unknown> = {};
  try {
    scripts = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")).scripts ?? {};
  } catch {
    return [];
  }

  const packageManager = detectPackageManager(repoPath);
  const preferredScripts = ["typecheck", "test", "lint", "validate", "validate:local"];
  return preferredScripts
    .filter(scriptName => typeof scripts[scriptName] === "string")
    .slice(0, 2)
    .map(scriptName => buildRunScriptCommand(packageManager, scriptName));
}

export function selectRemediationFindings(
  report: AnalysisReport,
  input: CreateRemediationTaskInput,
) {
  if (input.selectionMode === "selected-findings") {
    const wanted = new Set(input.selectedFindingIds);
    return report.findings.filter(finding => wanted.has(finding.id));
  }

  const preferred = report.findings.filter(finding => finding.severity === "high" || finding.severity === "medium");
  return (preferred.length > 0 ? preferred : report.findings).slice(0, 12);
}

export async function materializeRemediationRepo(options: {
  source: Source;
  repoDir: string;
  tempDir: string;
  storageConfig: any;
  downloadObjectToFile: (config: any, objectKey: string, destinationPath: string) => Promise<unknown>;
}) {
  fs.mkdirSync(options.repoDir, { recursive: true });

  if (options.source.type === "upload-archive") {
    if (!options.source.uploadObjectKey) {
      throw new Error(`Archive source ${options.source.id} is missing uploadObjectKey.`);
    }
    const archivePath = path.join(options.tempDir, `${Date.now()}-${safeFilename(path.basename(options.source.location))}`);
    await options.downloadObjectToFile(options.storageConfig, options.source.uploadObjectKey, archivePath);
    const archiveInspection = await inspectGitRepositoryArchiveFileAsync(archivePath, options.source.location);
    if (archiveInspection.ok === false) {
      throw new Error(archiveInspection.message);
    }
    await extractArchiveFileAsync(archivePath, options.repoDir, archiveInspection.kind);
    const repoRoot = collapseSingleRoot(options.repoDir);
    await runGit(["status", "--short"], repoRoot);
    return repoRoot;
  }

  if (options.source.type === "github-private" && !options.source.githubInstallationId) {
    throw new Error(`Private GitHub source ${options.source.id} is missing githubInstallationId.`);
  }

  const cloneUrl = options.source.type === "github-private"
    ? createGithubCloneUrl(options.source.location)
    : options.source.location;
  const env = options.source.type === "github-private"
    ? await createGithubGitAuthEnv(options.source.githubInstallationId!, { baseEnv: process.env })
    : undefined;
  await runGitWithEnv(["clone", "--quiet", cloneUrl, options.repoDir], options.tempDir, env);
  return options.repoDir;
}

export async function runCodexRemediation(options: {
  repoPath: string;
  prompt: string;
  outputPath: string;
  authPath?: string | null;
}): Promise<void> {
  const codexBin = process.env.CODEX_BIN ?? "codex";
  const codexModel = process.env.OPENAI_CODEX_MODEL?.trim() || null;
  const bypassSandbox = process.env.AI_WORKER_CODEX_BYPASS_SANDBOX === "true"
    && process.env.SPECLENS_ALLOW_UNSAFE_CODEX_BYPASS === "true";
  const codexHome = options.authPath
    ? path.dirname(options.authPath)
    : path.join(options.repoPath, ".speclens-codex");
  fs.mkdirSync(codexHome, { recursive: true });
  const args = ["exec", "--skip-git-repo-check"];
  if (codexModel) {
    args.push("--model", codexModel);
  }
  if (bypassSandbox) {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else {
    args.push("--sandbox", "workspace-write");
  }
  args.push("--output-last-message", options.outputPath, options.prompt);
  const result = await runCommand([codexBin, ...args], {
    cwd: options.repoPath,
    env: {
      ...process.env,
      HOME: codexHome,
      XDG_CACHE_HOME: codexHome,
      TMPDIR: codexHome,
      CODEX_HOME: codexHome,
      ...(options.authPath ? { CODEX_AUTH_PATH: options.authPath } : {}),
    },
    label: "codex remediation",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "Codex remediation failed.");
  }
}

export async function runValidationCommands(repoPath: string, commands: string[]) {
  const entries = [];
  const allowUnsafe = process.env.SPECLENS_ALLOW_UNSAFE_VALIDATION_COMMANDS === "true";
  for (const command of commands) {
    let result: Awaited<ReturnType<typeof runCommand>>;
    try {
      result = allowUnsafe
        ? await runCommand(["bash", "-lc", command], {
            cwd: repoPath,
            label: `validation command: ${command}`,
          })
        : await runCommand(parseCommandArgv(command), {
            cwd: repoPath,
            label: `validation command: ${command}`,
          });
    } catch (error) {
      entries.push({
        command,
        exitCode: 1,
        output: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    entries.push({
      command,
      exitCode: result.status ?? 1,
      output: [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n\n"),
    });
  }
  return {
    passed: entries.every(entry => entry.exitCode === 0),
    entries,
  };
}

export async function maybePublishGithubPullRequest(options: {
  repoPath: string;
  branchName: string;
  baseRef: string;
  publishRemote: boolean;
  outputMode: "changeset" | "remote-pr";
  summaryBody: string;
}) {
  if (!options.publishRemote || options.outputMode !== "remote-pr") {
    return { prUrl: null, stopReason: null as null | "remote-pr-not-configured" };
  }
  if (process.env.SPECLENS_ENABLE_REMOTE_PR_PUBLISH !== "true") {
    return { prUrl: null, stopReason: "remote-pr-not-configured" as const };
  }
  const token = process.env.SPECLENS_REMOTE_PR_GITHUB_TOKEN ?? null;
  const remoteUrl = await runGit(["remote", "get-url", "origin"], options.repoPath);
  const match = /github\.com[:/](.+?)\/(.+?)(?:\.git)?$/.exec(remoteUrl);
  if (!token || !match) {
    return { prUrl: null, stopReason: "remote-pr-not-configured" as const };
  }
  const [, owner, repo] = match;
  const pushUrl = remoteUrl.startsWith("http")
    ? remoteUrl.replace("https://", `https://x-access-token:${token}@`)
    : `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  await runGit(["push", pushUrl, `HEAD:${options.branchName}`, "--force-with-lease"], options.repoPath);
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "SpecLens",
    },
    body: JSON.stringify({
      title: `SpecLens remediation: ${options.branchName}`,
      head: options.branchName,
      base: options.baseRef,
      body: options.summaryBody,
    }),
  });
  if (!response.ok) {
    return { prUrl: null, stopReason: "remote-pr-not-configured" as const };
  }
  const payload = await response.json() as { html_url?: string };
  return { prUrl: payload.html_url ?? null, stopReason: null as null | "remote-pr-not-configured" };
}

export function createRemediationTempDir(prefix = "speclens-remediation-"): string {
  return createHomeTempDirSync(prefix);
}

export function createChangesetSummary(input: {
  branchName: string | null;
  baseRef: string;
  changedFiles: string[];
  commandsRun: string[];
  validationCommands: string[];
  validationPassed: boolean;
  iterationCount: number;
  stopReason: ChangesetSummary["stopReason"];
  fixedFindingIds: string[];
  residualFindingIds: string[];
  pullInstructions: string[];
  prUrl: string | null;
}): ChangesetSummary {
  return {
    branchName: input.branchName,
    baseRef: input.baseRef,
    changedFiles: input.changedFiles,
    commandsRun: [...new Set(input.commandsRun)],
    validationCommands: input.validationCommands,
    validationPassed: input.validationPassed,
    iterationCount: input.iterationCount,
    stopReason: input.stopReason,
    fixedFindingIds: input.fixedFindingIds,
    residualFindingIds: input.residualFindingIds,
    pullInstructions: input.pullInstructions,
    prUrl: input.prUrl,
  };
}
