import fs from "node:fs";
import path from "node:path";
import type { AnalysisLogEvent, AnalysisReport, ArtifactReference, JobEnvelope } from "@speclens/contracts";
import { ensureDir, relativePosix, writeJsonFile, writeTextFile } from "./utils";
import type { WorkspaceHandle } from "./workspace";

export interface WriteRunArtifactsInput {
  workspace: WorkspaceHandle;
  envelope: JobEnvelope;
  generatedSpecPack: unknown;
}

function renderMarkdown(report: AnalysisReport): string {
  const roleLookup = new Map(report.roles.map(role => [role.id, role]));
  const roleLabel = (roleId: string) => roleLookup.get(roleId)?.title ?? roleId;
  const roleSummary = report.roles.length > 0
    ? report.roles.map(role => role.title || role.id).join(", ")
    : "n/a";
  const lines = [
    `# ${report.title}`,
    "",
    `Generated: ${report.createdAt}`,
    `Runtime mode: ${report.runtimeMode}`,
    "",
    "## Summary",
    "",
    `- Total findings: ${report.summary.totalFindings}`,
    `- High: ${report.summary.high}`,
    `- Medium: ${report.summary.medium}`,
    `- Low: ${report.summary.low}`,
    `- Roles: ${roleSummary}`,
    "",
    "## Sections",
    "",
  ];

  if (report.sections.length === 0) {
    lines.push("No sections.");
  } else {
    for (const section of report.sections) {
      lines.push(`### ${section.title}`);
      lines.push(`- Role: ${roleLabel(section.roleId)}`);
      lines.push(`- Status: ${section.status}`);
      lines.push(`- Summary: ${section.summary}`);
      lines.push("");
    }
  }

  lines.push("## Findings");
  lines.push("");
  if (report.findings.length === 0) {
    lines.push("No findings.");
  } else {
    for (const finding of report.findings) {
      lines.push(`### ${finding.title}`);
      lines.push(`- Role: ${roleLabel(finding.roleId)}`);
      lines.push(`- Severity: ${finding.severity}`);
      lines.push(`- Message: ${finding.message}`);
      lines.push(`- Suggestion: ${finding.suggestion}`);
      if (finding.evidence.length > 0) {
        lines.push(`- Evidence: ${finding.evidence.join(", ")}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHtml(report: AnalysisReport, logs: AnalysisLogEvent[]): string {
  const roleLookup = new Map(report.roles.map(role => [role.id, role]));
  const roleLabel = (roleId: string) => roleLookup.get(roleId)?.title ?? roleId;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(report.title)}</title>
  <style>
    body{margin:0;font-family:Georgia,serif;background:#f5f2ea;color:#14211c}
    main{max-width:1100px;margin:0 auto;padding:40px 20px 80px}
    .hero,.panel,.logline{background:#fffdf8;border:1px solid #d7cec1;border-radius:20px;box-shadow:0 12px 32px rgba(20,33,28,.08)}
    .hero,.panel{padding:24px;margin-bottom:24px}
    .hero{background:linear-gradient(140deg,#f8f4eb 0%,#eef3ee 100%)}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px}
    .finding{padding:16px;border-top:1px solid #e6ddd0}
    .badge{display:inline-block;padding:4px 10px;border-radius:999px;background:#23463d;color:#fff;font-size:12px}
    .badge--planned{background:#8a6f33}
    .role-label{font-size:12px;color:#6b5c4d;text-transform:uppercase;letter-spacing:.08em}
    .logline{padding:10px 14px;margin:8px 0;font-family:ui-monospace,monospace}
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <p>SpecLens behavioral parity report</p>
      <h1>${escapeHtml(report.title)}</h1>
      <p>Running in <strong>${escapeHtml(report.runtimeMode)}</strong> mode.</p>
      <div class="grid">
        <div><strong>Total</strong><br>${report.summary.totalFindings}</div>
        <div><strong>High</strong><br>${report.summary.high}</div>
        <div><strong>Medium</strong><br>${report.summary.medium}</div>
        <div><strong>Low</strong><br>${report.summary.low}</div>
      </div>
    </section>
    <section class="panel">
      <h2>Sections</h2>
      ${report.sections.map(section => `
        <article class="finding">
          <span class="badge ${section.status === "planned" ? "badge--planned" : ""}">${section.status.toUpperCase()}</span>
          <p class="role-label">${escapeHtml(roleLabel(section.roleId))}</p>
          <h3>${escapeHtml(section.title)}</h3>
          <p>${escapeHtml(section.summary)}</p>
        </article>
      `).join("") || "<p>No sections.</p>"}
    </section>
    <section class="panel">
      <h2>Findings</h2>
      ${report.findings.map(finding => `
        <article class="finding">
          <span class="badge">${finding.severity.toUpperCase()}</span>
          <p class="role-label">${escapeHtml(roleLabel(finding.roleId))}</p>
          <h3>${escapeHtml(finding.title)}</h3>
          <p>${escapeHtml(finding.message)}</p>
          <p><strong>Suggestion:</strong> ${escapeHtml(finding.suggestion)}</p>
          ${finding.evidence.length > 0 ? `<p><strong>Evidence:</strong> ${escapeHtml(finding.evidence.join(", "))}</p>` : ""}
        </article>
      `).join("") || "<p>No findings.</p>"}
    </section>
    <section class="panel">
      <h2>Execution log</h2>
      ${logs.map(log => `<div class="logline">[${escapeHtml(log.level)}] ${escapeHtml(log.scope)}: ${escapeHtml(log.message)}</div>`).join("")}
    </section>
  </main>
</body>
</html>`;
}

function detectMimeType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".json") return "application/json";
  if (extension === ".md") return "text/markdown";
  if (extension === ".html") return "text/html";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  return "application/octet-stream";
}

function detectArtifactKind(filePath: string): ArtifactReference["kind"] {
  const normalized = filePath.split(path.sep).join("/");
  const baseName = path.basename(normalized).toLowerCase();
  if (baseName === "report.json" || baseName === "report.md" || baseName === "report.html") {
    return "report";
  }
  if (baseName.endsWith(".png") || baseName.endsWith(".jpg") || baseName.endsWith(".jpeg")) {
    return "screenshot";
  }
  if (baseName.endsWith("trace.zip")) {
    return "trace";
  }
  if (baseName.includes("storage-state") && baseName.endsWith(".json")) {
    return "storage-state";
  }
  if (baseName === "runtime.log") {
    return "runtime-log";
  }
  if (normalized.includes("/playwright-report/")) {
    return "playwright-report";
  }
  if (normalized.includes("/test-results/")) {
    return "test-results";
  }
  if (baseName.includes("component-inventory")) {
    return "component-inventory";
  }
  if (baseName.includes("route-map")) {
    return "route-map";
  }
  if (baseName.includes("remediation-pack")) {
    return "remediation-pack";
  }
  return "artifact";
}

function collectFiles(rootDir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(rootDir)) return results;
  const queue = [rootDir];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolutePath);
      } else {
        results.push(absolutePath);
      }
    }
  }
  return results.sort();
}

