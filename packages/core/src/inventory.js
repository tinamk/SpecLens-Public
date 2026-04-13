import fs from "node:fs";
import path from "node:path";
import { relativeFrom } from "./utils.js";

function readJsonIfPresent(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function collectFiles(rootPath, names) {
  return names
    .map(name => path.join(rootPath, name))
    .filter(filePath => fs.existsSync(filePath))
    .map(filePath => relativeFrom(rootPath, filePath));
}

function collectPackageManifests(rootPath) {
  const manifests = [];
  const queue = [rootPath];

  while (queue.length > 0) {
    const current = queue.shift();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".git")) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (entry.name === "package.json") {
        const manifest = readJsonIfPresent(fullPath);
        manifests.push({
          relativePath: relativeFrom(rootPath, fullPath),
          name: manifest?.name ?? null,
          private: manifest?.private ?? false,
          license: manifest?.license ?? null,
          scripts: Object.keys(manifest?.scripts ?? {}),
          packageManager: manifest?.packageManager ?? null,
          workspaces: manifest?.workspaces ?? [],
        });
      }
    }
  }

  return manifests.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function detectClassification(rootEntries, rootManifest) {
  if (rootManifest || rootEntries.has("package-lock.json") || rootEntries.has("pnpm-lock.yaml") || rootEntries.has("yarn.lock")) {
    return {
      kind: "node-npm",
      reasons: ["Detected package.json or JavaScript package-manager lockfile."],
    };
  }

  return {
    kind: "generic",
    reasons: ["No ecosystem-specific analyzer matched; using generic baseline checks."],
  };
}

export function buildRepoInventory(repoPath) {
  const rootEntries = new Set(fs.readdirSync(repoPath));
  const readmeFiles = collectFiles(repoPath, ["README.md", "README", "README.txt"]);
  const licenseFiles = collectFiles(repoPath, ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING"]);
  const docsDir = fs.existsSync(path.join(repoPath, "docs")) ? "docs" : null;
  const rootManifest = readJsonIfPresent(path.join(repoPath, "package.json"));
  const manifests = collectPackageManifests(repoPath);
  const classification = detectClassification(rootEntries, rootManifest);

  return {
    targetPath: repoPath,
    repoName: path.basename(repoPath),
    createdAt: new Date().toISOString(),
    classification,
    rootEntries: [...rootEntries].sort(),
    files: {
      readmeFiles,
      licenseFiles,
      docsDir,
      packageLock: rootEntries.has("package-lock.json") ? "package-lock.json" : null,
      pnpmLock: rootEntries.has("pnpm-lock.yaml") ? "pnpm-lock.yaml" : null,
      yarnLock: rootEntries.has("yarn.lock") ? "yarn.lock" : null,
      gitignore: rootEntries.has(".gitignore") ? ".gitignore" : null,
    },
    manifests,
    node: rootManifest ? {
      rootManifest: {
        name: rootManifest.name ?? null,
        private: rootManifest.private ?? false,
        license: rootManifest.license ?? null,
        scripts: Object.keys(rootManifest.scripts ?? {}),
        packageManager: rootManifest.packageManager ?? null,
      },
      workspaceCount: Array.isArray(rootManifest.workspaces)
        ? rootManifest.workspaces.length
        : (rootManifest.workspaces?.packages?.length ?? 0),
    } : null,
    summary: {
      manifestCount: manifests.length,
      readmeCount: readmeFiles.length,
      licenseFileCount: licenseFiles.length,
      hasDocsDir: Boolean(docsDir),
    },
  };
}
