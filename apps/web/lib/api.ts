import type {
  AiAgent,
  AiRole,
  AiSkill,
  AnalysisTask,
  CodeReviewPayload,
  AnalysisReport,
  CodexAuthSelection,
  CodexAuthStatus,
  GithubInstallation,
  GithubRepository,
  JobEnvelope,
  Learnable,
  PageInfo,
  Source,
  User,
  Workspace,
  WorkspaceMemberSummary,
  WorkspaceSecret,
} from "@speclens/contracts";
import { cookies } from "next/headers";
import { idTokenCookieName, sessionCookieName } from "./auth";
import { assertTrustedPortalApiBaseUrl, resolveInternalApiBaseUrl } from "./internal-api";

export class ApiResponseError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiResponseError";
    this.status = status;
  }
}

export type PortalAnalysisTask = AnalysisTask;
export type PaginatedItems<T> = {
  items: T[];
  pageInfo: PageInfo;
};

async function apiFetch<T>(pathname: string, init?: RequestInit): Promise<T> {
  try {
    const cookieStore = await cookies();
    const idToken = cookieStore.get(idTokenCookieName())?.value;
    const session = cookieStore.get(sessionCookieName())?.value;
    const baseUrl = resolveInternalApiBaseUrl();
    const headers = new Headers(init?.headers);
    headers.set("content-type", "application/json");
    if (idToken || session) {
      assertTrustedPortalApiBaseUrl(baseUrl);
    }
    if (idToken) {
      headers.set("authorization", `Bearer ${idToken}`);
    }
    if (session) {
      headers.set("cookie", `${sessionCookieName()}=${session}`);
    }
    const response = await fetch(`${baseUrl}${pathname}`, {
      ...init,
      headers,
      cache: "no-store",
    });
    if (!response.ok) {
      const message = await response.text();
      throw new ApiResponseError(response.status, message || `${response.status} ${response.statusText}`);
    }
    return await response.json() as T;
  } catch (error) {
    if (error instanceof ApiResponseError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "API request failed.";
    throw new ApiResponseError(502, `API unavailable while requesting ${pathname}: ${message}`);
  }
}

export async function getPortalWorkspaces(): Promise<Array<{
  workspace: Workspace;
  members: WorkspaceMemberSummary[];
  sources: Source[];
}>> {
  const payload = await apiFetch<{ workspaces: Array<{ workspace: Workspace; members: WorkspaceMemberSummary[]; sources: Source[] }> }>(
    "/api/workspaces",
  );
  return payload.workspaces;
}

export async function getPortalWorkspacesPage(query: {
  q?: string;
  page?: number;
  pageSize?: number;
} = {}): Promise<PaginatedItems<{
  workspace: Workspace;
  members: WorkspaceMemberSummary[];
  sources: Source[];
}>> {
  return await apiFetch<PaginatedItems<{
    workspace: Workspace;
    members: WorkspaceMemberSummary[];
    sources: Source[];
  }>>(`/api/workspaces${buildSearchParams(query)}`);
}

export async function getCurrentUser(): Promise<User> {
  const payload = await apiFetch<{ user: User }>("/api/me");
  return payload.user;
}

export async function getPortalAnalysisTasks(): Promise<PortalAnalysisTask[]> {
  const payload = await apiFetch<{ tasks: PortalAnalysisTask[] }>("/api/analysis-tasks");
  return payload.tasks;
}

export async function getWorkspaceConsole(workspaceId: string): Promise<{
  workspace: Workspace;
  members: WorkspaceMemberSummary[];
  sources: Source[];
  installations: GithubInstallation[];
  jobs: JobEnvelope[];
}> {
  return apiFetch(`/api/workspaces/${workspaceId}`);
}

export async function getWorkspaceSecrets(workspaceId: string): Promise<WorkspaceSecret[]> {
  const payload = await getWorkspaceSecretsPage(workspaceId);
  return payload.items;
}

export async function getGithubRepositories(workspaceId: string): Promise<GithubRepository[]> {
  const payload = await getGithubRepositoriesPage(workspaceId);
  return payload.items;
}

export async function getHostedJob(jobId: string, verbosity: "default" | "verbose" = "default"): Promise<JobEnvelope> {
  const payload = await apiFetch<{ job: JobEnvelope }>(`/api/jobs/${jobId}?verbosity=${verbosity}`);
  return payload.job;
}

export async function getSourceLearnables(workspaceId: string, sourceId: string): Promise<Learnable[]> {
  const payload = await apiFetch<{ learnables: Learnable[] }>(
    `/api/workspaces/${workspaceId}/sources/${sourceId}/learnables`,
  );
  return payload.learnables;
}

function buildSearchParams(query: Record<string, string | number | boolean | null | undefined>): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === "") {
      continue;
    }
    searchParams.set(key, String(value));
  }
  return searchParams.size > 0 ? `?${searchParams.toString()}` : "";
}

