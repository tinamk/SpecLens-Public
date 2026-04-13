import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import type {
  AnalysisFinding,
  AnalysisLogEvent,
  AnalysisReportSection,
  CapabilityId,
  WorkspaceSecretKind,
} from "@speclens/contracts";
import {
  analysisFindingSchema,
  analysisLogEventSchema,
  analysisReportSectionSchema,
} from "@speclens/contracts";
import type { RepoInventory } from "./inventory";
import { createId, ensureDir, hashValue, nowIso, relativePosix, writeTextFile } from "./utils";
import type { WorkspaceHandle } from "./workspace";

interface BrowserSecretInput {
  id: string;
  kind: WorkspaceSecretKind;
  value: string;
  name?: string;
}

interface BrowserAnalysisContext {
  jobId: string;
  repoPath: string;
  inventory: RepoInventory;
  capabilities: CapabilityId[];
  workspace: WorkspaceHandle;
  secrets: BrowserSecretInput[];
}

interface BrowserPageRecord {
  url: string;
  finalUrl: string;
  status: number | null;
  title: string;
  h1: string | null;
  hasMain: boolean;
  screenshot: string | null;
  discoveredLinks: string[];
}

interface BrowserInteractionRecord {
  pageUrl: string;
  label: string;
  action: "click" | "fill" | "select" | "link";
  beforeScreenshot: string | null;
  afterScreenshot: string | null;
  success: boolean;
  error: string | null;
}

export interface BrowserAnalysisResult {
  findings: AnalysisFinding[];
  sections: AnalysisReportSection[];
  logs: AnalysisLogEvent[];
}

interface RuntimeContract {
  scriptName: string;
  scriptCommand: string;
  command: string[];
  baseUrl: string;
  sandboxRepoPath: string;
}

const DEFAULT_PORT = 4173;
const DEFAULT_BOOT_TIMEOUT_MS = Number.parseInt(process.env.SANDBOX_BROWSER_BOOT_TIMEOUT_MS ?? "45000", 10);
const MAX_CRAWL_PAGES = 6;
const MAX_INTERACTIONS_PER_PAGE = 3;

function createLog(jobId: string, scope: string, message: string, level: "info" | "warn" | "error" = "info"): AnalysisLogEvent {
  return analysisLogEventSchema.parse({
    id: createId("log", `${jobId}:${scope}:${message}`),
    jobId,
    level,
    scope,
    message,
    createdAt: nowIso(),
  });
}

function createFinding(
  capability: CapabilityId,
  severity: "high" | "medium" | "low",
  title: string,
  message: string,
  suggestion: string,
  evidence: string[] = [],
): AnalysisFinding {
  return analysisFindingSchema.parse({
    id: createId("finding", `${capability}:${title}:${message}`),
    capability,
    severity,
    title,
    message,
    suggestion,
    evidence,
  });
}

function createSection(
  capability: CapabilityId,
  title: string,
  status: "ready" | "planned" | "skipped",
  summary: string,
  data: Record<string, unknown>,
): AnalysisReportSection {
  return analysisReportSectionSchema.parse({
    id: createId("section", `${capability}:${title}:${summary}`),
    capability,
    title,
    status,
    summary,
    data,
  });
}

function copyRepoToSandbox(sourcePath: string, sandboxRepoPath: string): void {
  fs.rmSync(sandboxRepoPath, { recursive: true, force: true });
  fs.cpSync(sourcePath, sandboxRepoPath, {
    recursive: true,
    filter: item => {
      const baseName = path.basename(item);
      return baseName !== "node_modules" && baseName !== ".git" && baseName !== ".next" && baseName !== "dist";
    },
  });
}

