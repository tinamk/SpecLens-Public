import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createHomeTempDirSync } from "@speclens/core";

function runGit(args: string[], cwd: string): void {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "SpecLens Tests",
      GIT_AUTHOR_EMAIL: "tests@speclens.dev",
      GIT_COMMITTER_NAME: "SpecLens Tests",
      GIT_COMMITTER_EMAIL: "tests@speclens.dev",
    },
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `git ${args.join(" ")} failed`);
  }
}

export function createCommittedGitFixture(sourceDir: string, prefix = "speclens-git-fixture-"): string {
  const tempDir = createHomeTempDirSync(prefix);
  const repoPath = path.join(tempDir, path.basename(sourceDir));
  fs.cpSync(sourceDir, repoPath, { recursive: true });
  runGit(["init", "--quiet"], repoPath);
  runGit(["add", "--all"], repoPath);
  const status = spawnSync("git", ["status", "--porcelain"], { cwd: repoPath, encoding: "utf8" });
  if ((status.stdout ?? "").trim().length > 0) {
    runGit(["commit", "--quiet", "-m", "fixture"], repoPath);
  }
  return repoPath;
}

export function createCommittedGitFixtureInRoot(
  sourceDir: string,
  destinationRoot: string,
  prefix = "speclens-git-fixture-",
): string {
  fs.mkdirSync(destinationRoot, { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(destinationRoot, prefix));
  const repoPath = path.join(tempDir, path.basename(sourceDir));
  fs.cpSync(sourceDir, repoPath, { recursive: true });
  runGit(["init", "--quiet"], repoPath);
  runGit(["add", "--all"], repoPath);
  const status = spawnSync("git", ["status", "--porcelain"], { cwd: repoPath, encoding: "utf8" });
  if ((status.stdout ?? "").trim().length > 0) {
    runGit(["commit", "--quiet", "-m", "fixture"], repoPath);
  }
  return repoPath;
}

export function createCommittedGitArchiveFixture(
  sourceDir: string,
  prefix = "speclens-git-archive-fixture-",
): { repoPath: string; archivePath: string } {
  const repoPath = createCommittedGitFixture(sourceDir, prefix);
  const archivePath = path.join(path.dirname(repoPath), `${path.basename(sourceDir)}.tar.gz`);
  const result = spawnSync("tar", ["-czf", archivePath, "-C", repoPath, "."], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "Failed to create Git archive fixture.");
  }
  return { repoPath, archivePath };
}

export function toFileGitUrl(repoPath: string): string {
  return pathToFileURL(repoPath).toString();
}
