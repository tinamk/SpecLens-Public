import { spawn } from "node:child_process";

function runWithCleanNodeOptions(argv) {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  if (args.length === 0) {
    throw new Error("Usage: node scripts/node/run-with-clean-node-options.mjs -- <command> [args...]");
  }

  const child = spawn(args[0], args.slice(1), {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_OPTIONS: "",
    },
    shell: process.platform === "win32",
  });

  child.once("error", error => {
    console.error(error);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });
}

runWithCleanNodeOptions(process.argv.slice(2));
