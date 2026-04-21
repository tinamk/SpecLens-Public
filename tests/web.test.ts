import assert from "node:assert/strict";
import test from "node:test";
import { ensureTestAuthSecrets } from "./helpers/portal-auth";

function clearKeycloakEnv(): void {
  delete process.env.KEYCLOAK_ISSUER_URL;
  delete process.env.KEYCLOAK_INTERNAL_ISSUER_URL;
  delete process.env.KEYCLOAK_CLIENT_ID;
  delete process.env.KEYCLOAK_CLIENT_SECRET;
  delete process.env.KEYCLOAK_BASE_URL;
}

test("web auth login route sets a local portal session cookie and preserves returnTo", async () => {
  const originalEnv = { ...process.env };
  clearKeycloakEnv();
  ensureTestAuthSecrets();
  const route = await import("../apps/web/app/api/auth/login/route");
  const response = await route.GET(new Request("http://localhost:3000/api/auth/login?returnTo=/portal/workspaces/demo"));

  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "http://localhost:3000/portal/workspaces/demo");
  assert.equal((response.headers.get("set-cookie") ?? "").includes("speclens_portal_session="), true);

  process.env = originalEnv;
});

test("web auth local-dev helpers fall back to deterministic local signing secrets when auth secrets are unset", async () => {
  const originalEnv = { ...process.env };
  clearKeycloakEnv();
  delete process.env.CSRF_SECRET;
  delete process.env.PORTAL_SESSION_SECRET;
  delete process.env.APP_URL;
  delete process.env.INTERNAL_API_URL;
  delete process.env.API_URL;

  const auth = await import("../apps/web/lib/auth");
  const sessionValue = auth.buildLocalDevSession();
  const session = auth.decodePortalSessionValue(sessionValue);
  const csrfToken = auth.buildCsrfToken(sessionValue);

  assert.deepEqual(session, {
    provider: "local-dev",
    subject: "local-dev-user",
    email: "demo@speclens.dev",
    displayName: "Local Dev User",
  });
  assert.equal(typeof csrfToken, "string");
  assert.equal(csrfToken.length > 0, true);

  process.env = originalEnv;
});

test("web auth return-to helper preserves query-driven portal state", async () => {
  const auth = await import("../apps/web/lib/auth");
  assert.equal(
    auth.buildPortalReturnTo("/portal/workspaces/demo/code", {
      sourceId: "source_demo",
      ref: "speclens/job_123",
      compare: "HEAD",
      filter: ["open", "warnings"],
    }),
    "/portal/workspaces/demo/code?sourceId=source_demo&ref=speclens%2Fjob_123&compare=HEAD&filter=open&filter=warnings",
  );
});

test("web auth return-to helper omits an empty query string cleanly", async () => {
  const auth = await import("../apps/web/lib/auth");
  assert.equal(auth.buildPortalReturnTo("/portal/workspaces", {}), "/portal/workspaces");
});

test("web auth login route rejects external returnTo targets", async () => {
  const originalEnv = { ...process.env };
  clearKeycloakEnv();
  ensureTestAuthSecrets();
  const route = await import("../apps/web/app/api/auth/login/route");
  const response = await route.GET(new Request("http://localhost:3000/api/auth/login?returnTo=https://attacker.example/phish"));

  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "http://localhost:3000/portal/workspaces");

  process.env = originalEnv;
});

test("web auth login route normalizes Keycloak callback returnTo targets", async () => {
  const originalEnv = { ...process.env };
  clearKeycloakEnv();
  ensureTestAuthSecrets();
  process.env.KEYCLOAK_ISSUER_URL = "http://localhost:8081/realms/speclens";
  process.env.KEYCLOAK_CLIENT_ID = "speclens-web";

  const route = await import("../apps/web/app/api/auth/login/route");
  const response = await route.GET(new Request("http://localhost:3000/api/auth/login?returnTo=https://attacker.example/phish"));

  assert.equal(response.status, 307);
  const location = new URL(response.headers.get("location") ?? "");
  const redirectUri = new URL(location.searchParams.get("redirect_uri") ?? "http://localhost:3000/api/auth/callback");
  assert.equal(redirectUri.origin, "http://localhost:3000");
  assert.equal(redirectUri.pathname, "/api/auth/callback");
  assert.equal(redirectUri.searchParams.get("returnTo"), "/portal/workspaces");

  process.env = originalEnv;
});

