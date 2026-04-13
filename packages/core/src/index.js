import path from "node:path";
import { acquireSource } from "./source.js";
import { buildRepoInventory } from "./inventory.js";
import { createGeneratedSpecPack } from "./generated-spec-pack.js";
import { runGenericBaseline } from "./analyzers/generic.js";
import { runNodeNpmBaseline } from "./analyzers/node-npm.js";
import { createWorkspace, getRun, listRuns, listWorkspaces } from "./workspace.js";
import { exportPatch } from "./patch.js";
import { ensureDir, makeRunId, nowIso, writeJsonFile } from "./utils.js";
import { writeRunArtifacts } from "./reporting.js";

const PRESETS = {
  auto: {
    id: "auto",
    description: "Chooses the generic baseline, then adds stronger built-in checks for detected repo ecosystems.",
  },
  "generic-baseline": {
    id: "generic-baseline",
    description: "Repo-agnostic metadata and documentation checks.",
    analyzers: ["generic-baseline"],
  },
  "node-npm-baseline": {
    id: "node-npm-baseline",
    description: "JS/npm-flavoured checks for root package metadata, scripts, and lockfiles.",
    analyzers: ["generic-baseline", "node-npm-baseline"],
  },
};

function resolvePresetPlan(preset, inventory) {
  if (!preset || preset === "auto") {
    return inventory.classification.kind === "node-npm"
      ? PRESETS["node-npm-baseline"]
      : PRESETS["generic-baseline"];
  }

  if (Array.isArray(preset)) {
    return {
      id: "custom",
      description: "Custom analyzer composition.",
      analyzers: preset,
    };
  }

  if (PRESETS[preset]) return PRESETS[preset];
  return {
    id: String(preset),
    description: "Custom analyzer composition.",
    analyzers: [String(preset)],
  };
}

function runAnalyzers(plan, inventory) {
  const findings = [];

  for (const analyzer of plan.analyzers ?? []) {
    if (analyzer === "generic-baseline") {
      findings.push(...runGenericBaseline(inventory));
      continue;
    }
    if (analyzer === "node-npm-baseline") {
      findings.push(...runNodeNpmBaseline(inventory));
      continue;
    }
  }

  return findings.map((finding, index) => ({
    id: `FND-${String(index + 1).padStart(3, "0")}`,
    ...finding,
  }));
}

export function listPresets() {
  return Object.values(PRESETS);
}

export async function analyzeRepo(options = {}) {
  const workspace = createWorkspace(options.workspace
    ? {
        ...options.workspace,
        rootDir: options.workspace.rootDir ?? options.rootDir ?? process.cwd(),
      }
    : {
        rootDir: options.rootDir ?? process.cwd(),
        name: "default",
      });
  const source = acquireSource(options.source, workspace);
  const inventory = buildRepoInventory(source.repoPath);
  const presetPlan = resolvePresetPlan(options.preset ?? "auto", inventory);
  const findings = runAnalyzers(presetPlan, inventory);
  const runId = makeRunId(inventory.repoName);
  const runDir = path.join(workspace.runsDir, runId);
  const generatedSpecPackPath = path.join(workspace.generatedDir, `${runId}.generated-spec-pack.json`);
  ensureDir(runDir);

  const generatedSpecPack = createGeneratedSpecPack({
    inventory,
    presetPlan,
    source,
  });
  writeJsonFile(generatedSpecPackPath, generatedSpecPack);

  const run = writeRunArtifacts({
    workspace,
    runDir,
    run: {
      runId,
      createdAt: nowIso(),
      mode: options.mode ?? "standard",
      workspace: {
        name: workspace.name,
        path: workspace.workspaceDir,
      },
      source: {
        type: source.type,
        sourceId: source.sourceId,
        location: source.location,
        repoPath: source.repoPath,
      },
      presetPlan: {
        ...presetPlan,
        analyzers: [...(presetPlan.analyzers ?? [])],
      },
      inventory,
      findings,
      generatedSpecPackPath,
      exports: [],
    },
  });

  return run;
}

export { createWorkspace, exportPatch, getRun, listRuns, listWorkspaces };
