import crypto from "node:crypto";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { Transform } from "node:stream";
import Fastify, { type FastifyRequest } from "fastify";
import { buildPortalCsrfToken, isPrivateOrLocalHostname } from "@speclens/core";
import {
  checkDatabaseHealth,
  checkObjectStorageHealth,
  checkQueueHealth,
  disconnectDatabase,
  getJobStatusCounts,
  initializeDatabase,
  registerGithubWebhookTarget,
  purgeRetention,
  startQueueDispatchLoop,
  statusError,
  stopQueueBoss,
} from "@speclens/db";
import { ZodError } from "zod";
import { registerRoutes } from "./routes";
import { loadApiConfig } from "./services/config";
import { getMetricsContentType, getMetricsSnapshot, recordHttpRequest, setQueueDepth } from "./services/metrics";
import { resolvePortalAuthEnv } from "./services/portal-auth-env";

declare module "fastify" {
  interface FastifyRequest {
    rawBody: Buffer | null;
    requestId: string;
    requestStart: number;
  }
}

function shouldCaptureRawBody(url: string | undefined): boolean {
  if (!url) {
    return false;
  }
  const pathname = url.split("?", 1)[0];
  return pathname === "/api/webhooks/stripe" || pathname === "/api/webhooks/github";
}

function readCookie(cookieHeader: string | string[] | undefined, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }
  const value = Array.isArray(cookieHeader) ? cookieHeader.join(";") : cookieHeader;
  const token = value
    .split(";")
    .map(part => part.trim())
    .find(part => part.startsWith(`${name}=`));
  return token ? token.slice(name.length + 1) : null;
}

