import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolveSpecLensTempRoot } from "@speclens/core";

type TestPostgresServer = {
  containerName: string;
  hostPort: string;
};

let postgresServerPromise: Promise<TestPostgresServer> | null = null;
let runnerImageReady = false;

function cleanupExitedHostedTestContainers(): void {
  const containerIds = runCommand(
    "docker",
    [
      "ps",
      "-aq",
      "--filter",
      "name=speclens-api-test-",
      "--filter",
      "status=created",
      "--filter",
      "status=exited",
      "--filter",
      "status=dead",
    ],
    { allowFailure: true },
  )
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);
  if (containerIds.length === 0) {
    return;
  }
  runCommand("docker", ["rm", "-f", ...containerIds], { allowFailure: true });
}

function runCommand(
  command: string,
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    allowFailure?: boolean;
  } = {},
): string {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: {
      ...process.env,
      TMPDIR: process.env.TMPDIR ?? resolveSpecLensTempRoot(process.env),
      ...(options.env ?? {}),
    },
  });
  if (!options.allowFailure && result.status !== 0) {
    throw new Error([
      `${command} ${args.join(" ")} failed with code ${result.status ?? "unknown"}.`,
      result.stderr.trim(),
      result.stdout.trim(),
    ].filter(Boolean).join("\n"));
  }
  return result.stdout.trim();
}

function waitForPostgres(containerName: string): void {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = spawnSync("docker", ["exec", containerName, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "postgres"], {
      encoding: "utf8",
    });
    if (result.status === 0) {
      return;
    }
  }
  throw new Error(`Timed out waiting for PostgreSQL container ${containerName}.`);
}

async function startPostgresServer(): Promise<TestPostgresServer> {
  const containerName = `speclens-api-test-${randomUUID().slice(0, 8)}`;
  runCommand("docker", [
    "run",
    "--rm",
    "-d",
    "--name",
    containerName,
    "-e",
    "POSTGRES_PASSWORD=postgres",
    "-e",
    "POSTGRES_USER=postgres",
    "-P",
    "postgres:16-alpine",
  ]);
  waitForPostgres(containerName);
  const portOutput = runCommand("docker", ["port", containerName, "5432/tcp"]);
  const hostPort = portOutput.split(":").at(-1);
  if (!hostPort) {
    throw new Error(`Could not resolve forwarded port for ${containerName}.`);
  }
  return {
    containerName,
    hostPort,
  };
}

export async function ensureTestPostgresServer(): Promise<TestPostgresServer> {
  if (!postgresServerPromise) {
    postgresServerPromise = startPostgresServer();
  }
  return postgresServerPromise;
}

export function createTestDatabaseName(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`.slice(0, 60);
}

function sqlIdentifier(value: string): string {
  return value.replace(/"/g, "\"\"");
}

export async function preparePrismaTestDatabase(
  databaseName: string,
  options: {
    reuseExisting?: boolean;
  } = {},
): Promise<string> {
  const server = await ensureTestPostgresServer();
  const quotedDatabase = sqlIdentifier(databaseName);
  const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${server.hostPort}/${databaseName}`;

  if (!options.reuseExisting) {
    runCommand("docker", [
      "exec",
      server.containerName,
      "psql",
      "-h",
      "127.0.0.1",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `DROP DATABASE IF EXISTS "${quotedDatabase}" WITH (FORCE);`,
    ]);
    runCommand("docker", [
      "exec",
      server.containerName,
      "psql",
      "-h",
      "127.0.0.1",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `CREATE DATABASE "${quotedDatabase}";`,
    ]);
    runCommand("npx", [
      "prisma",
      "db",
      "push",
      "--skip-generate",
      "--schema",
      "packages/db/prisma/schema.prisma",
    ], {
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
      },
    });
  }

  return databaseUrl;
}

export async function ensureRunnerSandboxImage(): Promise<void> {
  if (runnerImageReady) {
    return;
  }
  const existingImage = runCommand(
    "docker",
    ["image", "inspect", "speclens/analysis-runner:local"],
    { allowFailure: true },
  );
  if (existingImage) {
    runnerImageReady = true;
    return;
  }
  runCommand("docker", [
    "build",
    "-t",
    "speclens/analysis-runner:local",
    "-f",
    "apps/runner/docker/Dockerfile",
    ".",
  ]);
  runnerImageReady = true;
}

export async function stopHostedTestRuntime(): Promise<void> {
  if (postgresServerPromise) {
    const server = await postgresServerPromise;
    runCommand("docker", ["rm", "-f", server.containerName], { allowFailure: true });
    postgresServerPromise = null;
  }
  cleanupExitedHostedTestContainers();
  runnerImageReady = false;
}
