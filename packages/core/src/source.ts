import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { Source } from "@speclens/contracts";
import { createId, ensureDir, isGitLocation, slugify } from "./utils";
import type { WorkspaceHandle } from "./workspace";

export interface SourceDescriptor {
  type?: "path" | "git" | "workspace";
  location: string;
  ref?: string;
  depth?: number;
}

export interface AcquiredSource {
  sourceId: string;
  type: "path" | "git" | "workspace";
  location: string;
  repoPath: string;
}

function runGit(args: string[], cwd?: string): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `git ${args.join(" ")} failed`);
  }
}

function inferSourceType(source: SourceDescriptor): "path" | "git" | "workspace" {
  if (source.type) return source.type;
  return isGitLocation(source.location) ? "git" : "path";
}

export function acquireSource(source: SourceDescriptor, workspace: WorkspaceHandle): AcquiredSource {
  const type = inferSourceType(source);

  if (type === "path") {
    const repoPath = path.resolve(workspace.rootDir, source.location);
    if (!fs.existsSync(repoPath)) throw new Error(`Path source not found: ${repoPath}`);
    return {
      sourceId: createId("src", `path:${repoPath}`),
      type,
      location: source.location,
      repoPath,
    };
  }

  if (type === "workspace") {
    const repoPath = path.resolve(workspace.uploadsDir, source.location);
    if (!fs.existsSync(repoPath)) throw new Error(`Workspace source not found: ${repoPath}`);
    return {
      sourceId: createId("src", `workspace:${repoPath}`),
      type,
      location: source.location,
      repoPath,
    };
  }

  const checkoutDir = path.join(workspace.cacheDir, `${slugify(path.basename(source.location.replace(/\.git$/i, "")))}-${createId("git", source.location).slice(-6)}`);
  ensureDir(workspace.cacheDir);

  if (!fs.existsSync(path.join(checkoutDir, ".git"))) {
    const args = ["clone"];
    if (source.depth) args.push("--depth", String(source.depth));
    args.push(source.location, checkoutDir);
    runGit(args);
  } else {
    runGit(["fetch", "--all", "--prune", "--tags"], checkoutDir);
  }

  if (source.ref) {
    runGit(["checkout", "--force", source.ref], checkoutDir);
  }

  return {
    sourceId: createId("src", `git:${source.location}:${source.ref ?? "HEAD"}`),
    type,
    location: source.location,
    repoPath: checkoutDir,
  };
}

export function asHostedSource(source: AcquiredSource, workspaceId: string): Source {
  return {
    id: source.sourceId,
    workspaceId,
    type: source.type === "git" ? "github-public" : source.type === "workspace" ? "upload-archive" : "workspace",
    displayName: path.basename(source.repoPath),
    location: source.location,
    visibility: source.type === "git" ? "public" : "private",
    githubInstallationId: null,
    uploadObjectKey: null,
    createdAt: new Date().toISOString(),
  };
}