function readRootManifest(repoPath: string): Record<string, unknown> | null {
  const manifestPath = path.join(repoPath, "package.json");
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function buildRuntimeContract(context: BrowserAnalysisContext): RuntimeContract | null {
  const sandboxRepoPath = path.join(context.workspace.jobsDir, context.jobId, "sandbox-repo");
  copyRepoToSandbox(context.repoPath, sandboxRepoPath);

  const manifest = readRootManifest(sandboxRepoPath);
  const scripts = (manifest?.scripts as Record<string, string> | undefined) ?? {};
  const port = DEFAULT_PORT;
  const baseUrl = `http://127.0.0.1:${port}`;
  const candidates = [
    "speclens:start",
    "start",
    "preview",
    "dev",
  ];

  for (const scriptName of candidates) {
    const scriptCommand = scripts[scriptName];
    if (!scriptCommand) continue;
    const lower = scriptCommand.toLowerCase();
    const command = ["npm", "run", scriptName];
    if (lower.includes("vite") || lower.includes("svelte-kit")) {
      command.push("--", "--host", "127.0.0.1", "--port", String(port));
    } else if (lower.includes("next dev")) {
      command.push("--", "--hostname", "127.0.0.1", "--port", String(port));
    } else if (lower.includes("next start")) {
      command.push("--", "--hostname", "127.0.0.1", "--port", String(port));
    }
    return {
      scriptName,
      scriptCommand,
      command,
      baseUrl,
      sandboxRepoPath,
    };
  }

  return null;
}

function installDependencies(sandboxRepoPath: string): { ok: boolean; message: string } {
  const manifestPath = path.join(sandboxRepoPath, "package.json");
  if (!fs.existsSync(manifestPath)) {
    return { ok: false, message: "No package.json found for browser runtime." };
  }
  const hasNodeModules = fs.existsSync(path.join(sandboxRepoPath, "node_modules"));
  if (hasNodeModules) {
    return { ok: true, message: "Dependencies already present in sandbox copy." };
  }

  const hasPackageLock = fs.existsSync(path.join(sandboxRepoPath, "package-lock.json"));
  const result = spawnSync(
    "npm",
    hasPackageLock ? ["ci"] : ["install", "--no-fund", "--no-audit"],
    {
      cwd: sandboxRepoPath,
      encoding: "utf8",
      timeout: 180000,
      env: {
        ...process.env,
        CI: "1",
      },
    },
  );

  if (result.status !== 0) {
    return {
      ok: false,
      message: result.stderr.trim() || result.stdout.trim() || "Dependency installation failed.",
    };
  }

  return { ok: true, message: hasPackageLock ? "Installed dependencies with npm ci." : "Installed dependencies with npm install." };
}

async function waitForServer(baseUrl: string, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(baseUrl, { redirect: "manual" });
      if (response.status >= 200 && response.status < 500) {
        return true;
      }
    } catch {
      // Keep polling.
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

function startRuntime(contract: RuntimeContract): ChildProcess {
  const [command, ...args] = contract.command;
  return spawn(command ?? "npm", args, {
    cwd: contract.sandboxRepoPath,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      CI: "1",
      PORT: String(DEFAULT_PORT),
      HOST: "127.0.0.1",
      SPECLENS_BASE_URL: contract.baseUrl,
    },
  });
}

function normalizeUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  parsed.hash = "";
  parsed.search = "";
  if (parsed.pathname !== "/") {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  }
  return parsed.toString();
}

function chooseCredentialSecret(secrets: BrowserSecretInput[]): { username: string; password: string } | null {
  const record = secrets.find(secret => secret.kind === "credential-pair");
  if (!record) return null;
  try {
    const value = JSON.parse(record.value) as { username?: string; password?: string };
    if (!value.username || !value.password) return null;
    return {
      username: value.username,
      password: value.password,
    };
  } catch {
    return null;
  }
}

async function resolvePlaywrightContextOptions(
  context: BrowserAnalysisContext,
  artifactsDir: string,
): Promise<{ storageState?: string }> {
  const sessionState = context.secrets.find(secret => secret.kind === "session-state");
  if (!sessionState) {
    return {};
  }
  const storageStatePath = path.join(artifactsDir, "playwright-storage-state.json");
  writeTextFile(storageStatePath, sessionState.value);
  return {
    storageState: storageStatePath,
  };
}

async function attemptCredentialLogin(page: any, baseUrl: string, credentials: { username: string; password: string } | null): Promise<boolean> {
  if (!credentials) return false;

  const candidates = ["/login", "/login/", "/signin", "/signin/", "/auth/login", "/auth/signin"];
  for (const candidate of candidates) {
    try {
      await page.goto(new URL(candidate, baseUrl).toString(), { waitUntil: "domcontentloaded", timeout: 15000 });
      const passwordInput = page.locator('input[type="password"]').first();
      if (!await passwordInput.isVisible().catch(() => false)) {
        continue;
      }

      const userInput = page.locator('input[name="username"], input[name="email"], input[type="email"], input[type="text"]').first();
      if (!await userInput.isVisible().catch(() => false)) {
        continue;
      }

      await userInput.fill(credentials.username, { timeout: 3000 });
      await passwordInput.fill(credentials.password, { timeout: 3000 });

      const submit = page.locator('button[type="submit"], input[type="submit"]').first();
      if (await submit.isVisible().catch(() => false)) {
        await submit.click({ timeout: 3000 });
      } else {
        await page.keyboard.press("Enter");
      }

      await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => undefined);
      await page.waitForTimeout(500);
      if (!String(page.url()).includes("/login") && !String(page.url()).includes("/signin")) {
        return true;
      }
    } catch {
      // Try the next login route candidate.
    }
  }

  return false;
}

