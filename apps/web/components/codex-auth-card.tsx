"use client";

import type { CodexAuthStatus } from "@speclens/contracts";
import { PortalMetaList, PortalSectionHeader } from "@speclens/ui";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

function getApiBaseUrl(): string {
  return "/api/proxy";
}

async function requestJson<T>(method: "GET" | "POST" | "PATCH", pathname: string, payload?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (payload !== undefined) {
    init.headers = {
      "content-type": "application/json",
    };
    init.body = JSON.stringify(payload);
  }

  const response = await fetch(`${getApiBaseUrl()}${pathname}`, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }

  return await response.json() as T;
}

function formatTimestamp(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

export function CodexAuthCard({
  title,
  description,
  initialAuth,
  devicePath,
  verifyPath,
  logoutPath,
  importLocalPath,
  disableTogglePath,
  readOnly = false,
  testId,
}: {
  title: string;
  description?: string;
  initialAuth: CodexAuthStatus;
  devicePath?: string;
  verifyPath?: string;
  logoutPath?: string;
  importLocalPath?: string;
  disableTogglePath?: string;
  readOnly?: boolean;
  testId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [auth, setAuth] = useState(initialAuth);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const authRequestInFlightRef = useRef(false);

  useEffect(() => setAuth(initialAuth), [initialAuth]);

  const tone = useMemo(() => {
    if (auth.disabled) {
      return "idle";
    }
    switch (auth.status) {
      case "ready":
        return "ready";
      case "pending":
        return "pending";
      case "error":
        return "error";
      default:
        return "idle";
    }
  }, [auth.disabled, auth.status]);

  const stateLabel = useMemo(() => {
    if (auth.scope === "global" && auth.disabled) {
      return "Disabled";
    }
    switch (auth.status) {
      case "ready":
        return "Connected";
      case "pending":
        return "Awaiting verification";
      case "error":
        return "Needs attention";
      default:
        return "Not connected";
    }
  }, [auth.disabled, auth.scope, auth.status]);

  const verificationUrl = auth.verificationUriComplete ?? auth.verificationUri ?? null;

  const refreshAuthStatus = async (options?: {
    silent?: boolean;
    refreshRoute?: boolean;
  }): Promise<CodexAuthStatus | null> => {
    if (!verifyPath || authRequestInFlightRef.current) {
      return null;
    }
    authRequestInFlightRef.current = true;
    if (!options?.silent) {
      setError(null);
    }
    try {
      const payload = await requestJson<{ auth: CodexAuthStatus }>("POST", verifyPath);
      setAuth(payload.auth);
      if (options?.refreshRoute || payload.auth.status !== "pending") {
        router.refresh();
      }
      return payload.auth;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Verification failed.");
      return null;
    } finally {
      authRequestInFlightRef.current = false;
    }
  };

  useEffect(() => {
    if (auth.status !== "pending" || !verifyPath) {
      return undefined;
    }
    const intervalMs = Math.max(5, auth.intervalSeconds ?? 5) * 1000;
    let cancelled = false;

    const verifyPendingAuth = () => {
      if (cancelled || document.visibilityState === "hidden") {
        return;
      }
      void refreshAuthStatus({ silent: true });
    };

    const timeoutId = window.setTimeout(verifyPendingAuth, intervalMs);
    const intervalId = window.setInterval(verifyPendingAuth, intervalMs);
    const handleWindowFocus = () => verifyPendingAuth();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        verifyPendingAuth();
      }
    };

    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [auth.intervalSeconds, auth.status, verifyPath]);

  const handleCopyCode = async () => {
    if (!auth.userCode) {
      return;
    }
    if (!navigator.clipboard) {
      setCopyNotice("Clipboard unavailable.");
      window.setTimeout(() => setCopyNotice(null), 2500);
      return;
    }
    try {
      await navigator.clipboard.writeText(auth.userCode);
      setCopyNotice("Code copied.");
    } catch {
      setCopyNotice("Copy failed.");
    } finally {
      window.setTimeout(() => setCopyNotice(null), 2500);
    }
  };

  return (
    <article className="portal-panel" data-testid={testId}>
      <PortalSectionHeader title={title} description={description} />
      <div className="admin-summary-grid">
        <article className="admin-summary-card">
          <span className="admin-summary-card__label">State</span>
          <span className="admin-summary-card__value">{stateLabel}</span>
          <p><span className={`status-pill status-pill--${tone}`}>{auth.status}</span></p>
        </article>
        <article className="admin-summary-card">
          <span className="admin-summary-card__label">Scope</span>
          <span className="admin-summary-card__value">{auth.scope}</span>
          <p>{auth.scope === "user" ? "Private to your account." : auth.scope === "workspace" ? "Shared inside this workspace." : "Admin-managed shared fallback."}</p>
        </article>
        <article className="admin-summary-card">
          <span className="admin-summary-card__label">Account</span>
          <span className="admin-summary-card__value">{auth.accountId ?? "Not linked"}</span>
          <p>{auth.disabled ? "Selection blocked until re-enabled." : "Credentials stay isolated to this scope."}</p>
        </article>
        <article className="admin-summary-card">
          <span className="admin-summary-card__label">Refresh</span>
          <span className="admin-summary-card__value">{formatTimestamp(auth.lastRefresh) ?? "No refresh yet"}</span>
          <p>{auth.lastError ?? "No recent auth errors."}</p>
        </article>
      </div>

      {auth.scope === "global" && auth.disabled ? (
        <div className="auth-callout">
          <p className="auth-callout__title">Global fallback disabled</p>
          <p className="subtle-note">Workspace runs cannot use the shared global Codex auth until an admin enables it again.</p>
        </div>
      ) : null}

      {auth.status === "ready" && !auth.disabled ? (
        <div className="auth-callout auth-callout--ready">
          <p className="auth-callout__title">Authenticated</p>
          <PortalMetaList
            items={[
              { label: "Account", value: auth.accountId ?? "unknown" },
              { label: "Last refresh", value: formatTimestamp(auth.lastRefresh) ?? "not recorded" },
            ]}
          />
        </div>
      ) : null}

      {auth.status === "pending" ? (
        <div className="auth-callout">
          <p className="auth-callout__title">Device code ready</p>
          <ol className="bullet-list">
            <li>Open the verification page.</li>
            <li>Enter the device code shown below.</li>
            <li>SpecLens will keep polling until the session is ready.</li>
          </ol>
          <div className="auth-code">
            <span className="auth-code__label">Device code</span>
            <span className="auth-code__value">{auth.userCode ?? "—"}</span>
            <div className="auth-code__actions">
              <button className="button-ghost" type="button" onClick={handleCopyCode} disabled={!auth.userCode}>
                Copy code
              </button>
              {copyNotice ? <span className="subtle-note">{copyNotice}</span> : null}
            </div>
          </div>
          <div className="auth-links">
            {verificationUrl ? (
              <>
                <a className="button" href={verificationUrl} target="_blank" rel="noreferrer">
                  Open verification page
                </a>
                <span className="subtle-note">{verificationUrl}</span>
              </>
            ) : (
              <span className="subtle-note">Waiting for verification URL.</span>
            )}
          </div>
          <PortalMetaList
            items={[
              { label: "Expires", value: formatTimestamp(auth.expiresAt) ?? "not provided" },
              { label: "Check interval", value: `${auth.intervalSeconds ?? 5}s` },
            ]}
          />
        </div>
      ) : null}

      {auth.status === "unauthenticated" && !auth.disabled ? (
        <div className="auth-callout">
          <p className="auth-callout__title">Connect Codex</p>
          <p className="subtle-note">
            Start the device flow for a browser-based login, or import the local CLI session if this SpecLens instance is running on your machine.
          </p>
        </div>
      ) : null}

      {auth.status === "error" && auth.lastError ? (
        <div className="auth-callout auth-callout--error">
          <p className="auth-callout__title">Authentication failed</p>
          <p className="inline-error">{auth.lastError}</p>
        </div>
      ) : null}

      {!readOnly ? (
        <div className="admin-form-actions">
          {devicePath ? (
            <button
              className="button"
              type="button"
              disabled={pending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  try {
                    const payload = await requestJson<{ auth: CodexAuthStatus }>("POST", devicePath);
                    setAuth(payload.auth);
                    router.refresh();
                  } catch (requestError) {
                    setError(requestError instanceof Error ? requestError.message : "Failed to start device flow.");
                  }
                });
              }}
            >
              {pending ? "Starting..." : "Start device flow"}
            </button>
          ) : null}
          {importLocalPath ? (
            <button
              className="button-secondary"
              type="button"
              disabled={pending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  try {
                    const payload = await requestJson<{ auth: CodexAuthStatus }>("POST", importLocalPath);
                    setAuth(payload.auth);
                    router.refresh();
                  } catch (requestError) {
                    setError(requestError instanceof Error ? requestError.message : "Local auth import failed.");
                  }
                });
              }}
            >
              {pending ? "Importing..." : "Use local Codex auth"}
            </button>
          ) : null}
          {verifyPath ? (
            <button
              className="button-secondary"
              type="button"
              disabled={pending}
              onClick={() => {
                startTransition(async () => {
                  await refreshAuthStatus({ refreshRoute: true });
                });
              }}
            >
              {pending ? "Checking..." : "Check status"}
            </button>
          ) : null}
          {disableTogglePath ? (
            <button
              className="button-ghost"
              type="button"
              disabled={pending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  try {
                    const payload = await requestJson<{ auth: CodexAuthStatus }>("PATCH", disableTogglePath, {
                      disabled: !auth.disabled,
                    });
                    setAuth(payload.auth);
                    router.refresh();
                  } catch (requestError) {
                    setError(requestError instanceof Error ? requestError.message : "Failed to update global fallback.");
                  }
                });
              }}
            >
              {pending ? "Saving..." : auth.disabled ? "Enable global fallback" : "Disable global fallback"}
            </button>
          ) : null}
          {logoutPath ? (
            <button
              className="button-ghost"
              type="button"
              disabled={pending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  try {
                    const payload = await requestJson<{ auth: CodexAuthStatus }>("POST", logoutPath);
                    setAuth(payload.auth);
                    router.refresh();
                  } catch (requestError) {
                    setError(requestError instanceof Error ? requestError.message : "Logout failed.");
                  }
                });
              }}
            >
              Logout
            </button>
          ) : null}
          {error ? <p className="inline-error" role="alert">{error}</p> : null}
        </div>
      ) : null}

      {readOnly ? (
        <p className="subtle-note">You can choose this scope when queueing a run if it is connected and available.</p>
      ) : null}
    </article>
  );
}
