import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function resolveHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.HOME?.trim() || os.homedir();
}

export function resolveSpecLensStateRoot(env: NodeJS.ProcessEnv = process.env): string {
  const explicitRoot = env.SPECLENS_STATE_ROOT?.trim();
  if (explicitRoot) {
    return path.resolve(explicitRoot);
  }
  const xdgStateHome = env.XDG_STATE_HOME?.trim();
  return path.resolve(
    xdgStateHome && xdgStateHome.length > 0
      ? path.join(xdgStateHome, "speclens")
      : path.join(resolveHomeDir(env), ".local", "state", "speclens"),
  );
}

export function resolveSpecLensCacheRoot(env: NodeJS.ProcessEnv = process.env): string {
  const explicitRoot = env.SPECLENS_CACHE_ROOT?.trim();
  if (explicitRoot) {
    return path.resolve(explicitRoot);
  }
  const xdgCacheHome = env.XDG_CACHE_HOME?.trim();
  return path.resolve(
    xdgCacheHome && xdgCacheHome.length > 0
      ? path.join(xdgCacheHome, "speclens")
      : path.join(resolveHomeDir(env), ".cache", "speclens"),
  );
}

export function resolveSpecLensTempRoot(env: NodeJS.ProcessEnv = process.env): string {
  const explicitRoot = env.SPECLENS_TEMP_ROOT?.trim();
  if (explicitRoot) {
    return path.resolve(explicitRoot);
  }
  return path.join(resolveSpecLensCacheRoot(env), "tmp");
}

export function resolveSpecLensAppStatePath(env: NodeJS.ProcessEnv = process.env): string {
  const explicitPath = env.APP_STATE_PATH?.trim();
  if (explicitPath) {
    return path.resolve(explicitPath);
  }
  return path.join(resolveSpecLensStateRoot(env), "app-state", "hosted-api-state.json");
}

export function resolveSpecLensObjectStorageRoot(env: NodeJS.ProcessEnv = process.env): string {
  const explicitRoot = env.SPECLENS_OBJECT_STORAGE_ROOT?.trim();
  if (explicitRoot) {
    return path.resolve(explicitRoot);
  }
  return path.join(resolveSpecLensStateRoot(env), "object-storage");
}

export function ensureSpecLensTempRoot(env: NodeJS.ProcessEnv = process.env): string {
  const tempRoot = resolveSpecLensTempRoot(env);
  fs.mkdirSync(tempRoot, { recursive: true });
  return tempRoot;
}

export function createHomeTempDirSync(prefix: string, env: NodeJS.ProcessEnv = process.env): string {
  const tempRoot = ensureSpecLensTempRoot(env);
  return fs.mkdtempSync(path.join(tempRoot, prefix));
}