async function safeScreenshot(page: any, filePath: string): Promise<string | null> {
  try {
    await page.screenshot({ path: filePath, fullPage: true, timeout: 30000 });
    return filePath;
  } catch {
    await page.waitForTimeout(1200).catch(() => undefined);
    try {
      await page.screenshot({ path: filePath, fullPage: true, timeout: 30000 });
      return filePath;
    } catch {
      return null;
    }
  }
}

function toRelativeArtifact(workspace: WorkspaceHandle, absolutePath: string | null): string | null {
  if (!absolutePath) return null;
  return relativePosix(workspace.rootDir, absolutePath);
}

function selectInteractionTargets(page: any): any[] {
  return [
    page.locator('button:not([disabled])').first(),
    page.locator('[role="button"]:not([disabled])').first(),
    page.locator('input:not([type="hidden"]):not([disabled]):not([readonly])').first(),
    page.locator('select:not([disabled])').first(),
    page.locator('a[href]').first(),
  ];
}

async function runInteractionPass(
  page: any,
  pageUrl: string,
  artifactsDir: string,
  workspace: WorkspaceHandle,
): Promise<BrowserInteractionRecord[]> {
  const interactions: BrowserInteractionRecord[] = [];
  const targets = selectInteractionTargets(page).slice(0, MAX_INTERACTIONS_PER_PAGE);

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    const label = `interaction-${index + 1}`;
    try {
      if (!await target.isVisible().catch(() => false)) continue;
      const tagName = await target.evaluate((node: Element) => node.tagName.toLowerCase()).catch(() => "button");
      const beforeShotPath = path.join(artifactsDir, `${hashValue(`${pageUrl}:${label}:before`).slice(0, 10)}-before.png`);
      const afterShotPath = path.join(artifactsDir, `${hashValue(`${pageUrl}:${label}:after`).slice(0, 10)}-after.png`);
      const beforeShot = toRelativeArtifact(workspace, await safeScreenshot(page, beforeShotPath));

      let action: BrowserInteractionRecord["action"] = "click";
      if (tagName === "input") {
        action = "fill";
        await target.fill("SpecLens test input", { timeout: 3000 });
      } else if (tagName === "select") {
        action = "select";
        const options = await target.locator("option").count().catch(() => 0);
        if (options > 1) {
          await target.selectOption({ index: 1 }, { timeout: 3000 });
        }
      } else if (tagName === "a") {
        action = "link";
        await target.click({ timeout: 3000 });
        await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => undefined);
      } else {
        await target.click({ timeout: 3000 });
      }

      await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => page.waitForTimeout(500));
      const afterShot = toRelativeArtifact(workspace, await safeScreenshot(page, afterShotPath));
      interactions.push({
        pageUrl,
        label,
        action,
        beforeScreenshot: beforeShot,
        afterScreenshot: afterShot,
        success: true,
        error: null,
      });

      if (action === "link" && normalizeUrl(page.url()) !== normalizeUrl(pageUrl)) {
        await page.goBack({ waitUntil: "domcontentloaded", timeout: 8000 }).catch(() => page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 8000 }));
      }
    } catch (error) {
      interactions.push({
        pageUrl,
        label,
        action: "click",
        beforeScreenshot: null,
        afterScreenshot: null,
        success: false,
        error: error instanceof Error ? error.message : "Unknown interaction failure.",
      });
      await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 12000 }).catch(() => undefined);
    }
  }

  return interactions;
}

