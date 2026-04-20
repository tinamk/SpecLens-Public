import { expect, type BrowserContext, type Page } from "@playwright/test";
import type { User } from "@speclens/contracts";
import type { E2eUser } from "./env";

const rememberedContextUsers = new WeakMap<BrowserContext, Pick<E2eUser, "username" | "password">>();

function isKeycloakLoginUrl(url: string): boolean {
  return url.includes("/protocol/openid-connect/auth") || url.includes(":8081");
}

function isRetriableNavigationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("ERR_ADDRESS_UNREACHABLE");
}

async function gotoWithRetry(page: Page, targetPath: string, attempts = 3): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await page.goto(targetPath, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle");
      return;
    } catch (error) {
      lastError = error;
      if (!isRetriableNavigationError(error) || attempt >= attempts) {
        throw error;
      }
      await page.waitForTimeout(1_000 * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function submitKeycloakLogin(
  page: Page,
  user: Pick<E2eUser, "username" | "password">,
  expectedUrl: RegExp,
): Promise<void> {
  const usernameInput = page.locator("#username");
  const passwordInput = page.locator("#password");
  await expect(usernameInput).toBeVisible({ timeout: 15_000 });
  await expect(passwordInput).toBeVisible({ timeout: 15_000 });
  await usernameInput.fill(user.username);
  await passwordInput.fill(user.password);
  await Promise.all([
    page.waitForURL(expectedUrl, { timeout: 90_000 }),
    page.locator("#kc-login").click(),
  ]);
}

export async function loginThroughKeycloak(
  page: Page,
  user: Pick<E2eUser, "username" | "password">,
  options?: {
    path?: string;
    expectedUrl?: RegExp;
  },
): Promise<void> {
  const targetPath = options?.path ?? "/portal/workspaces";
  await gotoWithRetry(page, targetPath);

  if (isKeycloakLoginUrl(page.url())) {
    await submitKeycloakLogin(page, user, options?.expectedUrl ?? /\/portal\//);
  }

  if (options?.expectedUrl) {
    await expect(page).toHaveURL(options.expectedUrl);
  }
  rememberedContextUsers.set(page.context(), user);
}

export async function refreshPortalSession(
  page: Page,
  options: {
    path?: string;
    expectedUrl?: RegExp;
  } = {},
): Promise<void> {
  const rememberedUser = rememberedContextUsers.get(page.context());
  if (!rememberedUser) {
    throw new Error("No remembered E2E user credentials were available for session refresh.");
  }

  const current = page.url().startsWith("http") ? new URL(page.url()) : new URL(options.path ?? "/portal/workspaces", "http://localhost");
  const targetPath = options.path ?? `${current.pathname}${current.search}`;
  await gotoWithRetry(page, "/api/auth/logout");
  await loginThroughKeycloak(page, rememberedUser, {
    path: targetPath,
    expectedUrl: options.expectedUrl ?? /\/portal\//,
  });
}

export async function logoutFromPortal(page: Page): Promise<void> {
  await gotoWithRetry(page, "/api/auth/logout");
}

export async function fetchCurrentUser(page: Page): Promise<User> {
  const result = await page.evaluate(async () => {
    const response = await fetch("/api/proxy/api/me");
    return {
      ok: response.ok,
      status: response.status,
      payload: await response.json().catch(() => null),
    };
  });
  if (!result.ok || !result.payload?.user?.id) {
    throw new Error(`Failed to resolve user from /api/me (${result.status}).`);
  }
  return result.payload.user as User;
}

export async function fetchUserId(page: Page): Promise<string> {
  return (await fetchCurrentUser(page)).id;
}

export async function fetchUserEmail(page: Page): Promise<string> {
  return (await fetchCurrentUser(page)).email;
}
