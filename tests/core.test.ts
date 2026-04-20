import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  analyzeRepo,
  createHomeTempDirSync,
  exportPatch,
  getRun,
  inspectGitRepositoryArchiveFileAsync,
  inspectGitRepositoryPathAsync,
  listPresets,
  listRuns,
} from "@speclens/core";
import { createCommittedGitArchiveFixture, createCommittedGitFixture } from "./helpers/git-fixtures";

const fixturePath = path.join(process.cwd(), "fixtures", "tagtwo-mini");
const browserFixturePath = path.join(process.cwd(), "fixtures", "browser-parity-app");

function makeTempRoot(prefix: string): string {
  return createHomeTempDirSync(prefix);
}

function createTarArchive(sourceDir: string, prefix: string): string {
  const tempDir = makeTempRoot(prefix);
  const archivePath = path.join(tempDir, `${path.basename(sourceDir)}.tar.gz`);
  const result = spawnSync("tar", ["-czf", archivePath, "-C", sourceDir, "."], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr.trim() || result.stdout.trim());
  return archivePath;
}

function createMixedGitArchive(sourceDir: string, prefix: string): string {
  const tempDir = makeTempRoot(prefix);
  const repoRoot = createCommittedGitFixture(sourceDir, `${prefix}repo-`);
  const archiveRoot = path.join(tempDir, "archive-root");
  const repoDir = path.join(archiveRoot, "repo");
  fs.mkdirSync(archiveRoot, { recursive: true });
  fs.cpSync(repoRoot, repoDir, { recursive: true });
  fs.writeFileSync(path.join(archiveRoot, "README.txt"), "extra top-level file\n", "utf8");
  const archivePath = path.join(tempDir, "mixed-repo.tar.gz");
  const result = spawnSync("tar", ["-czf", archivePath, "-C", archiveRoot, "."], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr.trim() || result.stdout.trim());
  return archivePath;
}

function createSymlinkGitArchive(sourceDir: string, prefix: string): string {
  const tempDir = makeTempRoot(prefix);
  const repoRoot = createCommittedGitFixture(sourceDir, `${prefix}repo-`);
  fs.symlinkSync("../outside", path.join(repoRoot, "evil-link"));
  const archivePath = path.join(tempDir, "symlink-repo.tar.gz");
  const result = spawnSync("tar", ["-czf", archivePath, "-C", repoRoot, "."], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr.trim() || result.stdout.trim());
  return archivePath;
}

function createHardlinkGitArchive(sourceDir: string, prefix: string): string {
  const tempDir = makeTempRoot(prefix);
  const repoRoot = createCommittedGitFixture(sourceDir, `${prefix}repo-`);
  fs.linkSync(path.join(repoRoot, "package.json"), path.join(repoRoot, "package-hardlink.json"));
  const archivePath = path.join(tempDir, "hardlink-repo.tar.gz");
  const result = spawnSync("tar", ["-czf", archivePath, "-C", repoRoot, "."], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr.trim() || result.stdout.trim());
  return archivePath;
}

function createTraversalGitArchive(sourceDir: string, prefix: string): string {
  const tempDir = makeTempRoot(prefix);
  const repoRoot = createCommittedGitFixture(sourceDir, `${prefix}repo-`);
  const archivePath = path.join(tempDir, "traversal-repo.tar.gz");
  const result = spawnSync(
    "tar",
    ["-czf", archivePath, "--transform", "s|^./package.json$|../escape.txt|", "-C", repoRoot, "."],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr.trim() || result.stdout.trim());
  return archivePath;
}

function createAbsolutePathGitArchive(sourceDir: string, prefix: string): string {
  const tempDir = makeTempRoot(prefix);
  const repoRoot = createCommittedGitFixture(sourceDir, `${prefix}repo-`);
  const archivePath = path.join(tempDir, "absolute-repo.tar.gz");
  const result = spawnSync(
    "tar",
    ["-czf", archivePath, "--transform", "s|^./package.json$|/absolute.txt|", "-C", repoRoot, "."],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr.trim() || result.stdout.trim());
  return archivePath;
}