export async function analyzeBrowserCapabilities(context: BrowserAnalysisContext): Promise<BrowserAnalysisResult> {
  const browserCapabilities = context.capabilities.filter(capability =>
    capability === "browser-self-check" || capability === "visual-inspection" || capability === "interaction-test");
  if (browserCapabilities.length === 0) {
    return { findings: [], sections: [], logs: [] };
  }

  const findings: AnalysisFinding[] = [];
  const sections: AnalysisReportSection[] = [];
  const logs: AnalysisLogEvent[] = [];
  const artifactsDir = path.join(context.workspace.generatedDir, "browser", context.jobId);
  ensureDir(artifactsDir);

  const runtimeContract = buildRuntimeContract(context);
  if (!runtimeContract) {
    if (browserCapabilities.includes("browser-self-check")) {
      findings.push(createFinding(
        "browser-self-check",
        "high",
        "Browser runtime boot command could not be resolved",
        "SpecLens could not find a runnable script such as speclens:start, start, preview, or dev for hosted browser analysis.",
        "Add a bootable app script or provide a preset-specific runtime contract.",
      ));
      sections.push(createSection(
        "browser-self-check",
        "Browser self-check",
        "planned",
        "The repository could not be booted for browser analysis because no supported runtime script was found.",
        {
          expectedScripts: ["speclens:start", "start", "preview", "dev"],
        },
      ));
    }
    if (browserCapabilities.includes("visual-inspection")) {
      sections.push(createSection(
        "visual-inspection",
        "Visual inspection",
        "skipped",
        "Visual inspection was skipped because the browser runtime could not be started.",
        {},
      ));
    }
    if (browserCapabilities.includes("interaction-test")) {
      sections.push(createSection(
        "interaction-test",
        "Interaction testing",
        "skipped",
        "Interaction testing was skipped because the browser runtime could not be started.",
        {},
      ));
    }
    return { findings, sections, logs };
  }

  const installResult = installDependencies(runtimeContract.sandboxRepoPath);
  logs.push(createLog(context.jobId, "runtime-install", installResult.message, installResult.ok ? "info" : "error"));
  if (!installResult.ok) {
    findings.push(createFinding(
      "browser-self-check",
      "high",
      "Sandbox dependency installation failed",
      installResult.message,
      "Verify the target repository installs cleanly in a fresh environment before requesting browser parity analysis.",
    ));
    for (const capability of browserCapabilities) {
      sections.push(createSection(
        capability,
        capability === "browser-self-check" ? "Browser self-check" : capability === "visual-inspection" ? "Visual inspection" : "Interaction testing",
        capability === "browser-self-check" ? "planned" : "skipped",
        "Browser execution stopped before runtime boot because dependency installation failed.",
        {},
      ));
    }
    return { findings, sections, logs };
  }

  let runtime: ChildProcess | null = null;
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];

  try {
    runtime = startRuntime(runtimeContract);
    runtime.stdout?.on("data", chunk => {
      stdoutLines.push(String(chunk));
    });
    runtime.stderr?.on("data", chunk => {
      stderrLines.push(String(chunk));
    });
    logs.push(createLog(context.jobId, "runtime-boot", `Starting browser runtime with script "${runtimeContract.scriptName}".`));

    const ready = await waitForServer(runtimeContract.baseUrl, DEFAULT_BOOT_TIMEOUT_MS);
    if (!ready) {
      findings.push(createFinding(
        "browser-self-check",
        "high",
        "Browser runtime failed to become ready",
        `SpecLens started "${runtimeContract.scriptName}" but the app did not respond on ${runtimeContract.baseUrl} within ${DEFAULT_BOOT_TIMEOUT_MS}ms.`,
        "Confirm the selected script starts an HTTP server and respects HOST/PORT overrides when possible.",
        [...stdoutLines, ...stderrLines].join("").trim() ? [`runtime-log:${path.join(artifactsDir, "runtime.log")}`] : [],
      ));
      writeTextFile(path.join(artifactsDir, "runtime.log"), `${stdoutLines.join("")}\n${stderrLines.join("")}`.trim());
      for (const capability of browserCapabilities) {
        sections.push(createSection(
          capability,
          capability === "browser-self-check" ? "Browser self-check" : capability === "visual-inspection" ? "Visual inspection" : "Interaction testing",
          capability === "browser-self-check" ? "planned" : "skipped",
          "Runtime boot failed before browser evidence could be collected.",
          {
            baseUrl: runtimeContract.baseUrl,
            scriptName: runtimeContract.scriptName,
          },
        ));
      }
      return { findings, sections, logs };
    }

    logs.push(createLog(context.jobId, "runtime-boot", `Browser runtime responded at ${runtimeContract.baseUrl}.`));

    const playwrightModule = await import("@playwright/test");
    const { chromium } = playwrightModule;
    const browser = await chromium.launch({
      headless: true,
    });
    const contextOptions = await resolvePlaywrightContextOptions(context, artifactsDir);
    const browserContext = await browser.newContext({
      viewport: { width: 1440, height: 960 },
      ignoreHTTPSErrors: true,
      ...contextOptions,
    });
    const page = await browserContext.newPage();
    const credentials = chooseCredentialSecret(context.secrets);
    const authenticated = await attemptCredentialLogin(page, runtimeContract.baseUrl, credentials);
    if (authenticated) {
      logs.push(createLog(context.jobId, "auth", "Credential-backed login succeeded for browser analysis."));
      const savedStatePath = path.join(artifactsDir, "captured-storage-state.json");
      await browserContext.storageState({ path: savedStatePath });
    } else if (credentials) {
      logs.push(createLog(context.jobId, "auth", "Credential-backed login did not complete; continuing with anonymous coverage.", "warn"));
    }

    const pages: BrowserPageRecord[] = [];
    const interactions: BrowserInteractionRecord[] = [];
    const queued = [runtimeContract.baseUrl];
    const visited = new Set<string>();

    while (queued.length > 0 && pages.length < MAX_CRAWL_PAGES) {
      const nextUrl = queued.shift();
      if (!nextUrl) continue;
      const normalizedUrl = normalizeUrl(nextUrl);
      if (visited.has(normalizedUrl)) continue;
      visited.add(normalizedUrl);

      const pageErrors: string[] = [];
      const consoleErrors: string[] = [];
      const requestFailures: string[] = [];
      page.removeAllListeners("pageerror");
      page.removeAllListeners("console");
      page.removeAllListeners("requestfailed");
      page.on("pageerror", (error: Error) => {
        pageErrors.push(error.message);
      });
      page.on("console", (msg: { type(): string; text(): string }) => {
        if (msg.type() === "error") {
          consoleErrors.push(msg.text());
        }
      });
      page.on("requestfailed", (request: { method(): string; url(): string }) => {
        requestFailures.push(`${request.method()} ${request.url()}`);
      });

      let status: number | null = null;
      try {
        const response = await page.goto(normalizedUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
        status = response?.status() ?? null;
        await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => page.waitForTimeout(750));
      } catch (error) {
        findings.push(createFinding(
          "browser-self-check",
          "high",
          "Navigation failed during browser crawl",
          error instanceof Error ? error.message : `Failed to open ${normalizedUrl}.`,
          "Inspect the route runtime path and network dependencies for this page.",
          [normalizedUrl],
        ));
        continue;
      }

      const screenshotPath = path.join(artifactsDir, `${hashValue(`${normalizedUrl}:page`).slice(0, 12)}.png`);
      const screenshot = toRelativeArtifact(context.workspace, await safeScreenshot(page, screenshotPath));
      const title = await page.title().catch(() => "");
      const h1 = await page.locator("h1").first().textContent().catch(() => null);
      const hasMain = await page.locator("main").count().then((count: number) => count > 0).catch(() => false);
      const links = await page.locator("a[href]").evaluateAll((nodes: Element[]) => nodes
        .map(node => (node as HTMLAnchorElement).href)
        .filter(Boolean))
        .catch(() => []) as string[];
      const discoveredLinks = links
        .map(link => normalizeUrl(link))
        .filter(link => link.startsWith(runtimeContract.baseUrl))
        .filter(link => !visited.has(link));
      for (const link of discoveredLinks) {
        if (!queued.includes(link)) {
          queued.push(link);
        }
      }

      pages.push({
        url: normalizedUrl,
        finalUrl: normalizeUrl(page.url()),
        status,
        title,
        h1,
        hasMain,
        screenshot,
        discoveredLinks,
      });

      if ((status ?? 200) >= 400) {
        findings.push(createFinding(
          "browser-self-check",
          "high",
          "HTTP failure detected during crawl",
          `${normalizedUrl} responded with status ${status}.`,
          "Fix the failing route before relying on browser parity coverage.",
          screenshot ? [screenshot] : [normalizedUrl],
        ));
      }
      if (!title.trim()) {
        findings.push(createFinding(
          "browser-self-check",
          "low",
          "Visited page is missing a title",
          `${normalizedUrl} rendered without a document title.`,
          "Add a meaningful title so browser analysis and end users can identify the page context.",
          screenshot ? [screenshot] : [normalizedUrl],
        ));
      }
      if (!hasMain) {
        findings.push(createFinding(
          "browser-self-check",
          "low",
          "Visited page is missing a main landmark",
          `${normalizedUrl} rendered without a <main> landmark.`,
          "Expose a primary main landmark to stabilize structure-aware browser checks.",
          screenshot ? [screenshot] : [normalizedUrl],
        ));
      }
      if (!h1?.trim()) {
        findings.push(createFinding(
          "browser-self-check",
          "low",
          "Visited page is missing a primary heading",
          `${normalizedUrl} rendered without an h1 heading.`,
          "Add a primary heading so the page has an observable top-level label.",
          screenshot ? [screenshot] : [normalizedUrl],
        ));
      }

      for (const errorMessage of pageErrors) {
        findings.push(createFinding(
          "browser-self-check",
          "high",
          "Uncaught page error detected",
          errorMessage,
          "Fix the runtime exception so the page can render deterministically.",
          screenshot ? [screenshot] : [normalizedUrl],
        ));
      }
      for (const errorMessage of consoleErrors) {
        findings.push(createFinding(
          "browser-self-check",
          "medium",
          "Console error detected",
          errorMessage,
          "Resolve console errors so browser runs stay clean and predictable.",
          screenshot ? [screenshot] : [normalizedUrl],
        ));
      }
      for (const failure of requestFailures) {
        findings.push(createFinding(
          "browser-self-check",
          "medium",
          "Request failure detected",
          failure,
          "Inspect network requests or application routing for broken assets and API calls.",
          screenshot ? [screenshot] : [normalizedUrl],
        ));
      }

      if (browserCapabilities.includes("interaction-test")) {
        const pageInteractions = await runInteractionPass(page, normalizedUrl, artifactsDir, context.workspace);
        interactions.push(...pageInteractions);
        for (const interaction of pageInteractions.filter(item => !item.success)) {
          findings.push(createFinding(
            "interaction-test",
            "medium",
            "Interaction failed during sandbox run",
            interaction.error ?? "An interaction attempt failed unexpectedly.",
            "Inspect the target control and ensure it can be exercised in a clean browser session.",
            [interaction.pageUrl],
          ));
        }
      }
    }

    await browser.close();

    if (browserCapabilities.includes("browser-self-check")) {
      sections.push(createSection(
        "browser-self-check",
        "Browser self-check",
        "ready",
        `${pages.length} page(s) were crawled with ${findings.filter(item => item.capability === "browser-self-check").length} browser self-check finding(s).`,
        {
          baseUrl: runtimeContract.baseUrl,
          scriptName: runtimeContract.scriptName,
          authenticated,
          pages,
        },
      ));
    }

    if (browserCapabilities.includes("visual-inspection")) {
      sections.push(createSection(
        "visual-inspection",
        "Visual inspection",
        "ready",
        `${pages.filter(pageRecord => pageRecord.screenshot).length} full-page screenshot(s) were captured for browser-visible review.`,
        {
          pages: pages.map(pageRecord => ({
            url: pageRecord.url,
            screenshot: pageRecord.screenshot,
            title: pageRecord.title,
          })),
        },
      ));
    }

    if (browserCapabilities.includes("interaction-test")) {
      sections.push(createSection(
        "interaction-test",
        "Interaction testing",
        "ready",
        `${interactions.length} interaction attempt(s) were exercised with ${interactions.filter(item => !item.success).length} failure(s).`,
        {
          interactions,
        },
      ));
    }

    writeTextFile(path.join(artifactsDir, "runtime.log"), `${stdoutLines.join("")}\n${stderrLines.join("")}`.trim());
    logs.push(createLog(context.jobId, "browser-run", `Browser execution completed with ${pages.length} crawled page(s).`));
    return { findings, sections, logs };
  } catch (error) {
    findings.push(createFinding(
      "browser-self-check",
      "high",
      "Browser execution failed unexpectedly",
      error instanceof Error ? error.message : "Unknown browser execution error.",
      "Inspect the runner environment, Playwright availability, and runtime boot script.",
    ));
    for (const capability of browserCapabilities) {
      if (!sections.some(section => section.capability === capability)) {
        sections.push(createSection(
          capability,
          capability === "browser-self-check" ? "Browser self-check" : capability === "visual-inspection" ? "Visual inspection" : "Interaction testing",
          capability === "browser-self-check" ? "planned" : "skipped",
          "Browser execution terminated before this capability could complete.",
          {},
        ));
      }
    }
    return { findings, sections, logs };
  } finally {
    runtime?.kill("SIGTERM");
  }
}
