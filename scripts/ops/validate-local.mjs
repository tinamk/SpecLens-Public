import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export async function resolveValidationScripts(packageJsonPath = new URL("../../package.json", import.meta.url)) {
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const scripts = packageJson.scripts ?? {};
  const validationScripts = ["lint", "typecheck", "test", "build"];

  return validationScripts.filter(scriptName => {
    const scriptValue = scripts[scriptName];
    if (typeof scriptValue !== "string" || scriptValue.trim().length === 0) {
      return false;
    }

    if (scriptName !== "typecheck") {
      return true;
    }

    const buildScript = scripts.build;
    return typeof buildScript !== "string" || buildScript.trim() !== scriptValue.trim();
  });
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_OPTIONS: "",
      },
      shell: process.platform === "win32",
    });

    child.once("error", reject);
    child.once("exit", code => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`));
    });
  });
}

export async function main() {
  const validationScripts = await resolveValidationScripts();
  for (const scriptName of validationScripts) {
    await runCommand("npm", ["run", scriptName]);
  }
}

const isEntryPoint = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isEntryPoint) {
  void main().catch(error => {
    console.error("[validate:local] failed", error);
    process.exitCode = 1;
  });
}
