import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function ensureParentDir(filePath) {
  ensureDir(path.dirname(filePath));
}

export function loadJsonIfExists(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJsonFile(filePath, value) {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeTextFile(filePath, value) {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, value.endsWith("\n") ? value : `${value}\n`);
}

export function nowIso() {
  return new Date().toISOString();
}

export function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "item";
}

export function hashValue(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex");
}

export function makeRunId(label = "analyze") {
  const now = new Date();
  const pad = number => String(number).padStart(2, "0");
  return [
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`,
    slugify(label),
  ].join("_");
}

export function toPosixPath(filePath) {
  return filePath.replace(/\\/g, "/");
}

export function relativeFrom(basePath, targetPath) {
  return toPosixPath(path.relative(basePath, targetPath));
}

export function isGitLikeLocation(location) {
  return /^(https?:\/\/|ssh:\/\/|git@|git:\/\/|file:\/\/)/i.test(location)
    || location.endsWith(".git");
}

export function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
