import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const scriptPath = path.join(process.cwd(), "scripts", "ops", "build-release-archive.sh");

function runGit(repoPath: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd: repoPath,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "SpecLens Tests",
      GIT_AUTHOR_EMAIL: "tests@speclens.dev",
      GIT_COMMITTER_NAME: "SpecLens Tests",
      GIT_COMMITTER_EMAIL: "tests@speclens.dev",
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function createTempRepo(): { repoPath: string; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "speclens-release-archive-"));
  const repoPath = path.join(root, "repo");
  fs.mkdirSync(repoPath, { recursive: true });
  runGit(repoPath, ["init", "--quiet"]);
  runGit(repoPath, ["config", "user.name", "SpecLens Tests"]);
  runGit(repoPath, ["config", "user.email", "tests@speclens.dev"]);
  return {
    repoPath,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function runArchiveBuilder(repoPath: string, archivePath: string) {
  return spawnSync("bash", [scriptPath, repoPath, archivePath], {
    encoding: "utf8",
  });
}

test("deploy archive builder packages committed HEAD content from a clean repo", async t => {
  const { repoPath, cleanup } = createTempRepo();
  t.after(cleanup);

  fs.writeFileSync(path.join(repoPath, "tracked.txt"), "committed\n", "utf8");
  runGit(repoPath, ["add", "tracked.txt"]);
  runGit(repoPath, ["commit", "--quiet", "-m", "initial"]);

  const archivePath = path.join(repoPath, "..", "release.tar.gz");
  const result = runArchiveBuilder(repoPath, archivePath);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const extracted = spawnSync("tar", ["-xOzf", archivePath, "tracked.txt"], {
    encoding: "utf8",
  });
  assert.equal(extracted.status, 0, extracted.stderr || extracted.stdout);
  assert.equal(extracted.stdout, "committed\n");
});

test("deploy archive builder refuses dirty tracked changes instead of packaging them", t => {
  const { repoPath, cleanup } = createTempRepo();
  t.after(cleanup);

  fs.writeFileSync(path.join(repoPath, "tracked.txt"), "committed\n", "utf8");
  runGit(repoPath, ["add", "tracked.txt"]);
  runGit(repoPath, ["commit", "--quiet", "-m", "initial"]);
  fs.writeFileSync(path.join(repoPath, "tracked.txt"), "dirty working tree\n", "utf8");

  const archivePath = path.join(repoPath, "..", "release.tar.gz");
  const result = runArchiveBuilder(repoPath, archivePath);
  assert.notEqual(result.status, 0);
  assert.equal(result.stderr.includes("dirty repo"), true, result.stderr);
  assert.equal(result.stderr.includes("tracked.txt"), true, result.stderr);
  assert.equal(fs.existsSync(archivePath), false);
});

test("deploy archive builder refuses untracked files that would otherwise leak into releases", t => {
  const { repoPath, cleanup } = createTempRepo();
  t.after(cleanup);

  fs.writeFileSync(path.join(repoPath, "tracked.txt"), "committed\n", "utf8");
  runGit(repoPath, ["add", "tracked.txt"]);
  runGit(repoPath, ["commit", "--quiet", "-m", "initial"]);
  fs.writeFileSync(path.join(repoPath, "scratch.txt"), "should not deploy\n", "utf8");

  const archivePath = path.join(repoPath, "..", "release.tar.gz");
  const result = runArchiveBuilder(repoPath, archivePath);
  assert.notEqual(result.status, 0);
  assert.equal(result.stderr.includes("scratch.txt"), true, result.stderr);
  assert.equal(fs.existsSync(archivePath), false);
});