test("core source tree does not contain stale generated js siblings", () => {
  const sourceRoot = path.join(process.cwd(), "packages", "core", "src");
  const staleJsFiles: string[] = [];

  const visit = (dirPath: string) => {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".js")) {
        staleJsFiles.push(path.relative(sourceRoot, fullPath));
      }
    }
  };

  visit(sourceRoot);
  assert.deepEqual(staleJsFiles, []);
});

test("core Git source validation accepts repository roots and rejects plain directories", async () => {
  const repoPath = createCommittedGitFixture(browserFixturePath, "speclens-core-git-fixture-");
  assert.equal((await inspectGitRepositoryPathAsync(repoPath)).ok, true);
  assert.equal((await inspectGitRepositoryPathAsync(browserFixturePath)).ok, false);
});

test("core archive validation accepts Git repository archives and rejects plain source bundles", async () => {
  const gitArchivePath = createCommittedGitArchiveFixture(browserFixturePath, "speclens-core-git-archive-").archivePath;
  const plainArchivePath = createTarArchive(browserFixturePath, "speclens-core-plain-archive-");
  assert.equal((await inspectGitRepositoryArchiveFileAsync(gitArchivePath)).ok, true);
  assert.equal((await inspectGitRepositoryArchiveFileAsync(plainArchivePath)).ok, false);
});

test("core archive validation rejects mixed top-level layouts that do not unpack to a repo root", async () => {
  const mixedArchivePath = createMixedGitArchive(browserFixturePath, "speclens-core-mixed-archive-");
  const inspection = await inspectGitRepositoryArchiveFileAsync(mixedArchivePath);
  assert.equal(inspection.ok, false);
  if (!inspection.ok) {
    assert.match(inspection.message, /single top-level directory containing the repository root/i);
  }
});

test("core archive validation rejects repository archives with symbolic links", async () => {
  const archivePath = createSymlinkGitArchive(browserFixturePath, "speclens-core-symlink-archive-");
  const inspection = await inspectGitRepositoryArchiveFileAsync(archivePath);
  assert.equal(inspection.ok, false);
  if (!inspection.ok) {
    assert.match(inspection.message, /symbolic links or hard links/i);
  }
});

test("core archive validation rejects repository archives with hard links", async () => {
  const archivePath = createHardlinkGitArchive(browserFixturePath, "speclens-core-hardlink-archive-");
  const inspection = await inspectGitRepositoryArchiveFileAsync(archivePath);
  assert.equal(inspection.ok, false);
  if (!inspection.ok) {
    assert.match(inspection.message, /symbolic links or hard links/i);
  }
});

test("core archive validation rejects repository archives with traversal paths", async () => {
  const archivePath = createTraversalGitArchive(browserFixturePath, "speclens-core-traversal-archive-");
  const inspection = await inspectGitRepositoryArchiveFileAsync(archivePath);
  assert.equal(inspection.ok, false);
  if (!inspection.ok) {
    assert.match(inspection.message, /traversal paths/i);
  }
});

test("core archive validation rejects repository archives with absolute paths", async () => {
  const archivePath = createAbsolutePathGitArchive(browserFixturePath, "speclens-core-absolute-archive-");
  const inspection = await inspectGitRepositoryArchiveFileAsync(archivePath);
  assert.equal(inspection.ok, false);
  if (!inspection.ok) {
    assert.match(inspection.message, /absolute paths/i);
  }
});