test("web auth login route redirects to Keycloak when configured", async () => {
  const originalEnv = { ...process.env };
  clearKeycloakEnv();
  ensureTestAuthSecrets();
  process.env.KEYCLOAK_ISSUER_URL = "http://localhost:8081/realms/speclens";
  process.env.KEYCLOAK_CLIENT_ID = "speclens-web";

  const route = await import("../apps/web/app/api/auth/login/route");
  const response = await route.GET(new Request("http://localhost:3000/api/auth/login?returnTo=/portal"));

  assert.equal(response.status, 307);
  const location = response.headers.get("location") ?? "";
  assert.equal(location.startsWith("http://localhost:8081/realms/speclens/protocol/openid-connect/auth"), true);
  assert.equal(location.includes("client_id=speclens-web"), true);
  assert.equal((response.headers.get("set-cookie") ?? "").includes("speclens_oidc_state="), true);

  process.env = originalEnv;
});

test("web auth callback route rejects external returnTo targets in local dev mode", async () => {
  const originalEnv = { ...process.env };
  clearKeycloakEnv();
  ensureTestAuthSecrets();
  const route = await import("../apps/web/app/api/auth/callback/route");
  const response = await route.GET(new Request("http://localhost:3000/api/auth/callback?returnTo=https://attacker.example/phish"));

  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "http://localhost:3000/portal/workspaces");

  process.env = originalEnv;
});

test("web auth logout route clears the local portal session cookie", async () => {
  const originalEnv = { ...process.env };
  clearKeycloakEnv();
  ensureTestAuthSecrets();
  const route = await import("../apps/web/app/api/auth/logout/route");
  const response = await route.GET(new Request("http://localhost:3000/api/auth/logout"));

  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "http://localhost:3000/pricing");
  assert.equal((response.headers.get("set-cookie") ?? "").includes("speclens_portal_session="), true);

  process.env = originalEnv;
});

test("web proxy forwards Keycloak bearer token and session cookie to the API", async () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  process.env.INTERNAL_API_URL = "http://api:4000";

  let capturedAuthorization: string | null = null;
  let capturedCookie: string | null = null;
  global.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    capturedAuthorization = headers.get("authorization");
    capturedCookie = headers.get("cookie");
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    });
  }) as typeof fetch;

  const route = await import("../apps/web/app/api/proxy/[...path]/route");
  const response = await route.GET(
    new Request("http://localhost:3000/api/proxy/api/me", {
      headers: {
        cookie: [
          "speclens_portal_session=demo-session",
          "speclens_portal_id_token=demo-token",
        ].join("; "),
      },
    }),
    {
      params: Promise.resolve({
        path: ["api", "me"],
      }),
    },
  );

  assert.equal(response.status, 200);
  assert.equal(capturedAuthorization, "Bearer demo-token");
  assert.equal(capturedCookie, "speclens_portal_session=demo-session");

  global.fetch = originalFetch;
  process.env = originalEnv;
});

