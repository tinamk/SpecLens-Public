"use client";

import type { AiAgent, AiRole, AiSkill, AiToolCapability, CodexAuthStatus, Source, Workspace } from "@speclens/contracts";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

function getApiBaseUrl(): string {
  return "/api/proxy";
}

async function requestJson<T>(method: "GET" | "POST" | "PUT" | "DELETE", pathname: string, payload?: unknown): Promise<T> {
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

function readOptionalNumber(value: FormDataEntryValue | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readOptionalText(value: FormDataEntryValue | null): string | undefined {
  if (value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function upsertById<T extends { id?: string | null }>(items: T[], next: T): T[] {
  const nextId = next.id;
  if (!nextId) {
    return [...items, next];
  }

  const index = items.findIndex(item => item.id === nextId);
  if (index === -1) {
    return [...items, next];
  }
  const copy = [...items];
  copy[index] = next;
  return copy;
}

function sortByOrder<T extends { order?: number | null; name?: string | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const orderDifference = (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);
    if (orderDifference !== 0) {
      return orderDifference;
    }

    return (a.name ?? "").localeCompare(b.name ?? "");
  });
}

const availableToolCapabilities: AiToolCapability[] = [
  "repo-read",
  "shell-exec",
  "http-fetch",
  "browser-automation",
  "artifact-write",
  "package-install",
  "dev-server",
  "test-exec",
  "auth-state",
];

export function AdminAiPanel({
  section,
  initialAuth,
  initialSkills,
  initialRoles,
  initialAgents,
  workspaces,
}: {
  section: "auth" | "skills" | "roles" | "agents";
  initialAuth: CodexAuthStatus;
  initialSkills: AiSkill[];
  initialRoles: AiRole[];
  initialAgents: AiAgent[];
  workspaces: Array<{ workspace: Workspace; sources: Source[] }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [auth, setAuth] = useState(initialAuth);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [skills, setSkills] = useState(initialSkills);
  const [roles, setRoles] = useState(initialRoles);
  const [agents, setAgents] = useState(initialAgents);
  const [authError, setAuthError] = useState<string | null>(null);
  const [skillError, setSkillError] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const authRequestInFlightRef = useRef(false);

  useEffect(() => setAuth(initialAuth), [initialAuth]);
  useEffect(() => setSkills(initialSkills), [initialSkills]);
  useEffect(() => setRoles(initialRoles), [initialRoles]);
  useEffect(() => setAgents(initialAgents), [initialAgents]);

  const refreshAuthStatus = async (options?: {
    silent?: boolean;
    refreshRoute?: boolean;
  }): Promise<CodexAuthStatus | null> => {
    if (authRequestInFlightRef.current) {
      return null;
    }
    authRequestInFlightRef.current = true;
    if (!options?.silent) {
      setAuthError(null);
    }
    try {
      const payload = await requestJson<{ auth: CodexAuthStatus }>("POST", "/api/admin/ai/auth/verify");
      setAuth(payload.auth);
      if (options?.refreshRoute || payload.auth.status !== "pending") {
        router.refresh();
      }
      return payload.auth;
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Verification failed.");
      return null;
    } finally {
      authRequestInFlightRef.current = false;
    }
  };

  useEffect(() => {
    if (auth.status !== "pending") return undefined;
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
  }, [auth.intervalSeconds, auth.status, router]);

  const authLabel = useMemo(() => {
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
  }, [auth.status]);

  const authTone = useMemo(() => {
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
  }, [auth.status]);

  const verificationUrl = auth.verificationUriComplete ?? auth.verificationUri ?? null;

  const formatTimestamp = (value: string | null | undefined): string | null => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
  };

  const handleCopyCode = async () => {
    if (!auth.userCode) return;
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

  const workspaceOptions = workspaces.map(entry => entry.workspace);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(workspaceOptions[0]?.id ?? "");
  const availableSources = useMemo(() => {
    return workspaces.find(entry => entry.workspace.id === selectedWorkspaceId)?.sources ?? [];
  }, [selectedWorkspaceId, workspaces]);
  const [selectedSourceId, setSelectedSourceId] = useState(availableSources[0]?.id ?? "");
  const [selectedCompanionSourceId, setSelectedCompanionSourceId] = useState("");
  const availableCompanionSources = useMemo(
    () => availableSources.filter(source => source.id !== selectedSourceId),
    [availableSources, selectedSourceId],
  );
  const [selectedAgentId, setSelectedAgentId] = useState(initialAgents[0]?.id ?? "");
  const selectedAgent = useMemo(
    () => agents.find(agent => agent.id === selectedAgentId) ?? agents[0] ?? null,
    [agents, selectedAgentId],
  );
  const selectedAgentRoles = useMemo(() => {
    if (!selectedAgent) {
      return [] as AiRole[];
    }
    return selectedAgent.roles
      .map(link => roles.find(role => role.id === link.id))
      .filter((role): role is AiRole => role != null);
  }, [roles, selectedAgent]);
  const selectedAgentSkills = useMemo(() => {
    const seen = new Set<string>();
    const ordered: AiSkill[] = [];
    for (const role of selectedAgentRoles) {
      for (const link of role.skills) {
        const skill = skills.find(candidate => candidate.id === link.id);
        if (!skill || seen.has(skill.id)) {
          continue;
        }
        seen.add(skill.id);
        ordered.push(skill);
      }
    }
    return ordered;
  }, [selectedAgentRoles, skills]);
  const selectedAgentToolCapabilities = useMemo(() => {
    return [...new Set(selectedAgentSkills.flatMap(skill => skill.toolCapabilities ?? []))];
  }, [selectedAgentSkills]);

  useEffect(() => {
    setSelectedSourceId(availableSources[0]?.id ?? "");
  }, [availableSources]);

  useEffect(() => {
    if (selectedCompanionSourceId && !availableCompanionSources.some(source => source.id === selectedCompanionSourceId)) {
      setSelectedCompanionSourceId("");
    }
  }, [availableCompanionSources, selectedCompanionSourceId]);

  useEffect(() => {
    if (!selectedWorkspaceId && workspaceOptions[0]) {
      setSelectedWorkspaceId(workspaceOptions[0].id);
    }
  }, [selectedWorkspaceId, workspaceOptions]);

  useEffect(() => {
    if (selectedAgentId && agents.some(agent => agent.id === selectedAgentId)) {
      return;
    }
    setSelectedAgentId(agents[0]?.id ?? "");
  }, [agents, selectedAgentId]);

  const showAuth = section === "auth";
  const showSkills = section === "skills";
  const showRoles = section === "roles";
  const showAgents = section === "agents";

  return (
    <>
      {showAuth ? (
        <section className="portal-grid">
          <article className="portal-panel" data-testid="admin-ai-auth-panel">
          <h2>Codex device auth</h2>
          <div className="auth-status">
            <div>
              <p className="subtle-note">Status</p>
              <p className="auth-status__label">{authLabel}</p>
            </div>
            <span className={`status-pill status-pill--${authTone}`}>{auth.status}</span>
          </div>

          {auth.status === "ready" ? (
            <div className="auth-callout auth-callout--ready">
              <p className="auth-callout__title">Authenticated</p>
              <p className="subtle-note">Codex CLI is connected and ready for agent runs.</p>
              {auth.accountId ? <p><strong>Account:</strong> {auth.accountId}</p> : null}
              {auth.lastRefresh ? <p><strong>Last refresh:</strong> {formatTimestamp(auth.lastRefresh)}</p> : null}
            </div>
          ) : null}

          {auth.status === "pending" ? (
            <div className="auth-callout">
              <p className="auth-callout__title">Device code ready</p>
              <ol className="bullet-list">
                <li>Open the verification page.</li>
                <li>Enter the device code shown below.</li>
                <li>We will auto-check the status, or you can click “Check status”.</li>
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
              {auth.expiresAt ? <p className="subtle-note">Expires {formatTimestamp(auth.expiresAt)}</p> : null}
              {auth.intervalSeconds ? (
                <p className="subtle-note">Auto-checking every {auth.intervalSeconds}s.</p>
              ) : (
                <p className="subtle-note">Auto-checking every 5s.</p>
              )}
            </div>
          ) : null}

          {auth.status === "unauthenticated" ? (
            <p className="subtle-note">Start the device flow to generate a verification code.</p>
          ) : null}

          {auth.status === "error" && auth.lastError ? (
            <div className="auth-callout auth-callout--error">
              <p className="auth-callout__title">Authentication failed</p>
              <p className="inline-error">{auth.lastError}</p>
            </div>
          ) : null}

          <div className="stack-form">
            <button
              className="button"
              type="button"
              data-testid="admin-ai-auth-start"
              disabled={pending}
              onClick={() => {
                setAuthError(null);
                startTransition(async () => {
                  try {
                    const payload = await requestJson<{ auth: CodexAuthStatus }>("POST", "/api/admin/ai/auth/device");
                    setAuth(payload.auth);
                  } catch (error) {
                    setAuthError(error instanceof Error ? error.message : "Failed to start device flow.");
                  }
                });
              }}
            >
              {pending ? "Starting..." : "Start device flow"}
            </button>
            <button
              className="button-secondary"
              type="button"
              data-testid="admin-ai-auth-check"
              disabled={pending}
              onClick={() => {
                startTransition(async () => {
                  await refreshAuthStatus({ refreshRoute: true });
                });
              }}
            >
              {pending ? "Checking..." : "Check status"}
            </button>
            <button
              className="button-ghost"
              type="button"
              data-testid="admin-ai-auth-logout"
              disabled={pending}
              onClick={() => {
                setAuthError(null);
                startTransition(async () => {
                  try {
                    const payload = await requestJson<{ auth: CodexAuthStatus }>("POST", "/api/admin/ai/auth/logout");
                    setAuth(payload.auth);
                    router.refresh();
                  } catch (error) {
                    setAuthError(error instanceof Error ? error.message : "Logout failed.");
                  }
                });
              }}
            >
              Logout
            </button>
            {authError ? <p className="inline-error" role="alert">{authError}</p> : null}
          </div>
          </article>
        </section>
      ) : null}

      {showAgents ? (
        <section className="portal-grid">
          <article className="portal-panel" data-testid="admin-ai-run-panel">
          <h2>Run agent analysis</h2>
          <form
            className="stack-form"
            data-testid="admin-ai-run-form"
            onSubmit={event => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              const agentId = String(formData.get("agentId") ?? "");
              const workspaceId = String(formData.get("workspaceId") ?? "");
              const sourceId = String(formData.get("sourceId") ?? "");
              const companionSourceId = String(formData.get("companionSourceId") ?? "");
              setRunError(null);
              setRunResult(null);

              startTransition(async () => {
                try {
                  const payload = await requestJson<{ job: { job: { id: string } } }>(
                    "POST",
                    `/api/admin/ai/agents/${agentId}/run`,
                    { workspaceId, sourceId, ...(companionSourceId ? { companionSourceId } : {}) },
                  );
                  setRunResult(`Queued job ${payload.job.job.id}`);
                  router.refresh();
                } catch (error) {
                  setRunError(error instanceof Error ? error.message : "Failed to queue agent run.");
                }
              });
            }}
          >
            <label className="field">
              <span>Agent</span>
              <select
                name="agentId"
                required
                value={selectedAgentId}
                onChange={event => setSelectedAgentId(event.target.value)}
              >
                {agents.length === 0 ? <option value="">Create an agent first</option> : null}
                {agents.map(agent => (
                  <option key={agent.id} value={agent.id}>{agent.name}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Workspace</span>
              <select
                name="workspaceId"
                required
                value={selectedWorkspaceId}
                onChange={event => setSelectedWorkspaceId(event.target.value)}
              >
                {workspaceOptions.length === 0 ? <option value="">Create a workspace first</option> : null}
                {workspaceOptions.map(workspace => (
                  <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Source</span>
              <select
                name="sourceId"
                required
                value={selectedSourceId}
                onChange={event => setSelectedSourceId(event.target.value)}
              >
                {availableSources.length === 0 ? <option value="">Add a source first</option> : null}
                {availableSources.map(source => (
                  <option key={source.id} value={source.id}>{source.displayName}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Companion source</span>
              <select
                name="companionSourceId"
                value={selectedCompanionSourceId}
                onChange={event => setSelectedCompanionSourceId(event.target.value)}
              >
                <option value="">None</option>
                {availableCompanionSources.map(source => (
                  <option key={source.id} value={source.id}>{source.displayName}</option>
                ))}
              </select>
            </label>
            <div className="field" data-testid="admin-ai-run-agent-summary">
              <span>Execution plan</span>
              {selectedAgent ? (
                <div className="subtle-note">
                  <p><strong>Agent:</strong> {selectedAgent.name}</p>
                  {selectedAgent.description ? <p>{selectedAgent.description}</p> : null}
                  <p><strong>Role count:</strong> {selectedAgentRoles.length}</p>
                  <p><strong>Skill count:</strong> {selectedAgentSkills.length}</p>
                  <p><strong>Runtime:</strong> Unified agent planning with native executor support.</p>
                  {selectedAgentToolCapabilities.length > 0 ? (
                    <p><strong>Tool grants:</strong> {selectedAgentToolCapabilities.join(", ")}</p>
                  ) : (
                    <p><strong>Tool grants:</strong> None declared.</p>
                  )}
                </div>
              ) : (
                <p className="subtle-note">Select or create an agent to inspect its execution plan.</p>
              )}
            </div>
            <button
              className="button"
              type="submit"
              data-testid="admin-ai-run-submit"
              disabled={pending || agents.length === 0 || workspaceOptions.length === 0 || availableSources.length === 0}
            >
              {pending ? "Queueing..." : "Queue agent run"}
            </button>
            {runResult ? <p className="subtle-note" role="status">{runResult}</p> : null}
            {runError ? <p className="inline-error" role="alert">{runError}</p> : null}
          </form>
          </article>
        </section>
      ) : null}

      {showSkills ? (
        <section className="portal-grid">
          <article className="portal-panel" data-testid="admin-ai-skill-panel">
          <h2>Skills</h2>
          <form
            className="stack-form"
            data-testid="admin-ai-skill-create-form"
            onSubmit={event => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              const payload = {
                name: String(formData.get("name") ?? "").trim(),
                description: readOptionalText(formData.get("description")),
                instructions: String(formData.get("instructions") ?? "").trim(),
                toolCapabilities: formData.getAll("toolCapabilities").map(value => String(value)),
                order: readOptionalNumber(formData.get("order")),
              };
              setSkillError(null);
              startTransition(async () => {
                try {
                  const response = await requestJson<{ skill: AiSkill }>("POST", "/api/admin/ai/skills", payload);
                  setSkills(current => sortByOrder<AiSkill>(upsertById<AiSkill>(current, response.skill)));
                  (event.currentTarget as HTMLFormElement).reset();
                  router.refresh();
                } catch (error) {
                  setSkillError(error instanceof Error ? error.message : "Skill creation failed.");
                }
              });
            }}
          >
            <label className="field">
              <span>Name</span>
              <input name="name" required placeholder="Repo context" />
            </label>
            <label className="field">
              <span>Description</span>
              <input name="description" placeholder="Optional description" />
            </label>
            <label className="field">
              <span>Order</span>
              <input name="order" type="number" min={0} placeholder="0" />
            </label>
            <label className="field">
              <span>Instructions</span>
              <textarea name="instructions" rows={4} required placeholder="Describe how this skill should behave." />
            </label>
            <label className="field">
              <span>Tool grants</span>
              <select name="toolCapabilities" multiple defaultValue={[]}>
                {availableToolCapabilities.map(capability => (
                  <option key={capability} value={capability}>{capability}</option>
                ))}
              </select>
            </label>
            <button className="button-secondary" data-testid="admin-ai-skill-create-submit" type="submit" disabled={pending}>Add skill</button>
            {skillError ? <p className="inline-error" role="alert">{skillError}</p> : null}
          </form>
          {skills.length === 0 ? <p>No skills yet.</p> : null}
          {skills.map(skill => (
            <form
              className="stack-form"
              data-testid={`admin-ai-skill-form-${skill.id}`}
              key={skill.id}
              onSubmit={event => {
                event.preventDefault();
                const formData = new FormData(event.currentTarget);
                const payload = {
                  name: String(formData.get("name") ?? "").trim(),
                  description: readOptionalText(formData.get("description")),
                  instructions: String(formData.get("instructions") ?? "").trim(),
                  toolCapabilities: formData.getAll("toolCapabilities").map(value => String(value)),
                  order: readOptionalNumber(formData.get("order")),
                };
                setSkillError(null);
                startTransition(async () => {
                  try {
                    const response = await requestJson<{ skill: AiSkill }>("PUT", `/api/admin/ai/skills/${skill.id}`, payload);
                    setSkills(current => sortByOrder<AiSkill>(upsertById<AiSkill>(current, response.skill)));
                    router.refresh();
                  } catch (error) {
                    setSkillError(error instanceof Error ? error.message : "Skill update failed.");
                  }
                });
              }}
            >
              <label className="field">
                <span>Name</span>
                <input name="name" defaultValue={skill.name} required />
              </label>
              <label className="field">
                <span>Description</span>
                <input name="description" defaultValue={skill.description ?? ""} />
              </label>
              <label className="field">
                <span>Order</span>
                <input name="order" type="number" min={0} defaultValue={skill.order} />
              </label>
              <label className="field">
                <span>Instructions</span>
                <textarea name="instructions" rows={4} defaultValue={skill.instructions} required />
              </label>
              <label className="field">
                <span>Tool grants</span>
                <select name="toolCapabilities" multiple defaultValue={skill.toolCapabilities}>
                  {availableToolCapabilities.map(capability => (
                    <option key={capability} value={capability}>{capability}</option>
                  ))}
                </select>
              </label>
              <p className="subtle-note">Granted: {skill.toolCapabilities.join(", ") || "repo-read"}</p>
              <div className="list-row">
                <button className="button-ghost" data-testid={`admin-ai-skill-update-${skill.id}`} type="submit" disabled={pending}>Update</button>
                <button
                  className="button-ghost"
                  type="button"
                  data-testid={`admin-ai-skill-delete-${skill.id}`}
                  disabled={pending}
                  onClick={() => {
                    setSkillError(null);
                    startTransition(async () => {
                      try {
                        await requestJson<{ ok: boolean }>("DELETE", `/api/admin/ai/skills/${skill.id}`);
                        setSkills(current => current.filter(item => item.id !== skill.id));
                        router.refresh();
                      } catch (error) {
                        setSkillError(error instanceof Error ? error.message : "Skill deletion failed.");
                      }
                    });
                  }}
                >
                  Delete
                </button>
              </div>
            </form>
          ))}
          </article>
        </section>
      ) : null}

      {showRoles ? (
        <section className="portal-grid">
          <article className="portal-panel" data-testid="admin-ai-role-panel">
          <h2>Roles</h2>
          <form
            className="stack-form"
            data-testid="admin-ai-role-create-form"
            onSubmit={event => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              const payload = {
                name: String(formData.get("name") ?? "").trim(),
                description: readOptionalText(formData.get("description")),
                prompt: String(formData.get("prompt") ?? "").trim(),
                order: readOptionalNumber(formData.get("order")),
                consoleVisibility: String(formData.get("consoleVisibility") ?? "normal"),
                executorKind: String(formData.get("executorKind") ?? "codex"),
                nativeExecutorId: readOptionalText(formData.get("nativeExecutorId")),
                dependsOnRoleIds: formData.getAll("dependsOnRoleIds").map(value => String(value)),
                skillIds: formData.getAll("skillIds").map(value => String(value)),
              };
              setRoleError(null);
              startTransition(async () => {
                try {
                  const response = await requestJson<{ role: AiRole }>("POST", "/api/admin/ai/roles", payload);
                  setRoles(current => sortByOrder<AiRole>(upsertById<AiRole>(current, response.role)));
                  (event.currentTarget as HTMLFormElement).reset();
                  router.refresh();
                } catch (error) {
                  setRoleError(error instanceof Error ? error.message : "Role creation failed.");
                }
              });
            }}
          >
            <label className="field">
              <span>Name</span>
              <input name="name" required placeholder="Spec parity" />
            </label>
            <label className="field">
              <span>Description</span>
              <input name="description" placeholder="Optional description" />
            </label>
            <label className="field">
              <span>Order</span>
              <input name="order" type="number" min={0} placeholder="0" />
            </label>
            <label className="field">
              <span>Prompt</span>
              <textarea name="prompt" rows={4} required placeholder="Role instructions" />
            </label>
            <label className="field">
              <span>Console visibility</span>
              <select name="consoleVisibility" defaultValue="normal">
                <option value="normal">normal</option>
                <option value="quiet">quiet</option>
              </select>
            </label>
            <label className="field">
              <span>Executor</span>
              <select name="executorKind" defaultValue="codex">
                <option value="codex">codex</option>
                <option value="native">native</option>
                <option value="hybrid">hybrid</option>
              </select>
            </label>
            <label className="field">
              <span>Native executor id</span>
              <input name="nativeExecutorId" placeholder="native-browser-suite" />
            </label>
            <label className="field">
              <span>Dependencies</span>
              <select name="dependsOnRoleIds" multiple defaultValue={[]}>
                {roles.map(role => (
                  <option key={role.id} value={role.id}>{role.name}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Skills</span>
              <select name="skillIds" multiple defaultValue={[]}>
                {skills.map(skill => (
                  <option key={skill.id} value={skill.id}>{skill.name}</option>
                ))}
              </select>
            </label>
            <button className="button-secondary" data-testid="admin-ai-role-create-submit" type="submit" disabled={pending}>Add role</button>
            {roleError ? <p className="inline-error" role="alert">{roleError}</p> : null}
          </form>
          {roles.length === 0 ? <p>No roles yet.</p> : null}
          {roles.map(role => (
            <form
              className="stack-form"
              data-testid={`admin-ai-role-form-${role.id}`}
              key={role.id}
              onSubmit={event => {
                event.preventDefault();
                const formData = new FormData(event.currentTarget);
                const payload = {
                  name: String(formData.get("name") ?? "").trim(),
                  description: readOptionalText(formData.get("description")),
                  prompt: String(formData.get("prompt") ?? "").trim(),
                  order: readOptionalNumber(formData.get("order")),
                  consoleVisibility: String(formData.get("consoleVisibility") ?? "normal"),
                  executorKind: String(formData.get("executorKind") ?? "codex"),
                  nativeExecutorId: readOptionalText(formData.get("nativeExecutorId")),
                  dependsOnRoleIds: formData.getAll("dependsOnRoleIds").map(value => String(value)),
                  skillIds: formData.getAll("skillIds").map(value => String(value)),
                };
                setRoleError(null);
                startTransition(async () => {
                  try {
                    const response = await requestJson<{ role: AiRole }>("PUT", `/api/admin/ai/roles/${role.id}`, payload);
                    setRoles(current => sortByOrder<AiRole>(upsertById<AiRole>(current, response.role)));
                    router.refresh();
                  } catch (error) {
                    setRoleError(error instanceof Error ? error.message : "Role update failed.");
                  }
                });
              }}
            >
              <label className="field">
                <span>Name</span>
                <input name="name" defaultValue={role.name} required />
              </label>
              <label className="field">
                <span>Description</span>
                <input name="description" defaultValue={role.description ?? ""} />
              </label>
              <label className="field">
                <span>Order</span>
                <input name="order" type="number" min={0} defaultValue={role.order} />
              </label>
              <label className="field">
                <span>Prompt</span>
                <textarea name="prompt" rows={4} defaultValue={role.prompt} required />
              </label>
              <label className="field">
                <span>Console visibility</span>
                <select name="consoleVisibility" defaultValue={role.consoleVisibility}>
                  <option value="normal">normal</option>
                  <option value="quiet">quiet</option>
                </select>
              </label>
              <label className="field">
                <span>Executor</span>
                <select name="executorKind" defaultValue={role.executorKind}>
                  <option value="codex">codex</option>
                  <option value="native">native</option>
                  <option value="hybrid">hybrid</option>
                </select>
              </label>
              <label className="field">
                <span>Native executor id</span>
                <input name="nativeExecutorId" defaultValue={role.nativeExecutorId ?? ""} />
              </label>
              <label className="field">
                <span>Dependencies</span>
                <select name="dependsOnRoleIds" multiple defaultValue={role.dependsOnRoleIds}>
                  {roles.filter(candidate => candidate.id !== role.id).map(candidate => (
                    <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Skills</span>
                <select name="skillIds" multiple defaultValue={role.skills.map(skill => skill.id)}>
                  {skills.map(skill => (
                    <option key={skill.id} value={skill.id}>{skill.name}</option>
                  ))}
                </select>
              </label>
              <div className="list-row">
                <button className="button-ghost" data-testid={`admin-ai-role-update-${role.id}`} type="submit" disabled={pending}>Update</button>
                <button
                  className="button-ghost"
                  type="button"
                  data-testid={`admin-ai-role-delete-${role.id}`}
                  disabled={pending}
                  onClick={() => {
                    setRoleError(null);
                    startTransition(async () => {
                      try {
                        await requestJson<{ ok: boolean }>("DELETE", `/api/admin/ai/roles/${role.id}`);
                        setRoles(current => current.filter(item => item.id !== role.id));
                        router.refresh();
                      } catch (error) {
                        setRoleError(error instanceof Error ? error.message : "Role deletion failed.");
                      }
                    });
                  }}
                >
                  Delete
                </button>
              </div>
            </form>
          ))}
          </article>
        </section>
      ) : null}

      {showAgents ? (
        <section className="portal-grid">
          <article className="portal-panel" data-testid="admin-ai-agent-panel">
          <h2>Agents</h2>
          <form
            className="stack-form"
            data-testid="admin-ai-agent-create-form"
            onSubmit={event => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              const payload = {
                name: String(formData.get("name") ?? "").trim(),
                description: readOptionalText(formData.get("description")),
                order: readOptionalNumber(formData.get("order")),
                roleIds: formData.getAll("roleIds").map(value => String(value)),
              };
              setAgentError(null);
              startTransition(async () => {
                try {
                  const response = await requestJson<{ agent: AiAgent }>("POST", "/api/admin/ai/agents", payload);
                  setAgents(current => sortByOrder<AiAgent>(upsertById<AiAgent>(current, response.agent)));
                  (event.currentTarget as HTMLFormElement).reset();
                  router.refresh();
                } catch (error) {
                  setAgentError(error instanceof Error ? error.message : "Agent creation failed.");
                }
              });
            }}
          >
            <label className="field">
              <span>Name</span>
              <input name="name" required placeholder="SpecLens agent" />
            </label>
            <label className="field">
              <span>Description</span>
              <input name="description" placeholder="Optional description" />
            </label>
            <label className="field">
              <span>Order</span>
              <input name="order" type="number" min={0} placeholder="0" />
            </label>
            <label className="field">
              <span>Roles</span>
              <select name="roleIds" multiple defaultValue={[]}>
                {roles.map(role => (
                  <option key={role.id} value={role.id}>{role.name}</option>
                ))}
              </select>
            </label>
            <button className="button-secondary" data-testid="admin-ai-agent-create-submit" type="submit" disabled={pending}>Add agent</button>
            {agentError ? <p className="inline-error" role="alert">{agentError}</p> : null}
          </form>
          {agents.length === 0 ? <p>No agents yet.</p> : null}
          {agents.map(agent => (
            <form
              className="stack-form"
              data-testid={`admin-ai-agent-form-${agent.id}`}
              key={agent.id}
              onSubmit={event => {
                event.preventDefault();
                const formData = new FormData(event.currentTarget);
                const payload = {
                  name: String(formData.get("name") ?? "").trim(),
                  description: readOptionalText(formData.get("description")),
                  order: readOptionalNumber(formData.get("order")),
                  roleIds: formData.getAll("roleIds").map(value => String(value)),
                };
                setAgentError(null);
                startTransition(async () => {
                  try {
                    const response = await requestJson<{ agent: AiAgent }>("PUT", `/api/admin/ai/agents/${agent.id}`, payload);
                    setAgents(current => sortByOrder<AiAgent>(upsertById<AiAgent>(current, response.agent)));
                    router.refresh();
                  } catch (error) {
                    setAgentError(error instanceof Error ? error.message : "Agent update failed.");
                  }
                });
              }}
            >
              <label className="field">
                <span>Name</span>
                <input name="name" defaultValue={agent.name} required />
              </label>
              <label className="field">
                <span>Description</span>
                <input name="description" defaultValue={agent.description ?? ""} />
              </label>
              <label className="field">
                <span>Order</span>
                <input name="order" type="number" min={0} defaultValue={agent.order} />
              </label>
              <label className="field">
                <span>Roles</span>
                <select name="roleIds" multiple defaultValue={agent.roles.map(role => role.id)}>
                  {roles.map(role => (
                    <option key={role.id} value={role.id}>{role.name}</option>
                  ))}
                </select>
              </label>
              <div className="list-row">
                <button className="button-ghost" data-testid={`admin-ai-agent-update-${agent.id}`} type="submit" disabled={pending}>Update</button>
                <button
                  className="button-ghost"
                  type="button"
                  data-testid={`admin-ai-agent-delete-${agent.id}`}
                  disabled={pending}
                  onClick={() => {
                    setAgentError(null);
                    startTransition(async () => {
                      try {
                        await requestJson<{ ok: boolean }>("DELETE", `/api/admin/ai/agents/${agent.id}`);
                        setAgents(current => current.filter(item => item.id !== agent.id));
                        router.refresh();
                      } catch (error) {
                        setAgentError(error instanceof Error ? error.message : "Agent deletion failed.");
                      }
                    });
                  }}
                >
                  Delete
                </button>
              </div>
            </form>
          ))}
          </article>
        </section>
      ) : null}
    </>
  );
}
