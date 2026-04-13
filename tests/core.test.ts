import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { analyzeRepo, exportPatch, getRun, listCapabilities, listPresets, listRuns } from "@speclens/core";

const fixturePath = path.join(process.cwd(), "fixtures", "tagtwo-mini");
const browserFixturePath = path.join(process.cwd(), "fixtures", "browser-parity-app");

function makeTempRoot(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("core analyzeRepo writes hosted artifacts and keeps runs queryable", async () => {
  const rootDir = makeTempRoot("speclens-core-");
  const workspaceName = "hosted-core";

  const run = await analyzeRepo({
    workspace: { rootDir, name: workspaceName },
    source: { type: "path", location: fixturePath },
    mode: "hosted",
  });

  assert.equal(run.job.status, "succeeded");
  assert.ok(run.report);
  assert.equal(run.report?.workspaceId, run.job.workspaceId);
  assert.equal(run.report?.preset, "node-repo");
  assert.equal(run.report?.runtimeMode, "static");
  assert.equal(run.report?.sections.length > 0, true);
  assert.equal((run.report?.artifacts.length ?? 0) > 0, true);
  assert.equal(run.job.capabilities.includes("repo-inventory"), true);

  const savedRun = getRun(run.job.id, { rootDir, name: workspaceName });
  assert.equal(savedRun.job.id, run.job.id);

  const listedRuns = listRuns({ rootDir, name: workspaceName });
  assert.equal(listedRuns.some(item => item.job.id === run.job.id), true);

  const runDir = path.join(rootDir, ".speclens-workspace", "workspaces", workspaceName, "runs", run.job.id);
  assert.equal(fs.existsSync(path.join(runDir, "run.json")), true);
  assert.equal(fs.existsSync(path.join(runDir, "report.json")), true);
  assert.equal(fs.existsSync(path.join(runDir, "report.html")), true);
});

test("core exposes parity presets and capabilities", () => {
  const presets = listPresets();
  const capabilities = listCapabilities();

  assert.equal(presets.some(item => item.id === "tagtwo"), true);
  assert.equal(capabilities.some(item => item.id === "browser-self-check"), true);
  assert.equal(capabilities.some(item => item.id === "chaos-advisor"), true);
});

test("core exportPatch creates a reviewable manifest without mutating the target repo", async () => {
  const rootDir = makeTempRoot("speclens-export-");
  const workspaceName = "hosted-export";
  const before = fs.readFileSync(path.join(fixturePath, "package.json"), "utf8");

  const run = await analyzeRepo({
    workspace: { rootDir, name: workspaceName },
    source: { type: "path", location: fixturePath },
    mode: "hosted",
  });

  const exported = exportPatch(run.job.id, {}, { rootDir, name: workspaceName });
  const after = fs.readFileSync(path.join(fixturePath, "package.json"), "utf8");

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
  const run = await analyzeRepo({
    workspace: { rootDir, name: workspaceName },
    source: { type: "path", location: browserFixturePath },
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
  });

  assert.ok(run.report);
  assert.equal(run.report?.runtimeMode, "browser");
  const browserSection = run.report?.sections.find(section => section.capability === "browser-self-check");
  assert.ok(browserSection);
  assert.equal(browserSection?.status, "ready");
  assert.equal(Array.isArray((browserSection?.data as { pages?: unknown[] }).pages), true);
  const interactionSection = run.report?.sections.find(section => section.capability === "interaction-test");
  assert.ok(interactionSection);
  const visualSection = run.report?.sections.find(section => section.capability === "visual-inspection");
  assert.ok(visualSection);
});