test("web proxy forwards multipart request bodies without text conversion", async () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  process.env.INTERNAL_API_URL = "http://api:4000";

  let capturedBody: Uint8Array | null = null;
  let capturedContentType: string | null = null;
  global.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    capturedContentType = headers.get("content-type");
    if (init?.body instanceof Uint8Array) {
      capturedBody = init.body;
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    });
  }) as typeof fetch;

  const route = await import("../apps/web/app/api/proxy/[...path]/route");
  const body = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
  const response = await route.POST(
    new Request("http://localhost:3000/api/proxy/api/workspaces/demo/uploads", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=demo",
      },
      body,
    }),
    {
      params: Promise.resolve({
        path: ["api", "workspaces", "demo", "uploads"],
      }),
    },
  );

  assert.equal(response.status, 200);
  assert.equal(capturedContentType, "multipart/form-data; boundary=demo");
  assert.deepEqual(Array.from(capturedBody ?? []), Array.from(body));

  global.fetch = originalFetch;
  process.env = originalEnv;
});

test("web request-origin ignores forwarded host headers on untrusted public request hosts", async () => {
  const module = await import("../apps/web/lib/request-origin");
  const origin = module.resolvePublicRequestOrigin({
    requestUrl: "https://public.speclens.example/api/auth/login",
    forwardedProto: "https",
    forwardedHost: "attacker.example",
    configuredBaseUrl: "https://public.speclens.example",
  });

  assert.equal(origin, "https://public.speclens.example");
});

test("web request-origin honors forwarded host headers behind trusted local proxies", async () => {
  const module = await import("../apps/web/lib/request-origin");
  const origin = module.resolvePublicRequestOrigin({
    requestUrl: "http://web:3000/api/auth/login",
    forwardedProto: "https",
    forwardedHost: "app.speclens.example",
    configuredBaseUrl: "https://app.speclens.example",
  });

  assert.equal(origin, "https://app.speclens.example");
});

test("web request-origin rejects mismatched forwarded hosts when a public base URL is configured", async () => {
  const module = await import("../apps/web/lib/request-origin");
  const origin = module.resolvePublicRequestOrigin({
    requestUrl: "http://web:3000/api/auth/login",
    forwardedProto: "https",
    forwardedHost: "attacker.example",
    configuredBaseUrl: "https://app.speclens.example",
  });

  assert.equal(origin, "https://app.speclens.example");
});

test("web auth login route keeps Keycloak callback origins pinned to the configured app URL behind trusted proxies", async () => {
  const originalEnv = { ...process.env };
  clearKeycloakEnv();
  ensureTestAuthSecrets();
  process.env.APP_URL = "https://app.speclens.example";
  process.env.KEYCLOAK_ISSUER_URL = "https://sso.speclens.example/realms/speclens";
  process.env.KEYCLOAK_CLIENT_ID = "speclens-web";

  const route = await import("../apps/web/app/api/auth/login/route");
  const response = await route.GET(new Request("http://web:3000/api/auth/login?returnTo=/portal", {
    headers: {
      "x-forwarded-proto": "https",
      "x-forwarded-host": "attacker.example",
    },
  }));

  assert.equal(response.status, 307);
  const location = new URL(response.headers.get("location") ?? "");
  const redirectUri = new URL(location.searchParams.get("redirect_uri") ?? "https://app.speclens.example/api/auth/callback");
  assert.equal(redirectUri.origin, "https://app.speclens.example");
  assert.equal(redirectUri.pathname, "/api/auth/callback");
  assert.equal(redirectUri.searchParams.get("returnTo"), "/portal");

  process.env = originalEnv;
});

test("workspace report href helper suppresses broken report links when the report payload is missing", async () => {
  const module = await import("../apps/web/lib/portal");
  assert.equal(module.getWorkspaceReportHref("ws_demo", null), null);
  assert.equal(module.getWorkspaceReportHref("ws_demo", undefined), null);
});

test("workspace report href helper returns the direct report route when a report id is present", async () => {
  const module = await import("../apps/web/lib/portal");
  assert.equal(module.getWorkspaceReportHref("ws_demo", "report_demo"), "/portal/workspaces/ws_demo/reports/report_demo");
});

