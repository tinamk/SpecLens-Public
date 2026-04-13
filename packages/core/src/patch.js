import fs from "node:fs";
import path from "node:path";
import { ensureDir, ensureParentDir, loadJsonIfExists, nowIso, readJsonFile, writeJsonFile, writeTextFile } from "./utils.js";
import { createWorkspace, getRun } from "./workspace.js";

function normalizeSelection(selection, run) {
  const requestedIds = Array.isArray(selection?.findingIds)
    ? new Set(selection.findingIds)
    : null;

  return run.findings.filter(finding =>
    finding.patch
    && (!requestedIds || requestedIds.has(finding.id))
  );
}

function applyPackageJsonFieldPatch(filePath, patch) {
  const current = readJsonFile(filePath);
  const next = { ...current, [patch.field]: patch.value };
  return {
    originalText: `${JSON.stringify(current, null, 2)}\n`,
    nextText: `${JSON.stringify(next, null, 2)}\n`,
    nextJson: next,
  };
}

function createUnifiedDiff(relativePath, originalText, nextText) {
  const originalLines = originalText.split("\n");
  const nextLines = nextText.split("\n");
  return [
    `--- a/${relativePath}`,
    `+++ b/${relativePath}`,
    `@@ -1,${originalLines.length} +1,${nextLines.length} @@`,
    ...originalLines.map(line => `-${line}`),
    ...nextLines.map(line => `+${line}`),
  ].join("\n");
}

export function exportPatch(runId, selection = {}, options = {}) {
  const workspace = createWorkspace(options);
  const run = getRun(runId, { rootDir: workspace.rootDir, name: workspace.name, workspaceRoot: workspace.workspaceRoot });
  const findings = normalizeSelection(selection, run);

  if (findings.length === 0) {
    throw new Error(`Run ${runId} does not contain any exportable patch findings for the requested selection.`);
  }

  const exportId = `${runId}-${nowIso().slice(0, 19).replace(/[:T]/g, "-")}`;
  const exportDir = path.join(workspace.exportsDir, "patches", exportId);
  ensureDir(exportDir);

  const operations = [];

  for (const finding of findings) {
    const patch = finding.patch;
    const absoluteFilePath = path.join(run.source.repoPath, patch.relativePath);

    if (patch.kind === "set-package-json-field") {
      const { originalText, nextText, nextJson } = applyPackageJsonFieldPatch(absoluteFilePath, patch);
      const patchFileName = `${path.basename(patch.relativePath)}.${finding.id}.patch`;
      const patchFilePath = path.join(exportDir, patchFileName);
      writeTextFile(patchFilePath, createUnifiedDiff(patch.relativePath, originalText, nextText));
      operations.push({
        findingId: finding.id,
        description: patch.description,
        kind: patch.kind,
        relativePath: patch.relativePath,
        field: patch.field,
        value: patch.value,
        patchFile: patchFileName,
        preview: nextJson,
      });
      continue;
    }

    throw new Error(`Unsupported patch kind: ${patch.kind}`);
  }

  const bundle = {
    exportId,
    runId,
    workspace: workspace.name,
    createdAt: nowIso(),
    targetRepoPath: run.source.repoPath,
    operations,
  };

  const bundlePath = path.join(exportDir, "patch-bundle.json");
  const readmePath = path.join(exportDir, "README.md");
  writeJsonFile(bundlePath, bundle);
  writeTextFile(readmePath, [
    `# Patch Export ${exportId}`,
    "",
    `Run: \`${runId}\``,
    `Workspace: \`${workspace.name}\``,
    "",
    "This bundle is exported by SpecLens and is safe to review before any target-repo mutation.",
    "",
    "## Operations",
    "",
    ...operations.map(operation => `- \`${operation.findingId}\`: ${operation.description} -> \`${operation.patchFile}\``),
  ].join("\n"));

  const updatedRun = {
    ...run,
    exports: [...(run.exports ?? []), {
      exportId,
      kind: "patch-bundle",
      createdAt: bundle.createdAt,
      path: bundlePath,
    }],
  };
  writeJsonFile(path.join(path.dirname(run.runFile), "run.json"), updatedRun);

  return {
    exportId,
    exportDir,
    bundlePath,
    readmePath,
    operations,
  };
}
