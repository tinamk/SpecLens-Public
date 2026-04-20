import { csrfCookieName, idTokenCookieName, sessionCookieName } from "../../../../lib/auth";
import { assertTrustedPortalApiBaseUrl, resolveInternalApiBaseUrl } from "../../../../lib/internal-api";

function getUpstreamBaseUrl(): string {
  return resolveInternalApiBaseUrl();
}

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const token = cookieHeader
    .split(";")
    .map(part => part.trim())
    .find(part => part.startsWith(`${name}=`));
  return token ? token.slice(name.length + 1) : null;
}

function shouldForwardBearerToken(): boolean {
  return process.env.API_AUTH_MODE !== "local-dev";
}

async function proxyRequest(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await context.params;
  const normalizedPath = path[0] === "api" ? path.slice(1) : path;
  const cookieHeader = request.headers.get("cookie");
  const idToken = readCookie(cookieHeader, idTokenCookieName());
  const sessionValue = readCookie(cookieHeader, sessionCookieName());
  const csrfToken = readCookie(cookieHeader, csrfCookieName());
  const upstreamUrl = new URL(`/api/${normalizedPath.join("/")}`, getUpstreamBaseUrl());
  const requestUrl = new URL(request.url);
  upstreamUrl.search = requestUrl.search;
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const bodyBuffer = hasBody ? Buffer.from(await request.arrayBuffer()) : null;
  const hasPayload = bodyBuffer !== null && bodyBuffer.byteLength > 0;

  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  const accept = request.headers.get("accept");
  const lastEventId = request.headers.get("last-event-id");
  if (contentType && hasPayload) {
    headers.set("content-type", contentType);
  }
  if (accept) {
    headers.set("accept", accept);
  }
  if (lastEventId) {
    headers.set("last-event-id", lastEventId);
  }
  if (shouldForwardBearerToken() && idToken && !request.headers.get("authorization")) {
    assertTrustedPortalApiBaseUrl(getUpstreamBaseUrl());
    headers.set("authorization", `Bearer ${idToken}`);
  }
  if (sessionValue || csrfToken) {
    assertTrustedPortalApiBaseUrl(getUpstreamBaseUrl());
    const cookieParts: string[] = [];
    if (sessionValue) {
      cookieParts.push(`${sessionCookieName()}=${sessionValue}`);
    }
    if (csrfToken) {
      cookieParts.push(`${csrfCookieName()}=${csrfToken}`);
    }
    headers.set("cookie", cookieParts.join("; "));
  }
  if (csrfToken && request.method !== "GET" && request.method !== "HEAD") {
    headers.set("x-csrf-token", csrfToken);
  }

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      ...(hasPayload ? { body: bodyBuffer } : {}),
      cache: "no-store",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown upstream error.";
    return new Response(`API upstream unavailable: ${message}`, {
      status: 502,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  const responseHeaders = new Headers();
  const upstreamContentType = upstreamResponse.headers.get("content-type");
  const location = upstreamResponse.headers.get("location");
  const cacheControl = upstreamResponse.headers.get("cache-control");
  const connection = upstreamResponse.headers.get("connection");
  if (upstreamContentType) {
    responseHeaders.set("content-type", upstreamContentType);
  }
  if (location) {
    responseHeaders.set("location", location);
  }
  if (cacheControl) {
    responseHeaders.set("cache-control", cacheControl);
  }
  if (connection) {
    responseHeaders.set("connection", connection);
  }

  if (upstreamContentType?.startsWith("text/event-stream")) {
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  }

  return new Response(await upstreamResponse.arrayBuffer(), {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  return proxyRequest(request, context);
}

export async function POST(request: Request, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  return proxyRequest(request, context);
}

export async function PUT(request: Request, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  return proxyRequest(request, context);
}

export async function DELETE(request: Request, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  return proxyRequest(request, context);
}