test("workspace run href helper suppresses broken analysis-job links when the job payload is missing", async () => {
  const module = await import("../apps/web/lib/portal");
  assert.equal(module.getWorkspaceRunHref("ws_demo", null), null);
  assert.equal(module.getWorkspaceRunHref("ws_demo", undefined), null);
});

test("workspace run href helper returns the direct run route when a job id is present", async () => {
  const module = await import("../apps/web/lib/portal");
  assert.equal(module.getWorkspaceRunHref("ws_demo", "job_demo"), "/portal/workspaces/ws_demo/runs/job_demo");
});

test("workspace reports empty-state helper explains filtered searches separately", async () => {
  const module = await import("../apps/web/lib/portal");
  assert.deepEqual(module.getWorkspaceReportsEmptyState("security"), {
    title: "No reports matched this filter.",
    detail: "Try a different title, source, or status search for “security”, or open the runs view to inspect jobs that have not produced report output yet.",
  });
});

test("workspace reports empty-state helper guides first-time report review", async () => {
  const module = await import("../apps/web/lib/portal");
  assert.deepEqual(module.getWorkspaceReportsEmptyState(""), {
    title: "No reports available yet.",
    detail: "Completed runs with durable report output will appear here. Open the runs view to inspect in-progress jobs, logs, and artifacts while you wait.",
  });
});

test("workspace report sections empty-state helper explains missing normalized sections when findings exist", async () => {
  const module = await import("../apps/web/lib/portal");
  assert.deepEqual(module.getWorkspaceReportSectionsEmptyState({ totalFindings: 2 }), {
    title: "Normalized sections are not available for this report yet.",
    detail: "Review the findings below and open the job or artifacts if you need the raw execution evidence before section rendering is available.",
  });
});

test("workspace report findings empty-state helper explains clean release-gate outcomes", async () => {
  const module = await import("../apps/web/lib/portal");
  assert.deepEqual(module.getWorkspaceReportFindingsEmptyState({ releaseGateStatus: "pass", sectionsCount: 1 }), {
    title: "No findings were recorded in this report.",
    detail: "The release gate is currently passing. Review the sections and artifacts if you need the supporting execution evidence for this clean result.",
  });
  assert.equal(module.getWorkspaceReportFindingsEmptyStateTagClass("pass"), "tag tag--success");
});

test("workspace report findings empty-state helper warns when the release gate is not passing", async () => {
  const module = await import("../apps/web/lib/portal");
  assert.deepEqual(module.getWorkspaceReportFindingsEmptyState({ releaseGateStatus: "warn", sectionsCount: 1 }), {
    title: "No findings were extracted, but the release gate still needs review.",
    detail: "The release gate is currently warning. Review the normalized sections, job logs, and artifacts to confirm what evidence was captured before treating this report as clean.",
  });
  assert.equal(module.getWorkspaceReportFindingsEmptyStateTagClass("warn"), "tag tag--warning");
  assert.equal(module.getWorkspaceReportFindingsEmptyStateTagClass("fail"), "tag tag--danger");
});

test("workspace report findings empty-state helper explains fully empty report payloads", async () => {
  const module = await import("../apps/web/lib/portal");
  assert.deepEqual(module.getWorkspaceReportFindingsEmptyState({ releaseGateStatus: null, sectionsCount: 0 }), {
    title: "This report does not contain any findings yet.",
    detail: "Open the job and artifact history to confirm whether the run finished with no actionable issues or stopped before finding output was generated.",
  });
  assert.equal(module.getWorkspaceReportFindingsEmptyStateTagClass(null), "tag tag--neutral");
});

test("workspace report remediation helper keeps queued remediation runs visible before a changeset exists", async () => {
  const module = await import("../apps/web/lib/portal");
  assert.deepEqual(module.getWorkspaceReportRemediationSummary({
    changesetGenerated: false,
    latestRemediationJobId: "job_remediate",
    latestRemediationJobStatus: "queued",
  }), {
    tagClass: "tag tag--warning",
    title: "Remediation run queued",
    detail: "A remediation run has already been queued for this report. Open the remediation run to follow progress, logs, and artifacts before a changeset is ready.",
    canOpenRun: true,
  });
});

