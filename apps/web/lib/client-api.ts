export type ClientJsonMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export function getApiBaseUrl(): string {
  return "/api/proxy";
}

export async function readApiErrorMessage(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const payload = await response.json() as { error?: string; message?: string };
      return payload.error ?? payload.message ?? `Request failed: ${response.status}`;
    } catch {
      return `Request failed: ${response.status}`;
    }
  }

  const text = (await response.text()).trim();
  return text || `Request failed: ${response.status}`;
}

export async function requestJson<T>(
  method: ClientJsonMethod,
  pathname: string,
  payload?: unknown,
): Promise<T> {
  const init: RequestInit = { method };
  if (payload !== undefined) {
    init.headers = {
      "content-type": "application/json",
    };
    init.body = JSON.stringify(payload);
  }

  const response = await fetch(`${getApiBaseUrl()}${pathname}`, init);
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response));
  }

  return await response.json() as T;
}

export function postJson<T>(pathname: string, payload: unknown): Promise<T> {
  return requestJson<T>("POST", pathname, payload);
}

export function patchJson<T>(pathname: string, payload: unknown): Promise<T> {
  return requestJson<T>("PATCH", pathname, payload);
}

export function deleteJson<T>(pathname: string): Promise<T> {
  return requestJson<T>("DELETE", pathname);
}

export async function postFormData<T>(pathname: string, payload: FormData): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${pathname}`, {
    method: "POST",
    body: payload,
  });

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response));
  }

  return await response.json() as T;
}
