import type {
  AnalysisReport,
  GithubInstallation,
  JobEnvelope,
  Source,
  Workspace,
  WorkspaceMembership,
} from "@speclens/contracts";
import { cookies } from "next/headers";
import { idTokenCookieName, sessionCookieName } from "./auth";
import { mockLogs, mockReport, mockWorkspace } from "./mock-data";

function getApiBaseUrl(): string {
  return process.env.INTERNAL_API_URL ?? process.env.API_URL ?? "http://localhost:4000";
}

async function apiFetch<T>(pathname: string, init?: RequestInit, fallback?: T): Promise<T> {
  try {
    const cookieStore = await cookies();
    const idToken = cookieStore.get(idTokenCookieName())?.value;
    const session = cookieStore.get(sessionCookieName())?.value;
    const headers = new Headers(init?.headers);
    headers.set("content-type", "application/json");
    if (idToken) {
      headers.set("authorization", `Bearer ${idToken}`);
    }
    if (session) {
      headers.set("cookie", `${sessionCookieName()}=${session}`);
    }
    const response = await fetch(`${getApiBaseUrl()}${pathname}`, {
      ...init,
      headers,
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return await response.json() as T;
  } catch (error) {
    if (fallback !== undefined) {
      return fallback;
    }
    throw error;
  }
}

export async function getPortalWorkspaces(): Promise<Array<{
  workspace: Workspace;
  members: WorkspaceMembership[];
  sources: Source[];
}>> {
  const fallback = {
    workspaces: [
      {
        workspace: mockWorkspace,
        members: [],
        sources: [],
      },
    ],
  };
  const payload = await apiFetch<{ workspaces: Array<{ workspace: Workspace; members: WorkspaceMembership[]; sources: Source[] }> }>(
    "/api/workspaces",
    undefined,
    fallback,
  );
  return payload.workspaces;
}

export async function getWorkspaceConsole(workspaceId: string): Promise<{
  workspace: Workspace;
  members: WorkspaceMembership[];
  sources: Source[];
  installations: GithubInstallation[];
  jobs: JobEnvelope[];
}> {
  const fallback: {
    workspace: Workspace;
    members: WorkspaceMembership[];
    sources: Source[];
    installations: GithubInstallation[];
    jobs: JobEnvelope[];
  } = {
    workspace: mockWorkspace,
    members: [],
    sources: [],
    installations: [],
    jobs: [
      {
        job: {
          id: "job_demo",
          workspaceId: mockWorkspace.id,
          sourceId: "source_demo",
          reportId: mockReport.id,
          status: "succeeded",
          sourceType: "workspace",
          sourceLocation: "./fixtures/browser-parity-app",
          preset: mockReport.preset,
          capabilities: mockReport.capabilities,
          runtimeMode: mockReport.runtimeMode,
          secretRefs: [],
          requestedByUserId: mockWorkspace.ownerUserId,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
        logs: mockLogs,
        report: mockReport,
      },
    ],
  };
  return apiFetch(`/api/workspaces/${workspaceId}`, undefined, fallback);
}

export async function getHostedJob(jobId: string): Promise<JobEnvelope> {
  const fallback: { job: JobEnvelope } = {
    job: {
      job: {
        id: "job_demo",
        workspaceId: mockWorkspace.id,
        sourceId: "source_demo",
        reportId: mockReport.id,
        status: "succeeded",
        sourceType: "workspace",
        sourceLocation: "./fixtures/browser-parity-app",
        preset: mockReport.preset,
        capabilities: mockReport.capabilities,
        runtimeMode: mockReport.runtimeMode,
        secretRefs: [],
        requestedByUserId: mockWorkspace.ownerUserId,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
      logs: mockLogs,
      report: mockReport,
    },
  };
  const payload = await apiFetch<{ job: JobEnvelope }>(`/api/jobs/${jobId}`, undefined, fallback);
  return payload.job;
}

export async function getHostedReport(reportId: string): Promise<AnalysisReport> {
  const payload = await apiFetch<{ report: AnalysisReport | null }>(
    `/api/reports/${reportId}`,
    undefined,
    { report: mockReport },
  );
  return payload.report ?? mockReport;
}
