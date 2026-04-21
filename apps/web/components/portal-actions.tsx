"use client";

import {
  type GithubRepository,
  parseAnalysisExecutionStepEvent,
  type AnalysisExecutionStep,
  type AnalysisLogEvent,
  type BillingPortalSessionResponse,
  type JobEnvelope,
  type ReportExportResponse,
  type Source,
  type WorkspaceMemberSummary,
  type WorkspaceSecret,
} from "@speclens/contracts";
import type { PortalAnalysisTask } from "../lib/api";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

function getApiBaseUrl(): string {
  return "/api/proxy";
}

function scopedTestId(prefix: string, suffix: string): string {
  return `${prefix}-${suffix}`;
}

function encodeGithubRepositorySelection(repository: GithubRepository): string {
  return JSON.stringify({
    location: repository.cloneUrl,
    githubInstallationId: repository.githubInstallationId,
  });
}

function decodeGithubRepositorySelection(value: string): {
  location: string;
  githubInstallationId: string;
} {
  try {
    const payload = JSON.parse(value) as { location?: unknown; githubInstallationId?: unknown };
    if (typeof payload.location !== "string" || typeof payload.githubInstallationId !== "string") {
      throw new Error("missing fields");
    }
    return {
      location: payload.location,
      githubInstallationId: payload.githubInstallationId,
    };
  } catch {
    throw new Error("Choose a connected GitHub repository before adding the source.");
  }
}

function isVerifiedSource(source: { verificationStatus?: string }): boolean {
  return source.verificationStatus === "verified";
}

function formatSourceVerification(source: { verificationStatus?: string; verificationError?: string | null }): string {
  if (source.verificationStatus === "failed") {
    return source.verificationError ? `verification failed: ${source.verificationError}` : "verification failed";
  }
  if (source.verificationStatus === "pending") {
    return "verification pending";
  }
  return "verified";
}

function getVisibleLogs(logs: AnalysisLogEvent[]): AnalysisLogEvent[] {
  return logs.filter(log => !parseAnalysisExecutionStepEvent(log.message));
}

function formatStepDuration(step: AnalysisExecutionStep): string {
  if (step.durationMs === null || step.durationMs < 1000) {
    return step.durationMs === null ? "pending" : `${step.durationMs}ms`;
  }
  const seconds = Math.round(step.durationMs / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function applyExecutionStep(
  current: AnalysisExecutionStep[],
  update: AnalysisExecutionStep,
): AnalysisExecutionStep[] {
  const next = new Map(current.map(step => [step.id, step] as const));
  const previous = next.get(update.id);
  next.set(update.id, previous ? { ...previous, ...update } : update);
  return [...next.values()].sort((left, right) => left.order - right.order);
}

async function readErrorMessage(response: Response): Promise<string> {
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

async function postJson<T>(pathname: string, payload: unknown): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return await response.json() as T;
}

async function patchJson<T>(pathname: string, payload: unknown): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${pathname}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return await response.json() as T;
}

async function deleteJson<T>(pathname: string): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${pathname}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return await response.json() as T;
}