test("workspace report remediation helper explains failed remediation runs without a changeset", async () => {
  const module = await import("../apps/web/lib/portal");
  assert.deepEqual(module.getWorkspaceReportRemediationSummary({
    changesetGenerated: false,
    latestRemediationJobId: "job_remediate",
    latestRemediationJobStatus: "failed",
  }), {
    tagClass: "tag tag--danger",
    title: "Latest remediation run needs review",
    detail: "The latest remediation run did not finish cleanly, so no changeset is available yet. Open the remediation run to inspect logs and artifacts before retrying.",
    canOpenRun: true,
  });
});

test("workspace report remediation helper keeps first-run guidance when no remediation run exists yet", async () => {
  const module = await import("../apps/web/lib/portal");
  assert.deepEqual(module.getWorkspaceReportRemediationSummary({
    changesetGenerated: false,
    latestRemediationJobId: null,
    latestRemediationJobStatus: null,
  }), {
    tagClass: "tag tag--neutral",
    title: "No remediation changeset has been generated for this report yet.",
    detail: "Launch remediation from this report when you want SpecLens to prepare a queued fix run and produce reviewable changeset output.",
    canOpenRun: false,
  });
});

test("workspace report remediation code href helper preserves branch diff context for changed files", async () => {
  const module = await import("../apps/web/lib/portal");
  assert.equal(
    module.getWorkspaceReportRemediationCodeHref({
      workspaceId: "ws_demo",
      sourceId: "source_demo",
      reportId: "report_demo",
      filePath: "src/fix me.ts",
      branchName: "autofix/report_demo",
      baseRef: "main",
    }),
    "/portal/workspaces/ws_demo/code?sourceId=source_demo&path=src%2Ffix+me.ts&reportId=report_demo&ref=autofix%2Freport_demo&compare=main",
  );
});

test("workspace report remediation code href helper omits diff parameters when no remediation branch exists", async () => {
  const module = await import("../apps/web/lib/portal");
  assert.equal(
    module.getWorkspaceReportRemediationCodeHref({
      workspaceId: "ws_demo",
      sourceId: "source_demo",
      reportId: "report_demo",
      filePath: "src/fix.ts",
      branchName: null,
      baseRef: "main",
    }),
    "/portal/workspaces/ws_demo/code?sourceId=source_demo&path=src%2Ffix.ts&reportId=report_demo",
  );
});

test("workspace report finding code href helper preserves remediation diff context", async () => {
  const module = await import("../apps/web/lib/portal");
  assert.equal(
    module.getWorkspaceReportFindingCodeHref({
      workspaceId: "ws_demo",
      sourceId: "source_demo",
      reportId: "report_demo",
      findingId: "finding_demo",
      filePath: "src/fix.ts",
      branchName: "autofix/report_demo",
      baseRef: "main",
    }),
    "/portal/workspaces/ws_demo/code?sourceId=source_demo&path=src%2Ffix.ts&reportId=report_demo&findingId=finding_demo&ref=autofix%2Freport_demo&compare=main",
  );
});

test("workspace report finding code href helper omits remediation diff context when no branch exists", async () => {
  const module = await import("../apps/web/lib/portal");
  assert.equal(
    module.getWorkspaceReportFindingCodeHref({
      workspaceId: "ws_demo",
      sourceId: "source_demo",
      reportId: "report_demo",
      findingId: "finding_demo",
      filePath: null,
      branchName: null,
      baseRef: "main",
    }),
    "/portal/workspaces/ws_demo/code?sourceId=source_demo&reportId=report_demo&findingId=finding_demo",
  );
});

