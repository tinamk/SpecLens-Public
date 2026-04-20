import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: "speclens_" });

const httpRequestsTotal = new Counter({
  name: "speclens_api_requests_total",
  help: "Total number of API requests.",
  labelNames: ["method", "route", "status"],
  registers: [registry],
});

const httpRequestDurationMs = new Histogram({
  name: "speclens_api_request_duration_ms",
  help: "API request duration in milliseconds.",
  labelNames: ["method", "route", "status"],
  buckets: [10, 25, 50, 100, 200, 500, 1000, 2000, 5000],
  registers: [registry],
});

const jobEventsTotal = new Counter({
  name: "speclens_job_events_total",
  help: "Job lifecycle events emitted by the API.",
  labelNames: ["event"],
  registers: [registry],
});

const webhookEventsTotal = new Counter({
  name: "speclens_webhook_events_total",
  help: "Webhook events received by the API.",
  labelNames: ["provider", "event"],
  registers: [registry],
});

const queueDepthGauge = new Gauge({
  name: "speclens_queue_depth",
  help: "Current durable queue depth by job status.",
  labelNames: ["status"],
  registers: [registry],
});

export function recordHttpRequest(
  method: string,
  route: string,
  status: number,
  durationMs: number,
): void {
  const statusLabel = String(status);
  httpRequestsTotal.inc({ method, route, status: statusLabel });
  httpRequestDurationMs.observe({ method, route, status: statusLabel }, durationMs);
}

export function recordJobEvent(event: string): void {
  jobEventsTotal.inc({ event });
}

export function recordWebhookEvent(provider: string, event: string): void {
  webhookEventsTotal.inc({ provider, event });
}

export function setQueueDepth(status: string, count: number): void {
  queueDepthGauge.set({ status }, count);
}

export function getMetricsContentType(): string {
  return registry.contentType;
}

export async function getMetricsSnapshot(): Promise<string> {
  return registry.metrics();
}
