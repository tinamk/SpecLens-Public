import { idTokenCookieName, sessionCookieName } from "../../../../lib/auth";

function getUpstreamBaseUrl(): string {
  return process.env.INTERNAL_API_URL ?? process.env.API_URL ?? "http://localhost:4000";
}

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const token = cookieHeader
    .split(";")
    .map(part => part.trim())
    .find(part => part.startsWith(`${name}=`));
  return token ? token.slice(name.length + 1) : null;
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
  const upstreamUrl = new URL(`/api/${normalizedPath.join("/")}`, getUpstreamBaseUrl());
  const requestUrl = new URL(request.url);
  upstreamUrl.search = requestUrl.search;

  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) {
    headers.set("content-type", contentType);
  }
  if (idToken && !request.headers.get("authorization")) {
    headers.set("authorization", `Bearer ${idToken}`);
  }
  if (sessionValue) {
    headers.set("cookie", `${sessionCookieName()}=${sessionValue}`);
  }

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const body = hasBody ? await request.text() : null;
  const upstreamResponse = await fetch(upstreamUrl, {
    method: request.method,
    headers,
    ...(body !== null ? { body } : {}),
    cache: "no-store",
  });

  const responseHeaders = new Headers();
  const upstreamContentType = upstreamResponse.headers.get("content-type");
  const location = upstreamResponse.headers.get("location");
  if (upstreamContentType) {
    responseHeaders.set("content-type", upstreamContentType);
  }
  if (location) {
    responseHeaders.set("location", location);
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
