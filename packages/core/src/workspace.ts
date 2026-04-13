import fs from "node:fs";
import path from "node:path";
import type { JobEnvelope } from "@speclens/contracts";
import { createId, ensureDir, loadJsonIfExists, nowIso, writeJsonFile } from "./utils";

export interface WorkspaceOptions {
  rootDir?: string;
  name?: string;
  workspaceRoot?: string;
}

export interface WorkspaceHandle {
  name: string;
  rootDir: string;
  workspaceRoot: string;
  workspaceDir: string;
  runsDir: string;
  cacheDir: string;
  generatedDir: string;
  exportsDir: string;
  jobsDir: string;
  uploadsDir: string;
  metadataPath: string;
}

export interface WorkspaceSummary {
  name: string;
  path: string;
  createdAt: string;
}

export function getWorkspaceRoot(rootDir = process.cwd()): string {
  return path.resolve(rootDir, ".speclens-workspace");
}

export function createWorkspace(options: WorkspaceOptions = {}): WorkspaceHandle {
  const rootDir = options.rootDir ?? process.cwd();
  const name = options.name ?? "default";
  const workspaceRoot = options.workspaceRoot
    ? path.resolve(rootDir, options.workspaceRoot)
    : getWorkspaceRoot(rootDir);
  const workspaceDir = path.join(workspaceRoot, "workspaces", name);

  const handle: WorkspaceHandle = {
    name,
    rootDir,
    workspaceRoot,
    workspaceDir,
    runsDir: path.join(workspaceDir, "runs"),
    cacheDir: path.join(workspaceDir, "cache"),
    generatedDir: path.join(workspaceDir, "generated"),
    exportsDir: path.join(workspaceDir, "exports"),
    jobsDir: path.join(workspaceDir, "jobs"),
    uploadsDir: path.join(workspaceDir, "uploads"),
    metadataPath: path.join(workspaceDir, "workspace.json"),
  };

  ensureDir(handle.runsDir);
  ensureDir(handle.cacheDir);
  ensureDir(handle.generatedDir);
  ensureDir(handle.exportsDir);
  ensureDir(handle.jobsDir);
  ensureDir(handle.uploadsDir);

  if (!fs.existsSync(handle.metadataPath)) {
    writeJsonFile(handle.metadataPath, {
      id: createId("workspace", `${name}:${rootDir}`),
      name,
      createdAt: nowIso(),
    });
  }

  return handle;
}

export function listWorkspaces(options: WorkspaceOptions = {}): WorkspaceSummary[] {
  const rootDir = options.rootDir ?? process.cwd();
  const workspaceRoot = options.workspaceRoot
    ? path.resolve(rootDir, options.workspaceRoot)
    : getWorkspaceRoot(rootDir);
  const workspacesDir = path.join(workspaceRoot, "workspaces");
  if (!fs.existsSync(workspacesDir)) return [];

  return fs.readdirSync(workspacesDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const metadata = loadJsonIfExists<{ createdAt: string }>(
        path.join(workspacesDir, entry.name, "workspace.json"),
        { createdAt: nowIso() },
      );
      return {
        name: entry.name,
        path: path.join(workspacesDir, entry.name),
        createdAt: metadata.createdAt,
      };
    });
}

export function listRunEnvelopes(options: WorkspaceOptions = {}): JobEnvelope[] {
  const workspace = createWorkspace(options);
  const runDirs = fs.existsSync(workspace.runsDir)
    ? fs.readdirSync(workspace.runsDir, { withFileTypes: true }).filter(entry => entry.isDirectory())
    : [];

  return runDirs
    .map(entry => loadJsonIfExists<JobEnvelope | null>(path.join(workspace.runsDir, entry.name, "run.json"), null))
    .filter((value): value is JobEnvelope => value !== null);
}

export function getRunEnvelope(runId: string, options: WorkspaceOptions = {}): JobEnvelope {
  const workspace = createWorkspace(options);
  const envelope = loadJsonIfExists<JobEnvelope | null>(path.join(workspace.runsDir, runId, "run.json"), null);
  if (!envelope) {
    throw new Error(`Run not found: ${runId}`);
  }
  return envelope;
}
