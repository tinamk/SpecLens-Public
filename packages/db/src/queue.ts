import { randomUUID } from "node:crypto";
import PgBoss from "pg-boss";
import {
  agentJobPayloadSchema,
  runnerJobPayloadSchema,
  type AgentJobPayload,
  type RunnerJobPayload,
} from "@speclens/contracts";
import {
  getAnalysisJobExecutionPath,
  leaseAnalysisJobForDispatch,
  leaseNextPendingAnalysisJobForDispatch,
  markAnalysisJobDispatchFailure,
  setAnalysisJobQueueMessage,
} from "./repositories";

let bossPromise: Promise<PgBoss> | null = null;
let dispatchLoopTimer: NodeJS.Timeout | null = null;
let dispatchLoopPromise: Promise<void> | null = null;
const dispatchLoopInstanceId = `dispatch_${randomUUID()}`;

function getRunnerQueueName(): string {
  return process.env.PG_BOSS_QUEUE_NAME ?? "analysis-jobs";
}

function getAgentQueueName(): string {
  return process.env.PG_BOSS_AI_QUEUE_NAME ?? "ai-agent-jobs";
}


function getDispatchIntervalMs(): number {
  const value = Number.parseInt(process.env.ANALYSIS_JOB_DISPATCH_INTERVAL_MS ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : 2_000;
}

async function createBoss(): Promise<PgBoss> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for pg-boss queue usage.");
  }
  const boss = new PgBoss({
    connectionString,
    schema: process.env.PG_BOSS_SCHEMA ?? "pgboss",
  });
  await boss.start();
  await boss.createQueue(getRunnerQueueName());
  await boss.createQueue(getAgentQueueName());
  return boss;
}

export async function getQueueBoss(): Promise<PgBoss> {
  if (!bossPromise) {
    bossPromise = createBoss();
  }
  return bossPromise;
}

export async function publishRunnerJob(payload: RunnerJobPayload): Promise<string> {
  const boss = await getQueueBoss();
  const messageId = await boss.send(getRunnerQueueName(), runnerJobPayloadSchema.parse(payload));
  if (!messageId) {
    throw new Error(`Failed to publish queue message for job ${payload.jobId}.`);
  }
  return String(messageId);
}

export async function cancelRunnerJob(messageId: string): Promise<void> {
  const boss = await getQueueBoss();
  await boss.cancel(getRunnerQueueName(), messageId);
}

export async function publishAgentJob(payload: AgentJobPayload): Promise<string> {
  const boss = await getQueueBoss();
  const messageId = await boss.send(getAgentQueueName(), agentJobPayloadSchema.parse(payload));
  if (!messageId) {
    throw new Error(`Failed to publish agent queue message for job ${payload.jobId}.`);
  }
  return String(messageId);
}

export async function cancelAgentJob(messageId: string): Promise<void> {
  const boss = await getQueueBoss();
  await boss.cancel(getAgentQueueName(), messageId);
}

async function publishDispatchedJob(jobId: string, dispatcherId: string): Promise<void> {
  try {
    const executionPath = await getAnalysisJobExecutionPath(jobId);
    if (executionPath !== "unified-agent") {
      throw new Error(`Unsupported hosted job execution path for ${jobId}: ${executionPath ?? "unknown"}.`);
    }
    // Active hosted jobs are always unified-agent jobs. The runner queue remains
    // available for runner-plane compatibility, but normal hosted submissions do
    // not branch into it.
    const messageId = await publishAgentJob({ jobId });
    await setAnalysisJobQueueMessage(jobId, { jobId, messageId }, dispatcherId);
  } catch (error) {
    await markAnalysisJobDispatchFailure(jobId, {
      dispatcherId,
      errorMessage: error instanceof Error ? error.message : "Queue publish failed.",
    });
  }
}

export async function dispatchRunnerJob(jobId: string): Promise<void> {
  const dispatcherId = `${dispatchLoopInstanceId}:inline`;
  const leased = await leaseAnalysisJobForDispatch(jobId, dispatcherId);
  if (!leased) {
    return;
  }
  await publishDispatchedJob(jobId, dispatcherId);
}

async function drainPendingDispatches(): Promise<void> {
  const dispatcherId = `${dispatchLoopInstanceId}:loop`;
  for (;;) {
    const jobId = await leaseNextPendingAnalysisJobForDispatch(dispatcherId);
    if (!jobId) {
      return;
    }
    await publishDispatchedJob(jobId, dispatcherId);
  }
}

export function startQueueDispatchLoop(): void {
  if (dispatchLoopTimer) {
    return;
  }
  const tick = () => {
    if (dispatchLoopPromise) {
      return;
    }
    dispatchLoopPromise = drainPendingDispatches()
      .catch(error => {
        const message = error instanceof Error ? error.message : "Unknown queue dispatch failure.";
        console.warn(`[queue-dispatch] dispatch tick failed: ${message}`);
      })
      .finally(() => {
        dispatchLoopPromise = null;
      });
  };
  tick();
  dispatchLoopTimer = setInterval(tick, getDispatchIntervalMs());
}

export async function workRunnerJobs(
  handler: (payload: RunnerJobPayload, queueMessageId: string) => Promise<void>,
  options: { batchSize?: number } = {},
): Promise<PgBoss> {
  const boss = await getQueueBoss();
  const batchSize = Math.max(1, Math.floor(options.batchSize ?? 1));
  // pg-boss waits for a worker callback to finish before fetching again, so
  // long-running jobs need separate workers for real queue concurrency.
  for (let workerIndex = 0; workerIndex < batchSize; workerIndex += 1) {
    await boss.work(getRunnerQueueName(), { batchSize: 1 }, async jobs => {
      await Promise.all(jobs.map(async job => {
        const payload = runnerJobPayloadSchema.parse(job.data);
        await handler(payload, String(job.id));
      }));
    });
  }
  return boss;
}

export async function workAgentJobs(
  handler: (payload: AgentJobPayload, queueMessageId: string) => Promise<void>,
  options: { batchSize?: number } = {},
): Promise<PgBoss> {
  const boss = await getQueueBoss();
  const batchSize = Math.max(1, Math.floor(options.batchSize ?? 1));
  // pg-boss waits for a worker callback to finish before fetching again, so
  // long-running jobs need separate workers for real queue concurrency.
  for (let workerIndex = 0; workerIndex < batchSize; workerIndex += 1) {
    await boss.work(getAgentQueueName(), { batchSize: 1 }, async jobs => {
      await Promise.all(jobs.map(async job => {
        const payload = agentJobPayloadSchema.parse(job.data);
        await handler(payload, String(job.id));
      }));
    });
  }
  return boss;
}

export async function stopQueueBoss(): Promise<void> {
  if (dispatchLoopTimer) {
    clearInterval(dispatchLoopTimer);
    dispatchLoopTimer = null;
  }
  if (dispatchLoopPromise) {
    await dispatchLoopPromise;
    dispatchLoopPromise = null;
  }
  if (!bossPromise) {
    return;
  }
  const boss = await bossPromise;
  await boss.stop();
  bossPromise = null;
}

export async function checkQueueHealth(): Promise<void> {
  await getQueueBoss();
}