function computeCsrfToken(sessionValue: string): string {
  return buildPortalCsrfToken(sessionValue, resolvePortalAuthEnv());
}

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function buildCorsOriginResolver(config: ReturnType<typeof loadApiConfig>) {
  const exactOrigins = new Set<string>();
  for (const candidate of [config.appUrl, config.apiUrl, ...config.corsAllowedOrigins]) {
    const normalized = normalizeOrigin(candidate);
    if (normalized) {
      exactOrigins.add(normalized);
    }
  }
  const allowPrivateOrigins = (() => {
    const appOrigin = normalizeOrigin(config.appUrl);
    return appOrigin ? isPrivateOrLocalHostname(new URL(appOrigin).hostname) : false;
  })();

  return (origin: string | undefined, callback: (error: Error | null, allow: boolean) => void): void => {
    if (!origin) {
      callback(null, true);
      return;
    }
    const normalized = normalizeOrigin(origin);
    if (!normalized) {
      callback(null, false);
      return;
    }
    if (exactOrigins.has(normalized)) {
      callback(null, true);
      return;
    }
    if (allowPrivateOrigins && isPrivateOrLocalHostname(new URL(normalized).hostname)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  };
}

function hashRateLimitIdentity(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function resolveRateLimitIdentity(request: FastifyRequest): string {
  const authorization = Array.isArray(request.headers.authorization)
    ? request.headers.authorization[0]
    : request.headers.authorization;
  if (authorization && authorization.trim().length > 0) {
    return `auth:${hashRateLimitIdentity(authorization.trim())}`;
  }

  const sessionValue = readCookie(request.headers.cookie, "speclens_portal_session");
  if (sessionValue && sessionValue.trim().length > 0) {
    return `session:${hashRateLimitIdentity(sessionValue.trim())}`;
  }

  return `ip:${request.ip}`;
}

async function createApiApp() {
  const config = loadApiConfig();
  await initializeDatabase();
  if (
    config.githubGatewayUrl
    && config.apiUrl
    && config.appUrl
    && !isPrivateOrLocalHostname(new URL(config.appUrl).hostname)
  ) {
    await registerGithubWebhookTarget({
      environmentLabel: "production",
      appUrl: config.appUrl,
      webhookForwardUrl: `${config.apiUrl.replace(/\/+$/, "")}/api/webhooks/github`,
      kind: "prod",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
  }
  startQueueDispatchLoop();
  const retentionTimer = startRetentionLoop(config);
  const app = Fastify({
    logger: false,
    trustProxy: config.trustProxy,
  });
  app.decorateRequest("rawBody", null);
  app.decorateRequest("requestId", "");
  app.decorateRequest("requestStart", 0);

  await app.register(cors, {
    origin: buildCorsOriginResolver(config),
    credentials: true,
  });
  await app.register(multipart);
  if (config.rateLimitEnabled) {
    await app.register(rateLimit, {
      max: config.rateLimitMax,
      timeWindow: config.rateLimitWindowMs,
      allowList: config.rateLimitAllowList,
      keyGenerator: resolveRateLimitIdentity,
    });
  }
  app.addHook("onRequest", (request, _reply, done) => {
    request.rawBody = null;
    const header = Array.isArray(request.headers["x-request-id"])
      ? request.headers["x-request-id"][0]
      : request.headers["x-request-id"];
    request.requestId = header && header.trim().length > 0 ? header.trim() : `req_${crypto.randomUUID()}`;
    request.requestStart = Date.now();
    _reply.header("x-request-id", request.requestId);
    done();
  });
  app.addHook("preHandler", (request, _reply, done) => {
    const method = request.method.toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      done();
      return;
    }
    const hasBearer = Boolean(request.headers.authorization);
    if (hasBearer) {
      done();
      return;
    }
    const sessionValue = readCookie(request.headers.cookie, "speclens_portal_session");
    if (!sessionValue) {
      done();
      return;
    }
    const csrfHeader = Array.isArray(request.headers["x-csrf-token"])
      ? request.headers["x-csrf-token"][0]
      : request.headers["x-csrf-token"];
    const csrfCookie = readCookie(request.headers.cookie, "speclens_csrf");
    const expected = computeCsrfToken(sessionValue);
    if (!csrfHeader || !csrfCookie || csrfHeader !== csrfCookie || csrfHeader !== expected) {
      done(statusError(403, "Invalid CSRF token."));
      return;
    }
    done();
  });
  app.addHook("preParsing", (request, _reply, payload, done) => {
    if (!shouldCaptureRawBody(request.raw.url)) {
      done(null, payload);
      return;
    }

    const chunks: Buffer[] = [];
    const capture = new Transform({
      transform(chunk, _encoding, callback) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        chunks.push(buffer);
        capture.receivedEncodedLength = (capture.receivedEncodedLength ?? 0) + buffer.length;
        callback(null, buffer);
      },
      flush(callback) {
        request.rawBody = Buffer.concat(chunks);
        callback();
      },
    }) as Transform & { receivedEncodedLength?: number };
    capture.receivedEncodedLength = 0;
    payload.on("error", error => {
      capture.destroy(error);
    });
    done(null, payload.pipe(capture));
  });
  app.addHook("onResponse", (request, reply, done) => {
    if (config.httpAccessLogEnabled) {
      console.log(JSON.stringify({
        requestId: request.requestId,
        method: request.method,
        url: request.raw.url,
        statusCode: reply.statusCode,
      }));
    }
    const durationMs = Math.max(0, Date.now() - request.requestStart);
    const route = request.routeOptions?.url ?? request.raw.url ?? "unknown";
    recordHttpRequest(request.method, route, reply.statusCode, durationMs);
    done();
  });
  app.addHook("onClose", async () => {
    if (retentionTimer) {
      clearInterval(retentionTimer);
    }
    await stopQueueBoss();
    await disconnectDatabase();
  });
  app.setErrorHandler((error, _request, reply) => {
    const message = error instanceof Error ? error.message : "Unknown server error";
    if (error instanceof ZodError) {
      reply.status(400).send({
        error: "validation_error",
        issues: error.issues,
      });
      return;
    }
    if (typeof (error as { statusCode?: unknown }).statusCode === "number") {
      reply.status((error as { statusCode: number }).statusCode).send({ error: message });
      return;
    }
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes("not found")) {
      reply.status(404).send({ error: message });
      return;
    }
    if (lowerMessage.includes("required") || lowerMessage.includes("forbidden") || lowerMessage.includes("entitlement")) {
      reply.status(403).send({ error: message });
      return;
    }
    reply.status(500).send({ error: message });
  });
  app.get("/ready", async (_request, reply) => {
    try {
      await checkDatabaseHealth();
      await checkQueueHealth();
      const storageResult = await checkObjectStorageHealth({
        objectStorageProvider: config.objectStorageProvider,
        objectStorageBucket: config.objectStorageBucket,
        objectStorageEndpoint: config.objectStorageEndpoint,
        objectStoragePublicEndpoint: config.objectStoragePublicEndpoint,
        objectStorageRegion: config.objectStorageRegion,
        objectStorageForcePathStyle: config.objectStorageForcePathStyle,
        objectStorageAccessKeyId: config.objectStorageAccessKeyId,
        objectStorageSecretAccessKey: config.objectStorageSecretAccessKey,
        objectStorageMirror: config.objectStorageMirror,
        objectStorageMirrorRequired: config.objectStorageMirrorRequired,
      });
      reply.send({
        ok: true,
        storage: storageResult,
      });
    } catch (error) {
      reply.status(503).send({
        ok: false,
        error: error instanceof Error ? error.message : "Readiness check failed.",
      });
    }
  });

  if (config.metricsEnabled) {
    app.get("/metrics", async (_request, reply) => {
      const counts = await getJobStatusCounts();
      for (const [status, count] of Object.entries(counts)) {
        setQueueDepth(status, count);
      }
      reply.header("content-type", getMetricsContentType());
      reply.send(await getMetricsSnapshot());
    });
  }

  await registerRoutes(app);

  return {
    app,
    config,
  };
}

function startRetentionLoop(config: ReturnType<typeof loadApiConfig>): NodeJS.Timeout | null {
  const rawDays = Number(process.env.WORKSPACE_RETENTION_DAYS ?? "");
  if (!Number.isFinite(rawDays) || rawDays <= 0) {
    return null;
  }
  const run = async () => {
    const cutoff = new Date(Date.now() - rawDays * 24 * 60 * 60 * 1000);
    const result = await purgeRetention({
      objectStorageProvider: config.objectStorageProvider,
      objectStorageBucket: config.objectStorageBucket,
      objectStorageEndpoint: config.objectStorageEndpoint,
      objectStoragePublicEndpoint: config.objectStoragePublicEndpoint,
      objectStorageRegion: config.objectStorageRegion,
      objectStorageForcePathStyle: config.objectStorageForcePathStyle,
      objectStorageAccessKeyId: config.objectStorageAccessKeyId,
      objectStorageSecretAccessKey: config.objectStorageSecretAccessKey,
      objectStorageMirror: config.objectStorageMirror,
      objectStorageMirrorRequired: config.objectStorageMirrorRequired,
    }, cutoff);
    if (result.artifacts > 0 || result.logs > 0) {
      console.log(`[retention] purged ${result.artifacts} artifacts and ${result.logs} logs older than ${cutoff.toISOString()}`);
    }
  };
  void run();
  return setInterval(run, 24 * 60 * 60 * 1000);
}

export { createApiApp };
export default createApiApp;
