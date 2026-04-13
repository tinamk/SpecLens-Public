import fs from "node:fs";
import path from "node:path";

export interface RepoManifestInventory {
  relativePath: string;
  name: string | null;
  private: boolean;
  license: string | null;
  scripts: string[];
  packageManager: string | null;
  workspaces: unknown;
}

export interface RepoInventory {
  targetPath: string;
  repoName: string;
  createdAt: string;
  classification: {
    kind: "node-npm" | "generic";
    reasons: string[];
  };
  rootEntries: string[];
  files: {
    readmeFiles: string[];
    licenseFiles: string[];
    docsDir: string | null;
    packageLock: string | null;
    pnpmLock: string | null;
    yarnLock: string | null;
    gitignore: string | null;
  };
  manifests: RepoManifestInventory[];
  node: {
    rootManifest: {
      name: string | null;
      private: boolean;
      license: string | null;
      scripts: string[];
      packageManager: string | null;
    };
    workspaceCount: number;
  } | null;
  summary: {
    manifestCount: number;
    readmeCount: number;
    licenseFileCount: number;
    hasDocsDir: boolean;
  };
}

function readJsonFileIfExists<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function collectNamedFiles(rootPath: string, names: string[]): string[] {
  return names
    .map(name => path.join(rootPath, name))
    .filter(filePath => fs.existsSync(filePath))
    .map(filePath => path.relative(rootPath, filePath).replace(/\\/g, "/"));
}

function collectPackageManifests(rootPath: string): RepoManifestInventory[] {
  const manifests: RepoManifestInventory[] = [];
  const queue = [rootPath];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".git")) continue;
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolutePath);
        continue;
      }
      if (entry.name !== "package.json") continue;

      const manifest = readJsonFileIfExists<Record<string, unknown>>(absolutePath);
      manifests.push({
        relativePath: path.relative(rootPath, absolutePath).replace(/\\/g, "/"),
        name: typeof manifest?.name === "string" ? manifest.name : null,
        private: Boolean(manifest?.private),
        license: typeof manifest?.license === "string" ? manifest.license : null,
        scripts: Object.keys((manifest?.scripts as Record<string, unknown> | undefined) ?? {}),
        packageManager: typeof manifest?.packageManager === "string" ? manifest.packageManager : null,
        workspaces: manifest?.workspaces ?? [],
      });
    }
  }

  return manifests.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export function buildRepoInventory(repoPath: string): RepoInventory {
  const rootEntries = fs.readdirSync(repoPath).sort();
  const rootManifest = readJsonFileIfExists<Record<string, unknown>>(path.join(repoPath, "package.json"));
  const manifests = collectPackageManifests(repoPath);
  const classification = rootManifest || rootEntries.includes("package-lock.json") || rootEntries.includes("pnpm-lock.yaml") || rootEntries.includes("yarn.lock")
    ? {
        kind: "node-npm" as const,
        reasons: ["Detected Node/npm metadata or lockfile."],
      }
    : {
        kind: "generic" as const,
        reasons: ["Falling back to generic repository analysis."],
      };

  const workspaces = Array.isArray(rootManifest?.workspaces)
    ? rootManifest.workspaces.length
    : Array.isArray((rootManifest?.workspaces as { packages?: unknown[] } | undefined)?.packages)
      ? ((rootManifest?.workspaces as { packages?: unknown[] }).packages?.length ?? 0)
      : 0;

  return {
    targetPath: repoPath,
    repoName: path.basename(repoPath),
    createdAt: new Date().toISOString(),
    classification,
    rootEntries,
    files: {
      readmeFiles: collectNamedFiles(repoPath, ["README.md", "README", "README.txt"]),
      licenseFiles: collectNamedFiles(repoPath, ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING"]),
      docsDir: fs.existsSync(path.join(repoPath, "docs")) ? "docs" : null,
      packageLock: rootEntries.includes("package-lock.json") ? "package-lock.json" : null,
      pnpmLock: rootEntries.includes("pnpm-lock.yaml") ? "pnpm-lock.yaml" : null,
      yarnLock: rootEntries.includes("yarn.lock") ? "yarn.lock" : null,
      gitignore: rootEntries.includes(".gitignore") ? ".gitignore" : null,
    },
    manifests,
    node: rootManifest ? {
      rootManifest: {
        name: typeof rootManifest.name === "string" ? rootManifest.name : null,
        private: Boolean(rootManifest.private),
        license: typeof rootManifest.license === "string" ? rootManifest.license : null,
        scripts: Object.keys((rootManifest.scripts as Record<string, unknown> | undefined) ?? {}),
        packageManager: typeof rootManifest.packageManager === "string" ? rootManifest.packageManager : null,
      },
      workspaceCount: workspaces,
    } : null,
    summary: {
      manifestCount: manifests.length,
      readmeCount: collectNamedFiles(repoPath, ["README.md", "README", "README.txt"]).length,
      licenseFileCount: collectNamedFiles(repoPath, ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING"]).length,
      hasDocsDir: fs.existsSync(path.join(repoPath, "docs")),
    },
  };
}
