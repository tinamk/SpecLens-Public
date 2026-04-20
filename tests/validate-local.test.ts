import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

type ResolveValidationScripts = (packageJsonPath?: URL) => Promise<string[]>;

async function loadResolveValidationScripts(): Promise<ResolveValidationScripts> {
  const moduleUrl = pathToFileURL(path.join(process.cwd(), "scripts/ops/validate-local.mjs")).href;
  const module = (await import(moduleUrl)) as { resolveValidationScripts: ResolveValidationScripts };
  return module.resolveValidationScripts;
}

function writePackageJson(scripts: Record<string, string>): URL {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "speclens-validate-local-"));
  const packageJsonPath = path.join(fixtureDir, "package.json");
  fs.writeFileSync(packageJsonPath, JSON.stringify({ scripts }, null, 2));
  return pathToFileURL(packageJsonPath);
}

test("resolveValidationScripts skips duplicate typecheck when build reuses it", async () => {
  const resolveValidationScripts = await loadResolveValidationScripts();
  const packageJsonUrl = writePackageJson({
    lint: "eslint .",
    typecheck: "tsc --noEmit",
    test: "node --test",
    build: "tsc --noEmit",
  });

  const scripts = await resolveValidationScripts(packageJsonUrl);
  assert.deepEqual(scripts, ["lint", "test", "build"]);
});

test("resolveValidationScripts keeps typecheck when build is distinct", async () => {
  const resolveValidationScripts = await loadResolveValidationScripts();
  const packageJsonUrl = writePackageJson({
    lint: "eslint .",
    typecheck: "tsc --noEmit",
    test: "node --test",
    build: "next build apps/web",
  });

  const scripts = await resolveValidationScripts(packageJsonUrl);
  assert.deepEqual(scripts, ["lint", "typecheck", "test", "build"]);
});