test("changeset branch helper falls back to pull instructions when branchName is missing", async () => {
  const module = await import("../apps/web/lib/portal");
  assert.equal(
    module.getChangesetBranchName({
      branchName: null,
      pullInstructions: [
        "git fetch <remote> speclens/job_123",
        "git checkout speclens/job_123",
      ],
    }),
    "speclens/job_123",
  );
});

test("changeset branch helper prefers explicit branch names over pull instruction parsing", async () => {
  const module = await import("../apps/web/lib/portal");
  assert.equal(
    module.getChangesetBranchName({
      branchName: "autofix/report_demo",
      pullInstructions: [
        "git fetch <remote> speclens/job_123",
      ],
    }),
    "autofix/report_demo",
  );
});

test("workspace-scoped report context helper accepts report and job payloads from the active workspace", async () => {
  const module = await import("../apps/web/lib/portal");
  assert.equal(
    module.isWorkspaceScopedReportContext(
      "ws_demo",
      { workspaceId: "ws_demo" },
      { workspaceId: "ws_demo" },
      { workspaceId: "ws_demo" },
    ),
    true,
  );
});

test("workspace-scoped report page context helper accepts report and workspace console payloads from the active workspace", async () => {
  const module = await import("../apps/web/lib/portal");
  assert.equal(
    module.isWorkspaceScopedReportPageContext(
      "ws_demo",
      [
        { workspaceId: "ws_demo" },
        { workspaceId: "ws_demo" },
        { workspaceId: "ws_demo" },
      ],
      {
        workspace: {
          id: "ws_demo",
        },
        members: [{ workspaceId: "ws_demo" }],
        sources: [{ workspaceId: "ws_demo" }],
        installations: [{ workspaceId: "ws_demo" }],
        jobs: [
          {
            job: { workspaceId: "ws_demo" },
            report: { workspaceId: "ws_demo" },
          },
        ],
      },
    ),
    true,
  );
});

test("workspace-scoped report context helper rejects mismatched report workspace payloads", async () => {
  const module = await import("../apps/web/lib/portal");
  assert.equal(
    module.isWorkspaceScopedReportContext(
      "ws_demo",
      { workspaceId: "ws_other" },
      { workspaceId: "ws_demo" },
    ),
    false,
  );
});

test("workspace-scoped report page context helper rejects mismatched workspace console payloads", async () => {
  const module = await import("../apps/web/lib/portal");
  assert.equal(
    module.isWorkspaceScopedReportPageContext(
      "ws_demo",
      [
        { workspaceId: "ws_demo" },
        { workspaceId: "ws_demo" },
        null,
      ],
      {
        workspace: {
          id: "ws_other",
        },
        members: [{ workspaceId: "ws_demo" }],
        sources: [{ workspaceId: "ws_demo" }],
        installations: [{ workspaceId: "ws_demo" }],
        jobs: [],
      },
    ),
    false,
  );
});

test("workspace-scoped job context helper accepts job and report payloads from the active workspace", async () => {
  const module = await import("../apps/web/lib/portal");
  assert.equal(
    module.isWorkspaceScopedJobContext(
      "ws_demo",
      { workspaceId: "ws_demo" },
      { workspaceId: "ws_demo" },
    ),
    true,
  );
});

test("workspace-scoped job context helper accepts in-progress jobs before a report exists", async () => {
  const module = await import("../apps/web/lib/portal");
  assert.equal(
    module.isWorkspaceScopedJobContext(
      "ws_demo",
      { workspaceId: "ws_demo" },
      null,
    ),
    true,
  );
});

test("workspace-scoped job context helper rejects mismatched job workspace payloads", async () => {
  const module = await import("../apps/web/lib/portal");
  assert.equal(
    module.isWorkspaceScopedJobContext(
      "ws_demo",
      { workspaceId: "ws_other" },
      { workspaceId: "ws_demo" },
    ),
    false,
  );
});

