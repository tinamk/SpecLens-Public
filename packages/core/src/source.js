import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { isGitLikeLocation, nowIso, relativeFrom, slugify } from "./utils.js";
import { createWorkspace, getRegisteredSource, makeSourceId, registerSource } from "./workspace.js";

function runGit(args, cwd = undefined) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `git ${args.join(" ")} failed`);
  }

  return result.stdout.trim();
}

function inferSourceType(source) {
  if (source.type) return source.type;
  if (isGitLikeLocation(source.location)) return "git";
  return "path";
}

function normalizeSourceInput(source) {
  if (typeof source === "string") {
    return { type: undefined, location: source };
  }
  if (!source || !source.location) {
    throw new Error("analyzeRepo requires a source with a location.");
  }
  return source;
}

function acquirePathSource(source, workspace) {
  const absolutePath = path.resolve(workspace.rootDir, source.location);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isDirectory()) {
    throw new Error(`Local source path not found: ${absolutePath}`);
  }

  const sourceId = makeSourceId("path", fs.realpathSync(absolutePath));
  const record = registerSource(workspace, {
    id: sourceId,
    type: "path",
    alias: source.alias ?? null,
    location: source.location,
    resolvedPath: absolutePath,
  });

  return {
    ...record,
    sourceId,
    repoPath: absolutePath,
  };
}

function acquireGitSource(source, workspace) {
  const sourceId = makeSourceId("git", `${source.location}#${source.ref ?? "HEAD"}`);
  const checkoutDir = path.join(
    workspace.cacheDir,
    "git",
    `${slugify(path.basename(source.location.replace(/\.git$/i, "")))}-${sourceId.slice(-6)}`,
  );

  if (!fs.existsSync(path.join(checkoutDir, ".git"))) {
    const cloneArgs = ["clone"];
    if (source.depth) cloneArgs.push("--depth", String(source.depth));
    cloneArgs.push(source.location, checkoutDir);
    runGit(cloneArgs);
  } else {
    runGit(["fetch", "--all", "--tags", "--prune"], checkoutDir);
  }

  if (source.ref) {
    runGit(["checkout", "--force", source.ref], checkoutDir);
  } else {
    runGit(["checkout", "--force", "HEAD"], checkoutDir);
  }

  const record = registerSource(workspace, {
    id: sourceId,
    type: "git",
    alias: source.alias ?? null,
    location: source.location,
    ref: source.ref ?? null,
    depth: source.depth ?? null,
    resolvedPath: checkoutDir,
    cachePath: relativeFrom(workspace.workspaceDir, checkoutDir),
    acquiredAt: nowIso(),
  });

  return {
    ...record,
    sourceId,
    repoPath: checkoutDir,
  };
}

function acquireWorkspaceSource(source, workspace) {
  const record = getRegisteredSource(workspace, source.location);
  if (!record) {
    throw new Error(`Workspace source not found: ${source.location}`);
  }
  if (!record.resolvedPath || !fs.existsSync(record.resolvedPath)) {
    throw new Error(`Workspace source is no longer available on disk: ${source.location}`);
  }
  return {
    ...record,
    sourceId: record.id,
    repoPath: record.resolvedPath,
  };
}

export function acquireSource(sourceInput, options = {}) {
  const workspace = createWorkspace(options);
  const source = normalizeSourceInput(sourceInput);
  const type = inferSourceType(source);

  if (type === "path") {
    return acquirePathSource({ ...source, type }, workspace);
  }
  if (type === "git") {
    return acquireGitSource({ ...source, type }, workspace);
  }
  if (type === "workspace") {
    return acquireWorkspaceSource({ ...source, type }, workspace);
  }

  throw new Error(`Unsupported source type: ${type}`);
}
