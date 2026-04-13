import fs from "node:fs";
import path from "node:path";
import {
  ensureDir,
  hashValue,
  loadJsonIfExists,
  nowIso,
  readJsonFile,
  slugify,
  writeJsonFile,
} from "./utils.js";

export function getWorkspaceRoot(rootDir = process.cwd()) {
  return path.resolve(rootDir, ".speclens-workspace");
}

export function createWorkspace(options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const name = options.name ?? "default";
  const workspaceRoot = options.workspaceRoot
    ? path.resolve(rootDir, options.workspaceRoot)
    : getWorkspaceRoot(rootDir);
  const workspacesDir = path.join(workspaceRoot, "workspaces");
  const workspaceDir = path.join(workspacesDir, name);
  const metadataPath = path.join(workspaceDir, "workspace.json");
  const workspace = {
    name,
    rootDir,
    workspaceRoot,
    workspaceDir,
    metadataPath,
    runsDir: path.join(workspaceDir, "runs"),
    cacheDir: path.join(workspaceDir, "cache"),
    generatedDir: path.join(workspaceDir, "generated"),
    exportsDir: path.join(workspaceDir, "exports"),
    artifactsDir: path.join(workspaceDir, "artifacts"),
    sourcesRegistryPath: path.join(workspaceDir, "sources.json"),
  };

  ensureDir(workspace.runsDir);
  ensureDir(workspace.cacheDir);
  ensureDir(workspace.generatedDir);
  ensureDir(workspace.exportsDir);
  ensureDir(workspace.artifactsDir);

  const existing = loadJsonIfExists(metadataPath);
  if (!existing) {
    writeJsonFile(metadataPath, {
      name,
      createdAt: nowIso(),
      workspaceRoot,
      version: 1,
    });
  }

  if (!fs.existsSync(workspace.sourcesRegistryPath)) {
    writeJsonFile(workspace.sourcesRegistryPath, {
      updatedAt: nowIso(),
      sources: [],
    });
  }

  return workspace;
}

export function listWorkspaces(options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const workspaceRoot = options.workspaceRoot
    ? path.resolve(rootDir, options.workspaceRoot)
    : getWorkspaceRoot(rootDir);
  const workspacesDir = path.join(workspaceRoot, "workspaces");
  if (!fs.existsSync(workspacesDir)) return [];

  return fs.readdirSync(workspacesDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const workspace = createWorkspace({
        rootDir,
        name: entry.name,
        workspaceRoot,
      });
      return {
        name: workspace.name,
        path: workspace.workspaceDir,
        metadata: loadJsonIfExists(workspace.metadataPath),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function readSourcesRegistry(workspace) {
  return readJsonFile(workspace.sourcesRegistryPath);
}

export function writeSourcesRegistry(workspace, registry) {
  writeJsonFile(workspace.sourcesRegistryPath, {
    ...registry,
    updatedAt: nowIso(),
  });
}

export function registerSource(workspace, entry) {
  const registry = readSourcesRegistry(workspace);
  const existingIndex = registry.sources.findIndex(source => source.id === entry.id);
  if (existingIndex >= 0) {
    registry.sources[existingIndex] = {
      ...registry.sources[existingIndex],
      ...entry,
      lastSeenAt: nowIso(),
    };
  } else {
    registry.sources.push({
      ...entry,
      registeredAt: nowIso(),
      lastSeenAt: nowIso(),
    });
  }
  writeSourcesRegistry(workspace, registry);
  return registry.sources.find(source => source.id === entry.id);
}

export function getRegisteredSource(workspace, idOrLocation) {
  const registry = readSourcesRegistry(workspace);
  return registry.sources.find(source =>
    source.id === idOrLocation
    || source.location === idOrLocation
    || source.alias === idOrLocation
  ) ?? null;
}

export function makeSourceId(type, location) {
  return `${slugify(type)}-${hashValue(location).slice(0, 10)}`;
}

export function listRuns(options = {}) {
  const workspace = createWorkspace(options);
  if (!fs.existsSync(workspace.runsDir)) return [];

  return fs.readdirSync(workspace.runsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => loadJsonIfExists(path.join(workspace.runsDir, entry.name, "run.json")))
    .filter(Boolean)
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
}

export function getRun(runId, options = {}) {
  const workspace = createWorkspace(options);
  const runPath = path.join(workspace.runsDir, runId, "run.json");
  const run = loadJsonIfExists(runPath);
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }
  return run;
}