test("core analyzeRepo writes hosted artifacts and keeps runs queryable", async () => {
  const rootDir = makeTempRoot("speclens-core-");
  const workspaceName = "hosted-core";
  const repoPath = createCommittedGitFixture(fixturePath, "speclens-core-analysis-");

  const run = await analyzeRepo({
    workspace: { rootDir, name: workspaceName },
    repoPath,
    mode: "hosted",
  });

  assert.equal(run.job.status, "succeeded");
  assert.ok(run.report);
  assert.equal(run.report?.workspaceId, run.job.workspaceId);
  assert.equal(run.report?.runtimeMode, "static");
  assert.equal(run.report?.sections.length > 0, true);
  assert.equal((run.report?.artifacts.length ?? 0) > 0, true);
  assert.equal(run.job.roles.includes("repo-inventory"), true);

  const savedRun = getRun(run.job.id, { rootDir, name: workspaceName });
  assert.equal(savedRun.job.id, run.job.id);

  const listedRuns = listRuns({ rootDir, name: workspaceName });
  assert.equal(listedRuns.some(item => item.job.id === run.job.id), true);

  const runDir = path.join(rootDir, ".speclens-workspace", "workspaces", workspaceName, "runs", run.job.id);
  assert.equal(fs.existsSync(path.join(runDir, "run.json")), true);
  assert.equal(fs.existsSync(path.join(runDir, "report.json")), true);
  assert.equal(fs.existsSync(path.join(runDir, "report.html")), true);
});

test("core exposes parity presets", () => {
  const presets = listPresets();

  assert.equal(presets.some(item => item.id === "tagtwo"), true);
});

test("core exportPatch creates a reviewable manifest without mutating the target repo", async () => {
  const rootDir = makeTempRoot("speclens-export-");
  const workspaceName = "hosted-export";
  const repoPath = createCommittedGitFixture(fixturePath, "speclens-export-fixture-");
  const before = fs.readFileSync(path.join(repoPath, "package.json"), "utf8");

  const run = await analyzeRepo({
    workspace: { rootDir, name: workspaceName },
    repoPath,
    mode: "hosted",
  });

  const exported = exportPatch(run.job.id, {}, { rootDir, name: workspaceName });
  const after = fs.readFileSync(path.join(repoPath, "package.json"), "utf8");

  assert.equal(before, after);
  assert.equal(fs.existsSync(exported.bundlePath), true);
  assert.equal(fs.existsSync(exported.readmePath), true);
  assert.equal(exported.operations.length > 0, true);
});

test("core can execute browser parity analysis against a bootable fixture app", async t => {
  let playwrightAvailable = true;
  try {
    const playwright = await import("@playwright/test");
    const browser = await playwright.chromium.launch({ headless: true });
    await browser.close();
  } catch {
    playwrightAvailable = false;
  }

  if (!playwrightAvailable) {
    t.skip("Playwright browser runtime is not available in this environment.");
    return;
  }

  const rootDir = makeTempRoot("speclens-browser-");
  const workspaceName = "browser-parity";
  const repoPath = createCommittedGitFixture(browserFixturePath, "speclens-browser-fixture-");
  const run = await analyzeRepo({
    workspace: { rootDir, name: workspaceName },
    repoPath,
    preset: "tagtwo",
    secretRefs: ["secret_demo"],
    secrets: [
      {
        id: "secret_demo",
        kind: "credential-pair",
        value: JSON.stringify({ username: "demo", password: "secret" }),
      },
    ],
    mode: "hosted",
    allowHostExecution: true,
  });

  assert.ok(run.report);
  assert.equal(run.report?.runtimeMode, "browser");
  const browserSection = run.report?.sections.find(section => section.roleId === "browser-self-check");
  assert.ok(browserSection);
  assert.equal(browserSection?.status, "ready");
  assert.equal(Array.isArray((browserSection?.data as { pages?: unknown[] }).pages), true);
  const interactionSection = run.report?.sections.find(section => section.roleId === "interaction-test");
  assert.ok(interactionSection);
  const visualSection = run.report?.sections.find(section => section.roleId === "visual-inspection");
  assert.ok(visualSection);
});
