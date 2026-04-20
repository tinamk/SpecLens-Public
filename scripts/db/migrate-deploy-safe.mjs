#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const schemaPath = "packages/db/prisma/schema.prisma";
const migrationsDir = path.resolve("packages/db/prisma/migrations");

function runPrisma(args) {
  const result = spawnSync("npx", ["prisma", ...args, "--schema", schemaPath], {
    stdio: "pipe",
    encoding: "utf8",
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (stdout) {
    process.stdout.write(stdout);
  }
  if (stderr) {
    process.stderr.write(stderr);
  }
  return result;
}

function isBaselineRequired(output) {
  return output.includes("P3005");
}

function listMigrationDirectories() {
  return fs.readdirSync(migrationsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function baselineExistingDatabase() {
  const migrations = listMigrationDirectories();
  for (const migration of migrations) {
    const result = runPrisma(["migrate", "resolve", "--applied", migration]);
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    if (result.status === 0) {
      continue;
    }
    if (output.includes("is already recorded as applied")) {
      continue;
    }
    process.exit(result.status ?? 1);
  }
}

const initial = runPrisma(["migrate", "deploy"]);
if ((initial.status ?? 1) === 0) {
  process.exit(0);
}

const initialOutput = `${initial.stdout ?? ""}\n${initial.stderr ?? ""}`;
if (!isBaselineRequired(initialOutput)) {
  process.exit(initial.status ?? 1);
}

console.error("Prisma reported P3005 on a non-empty database; baselining existing migrations before retrying deploy.");
baselineExistingDatabase();

const retry = runPrisma(["migrate", "deploy"]);
process.exit(retry.status ?? 1);
