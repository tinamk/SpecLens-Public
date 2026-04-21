import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { Source } from "@speclens/contracts";
import { createId, ensureDir, isGitLocation, slugify } from "./utils";
import type { WorkspaceHandle } from "./workspace";

export interface SourceDescriptor {
  type?: "git";
  location: string;
  ref?: string;
  depth?: number;
}

export interface AcquiredSource {
  sourceId: string;
  type: "git";
  location: string;
  repoPath: string;
}

async function runGit(args: string[], cwd?: string): Promise<void> {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  const child = spawn("git", args, {
    cwd: cwd ?? os.tmpdir(),
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
    child.once("error", reject);
    child.once("close", status => {
      if (status !== 0) {
        reject(new Error(
          Buffer.concat(stderr).toString("utf8").trim()
          || Buffer.concat(stdout).toString("utf8").trim()
          || `git ${args.join(" ")} failed`,
        ));
        return;
      }
      resolve();
    });
  });
}

export async function acquireSource(source: SourceDescriptor, workspace: WorkspaceHandle): Promise<AcquiredSource> {
  if (!isGitLocation(source.location)) {
    throw new Error("Hosted source descriptors must be Git locations. Use repoPath for local repository analysis.");
  }

  const checkoutSeed = `${source.location}:${source.ref ?? "HEAD"}:${source.depth ?? "full"}`;
  const checkoutDir = path.join(workspace.cacheDir, `${slugify(path.basename(source.location.replace(/\.git$/i, "")))}-${createId("git", checkoutSeed).slice(-6)}`);
  ensureDir(workspace.cacheDir);

  if (!fs.existsSync(path.join(checkoutDir, ".git"))) {
    const args = ["clone"];
    if (source.depth) args.push("--depth", String(source.depth));
    args.push(source.location, checkoutDir);
    await runGit(args);
  } else {
    await runGit(["fetch", "--all", "--prune", "--tags"], checkoutDir);
  }

  if (source.ref) {
    await runGit(["checkout", "--force", source.ref], checkoutDir);
  }

  return {
    sourceId: createId("src", `git:${source.location}:${source.ref ?? "HEAD"}`),
    type: "git",
    location: source.location,
    repoPath: checkoutDir,
  };
}

export function asHostedSource(source: AcquiredSource, workspaceId: string): Source {
  const normalizedLocation = source.location.replace(/\/+$/g, "").replace(/\.git$/i, "");
  return {
    id: source.sourceId,
    workspaceId,
    type: "git-public",
    displayName: path.basename(normalizedLocation) || path.basename(source.repoPath),
    location: source.location,
    visibility: "public",
    verificationStatus: "verified",
    verificationError: null,
    githubInstallationId: null,
    uploadObjectKey: null,
    createdAt: new Date().toISOString(),
  };
}
