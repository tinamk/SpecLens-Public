import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("local compose routes runner and ai-worker through shared nested Docker", () => {
  const compose = read("docker-compose.yml");
  assert.match(compose, /\n  job-dind:\n/);
  assert.match(compose, /runner-sandbox-image-init:/);
  assert.match(compose, /ai-agent-sandbox-image-init:/);
  assert.match(compose, /DOCKER_HOST: tcp:\/\/job-dind:2375/);
  assert.match(compose, /AI_WORKER_ROLE_MAX_CONCURRENCY: \$\{AI_WORKER_ROLE_MAX_CONCURRENCY:-4\}/);
  assert.match(compose, /AI_WORKER_SANDBOX_IMAGE: speclens\/ai-agent-sandbox:local/);
  assert.match(compose, /AI_WORKER_SANDBOX_NETWORK: host/);
  assert.match(compose, /env_file:\n\s+- path: \.env\n\s+required: false/);
  assert.doesNotMatch(compose, /\/var\/run\/docker\.sock/);
});

test("single-node deploy compose does not mount the host Docker socket", () => {
  const compose = read("deploy/digitalocean/docker-compose.single-node.yml");
  assert.match(compose, /\n  job-dind:\n/);
  assert.match(compose, /runner-sandbox-image-init:/);
  assert.match(compose, /ai-agent-sandbox-image-init:/);
  assert.match(compose, /DOCKER_HOST: tcp:\/\/job-dind:2375/);
  assert.match(compose, /AI_WORKER_ROLE_MAX_CONCURRENCY: \$\{AI_WORKER_ROLE_MAX_CONCURRENCY:-4\}/);
  assert.match(compose, /AI_WORKER_SANDBOX_OBJECT_STORAGE_ENDPOINT: http:\/\/minio:9000/);
  assert.match(compose, /env_file:\n\s+- path: \.env\n\s+required: false/);
  assert.doesNotMatch(compose, /\/var\/run\/docker\.sock/);
});

test("standalone runner bootstrap uses DinD instead of the host Docker socket", () => {
  const script = read("deploy/digitalocean/runner-bootstrap.sh");
  assert.match(script, /docker:27-dind/);
  assert.match(script, /DOCKER_HOST="tcp:\/\/\$JOB_DIND_NAME:2375"/);
  assert.doesNotMatch(script, /\/var\/run\/docker\.sock/);
});

test("runner and hosted agent sandbox images share Codex and Playwright installers", () => {
  const runnerDockerfile = read("apps/runner/docker/Dockerfile");
  const agentSandboxDockerfile = read("apps/ai-worker/docker/agent-sandbox.Dockerfile");
  const codexRuntimeInstaller = read("docker/install-codex-runtime.sh");
  for (const dockerfile of [runnerDockerfile, agentSandboxDockerfile]) {
    assert.match(dockerfile, /docker\/install-codex-runtime\.sh/);
    assert.match(dockerfile, /docker\/install-playwright-chromium\.sh/);
  }
  assert.match(codexRuntimeInstaller, /docker\.io/);
  assert.match(codexRuntimeInstaller, /docker-compose/);
});

test("hosted agent controller only permits direct execution in explicit test harness mode", () => {
  const worker = read("apps/ai-worker/src/services/worker.ts");
  const guardStart = worker.indexOf("function shouldUseInProcessSandboxTestHarness");
  const handleStart = worker.indexOf("async function handleAgentJob");
  const testHelperStart = worker.indexOf("export async function runAgentJobForTest", handleStart);
  assert.notEqual(guardStart, -1);
  assert.notEqual(handleStart, -1);
  assert.notEqual(testHelperStart, -1);

  const guard = worker.slice(guardStart, handleStart);
  assert.match(guard, /process\.env\.NODE_ENV === "test"/);
  assert.match(guard, /AI_WORKER_TEST_IN_PROCESS_SANDBOX/);

  const handle = worker.slice(handleStart, testHelperStart);
  assert.match(handle, /shouldUseInProcessSandboxTestHarness\(\)/);
  assert.match(handle, /executeHostedAgentJobInSandbox\(execution, queueMessageId\)/);
  assert.doesNotMatch(handle, /runAgentJob\(/);
  assert.doesNotMatch(handle, /runRemediationJob\(/);
});

test("runner and ai-worker queue consumers wire configured concurrency to batch size", () => {
  const queue = read("packages/db/src/queue.ts");
  const runner = read("apps/runner/src/services/runner.ts");
  const worker = read("apps/ai-worker/src/services/worker.ts");

  assert.match(queue, /export async function workRunnerJobs[\s\S]*options: \{ batchSize\?: number \} = \{\}/);
  assert.match(queue, /export async function workAgentJobs[\s\S]*options: \{ batchSize\?: number \} = \{\}/);
  assert.match(runner, /workRunnerJobs[\s\S]*batchSize: config\.maxConcurrency/);
  assert.match(worker, /workAgentJobs[\s\S]*batchSize: config\.maxConcurrency/);
});

test("active hosted dispatch publishes only unified-agent jobs to the agent queue", () => {
  const queue = read("packages/db/src/queue.ts");
  const dispatchStart = queue.indexOf("async function publishDispatchedJob");
  const dispatchEnd = queue.indexOf("export async function dispatchRunnerJob", dispatchStart);
  assert.notEqual(dispatchStart, -1);
  assert.notEqual(dispatchEnd, -1);
  const dispatchBody = queue.slice(dispatchStart, dispatchEnd);
  assert.match(dispatchBody, /executionPath !== "unified-agent"/);
  assert.match(dispatchBody, /publishAgentJob\(\{ jobId \}\)/);
  assert.doesNotMatch(dispatchBody, /publishRunnerJob\(\{ jobId \}\)/);
});

test("hosted browser QA retries transient navigation startup failures", () => {
  const worker = read("apps/ai-worker/src/services/worker.ts");
  assert.match(worker, /function isRetryableBrowserNavigationError/);
  assert.match(worker, /err_connection_refused/);
  assert.match(worker, /econnrefused/);
  assert.match(worker, /gotoBrowserPageWithRetry\(page, normalizedUrl/);
  assert.match(worker, /attempts: 3/);
});

test("self-improvement loop verifies hosted sandbox readiness and evidence", () => {
  const script = read(".codex/skills/speclens-self-improvement-loop/scripts/run-cycle.mjs");
  const skill = read(".codex/skills/speclens-self-improvement-loop/SKILL.md");

  assert.match(script, /ensureHostedSandboxPreflight/);
  assert.match(script, /job-dind/);
  assert.match(script, /\/var\/run\/docker\.sock/);
  assert.match(script, /speclens\/ai-agent-sandbox:local/);
  assert.match(script, /speclens\/analysis-runner:local/);
  assert.match(script, /assertHostedSandboxEvidence/);
  assert.match(script, /sandbox-evidence\.json/);
  assert.match(script, /--no-sandbox-preflight/);
  assert.match(script, /--no-strict-sandbox-evidence/);

  assert.match(skill, /Prepare the local sandbox stack/);
  assert.match(skill, /successful job without sandbox evidence as a tooling failure/);
});