test("workspace-scoped code-review context helper accepts review payloads from the active workspace and visible sources", async () => {
  const module = await import("../apps/web/lib/portal");
  assert.equal(
    module.isWorkspaceScopedCodeReviewContext(
      "ws_demo",
      {
        workspaceId: "ws_demo",
        source: { id: "source_demo" },
      },
      [{ id: "source_demo" }, { id: "source_other" }],
    ),
    true,
  );
});

test("workspace-scoped code-review context helper rejects mismatched review workspace payloads and foreign sources", async () => {
  const module = await import("../apps/web/lib/portal");
  assert.equal(
    module.isWorkspaceScopedCodeReviewContext(
      "ws_demo",
      {
        workspaceId: "ws_other",
        source: { id: "source_demo" },
      },
      [{ id: "source_demo" }],
    ),
    false,
  );
  assert.equal(
    module.isWorkspaceScopedCodeReviewContext(
      "ws_demo",
      {
        workspaceId: "ws_demo",
        source: { id: "source_foreign" },
      },
      [{ id: "source_demo" }],
    ),
    false,
  );
});

test("workspace-scoped code page context helper accepts matching review and workspace console payloads", async () => {
  const module = await import("../apps/web/lib/portal");
  assert.equal(
    module.isWorkspaceScopedCodePageContext(
      "ws_demo",
      {
        workspaceId: "ws_demo",
        source: { id: "source_demo" },
      },
      {
        workspace: {
          id: "ws_demo",
        },
        members: [{ workspaceId: "ws_demo" }],
        sources: [{ id: "source_demo", workspaceId: "ws_demo" }],
        installations: [{ workspaceId: "ws_demo" }],
        jobs: [
          {
            job: { workspaceId: "ws_demo" },
            report: { workspaceId: "ws_demo" },
          },
        ],
      },
    ),
    true,
  );
});

test("workspace-scoped code page context helper rejects mismatched workspace console payloads", async () => {
  const module = await import("../apps/web/lib/portal");
  assert.equal(
    module.isWorkspaceScopedCodePageContext(
      "ws_demo",
      {
        workspaceId: "ws_demo",
        source: { id: "source_demo" },
      },
      {
        workspace: {
          id: "ws_other",
        },
        members: [{ workspaceId: "ws_demo" }],
        sources: [{ id: "source_demo", workspaceId: "ws_demo" }],
        installations: [{ workspaceId: "ws_demo" }],
        jobs: [],
      },
    ),
    false,
  );
});

test("workspace-scoped console context helper accepts overview payloads from the active workspace", async () => {
  const module = await import("../apps/web/lib/portal");
  assert.equal(
    module.isWorkspaceScopedWorkspaceConsoleContext("ws_demo", {
      workspace: {
        id: "ws_demo",
      },
      members: [{ workspaceId: "ws_demo" }],
      sources: [{ workspaceId: "ws_demo" }],
      installations: [{ workspaceId: "ws_demo" }],
      jobs: [
        {
          job: { workspaceId: "ws_demo" },
          report: { workspaceId: "ws_demo" },
        },
      ],
    }),
    true,
  );
});

test("workspace-scoped console context helper rejects mismatched overview payloads", async () => {
  const module = await import("../apps/web/lib/portal");
  assert.equal(
    module.isWorkspaceScopedWorkspaceConsoleContext("ws_demo", {
      workspace: {
        id: "ws_other",
      },
      members: [{ workspaceId: "ws_demo" }],
      sources: [{ workspaceId: "ws_demo" }],
      installations: [{ workspaceId: "ws_demo" }],
      jobs: [],
    }),
    false,
  );
  assert.equal(
    module.isWorkspaceScopedWorkspaceConsoleContext("ws_demo", {
      workspace: {
        id: "ws_demo",
      },
      members: [{ workspaceId: "ws_demo" }],
      sources: [{ workspaceId: "ws_demo" }],
      installations: [{ workspaceId: "ws_other" }],
      jobs: [
        {
          job: { workspaceId: "ws_demo" },
          report: { workspaceId: "ws_other" },
        },
      ],
    }),
    false,
  );
});

