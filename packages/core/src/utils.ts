import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function ensureParentDir(filePath: string): void {
  ensureDir(path.dirname(filePath));
}

export function loadJsonIfExists<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonFile(filePath: string, value: unknown): void {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeTextFile(filePath: string, value: string): void {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, value.endsWith("\n") ? value : `${value}\n`);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function slugify(value: string): string {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "item";
}

export function makeRunId(label: string): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`,
    slugify(label),
  ].join("_");
}

export function hashValue(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex");
}

export function relativePosix(fromPath: string, toPath: string): string {
  return path.relative(fromPath, toPath).replace(/\\/g, "/");
}

export function isGitLocation(location: string): boolean {
  return /^(https?:\/\/|ssh:\/\/|git@|git:\/\/|file:\/\/)/i.test(location) || location.endsWith(".git");
}

export function createId(prefix: string, seed: string): string {
  return `${prefix}_${hashValue(seed).slice(0, 12)}`;
}