export async function getWorkspaceMembersPage(
  workspaceId: string,
  query: {
    q?: string;
    page?: number;
    pageSize?: number;
  } = {},
): Promise<PaginatedItems<WorkspaceMemberSummary>> {
  return await apiFetch<PaginatedItems<WorkspaceMemberSummary>>(
    `/api/workspaces/${workspaceId}/members${buildSearchParams(query)}`,
  );
}

export async function getWorkspaceSecretsPage(
  workspaceId: string,
  query: {
    q?: string;
    page?: number;
    pageSize?: number;
  } = {},
): Promise<PaginatedItems<WorkspaceSecret>> {
  return await apiFetch<PaginatedItems<WorkspaceSecret>>(
    `/api/workspaces/${workspaceId}/secrets${buildSearchParams(query)}`,
  );
}

export async function getWorkspaceSourcesPage(
  workspaceId: string,
  query: {
    q?: string;
    type?: string;
    page?: number;
    pageSize?: number;
  } = {},
): Promise<PaginatedItems<Source>> {
  return await apiFetch<PaginatedItems<Source>>(
    `/api/workspaces/${workspaceId}/sources${buildSearchParams(query)}`,
  );
}

export async function getWorkspaceJobsPage(
  query: {
    workspaceId?: string;
    status?: string;
    q?: string;
    hasReport?: boolean;
    page?: number;
    pageSize?: number;
  } = {},
): Promise<PaginatedItems<JobEnvelope>> {
  return await apiFetch<PaginatedItems<JobEnvelope>>(
    `/api/jobs${buildSearchParams(query)}`,
  );
}

export async function getGithubRepositoriesPage(
  workspaceId: string,
  query: {
    installationId?: string;
    q?: string;
    page?: number;
    pageSize?: number;
  } = {},
): Promise<PaginatedItems<GithubRepository>> {
  return await apiFetch<PaginatedItems<GithubRepository>>(
    `/api/workspaces/${workspaceId}/integrations/github/repositories${buildSearchParams(query)}`,
  );
}

export async function getHostedReport(reportId: string): Promise<AnalysisReport> {
  const payload = await apiFetch<{ report: AnalysisReport | null }>(`/api/reports/${reportId}`);
  if (!payload.report) {
    throw new ApiResponseError(404, `Report ${reportId} not found.`);
  }
  return payload.report;
}

export async function getWorkspaceCodeReview(
  workspaceId: string,
  query: {
    sourceId?: string;
    ref?: string;
    path?: string;
    compare?: string;
    reportId?: string;
    findingId?: string;
    pr?: string;
  } = {},
): Promise<CodeReviewPayload> {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) {
      searchParams.set(key, value);
    }
  }
  const payload = await apiFetch<{ review: CodeReviewPayload }>(
    `/api/workspaces/${workspaceId}/code/review${searchParams.size > 0 ? `?${searchParams.toString()}` : ""}`,
  );
  return payload.review;
}

export async function runReportRemediation(reportId: string, input: {
  sourceId: string;
  selectionMode?: "auto-priority" | "selected-findings";
  selectedFindingIds?: string[];
  baseRef?: string;
  maxIterations?: 1 | 2;
  outputMode?: "changeset" | "remote-pr";
  publishRemote?: boolean;
}): Promise<{
  job: JobEnvelope;
}> {
  return apiFetch(`/api/reports/${reportId}/remediate`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getAdminAiAuthStatus(): Promise<CodexAuthStatus> {
  const payload = await apiFetch<{ auth: CodexAuthStatus }>("/api/admin/ai/auth/status");
  return payload.auth;
}

export async function getMyCodexAuthStatus(): Promise<CodexAuthStatus> {
  const payload = await apiFetch<{ auth: CodexAuthStatus }>("/api/me/ai/auth/status");
  return payload.auth;
}

export async function getWorkspaceCodexAuthStatus(workspaceId: string): Promise<CodexAuthStatus> {
  const payload = await apiFetch<{ auth: CodexAuthStatus }>(`/api/workspaces/${workspaceId}/ai/auth/status`);
  return payload.auth;
}

export async function getWorkspaceCodexAuthSelection(workspaceId: string): Promise<CodexAuthSelection> {
  const payload = await apiFetch<{ selection: CodexAuthSelection }>(`/api/workspaces/${workspaceId}/ai/auth-options`);
  return payload.selection;
}

export async function getAdminAiSkills(): Promise<AiSkill[]> {
  const payload = await apiFetch<{ skills: AiSkill[] }>("/api/admin/ai/skills");
  return payload.skills;
}

export async function getAdminAiRoles(): Promise<AiRole[]> {
  const payload = await apiFetch<{ roles: AiRole[] }>("/api/admin/ai/roles");
  return payload.roles;
}

export async function getAdminAiAgents(): Promise<AiAgent[]> {
  const payload = await apiFetch<{ agents: AiAgent[] }>("/api/admin/ai/agents");
  return payload.agents;
}
