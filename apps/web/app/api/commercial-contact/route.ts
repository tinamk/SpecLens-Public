import { resolveInternalApiBaseUrl } from "../../../lib/internal-api";

function getApiBaseUrl(): string {
  return resolveInternalApiBaseUrl();
}

export async function POST(request: Request): Promise<Response> {
  const payload = await request.text();
  const response = await fetch(`${getApiBaseUrl()}/api/commercial-contact`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: payload,
  });
  const body = await response.text();
  return new Response(body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json",
    },
  });
}
