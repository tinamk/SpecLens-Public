"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

function getApiBaseUrl(): string {
  return "/api/proxy";
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
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }

  return await response.json() as T;
}

export function CreateWorkspaceForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="stack-form"
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
            router.push(`/portal/workspaces/${payload.workspace.id}`);
            router.refresh();
          } catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Workspace creation failed.");
          }
        });
      }}
    >
      <label className="field">
        <span>Workspace name</span>
        <input name="name" placeholder="Platform Team" required />
      </label>
      <label className="field">
        <span>Description</span>
        <textarea name="description" placeholder="Shared workspace for repo analysis and reports." rows={3} />
      </label>
      <button className="button" type="submit" disabled={pending}>
        {pending ? "Creating..." : "Create workspace"}
      </button>
      {error ? <p className="inline-error">{error}</p> : null}
    </form>
  );
}

export function CreateSourceForm({
  workspaceId,
  entitlement,
}: {
  workspaceId: string;
  entitlement: "free" | "pro" | "commercial";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<"workspace" | "github-public" | "github-private" | "upload-archive">("workspace");

  return (
    <form
      className="stack-form"
      onSubmit={event => {
        event.preventDefault();
        const form = event.currentTarget;
        const formData = new FormData(event.currentTarget);
        const displayName = String(formData.get("displayName") ?? "").trim();
        const location = String(formData.get("location") ?? "").trim();
        const visibility = type === "github-public" ? "public" : "private";
        setError(null);

        startTransition(async () => {
          try {
            await postJson(`/api/workspaces/${workspaceId}/sources`, {
              type,
              displayName,
              location,
              visibility,
            });
            form.reset();
            router.refresh();
          } catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Source creation failed.");
          }
        });
      }}
    >
      <label className="field">
        <span>Source type</span>
        <select name="type" value={type} onChange={event => setType(event.target.value as typeof type)}>
          <option value="workspace">Local path / uploaded bundle</option>
          <option value="github-public">Public GitHub repo</option>
          <option value="github-private" disabled={entitlement === "free"}>Private GitHub repo</option>
          <option value="upload-archive" disabled={entitlement === "free"}>Archive upload metadata</option>
        </select>
      </label>
      {entitlement === "free" ? <p className="subtle-note">Free workspaces can only add public sources until the owner upgrades to Pro.</p> : null}
      <label className="field">
        <span>Display name</span>
        <input name="displayName" placeholder="SpecLens repo" required />
      </label>
      <label className="field">
        <span>{type === "workspace" ? "Local path" : "Location"}</span>
        <input
          name="location"
          placeholder={type === "workspace" ? "./fixtures/browser-parity-app" : "https://github.com/example/repo"}
          required
        />
      </label>
      <button className="button-secondary" type="submit" disabled={pending}>
        {pending ? "Adding..." : "Add source"}
      </button>
      {error ? <p className="inline-error">{error}</p> : null}
    </form>
  );
}

export function QueueAnalysisForm({
  workspaceId,
  sources,
}: {
  workspaceId: string;
  sources: Array<{ id: string; displayName: string; visibility: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="stack-form"
      onSubmit={event => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const sourceId = String(formData.get("sourceId") ?? "");
        const preset = String(formData.get("preset") ?? "auto");
        setError(null);

        startTransition(async () => {
          try {
            const payload = await postJson<{ job: { job: { id: string } } }>(`/api/workspaces/${workspaceId}/analyze`, {
              sourceId,
              preset,
            });
            router.push(`/portal/jobs/${payload.job.job.id}`);
            router.refresh();
          } catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Analysis queueing failed.");
          }
        });
      }}
    >
      <label className="field">
        <span>Source</span>
        <select name="sourceId" required defaultValue={sources[0]?.id ?? ""}>
          {sources.length === 0 ? <option value="">Add a source first</option> : null}
          {sources.map(source => (
            <option key={source.id} value={source.id}>
              {source.displayName} ({source.visibility})
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Preset</span>
        <select name="preset" defaultValue="auto">
          <option value="auto">auto</option>
          <option value="generic">generic</option>
          <option value="node-repo">node-repo</option>
          <option value="svelte-web">svelte-web</option>
          <option value="tagtwo">tagtwo</option>
          <option value="client-legacy">client-legacy</option>
        </select>
      </label>
      <button className="button" type="submit" disabled={pending || sources.length === 0}>
        {pending ? "Queueing..." : "Queue analysis"}
      </button>
      {error ? <p className="inline-error">{error}</p> : null}
    </form>
  );
}

export function CheckoutButton({
  workspaceId,
  label,
}: {
  workspaceId?: string;
  label: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="stack-form">
      <button
        className="button"
        type="button"
        disabled={pending}
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
      {error ? <p className="inline-error">{error}</p> : null}
    </div>
  );
}

export function GithubInstallButton({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="stack-form">
      <button
        className="button-secondary"
        type="button"
        disabled={pending}
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
        {pending ? "Preparing GitHub install..." : "Connect GitHub App"}
      </button>
      {error ? <p className="inline-error">{error}</p> : null}
    </div>
  );
}

export function JobLogConsole({
  jobId,
  initialLogs,
  initialStatus,
}: {
  jobId: string;
  initialLogs: Array<{ id: string; level: string; scope: string; message: string }>;
  initialStatus: string;
}) {
  const [logs, setLogs] = useState(initialLogs);
  const [status, setStatus] = useState(initialStatus);
  const router = useRouter();

  useEffect(() => {
    if (status === "succeeded" || status === "failed" || status === "cancelled") {
      return;
    }

    const interval = window.setInterval(async () => {
      const response = await fetch(`${getApiBaseUrl()}/api/jobs/${jobId}`, { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json() as {
        job: {
          job: { status: string; reportId: string | null };
          logs: Array<{ id: string; level: string; scope: string; message: string }>;
        };
      };
      setLogs(payload.job.logs);
      setStatus(payload.job.job.status);
      if (payload.job.job.status === "succeeded" && payload.job.job.reportId) {
        router.refresh();
      }
      if (payload.job.job.status === "succeeded" || payload.job.job.status === "failed" || payload.job.job.status === "cancelled") {
        window.clearInterval(interval);
      }
    }, 1000);

    return () => window.clearInterval(interval);
  }, [jobId, router, status]);

  return (
    <>
      <p><strong>Status:</strong> {status}</p>
      <section className="terminal-shell">
        {logs.map(log => (
          <span className="terminal-line" key={log.id}>
            [{log.level}] {log.scope}: {log.message}
          </span>
        ))}
      </section>
    </>
  );
}