function buildArtifactReferences(workspace: WorkspaceHandle, jobId: string, runDir: string, generatedPackPath: string): ArtifactReference[] {
  const browserDir = path.join(workspace.generatedDir, "browser", jobId);
  const artifactFiles = [
    generatedPackPath,
    ...collectFiles(runDir),
    ...collectFiles(browserDir),
  ];

  return artifactFiles
    .filter(filePath => fs.existsSync(filePath))
    .map(filePath => ({
      key: relativePosix(workspace.rootDir, filePath),
      bucket: "local-workspace",
      region: "local",
      kind: detectArtifactKind(filePath),
      mimeType: detectMimeType(filePath),
      sizeBytes: fs.statSync(filePath).size,
    }));
}

export function writeRunArtifacts({ workspace, envelope, generatedSpecPack }: WriteRunArtifactsInput): JobEnvelope {
  const runDir = path.join(workspace.runsDir, envelope.job.id);
  ensureDir(runDir);

  const generatedPackPath = path.join(workspace.generatedDir, `${envelope.job.id}.generated-spec-pack.json`);
  writeJsonFile(generatedPackPath, generatedSpecPack);

  if (envelope.report) {
    writeJsonFile(path.join(runDir, "report.json"), envelope.report);
    writeTextFile(path.join(runDir, "report.md"), renderMarkdown(envelope.report));
    writeTextFile(path.join(runDir, "report.html"), renderHtml(envelope.report, envelope.logs));
  }

  const nextEnvelope: JobEnvelope = envelope.report
    ? {
        ...envelope,
        report: {
          ...envelope.report,
          artifacts: buildArtifactReferences(workspace, envelope.job.id, runDir, generatedPackPath),
        },
      }
    : envelope;

  if (nextEnvelope.report) {
    writeJsonFile(path.join(runDir, "report.json"), nextEnvelope.report);
    writeTextFile(path.join(runDir, "report.md"), renderMarkdown(nextEnvelope.report));
    writeTextFile(path.join(runDir, "report.html"), renderHtml(nextEnvelope.report, nextEnvelope.logs));
  }

  writeJsonFile(path.join(runDir, "run.json"), nextEnvelope);
  return nextEnvelope;
}
