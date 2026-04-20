import { spawn } from "node:child_process";

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

async function main() {
  await runCommand("npm", ["run", "lint"]);
  await runCommand("npm", ["run", "typecheck"]);
  await runCommand("npm", ["run", "test"]);
  await runCommand("npm", ["run", "build"]);
}

void main().catch(error => {
  console.error("[validate:local] failed", error);
  process.exitCode = 1;
});