test("workspace-scoped entity page helper rejects paginated members or sources from another workspace", async () => {
  const module = await import("../apps/web/lib/portal");
  assert.equal(
    module.isWorkspaceScopedEntityPage("ws_demo", [{ workspaceId: "ws_demo" }, { workspaceId: "ws_demo" }]),
    true,
  );
  assert.equal(
    module.isWorkspaceScopedEntityPage("ws_demo", [{ workspaceId: "ws_demo" }, { workspaceId: "ws_other" }]),
    false,
  );
});

test("workspace-scoped jobs page helper accepts run rows from the active workspace", async () => {
  const module = await import("../apps/web/lib/portal");
  assert.equal(
    module.isWorkspaceScopedJobsPage("ws_demo", [
      {
        job: { workspaceId: "ws_demo" },
        report: { workspaceId: "ws_demo" },
      },
      {
        job: { workspaceId: "ws_demo" },
        report: null,
      },
    ]),
    true,
  );
});

test("workspace-scoped jobs page helper rejects foreign job or report rows", async () => {
  const module = await import("../apps/web/lib/portal");
  assert.equal(
    module.isWorkspaceScopedJobsPage("ws_demo", [
      {
        job: { workspaceId: "ws_other" },
        report: { workspaceId: "ws_demo" },
      },
    ]),
    false,
  );
  assert.equal(
    module.isWorkspaceScopedJobsPage("ws_demo", [
      {
        job: { workspaceId: "ws_demo" },
        report: { workspaceId: "ws_other" },
      },
    ]),
    false,
  );
});

test("workspace-scoped github repository page helper rejects repositories from unlinked installations", async () => {
  const module = await import("../apps/web/lib/portal");
  assert.equal(
    module.isWorkspaceScopedGithubRepositoriesPage(
      [{ githubInstallationId: "github_installation_1" }],
      [{ githubInstallationId: "github_installation_1" }],
    ),
    true,
  );
  assert.equal(
    module.isWorkspaceScopedGithubRepositoriesPage(
      [{ githubInstallationId: "github_installation_1" }],
      [{ githubInstallationId: "github_installation_2" }],
    ),
    false,
  );
});

test("workspace-scoped sources page context helper rejects repositories from foreign installations", async () => {
  const module = await import("../apps/web/lib/portal");
  const workspaceConsole = {
    workspace: { id: "ws_demo" },
    members: [{ workspaceId: "ws_demo" }],
    sources: [{ workspaceId: "ws_demo" }],
    installations: [{ workspaceId: "ws_demo", githubInstallationId: "github_installation_1" }],
    jobs: [{ job: { workspaceId: "ws_demo" }, report: null }],
  };
  assert.equal(
    module.isWorkspaceScopedSourcesPageContext(
      "ws_demo",
      workspaceConsole,
      [{ workspaceId: "ws_demo" }],
      [{ githubInstallationId: "github_installation_1" }],
    ),
    true,
  );
  assert.equal(
    module.isWorkspaceScopedSourcesPageContext(
      "ws_demo",
      workspaceConsole,
      [{ workspaceId: "ws_demo" }],
      [{ githubInstallationId: "github_installation_2" }],
    ),
    false,
  );
});

test("workspace job lifecycle helper keeps all job retries and cancellation owner-only", async () => {
  const module = await import("../apps/web/lib/portal");
  assert.equal(module.canManageWorkspaceJobLifecycle("audit", false), false);
  assert.equal(module.canManageWorkspaceJobLifecycle("audit", true), true);
  assert.equal(module.canManageWorkspaceJobLifecycle("remediation", false), false);
  assert.equal(module.canManageWorkspaceJobLifecycle("remediation", true), true);
});
