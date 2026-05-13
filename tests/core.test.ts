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

test("core license policy loads from the analyzed repo root", async () => {
  const rootDir = makeTempRoot("speclens-license-policy-");
  const repoPath = createCommittedGitFixture(fixturePath, "speclens-license-policy-fixture-");
  const policyDir = path.join(repoPath, "policies");
  fs.mkdirSync(policyDir, { recursive: true });
  fs.copyFileSync(
    path.join(process.cwd(), "policies", "license-policy.json"),
    path.join(policyDir, "license-policy.json"),
  );

  const run = await analyzeRepo({
    workspace: { rootDir, name: "license-policy" },
    repoPath,
    mode: "hosted",
    roles: ["license-policy"],
  });

  assert.ok(run.report);
  const licenseSection = run.report?.sections.find(section => section.title === "License policy review");
  assert.ok(licenseSection);
  const records = (licenseSection.data as { records?: Array<{ name?: string; classification?: string }> }).records ?? [];
  assert.equal(records.some(record => record.name === "@tagtwo/blocked-lib" && record.classification === "block"), true);
  assert.equal(run.report?.findings.some(finding => finding.title === "Blocked licenses detected"), true);
});

test("core license policy treats nested fixtures as reference-only", async () => {
  const rootDir = makeTempRoot("speclens-license-reference-workspace-");
  const sourceDir = makeTempRoot("speclens-license-reference-source-");
  fs.writeFileSync(
    path.join(sourceDir, "package.json"),
    JSON.stringify({ name: "active-product", private: true, license: "MIT" }, null, 2),
    "utf8",
  );
  const policyDir = path.join(sourceDir, "policies");
  fs.mkdirSync(policyDir, { recursive: true });
  fs.copyFileSync(
    path.join(process.cwd(), "policies", "license-policy.json"),
    path.join(policyDir, "license-policy.json"),
  );
  const fixtureDir = path.join(sourceDir, "fixtures", "license-case");
  fs.mkdirSync(fixtureDir, { recursive: true });
  fs.writeFileSync(
    path.join(fixtureDir, "package.json"),
    JSON.stringify({ name: "fixture-blocked-license", license: "SSPL-1.0" }, null, 2),
    "utf8",
  );
  const repoPath = createCommittedGitFixture(sourceDir, "speclens-license-reference-repo-");

  const run = await analyzeRepo({
    workspace: { rootDir, name: "license-reference" },
    repoPath,
    mode: "hosted",
    roles: ["license-policy"],
  });

  assert.ok(run.report);
  assert.equal(run.report?.findings.some(finding => finding.title === "Blocked licenses detected"), false);
  const licenseSection = run.report?.sections.find(section => section.title === "License policy review");
  assert.ok(licenseSection);
  const records = (licenseSection.data as { records?: Array<{ path?: string; classification?: string; policyScope?: string }> }).records ?? [];
  assert.equal(
    records.some(record =>
      record.path === "fixtures/license-case/package.json"
      && record.classification === "reference"
      && record.policyScope === "reference"),
    true,
  );
});

test("core component inventory detects active exported TSX components", async () => {
  const rootDir = makeTempRoot("speclens-component-inventory-workspace-");
  const sourceDir = makeTempRoot("speclens-component-inventory-source-");
  fs.writeFileSync(
    path.join(sourceDir, "package.json"),
    JSON.stringify({ name: "component-inventory-fixture", private: true }, null, 2),
    "utf8",
  );
  const componentDir = path.join(sourceDir, "apps", "web", "components");
  fs.mkdirSync(componentDir, { recursive: true });
  fs.writeFileSync(
    path.join(componentDir, "portal-actions.tsx"),
    "export function JobLogConsole() { return <section>Console</section>; }\nexport const ReportRemediationForm = () => <form />;\n",
    "utf8",
  );
  const archiveDir = path.join(sourceDir, "archive", "legacy");
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(path.join(archiveDir, "LegacyPanel.tsx"), "export function LegacyPanel() { return null; }\n", "utf8");
  const repoPath = createCommittedGitFixture(sourceDir, "speclens-component-inventory-repo-");

  const run = await analyzeRepo({
    workspace: { rootDir, name: "component-inventory" },
    repoPath,
    mode: "hosted",
    roles: ["component-inventory"],
  });

  assert.ok(run.report);
  const componentSection = run.report?.sections.find(section => section.title === "Component inventory");
  assert.ok(componentSection);
  const data = componentSection.data as { componentCount?: number; uiFileCount?: number; components?: Array<{ path: string }> };
  assert.equal(data.uiFileCount, 1);
  assert.equal(data.componentCount, 1);
  assert.deepEqual(data.components?.map(component => component.path), ["apps/web/components/portal-actions.tsx"]);
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
  assert.equal(
    "capturedStorageStatePath" in (browserSection?.data ?? {}),
    false,
    "Browser reports must not expose raw captured storage-state artifact paths.",
  );
  assert.equal(typeof (browserSection?.data as { authSummaryPath?: unknown }).authSummaryPath, "string");
  assert.equal(
    run.report?.artifacts.some(artifact => artifact.kind === "auth-coverage"),
    true,
    "Browser artifacts should classify redacted auth coverage distinctly.",
  );
  assert.equal(
    run.report?.artifacts.some(artifact => artifact.key.includes("storage-state")),
    false,
    "Browser artifacts must not persist raw Playwright storage-state JSON.",
  );
  const interactionSection = run.report?.sections.find(section => section.roleId === "interaction-test");
  assert.ok(interactionSection);
  const visualSection = run.report?.sections.find(section => section.roleId === "visual-inspection");
  assert.ok(visualSection);
});