async function postFormData<T>(pathname: string, payload: FormData): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${pathname}`, {
    method: "POST",
    body: payload,
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return await response.json() as T;
}

function getJobStatusTone(status: string): string {
  if (status === "succeeded") return "status-pill status-pill--ready";
  if (status === "queued" || status === "running") return "status-pill status-pill--pending";
  if (status === "failed" || status === "cancelled") return "status-pill status-pill--error";
  return "status-pill status-pill--idle";
}

function formatSourceTypeLabel(type: string): string {
  if (type === "git-public") return "public git";
  if (type === "github-private") return "private GitHub";
  if (type === "upload-archive") return "git repo archive";
  return type;
}

function taskSupportsBrowserRuntime(task: PortalAnalysisTask | null): boolean {
  return task?.toolCapabilities.includes("browser-automation") ?? false;
}

export function CreateWorkspaceForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="stack-form"
      data-testid="workspace-index-create-form"
      onSubmit={event => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const name = String(formData.get("name") ?? "").trim();
        const description = String(formData.get("description") ?? "").trim();
        setError(null);

        startTransition(async () => {
          try {
            const payload = await postJson<{ workspace: { id: string } }>("/api/workspaces", {
              name,
              description,
            });
            router.push(`/portal/workspaces/${payload.workspace.id}` as Route);
            router.refresh();
          } catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Workspace creation failed.");
          }
        });
      }}
    >
      <label className="field">
        <span>Workspace name</span>
        <input data-testid="workspace-index-name-input" name="name" placeholder="Platform Team" required />
      </label>
      <label className="field">
        <span>Description</span>
        <textarea
          data-testid="workspace-index-description-input"
          name="description"
          placeholder="Shared workspace for repo analysis and reports."
          rows={3}
        />
      </label>
      <button className="button" data-testid="workspace-index-submit" type="submit" disabled={pending}>
        {pending ? "Creating..." : "Create workspace"}
      </button>
      {error ? <p className="inline-error" data-testid="workspace-index-error" role="alert">{error}</p> : null}
    </form>
  );
}

export function CreateSourceForm({
  workspaceId,
  entitlement,
  githubRepositories = [],
  testIdPrefix = "workspace-sources",
}: {
  workspaceId: string;
  entitlement: "free" | "pro" | "commercial";
  githubRepositories?: GithubRepository[];
  testIdPrefix?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [type, setType] = useState<"git-public" | "github-private" | "upload-archive">(
    entitlement === "free" ? "git-public" : "upload-archive",
  );
  const githubRepositoryGroups = useMemo(() => {
    const groups = new Map<string, {
      githubInstallationId: string;
      githubAccountLogin: string;
      repositories: GithubRepository[];
    }>();
    for (const repository of githubRepositories) {
      const current = groups.get(repository.githubInstallationId);
      if (current) {
        current.repositories.push(repository);
        continue;
      }
      groups.set(repository.githubInstallationId, {
        githubInstallationId: repository.githubInstallationId,
        githubAccountLogin: repository.githubAccountLogin,
        repositories: [repository],
      });
    }
    return [...groups.values()];
  }, [githubRepositories]);
  const initialGithubRepositorySelection = githubRepositories[0]
    ? encodeGithubRepositorySelection(githubRepositories[0])
    : "";
  const [selectedGithubRepository, setSelectedGithubRepository] = useState(initialGithubRepositorySelection);

  useEffect(() => {
    setSelectedGithubRepository(initialGithubRepositorySelection);
  }, [initialGithubRepositorySelection]);

  const showPrivateRepositorySelect = type === "github-private" && githubRepositories.length > 0;
  const requiresArchiveUpload = type === "upload-archive";

  return (
    <form
      className="stack-form"
      data-testid={scopedTestId(testIdPrefix, "create-form")}
      onSubmit={event => {
        event.preventDefault();
        const form = event.currentTarget;
        const formData = new FormData(event.currentTarget);
        const displayName = String(formData.get("displayName") ?? "").trim();
        let location = String(formData.get("location") ?? "").trim();
        let githubInstallationId: string | undefined;
        const archive = formData.get("archive");
        setError(null);
        setSuccess(null);

        startTransition(async () => {
          try {
            if (requiresArchiveUpload) {
              if (!(archive instanceof File) || archive.size === 0) {
                throw new Error("Choose an archive file before uploading.");
              }
              const uploadPayload = new FormData();
              uploadPayload.set("archive", archive);
              await postFormData(`/api/workspaces/${workspaceId}/uploads`, uploadPayload);
              setSuccess(`${archive.name} uploaded and added as a source.`);
            } else {
              if (type === "github-private" && showPrivateRepositorySelect) {
                const selection = decodeGithubRepositorySelection(String(formData.get("githubRepository") ?? ""));
                location = selection.location;
                githubInstallationId = selection.githubInstallationId;
              }
              await postJson(`/api/workspaces/${workspaceId}/sources`, {
                type,
                displayName,
                location,
                ...(githubInstallationId ? { githubInstallationId } : {}),
              });
              setSuccess(`${displayName} added to the workspace.`);
            }
            form.reset();
            setType(entitlement === "free" ? "git-public" : "upload-archive");
            setSelectedGithubRepository(initialGithubRepositorySelection);
            router.refresh();
          } catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Source creation failed.");
          }
        });
      }}
    >
      <label className="field">
        <span>Source type</span>
        <select
          data-testid={scopedTestId(testIdPrefix, "type-select")}
          name="type"
          value={type}
          onChange={event => setType(event.target.value as typeof type)}
        >
          <option value="upload-archive" disabled={entitlement === "free"}>Git repo archive upload</option>
              <option value="git-public">Public Git repo (approved host)</option>
          <option value="github-private" disabled={entitlement === "free"}>Private GitHub repo</option>
        </select>
      </label>
      {entitlement === "free" ? (
        <p className="subtle-note">Free workspaces can add public Git repositories. Git repo archive upload and private GitHub repos unlock on Pro.</p>
      ) : null}

      {requiresArchiveUpload ? (
        <label className="field">
          <span>Git repo archive file</span>
          <input data-testid={scopedTestId(testIdPrefix, "archive-input")} name="archive" type="file" accept=".zip,.tar,.tgz,.tar.gz" required />
        </label>
      ) : (
        <>
          <label className="field">
            <span>Display name</span>
            <input data-testid={scopedTestId(testIdPrefix, "display-name-input")} name="displayName" placeholder="SpecLens repo" required />
          </label>
          {showPrivateRepositorySelect ? (
            <>
              <label className="field">
                <span>Connected private repositories</span>
                <select
                  data-testid={scopedTestId(testIdPrefix, "github-repository-select")}
                  name="githubRepository"
                  value={selectedGithubRepository}
                  onChange={event => setSelectedGithubRepository(event.target.value)}
                  required
                >
                  {githubRepositoryGroups.map(group => (
                    <optgroup key={group.githubInstallationId} label={group.githubAccountLogin}>
                      {group.repositories.map(repository => (
                        <option
                          key={`${repository.githubInstallationId}:${repository.id}`}
                          value={encodeGithubRepositorySelection(repository)}
                        >
                          {repository.fullName}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              {githubRepositoryGroups.length > 1 ? (
                <p className="subtle-note">
                  Repositories are grouped by installation so the selected private source keeps the correct GitHub App binding.
                </p>
              ) : null}
            </>
          ) : (
            <label className="field">
              <span>Repository URL</span>
              <input
                data-testid={scopedTestId(testIdPrefix, "location-input")}
                name="location"
                placeholder="https://github.com/org/repo, https://gitlab.com/org/repo, https://bitbucket.org/org/repo, or https://codeberg.org/org/repo"
                required
              />
            </label>
          )}
        </>
      )}
      {type === "git-public" ? (
        <p className="subtle-note">Paste a supported public HTTPS Git URL from GitHub, GitLab, Bitbucket, or Codeberg.</p>
      ) : null}
      {type === "upload-archive" ? (
        <p className="subtle-note">Upload a `.zip`, `.tar`, `.tgz`, or `.tar.gz` file that contains a Git repository, including its `.git` metadata.</p>
      ) : null}
      <button className="button-secondary" data-testid={scopedTestId(testIdPrefix, "submit")} type="submit" disabled={pending}>
        {pending ? "Adding..." : "Add source"}
      </button>
      {success ? <p className="subtle-note" data-testid={scopedTestId(testIdPrefix, "success")}>{success}</p> : null}
      {error ? <p className="inline-error" data-testid={scopedTestId(testIdPrefix, "error")} role="alert">{error}</p> : null}
    </form>
  );
}

export function SourceVerificationAction({
  workspaceId,
  source,
  testIdPrefix = "workspace-sources",
}: {
  workspaceId: string;
  source: Pick<Source, "id" | "type" | "verificationStatus">;
  testIdPrefix?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const label = (() => {
    if (source.type === "upload-archive") {
      return source.verificationStatus === "failed" ? "Retry readiness check" : "Check archive readiness";
    }
    if (source.type === "github-private") {
      return source.verificationStatus === "failed" ? "Repair GitHub access" : "Re-check GitHub access";
    }
    if (source.verificationStatus === "failed") {
      return "Retry verification";
    }
    if (source.verificationStatus === "pending") {
      return "Check verification";
    }
    return "Re-verify source";
  })();

  return (
    <div>
      <button
        className="button-secondary"
        data-testid={scopedTestId(testIdPrefix, `verify-${source.id}`)}
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              await postJson(`/api/workspaces/${workspaceId}/sources/${source.id}/verify`, {});
              router.refresh();
            } catch (requestError) {
              setError(requestError instanceof Error ? requestError.message : "Source verification failed.");
            }
          });
        }}
      >
        {pending ? "Verifying..." : label}
      </button>
      {error ? (
        <p className="inline-error" data-testid={scopedTestId(testIdPrefix, `verify-${source.id}-error`)} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function QueueAnalysisForm({
  workspaceId,
  tasks,
  sources,
  secrets = [],
  canUseSecrets = true,
  jobPathTemplate = "/portal/workspaces/{workspaceId}/runs/{jobId}",
  testIdPrefix = "workspace-runs",
}: {
  workspaceId: string;
  tasks: PortalAnalysisTask[];
  sources: Array<{ id: string; displayName: string; visibility: string; type: string; location: string; verificationStatus: string; verificationError: string | null }>;
  secrets?: WorkspaceSecret[];
  canUseSecrets?: boolean;
  jobPathTemplate?: string;
  testIdPrefix?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState(sources.find(isVerifiedSource)?.id ?? "");
  const [selectedCompanionSourceId, setSelectedCompanionSourceId] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState(tasks[0]?.agentId ?? "");
  const [selectedRuntimeMode, setSelectedRuntimeMode] = useState<"static" | "browser">(
    taskSupportsBrowserRuntime(tasks[0] ?? null) ? "browser" : "static",
  );
  const availableCompanionSources = useMemo(
    () => sources.filter(source => source.id !== selectedSourceId && isVerifiedSource(source)),
    [selectedSourceId, sources],
  );
  const selectedTask = useMemo(
    () => tasks.find(task => task.agentId === selectedTaskId) ?? tasks[0] ?? null,
    [tasks, selectedTaskId],
  );

  useEffect(() => {
    const nextReadySource = sources.find(isVerifiedSource) ?? null;
    if ((!selectedSourceId || !sources.some(source => source.id === selectedSourceId && isVerifiedSource(source))) && nextReadySource) {
      setSelectedSourceId(nextReadySource.id);
    }
  }, [selectedSourceId, sources]);

  useEffect(() => {
    if (selectedCompanionSourceId && !availableCompanionSources.some(source => source.id === selectedCompanionSourceId)) {
      setSelectedCompanionSourceId("");
    }
  }, [availableCompanionSources, selectedCompanionSourceId]);

  useEffect(() => {
    if (!selectedTaskId && tasks[0]) {
      setSelectedTaskId(tasks[0].agentId);
    }
  }, [selectedTaskId, tasks]);

  useEffect(() => {
    setSelectedRuntimeMode(taskSupportsBrowserRuntime(selectedTask) ? "browser" : "static");
  }, [selectedTask]);

  return (
    <form
      className="stack-form"
      data-testid={scopedTestId(testIdPrefix, "queue-form")}
      onSubmit={event => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const sourceId = String(formData.get("sourceId") ?? "");
        const companionSourceId = String(formData.get("companionSourceId") ?? "");
        const agentId = String(formData.get("agentId") ?? "");
        const runtimeMode = String(formData.get("runtimeMode") ?? "static");
        const secretRefs = formData.getAll("secretRefs").map(value => String(value)).filter(Boolean);
        setError(null);

        startTransition(async () => {
          try {
            const payload = await postJson<{ job: { job: { id: string } } }>(`/api/workspaces/${workspaceId}/analyze`, {
              sourceId,
              ...(companionSourceId ? { companionSourceId } : {}),
              agentId,
              ...(runtimeMode === "browser" || runtimeMode === "static" ? { runtimeMode } : {}),
              ...(secretRefs.length > 0 ? { secretRefs } : {}),
            });
            router.push(jobPathTemplate
              .replace("{workspaceId}", workspaceId)
              .replace("{jobId}", payload.job.job.id) as Route);
            router.refresh();
          } catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Analysis queueing failed.");
          }
        });
      }}
    >
      <label className="field">
        <span>Source</span>
        <select
          data-testid={scopedTestId(testIdPrefix, "source-select")}
          name="sourceId"
          required
          value={selectedSourceId}
          onChange={event => setSelectedSourceId(event.target.value)}
        >
          {sources.length === 0 ? <option value="">Add a source first</option> : null}
          {sources.length > 0 && !sources.some(isVerifiedSource) ? <option value="">No verified sources available yet</option> : null}
          {sources.map(source => (
            <option disabled={!isVerifiedSource(source)} key={source.id} value={source.id}>
              {source.displayName} ({formatSourceTypeLabel(source.type)} · {source.visibility} · {formatSourceVerification(source)})
            </option>
          ))}
        </select>
      </label>
      {sources.length > 0 ? (
        <p className="subtle-note" data-testid={scopedTestId(testIdPrefix, "source-detail")}>
          Selected source details are shown in the workspace source list below. Use Git-backed source types only: `public git`,
          `private GitHub`, or `git repo archive upload`.
        </p>
      ) : null}
      <label className="field">
        <span>Companion source</span>
        <select
          data-testid={scopedTestId(testIdPrefix, "companion-source-select")}
          name="companionSourceId"
          value={selectedCompanionSourceId}
          onChange={event => setSelectedCompanionSourceId(event.target.value)}
        >
          <option value="">None</option>
          {availableCompanionSources.map(source => (
            <option key={source.id} value={source.id}>
              {source.displayName} ({formatSourceTypeLabel(source.type)} · {source.visibility} · {formatSourceVerification(source)})
            </option>
          ))}
        </select>
      </label>
      {sources.length > 1 ? (
        <p className="subtle-note">
          Pair a deployed site with a code source to analyze both together in one run. The primary source becomes `primary/`,
          and the companion source becomes `companion/` inside the runtime bundle.
        </p>
      ) : null}
      <label className="field">
        <span>AI task</span>
        <select
          data-testid={scopedTestId(testIdPrefix, "task-select")}
          name="agentId"
          value={selectedTaskId}
          onChange={event => setSelectedTaskId(event.target.value)}
          required
        >
          {tasks.length === 0 ? <option value="">Create an AI agent task first</option> : null}
          {tasks.map(task => (
            <option key={task.id} value={task.agentId}>{task.title}</option>
          ))}
        </select>
      </label>
      {selectedTask ? (
        <div className="subtle-note" data-testid={scopedTestId(testIdPrefix, "task-description")}>
          <p><strong>{selectedTask.title}</strong> · {selectedTask.description ?? "AI-defined analysis task."}</p>
          <p>Roles: {selectedTask.roleCount} · Skills: {selectedTask.skillNames.join(", ") || "None listed"}</p>
          <p>Tool grants: {selectedTask.toolCapabilities.join(", ") || "repo-read"}</p>
        </div>
      ) : null}
      <label className="field">
        <span>Runtime mode</span>
        <select
          data-testid={scopedTestId(testIdPrefix, "runtime-mode-select")}
          name="runtimeMode"
          value={selectedRuntimeMode}
          onChange={event => setSelectedRuntimeMode(event.target.value as "static" | "browser")}
        >
          <option value="static">Static</option>
          <option value="browser" disabled={!taskSupportsBrowserRuntime(selectedTask)}>
            Browser
          </option>
        </select>
      </label>
      <p className="subtle-note" data-testid={scopedTestId(testIdPrefix, "runtime-mode-detail")}>
        {taskSupportsBrowserRuntime(selectedTask)
          ? "Browser mode asks the selected task to gather runtime and route-level evidence when the repo can boot safely."
          : "This task is currently static-only, so the run will collect repository and report evidence without runtime execution."}
      </p>
      {secrets.length > 0 && canUseSecrets ? (
        <fieldset className="field" data-testid={scopedTestId(testIdPrefix, "secrets-fieldset")}>
          <span>Workspace secrets</span>
          {secrets.map(secret => (
            <label
              key={secret.id}
              style={{ flexDirection: "row", alignItems: "center", gap: "0.75rem" }}
            >
              <input
                data-testid={scopedTestId(testIdPrefix, `secret-${secret.id}`)}
                name="secretRefs"
                type="checkbox"
                value={secret.id}
              />
              <span>{secret.name} ({secret.kind} · {secret.valuePreview})</span>
            </label>
          ))}
          <p className="subtle-note">Secret values stay write-only. Selecting one only passes its reference into the run.</p>
        </fieldset>
      ) : null}
      {secrets.length > 0 && !canUseSecrets ? (
        <p className="subtle-note" data-testid={scopedTestId(testIdPrefix, "secrets-owner-only")}>
          Only the workspace owner can attach stored workspace secrets to new runs.
        </p>
      ) : null}
      <button className="button" data-testid={scopedTestId(testIdPrefix, "submit")} type="submit" disabled={pending || sources.length === 0 || tasks.length === 0}>
        {pending ? "Queueing..." : "Queue AI task"}
      </button>
      {error ? <p className="inline-error" data-testid={scopedTestId(testIdPrefix, "error")} role="alert">{error}</p> : null}
    </form>
  );
}

export function CreateWorkspaceSecretForm({
  workspaceId,
  testIdPrefix = "workspace-runs-secrets",
}: {
  workspaceId: string;
  testIdPrefix?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  return (
    <form
      className="stack-form"
      data-testid={scopedTestId(testIdPrefix, "create-form")}
      onSubmit={event => {
        event.preventDefault();
        const form = event.currentTarget;
        const formData = new FormData(form);
        const name = String(formData.get("name") ?? "").trim();
        const kind = String(formData.get("kind") ?? "credential-pair").trim();
        const value = String(formData.get("value") ?? "");
        setError(null);
        setSuccess(null);

        startTransition(async () => {
          try {
            await postJson(`/api/workspaces/${workspaceId}/secrets`, {
              name,
              kind,
              value,
            });
            form.reset();
            setSuccess(`${name} saved as a workspace secret.`);
            router.refresh();
          } catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Workspace secret creation failed.");
          }
        });
      }}
    >
      <label className="field">
        <span>Name</span>
        <input data-testid={scopedTestId(testIdPrefix, "name-input")} name="name" placeholder="Preview login" required />
      </label>
      <label className="field">
        <span>Secret kind</span>
        <select data-testid={scopedTestId(testIdPrefix, "kind-select")} name="kind" defaultValue="credential-pair">
          <option value="credential-pair">Credential pair</option>
          <option value="session-state">Session state</option>
          <option value="api-token">API token</option>
        </select>
      </label>
      <label className="field">
        <span>Secret value</span>
        <textarea
          data-testid={scopedTestId(testIdPrefix, "value-input")}
          name="value"
          placeholder='{"username":"demo","password":"secret"}'
          rows={4}
          required
        />
      </label>
      <p className="subtle-note">Secret values are stored write-only. You will only see metadata and a safe preview after saving.</p>
      <button className="button-secondary" data-testid={scopedTestId(testIdPrefix, "submit")} type="submit" disabled={pending}>
        {pending ? "Saving..." : "Save secret"}
      </button>
      {success ? <p className="subtle-note" data-testid={scopedTestId(testIdPrefix, "success")}>{success}</p> : null}
      {error ? <p className="inline-error" data-testid={scopedTestId(testIdPrefix, "error")} role="alert">{error}</p> : null}
    </form>
  );
}

export function UpdateWorkspaceSecretForm({
  workspaceId,
  secret,
  testIdPrefix = "workspace-runs-secrets",
}: {
  workspaceId: string;
  secret: Pick<WorkspaceSecret, "id" | "name" | "kind">;
  testIdPrefix?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  return (
    <div className="stack-form">
      <button
        className="button-ghost"
        data-testid={scopedTestId(testIdPrefix, `update-toggle-${secret.id}`)}
        type="button"
        onClick={() => {
          setOpen(current => !current);
          setError(null);
          setSuccess(null);
        }}
      >
        {open ? "Hide update form" : "Rotate / update"}
      </button>
      {open ? (
        <form
          className="stack-form"
          data-testid={scopedTestId(testIdPrefix, `update-form-${secret.id}`)}
          onSubmit={event => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            const name = String(formData.get("name") ?? "").trim();
            const kind = String(formData.get("kind") ?? secret.kind).trim();
            const value = String(formData.get("value") ?? "");
            setError(null);
            setSuccess(null);

            startTransition(async () => {
              try {
                await patchJson(`/api/workspaces/${workspaceId}/secrets/${secret.id}`, {
                  name,
                  kind,
                  value,
                });
                setSuccess(`${name} updated.`);
                router.refresh();
              } catch (requestError) {
                setError(requestError instanceof Error ? requestError.message : "Workspace secret update failed.");
              }
            });
          }}
        >
          <label className="field">
            <span>Name</span>
            <input
              data-testid={scopedTestId(testIdPrefix, `update-name-${secret.id}`)}
              defaultValue={secret.name}
              name="name"
              required
            />
          </label>
          <label className="field">
            <span>Secret kind</span>
            <select
              data-testid={scopedTestId(testIdPrefix, `update-kind-${secret.id}`)}
              defaultValue={secret.kind}
              name="kind"
            >
              <option value="credential-pair">Credential pair</option>
              <option value="session-state">Session state</option>
              <option value="api-token">API token</option>
            </select>
          </label>
          <label className="field">
            <span>Replacement value</span>
            <textarea
              data-testid={scopedTestId(testIdPrefix, `update-value-${secret.id}`)}
              name="value"
              placeholder='{"username":"demo","password":"next-secret"}'
              rows={4}
              required
            />
          </label>
          <button
            className="button-secondary"
            data-testid={scopedTestId(testIdPrefix, `update-submit-${secret.id}`)}
            type="submit"
            disabled={pending}
          >
            {pending ? "Updating..." : "Update secret"}
          </button>
          {success ? <p className="subtle-note">{success}</p> : null}
          {error ? <p className="inline-error" role="alert">{error}</p> : null}
        </form>
      ) : null}
    </div>
  );
}

export function DeleteWorkspaceSecretButton({
  workspaceId,
  secretId,
  secretName,
  testId,
}: {
  workspaceId: string;
  secretId: string;
  secretName: string;
  testId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="stack-form">
      <button
        className="button-ghost"
        data-testid={testId}
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`Delete workspace secret "${secretName}"?`)) {
            return;
          }
          setError(null);
          startTransition(async () => {
            try {
              await deleteJson(`/api/workspaces/${workspaceId}/secrets/${secretId}`);
              router.refresh();
            } catch (requestError) {
              setError(requestError instanceof Error ? requestError.message : "Workspace secret deletion failed.");
            }
          });
        }}
      >
        {pending ? "Deleting..." : "Delete"}
      </button>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
    </div>
  );
}

export function AddWorkspaceMemberForm({
  workspaceId,
  testIdPrefix = "workspace-access-add-member",
}: {
  workspaceId: string;
  testIdPrefix?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  return (
    <form
      className="stack-form"
      data-testid={scopedTestId(testIdPrefix, "form")}
      onSubmit={event => {
        event.preventDefault();
        const form = event.currentTarget;
        const formData = new FormData(form);
        const email = String(formData.get("email") ?? "").trim();
        setError(null);
        setSuccess(null);

        startTransition(async () => {
          try {
            const payload = await postJson<{ membership: WorkspaceMemberSummary }>(`/api/workspaces/${workspaceId}/members`, {
              email,
            });
            form.reset();
            setSuccess(`Added ${payload.membership.email} to the workspace.`);
            router.refresh();
          } catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Workspace member creation failed.");
          }
        });
      }}
    >
      <label className="field">
        <span>Member email</span>
        <input
          data-testid={scopedTestId(testIdPrefix, "email-input")}
          name="email"
          placeholder="teammate@example.com"
          type="email"
          required
        />
      </label>
      <p className="subtle-note">The target user must have already signed in to SpecLens. Pending invites are not used here.</p>
      <button className="button-secondary" data-testid={scopedTestId(testIdPrefix, "submit")} type="submit" disabled={pending}>
        {pending ? "Adding..." : "Add member"}
      </button>
      {success ? <p className="subtle-note" data-testid={scopedTestId(testIdPrefix, "success")}>{success}</p> : null}
      {error ? <p className="inline-error" data-testid={scopedTestId(testIdPrefix, "error")} role="alert">{error}</p> : null}
    </form>
  );
}

export function RemoveWorkspaceMemberButton({
  workspaceId,
  membershipId,
  label,
  testId,
}: {
  workspaceId: string;
  membershipId: string;
  label: string;
  testId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="stack-form">
      <button
        className="button-ghost"
        data-testid={testId}
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`Remove ${label} from this workspace?`)) {
            return;
          }
          setError(null);
          startTransition(async () => {
            try {
              await deleteJson(`/api/workspaces/${workspaceId}/members/${membershipId}`);
              router.refresh();
            } catch (requestError) {
              setError(requestError instanceof Error ? requestError.message : "Workspace member removal failed.");
            }
          });
        }}
      >
        {pending ? "Removing..." : "Remove"}
      </button>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
    </div>
  );
}

export function ManageSourceActions({
  workspaceId,
  source,
  testIdPrefix = "workspace-sources",
}: {
  workspaceId: string;
  source: Pick<Source, "id" | "displayName" | "type">;
  testIdPrefix?: string;
}) {
  const router = useRouter();
  const [pendingAction, startTransition] = useTransition();
  const [displayName, setDisplayName] = useState(source.displayName);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  return (
    <div className="stack-form">
      <label className="field">
        <span>Rename source</span>
        <input
          data-testid={scopedTestId(testIdPrefix, `rename-input-${source.id}`)}
          value={displayName}
          onChange={event => setDisplayName(event.target.value)}
        />
      </label>
      <div className="list-row__actions">
        <button
          className="button-secondary"
          data-testid={scopedTestId(testIdPrefix, `rename-submit-${source.id}`)}
          type="button"
          disabled={pendingAction || displayName.trim().length < 2 || displayName.trim() === source.displayName}
          onClick={() => {
            setError(null);
            setSuccess(null);
            startTransition(async () => {
              try {
                await patchJson(`/api/workspaces/${workspaceId}/sources/${source.id}`, {
                  displayName: displayName.trim(),
                });
                setSuccess("Source renamed.");
                router.refresh();
              } catch (requestError) {
                setError(requestError instanceof Error ? requestError.message : "Source rename failed.");
              }
            });
          }}
        >
          {pendingAction ? "Saving..." : "Save name"}
        </button>
        <button
          className="button-ghost"
          data-testid={scopedTestId(testIdPrefix, `delete-${source.id}`)}
          type="button"
          disabled={pendingAction}
          onClick={() => {
            if (!window.confirm(`Delete source "${source.displayName}"?`)) {
              return;
            }
            setError(null);
            setSuccess(null);
            startTransition(async () => {
              try {
                await deleteJson(`/api/workspaces/${workspaceId}/sources/${source.id}`);
                router.refresh();
              } catch (requestError) {
                setError(requestError instanceof Error ? requestError.message : "Source deletion failed.");
              }
            });
          }}
        >
          {pendingAction ? "Working..." : "Delete source"}
        </button>
      </div>
      {source.type !== "git-public" ? (
        <p className="subtle-note">Verification is source-type aware. GitHub and archive sources rely on their own readiness paths instead of the public Git verification flow.</p>
      ) : null}
      {success ? <p className="subtle-note" data-testid={scopedTestId(testIdPrefix, `success-${source.id}`)}>{success}</p> : null}
      {error ? <p className="inline-error" data-testid={scopedTestId(testIdPrefix, `error-${source.id}`)} role="alert">{error}</p> : null}
    </div>
  );
}

export function JobLifecycleActions({
  workspaceId,
  jobId,
  status,
  canManageLifecycle = true,
  testIdPrefix = "workspace-runs-job",
}: {
  workspaceId: string;
  jobId: string;
  status: string;
  canManageLifecycle?: boolean;
  testIdPrefix?: string;
}) {
  const router = useRouter();
  const [pendingAction, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const canCancel = status === "pending" || status === "queued" || status === "running";
  const canRetry = status === "failed" || status === "cancelled";

  if (!canManageLifecycle || (!canCancel && !canRetry)) {
    return null;
  }

  return (
    <div className="stack-form">
      <div className="list-row__actions">
        {canCancel ? (
          <button
            className="button-secondary"
            data-testid={scopedTestId(testIdPrefix, "cancel")}
            type="button"
            disabled={pendingAction}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                try {
                  await postJson(`/api/jobs/${jobId}/cancel`, {});
                  router.refresh();
                } catch (requestError) {
                  setError(requestError instanceof Error ? requestError.message : "Job cancellation failed.");
                }
              });
            }}
          >
            {pendingAction ? "Cancelling..." : "Cancel run"}
          </button>
        ) : null}
        {canRetry ? (
          <button
            className="button-secondary"
            data-testid={scopedTestId(testIdPrefix, "retry")}
            type="button"
            disabled={pendingAction}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                try {
                  const payload = await postJson<{ job: { job: { id: string } } }>(`/api/jobs/${jobId}/retry`, {});
                  router.push(`/portal/workspaces/${workspaceId}/runs/${payload.job.job.id}` as Route);
                  router.refresh();
                } catch (requestError) {
                  setError(requestError instanceof Error ? requestError.message : "Job retry failed.");
                }
              });
            }}
          >
            {pendingAction ? "Queueing..." : "Retry run"}
          </button>
        ) : null}
      </div>
      {error ? <p className="inline-error" data-testid={scopedTestId(testIdPrefix, "lifecycle-error")} role="alert">{error}</p> : null}
    </div>
  );
}

export function ReportExportAction({
  reportId,
  testIdPrefix = "report-export",
}: {
  reportId: string;
  testIdPrefix?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [exportState, setExportState] = useState<ReportExportResponse | null>(null);

  return (
    <div className="stack-form">
      <button
        className="button-secondary"
        data-testid={scopedTestId(testIdPrefix, "button")}
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              const payload = await postJson<ReportExportResponse>(`/api/reports/${reportId}/export`, {});
              setExportState(payload);
            } catch (requestError) {
              setError(requestError instanceof Error ? requestError.message : "Report export failed.");
            }
          });
        }}
      >
        {pending ? "Preparing export..." : "Export report bundle"}
      </button>
      {exportState ? (
        <div className="subtle-note" data-testid={scopedTestId(testIdPrefix, "success")}>
          <p>Export ready: {exportState.artifact.key}</p>
          <a
            className="button-ghost"
            data-testid={scopedTestId(testIdPrefix, "download-link")}
            href={exportState.downloadUrl}
            target="_blank"
            rel="noreferrer"
          >
            Download export
          </a>
        </div>
      ) : null}
      {error ? <p className="inline-error" data-testid={scopedTestId(testIdPrefix, "error")} role="alert">{error}</p> : null}
    </div>
  );
}

export function CheckoutButton({
  workspaceId,
  label,
  testId = "workspace-settings-checkout-button",
  disabled = false,
}: {
  workspaceId?: string;
  label: string;
  testId?: string;
  disabled?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="stack-form">
      <button
        className="button"
        data-testid={testId}
        type="button"
        disabled={pending || disabled}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              const payload = await postJson<{ checkoutUrl: string }>("/api/billing/checkout", {
                plan: "pro",
                ...(workspaceId ? { workspaceId } : {}),
              });
              window.location.assign(payload.checkoutUrl);
            } catch (requestError) {
              setError(requestError instanceof Error ? requestError.message : "Checkout failed.");
            }
          });
        }}
      >
        {pending ? "Preparing checkout..." : label}
      </button>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
    </div>
  );
}

export function GithubInstallButton({
  workspaceId,
  label = "Connect GitHub App",
  testId = "workspace-settings-github-install-button",
  disabled = false,
}: {
  workspaceId: string;
  label?: string;
  testId?: string;
  disabled?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="stack-form">
      <button
        className="button-secondary"
        data-testid={testId}
        type="button"
        disabled={pending || disabled}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              const response = await fetch(`${getApiBaseUrl()}/api/integrations/github/install?workspaceId=${workspaceId}`, {
                cache: "no-store",
              });
              if (!response.ok) {
                throw new Error(await response.text());
              }
              const payload = await response.json() as { installUrl: string };
              window.location.assign(payload.installUrl);
            } catch (requestError) {
              setError(requestError instanceof Error ? requestError.message : "GitHub install redirect failed.");
            }
          });
        }}
      >
        {pending ? "Preparing GitHub install..." : label}
      </button>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
    </div>
  );
}

export function BillingPortalButton({
  workspaceId,
  label = "Manage billing",
  testId = "workspace-settings-billing-portal-button",
}: {
  workspaceId?: string;
  label?: string;
  testId?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="stack-form">
      <button
        className="button-secondary"
        data-testid={testId}
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              const payload = await postJson<BillingPortalSessionResponse>("/api/billing/portal", {
                ...(workspaceId ? { workspaceId } : {}),
              });
              window.location.assign(payload.manageUrl);
            } catch (requestError) {
              setError(requestError instanceof Error ? requestError.message : "Billing portal launch failed.");
            }
          });
        }}
      >
        {pending ? "Preparing billing..." : label}
      </button>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
    </div>
  );
}

export function GithubInstallationUnlinkButton({
  workspaceId,
  installationId,
  accountLogin,
  testId,
}: {
  workspaceId: string;
  installationId: string;
  accountLogin: string;
  testId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="stack-form">
      <button
        className="button-ghost"
        data-testid={testId}
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`Unlink the GitHub installation for ${accountLogin}?`)) {
            return;
          }
          setError(null);
          startTransition(async () => {
            try {
              await deleteJson(`/api/workspaces/${workspaceId}/integrations/github/installations/${installationId}`);
              router.push(`/portal/workspaces/${workspaceId}/settings?github=unlinked` as Route);
              router.refresh();
            } catch (requestError) {
              setError(requestError instanceof Error ? requestError.message : "GitHub unlink failed.");
            }
          });
        }}
      >
        {pending ? "Unlinking..." : "Unlink"}
      </button>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
    </div>
  );
}

export function JobLogConsole({
  jobId,
  initialLogs,
  initialStatus,
  initialExecutionSteps,
  initialTiming,
  testIdPrefix = "workspace-runs-job",
}: {
  jobId: string;
  initialLogs: AnalysisLogEvent[];
  initialStatus: string;
  initialExecutionSteps: JobEnvelope["executionSteps"];
  initialTiming: JobEnvelope["timing"];
  testIdPrefix?: string;
}) {
  const [logs, setLogs] = useState(getVisibleLogs(initialLogs));
  const [status, setStatus] = useState(initialStatus);
  const [executionSteps, setExecutionSteps] = useState(initialExecutionSteps);
  const [timing, setTiming] = useState(initialTiming);
  const [verbosity, setVerbosity] = useState<"default" | "verbose">("default");
  const [loadingLogs, setLoadingLogs] = useState(false);
  const router = useRouter();
  const activeStep = useMemo(
    () => executionSteps.find(step => step.status === "running") ?? null,
    [executionSteps],
  );

  useEffect(() => {
    let cancelled = false;
    let source: EventSource | null = null;

    const syncLogs = async () => {
      setLoadingLogs(true);
      try {
        const response = await fetch(`${getApiBaseUrl()}/api/jobs/${jobId}?verbosity=${verbosity}`, {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(await readErrorMessage(response));
        }
        const payload = await response.json() as {
          job: JobEnvelope;
        };
        if (cancelled) {
          return;
        }
        setLogs(getVisibleLogs(payload.job.logs));
        setStatus(payload.job.job.status);
        setExecutionSteps(payload.job.executionSteps);
        setTiming(payload.job.timing);

        if (
          payload.job.job.status === "succeeded"
          || payload.job.job.status === "failed"
          || payload.job.job.status === "cancelled"
        ) {
          return;
        }

        source = new EventSource(`${getApiBaseUrl()}/api/jobs/${jobId}/logs/stream?verbosity=${verbosity}`);

        source.addEventListener("log", event => {
          const streamPayload = JSON.parse((event as MessageEvent<string>).data) as AnalysisLogEvent;
          const stepEvent = parseAnalysisExecutionStepEvent(streamPayload.message);
          if (stepEvent) {
            setExecutionSteps(current => applyExecutionStep(current, stepEvent));
            return;
          }
          setLogs(current => current.some(log => log.id === streamPayload.id) ? current : [...current, streamPayload]);
        });

        source.addEventListener("status", event => {
          const streamPayload = JSON.parse((event as MessageEvent<string>).data) as { status: string };
          setStatus(streamPayload.status);
        });

        source.addEventListener("complete", event => {
          const streamPayload = JSON.parse((event as MessageEvent<string>).data) as { status: string };
          setStatus(streamPayload.status);
          if (streamPayload.status === "succeeded") {
            router.refresh();
          }
          source?.close();
        });
      } catch {
        if (!cancelled) {
          setLogs(getVisibleLogs(initialLogs));
          setStatus(initialStatus);
          setExecutionSteps(initialExecutionSteps);
          setTiming(initialTiming);
        }
      } finally {
        if (!cancelled) {
          setLoadingLogs(false);
        }
      }
    };

    void syncLogs();

    return () => {
      cancelled = true;
      source?.close();
    };
  }, [initialExecutionSteps, initialLogs, initialStatus, initialTiming, jobId, router, verbosity]);

  return (
    <>
      <div className="auth-status">
        <p data-testid={scopedTestId(testIdPrefix, "status")}><strong>Status:</strong> {status}</p>
        <span className={getJobStatusTone(status)}>{status}</span>
      </div>
      <div className="list-row" data-testid={scopedTestId(testIdPrefix, "execution-overview")}>
        <div>
          <strong>Execution steps</strong>
          <p className="subtle-note">
            {activeStep
              ? `${activeStep.agentName ?? activeStep.agentId ?? "Agent"} is running ${activeStep.roleName ?? activeStep.title}.`
              : "Showing the latest persisted agent step timeline."}
          </p>
        </div>
        <div className="list-row__actions">
          <span className="subtle-note" data-testid={scopedTestId(testIdPrefix, "timing-elapsed")}>Elapsed {Math.round((timing.elapsedMs ?? 0) / 1000)}s</span>
          {timing.estimatedRemainingMs !== null ? (
            <span className="subtle-note" data-testid={scopedTestId(testIdPrefix, "timing-remaining")}>Remaining ~{Math.round(timing.estimatedRemainingMs / 1000)}s</span>
          ) : null}
        </div>
      </div>
      <section className="stack-form" data-testid={scopedTestId(testIdPrefix, "execution-steps")}>
        {executionSteps.length === 0 ? <p className="subtle-note">No execution steps recorded yet.</p> : null}
        {executionSteps.map(step => (
          <div className="list-row" key={step.id} data-testid={scopedTestId(testIdPrefix, `step-${step.id.replace(/[^a-z0-9_-]+/gi, "-")}`)}>
            <div>
              <strong>{step.title}</strong>
              <p className="subtle-note">
                {(step.agentName ?? step.agentId ?? "agent")}
                {step.roleName ? ` · ${step.roleName}` : ""}
                {step.executorKind ? ` · ${step.executorKind}` : ""}
                {step.nativeExecutorId ? `:${step.nativeExecutorId}` : ""}
              </p>
              {step.detail ? <p>{step.detail}</p> : null}
            </div>
            <div className="list-row__actions">
              <span className={getJobStatusTone(step.status)}>{step.status}</span>
              <span className="subtle-note">{formatStepDuration(step)}</span>
            </div>
          </div>
        ))}
      </section>
      <div className="list-row">
        <div>
          <strong>Console mode</strong>
          <p className="subtle-note">
            {verbosity === "default"
              ? "Showing role progress, summaries, findings, blockers, and learnables activity."
              : "Showing the full verbose trace, including raw Codex and shell output."}
          </p>
        </div>
        <div className="list-row__actions">
          <button
            className={verbosity === "default" ? "button-secondary" : "button-ghost"}
            type="button"
            data-testid={scopedTestId(testIdPrefix, "verbosity-default")}
            onClick={() => setVerbosity("default")}
            disabled={loadingLogs}
          >
            Concise
          </button>
          <button
            className={verbosity === "verbose" ? "button-secondary" : "button-ghost"}
            type="button"
            data-testid={scopedTestId(testIdPrefix, "verbosity-verbose")}
            onClick={() => setVerbosity("verbose")}
            disabled={loadingLogs}
          >
            Verbose trace
          </button>
        </div>
      </div>
      <section className="terminal-shell" data-testid={scopedTestId(testIdPrefix, "log-console")}>
        <div className="terminal-shell__header">
          <span>speclens/job/{jobId}</span>
          <span>{verbosity === "verbose" ? "verbose trace" : "live log stream"}</span>
        </div>
        <div className="terminal-shell__body">
          {logs.length === 0 ? (
            <span className="terminal-line">[info] queue: Waiting for the first log line from the hosted worker.</span>
          ) : null}
          {logs.map(log => (
            <span className="terminal-line" key={log.id}>
              [{log.level}] {log.scope}: {log.message}
            </span>
          ))}
        </div>
      </section>
    </>
  );
}

export function ReportRemediationForm({
  workspaceId,
  reportId,
  defaultSourceId,
  sourceOptions,
  findingOptions,
  canMutate,
  testIdPrefix = "report-remediation",
}: {
  workspaceId: string;
  reportId: string;
  defaultSourceId: string;
  sourceOptions: Array<{
    id: string;
    displayName: string;
    type: string;
  }>;
  findingOptions: Array<{
    id: string;
    title: string;
    severity: string;
  }>;
  canMutate: boolean;
  testIdPrefix?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (!canMutate) {
    return (
      <p className="subtle-note" data-testid={scopedTestId(testIdPrefix, "read-only")}>
        This account can review code and findings, but only workspace owners and admins can launch remediation jobs.
      </p>
    );
  }

  return (
    <form
      className="stack-form"
      data-testid={scopedTestId(testIdPrefix, "form")}
      onSubmit={event => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const sourceId = String(formData.get("sourceId") ?? defaultSourceId).trim() || defaultSourceId;
        const selectionMode = String(formData.get("selectionMode") ?? "auto-priority") === "selected-findings"
          ? "selected-findings"
          : "auto-priority";
        const selectedFindingIds = formData.getAll("selectedFindingIds").map(value => String(value)).filter(Boolean);
        const baseRef = String(formData.get("baseRef") ?? "HEAD").trim() || "HEAD";
        const maxIterations = Number.parseInt(String(formData.get("maxIterations") ?? "2"), 10) === 1 ? 1 : 2;
        const outputMode = String(formData.get("outputMode") ?? "changeset") === "remote-pr" ? "remote-pr" : "changeset";
        const publishRemote = formData.get("publishRemote") === "on";
        setError(null);
        setSuccess(null);

        startTransition(async () => {
          try {
            const payload = await postJson<{
              job: {
                job: {
                  id: string;
                };
              };
            }>(`/api/reports/${reportId}/remediate`, {
              sourceId,
              selectionMode,
              selectedFindingIds,
              baseRef,
              maxIterations,
              outputMode,
              publishRemote,
            });
            setSuccess(`Queued remediation job ${payload.job.job.id}. Redirecting to the run detail.`);
            router.push(`/portal/workspaces/${workspaceId}/runs/${payload.job.job.id}`);
            router.refresh();
          } catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Remediation failed.");
          }
        });
      }}
    >
      <label className="field">
        <span>Source</span>
        <select data-testid={scopedTestId(testIdPrefix, "source-select")} name="sourceId" defaultValue={defaultSourceId}>
          {sourceOptions.map(source => (
            <option key={source.id} value={source.id}>{source.displayName} ({source.type})</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Finding selection</span>
        <select data-testid={scopedTestId(testIdPrefix, "selection-mode-select")} name="selectionMode" defaultValue="auto-priority">
          <option value="auto-priority">Auto-priority</option>
          <option value="selected-findings">Selected findings</option>
        </select>
      </label>
      <fieldset className="field">
        <span>Selected findings</span>
        {findingOptions.map(finding => (
          <label key={finding.id} style={{ flexDirection: "row", alignItems: "center", gap: "0.75rem" }}>
            <input
              data-testid={scopedTestId(testIdPrefix, `finding-${finding.id}`)}
              name="selectedFindingIds"
              type="checkbox"
              value={finding.id}
            />
            <span>{finding.severity}: {finding.title}</span>
          </label>
        ))}
        {findingOptions.length === 0 ? <p className="subtle-note">No findings available for targeted remediation on this report.</p> : null}
      </fieldset>
      <label className="field">
        <span>Base ref</span>
        <input data-testid={scopedTestId(testIdPrefix, "base-ref-input")} name="baseRef" defaultValue="HEAD" />
      </label>
      <label className="field">
        <span>Iteration budget</span>
        <select data-testid={scopedTestId(testIdPrefix, "iterations-select")} name="maxIterations" defaultValue="2">
          <option value="1">1 pass</option>
          <option value="2">2 passes</option>
        </select>
      </label>
      <label className="field">
        <span>Output mode</span>
        <select data-testid={scopedTestId(testIdPrefix, "output-mode-select")} name="outputMode" defaultValue="changeset">
          <option value="changeset">Local changeset</option>
          <option value="remote-pr">Remote PR</option>
        </select>
      </label>
      <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: "0.75rem" }}>
        <input data-testid={scopedTestId(testIdPrefix, "publish-remote-toggle")} name="publishRemote" type="checkbox" />
        <span>Publish remote if configured</span>
      </label>
      <button
        className="button"
        data-testid={scopedTestId(testIdPrefix, "submit")}
        type="submit"
        disabled={pending}
      >
        {pending ? "Queueing remediation..." : "Queue remediation"}
      </button>
      {success ? <p className="subtle-note" data-testid={scopedTestId(testIdPrefix, "success")}>{success}</p> : null}
      {error ? <p className="inline-error" data-testid={scopedTestId(testIdPrefix, "error")} role="alert">{error}</p> : null}
    </form>
  );
}
