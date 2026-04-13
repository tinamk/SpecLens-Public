import path from "node:path";
import { relativeFrom, writeJsonFile, writeTextFile } from "./utils.js";

function severityCounts(findings) {
  return findings.reduce((counts, finding) => {
    const key = finding.severity ?? "low";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, { high: 0, medium: 0, low: 0 });
}

function renderMarkdown(run) {
  const counts = severityCounts(run.findings);
  const lines = [
    `# SpecLens Report: ${run.runId}`,
    "",
    `Generated: ${run.createdAt}`,
    `Workspace: \`${run.workspace.name}\``,
    `Source: \`${run.source.location}\``,
    `Classification: \`${run.inventory.classification.kind}\``,
    "",
    "## Summary",
    "",
    "| Metric | Value |",
    "|---|---:|",
    `| Findings | ${run.findings.length} |`,
    `| High | ${counts.high ?? 0} |`,
    `| Medium | ${counts.medium ?? 0} |`,
    `| Low | ${counts.low ?? 0} |`,
    `| Analyzers | ${run.presetPlan.analyzers.length} |`,
    "",
    "## Inventory",
    "",
    `- Repo name: \`${run.inventory.repoName}\``,
    `- Manifests: \`${run.inventory.summary.manifestCount}\``,
    `- READMEs: \`${run.inventory.summary.readmeCount}\``,
    `- License files: \`${run.inventory.summary.licenseFileCount}\``,
    "",
    "## Findings",
    "",
  ];

  if (run.findings.length === 0) {
    lines.push("No findings.");
  } else {
    for (const finding of run.findings) {
      lines.push(`### ${finding.id} - ${finding.title}`);
      lines.push(`- Severity: ${finding.severity}`);
      lines.push(`- Analyzer: ${finding.analyzer}`);
      lines.push(`- Code: \`${finding.code}\``);
      lines.push(`- Message: ${finding.message}`);
      lines.push(`- Suggestion: ${finding.suggestion}`);
      if (finding.patch) {
        lines.push(`- Patch export: ${finding.patch.description}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

function renderHtml(run) {
  const findings = run.findings.map(finding => `
    <article class="finding severity-${finding.severity}">
      <div class="meta">
        <span class="badge">${finding.severity.toUpperCase()}</span>
        <span>${finding.analyzer}</span>
        <span>${finding.code}</span>
      </div>
      <h3>${escapeHtml(finding.title)}</h3>
      <p>${escapeHtml(finding.message)}</p>
      <p><strong>Suggestion:</strong> ${escapeHtml(finding.suggestion)}</p>
      ${finding.patch ? `<p><strong>Patch export:</strong> ${escapeHtml(finding.patch.description)}</p>` : ""}
    </article>
  `).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SpecLens ${escapeHtml(run.runId)}</title>
  <style>
    :root {
      --bg: #f4f1ea;
      --panel: #fffdf8;
      --ink: #182320;
      --muted: #5d6b67;
      --line: #d7d0c4;
      --high: #a63d2f;
      --medium: #b97b16;
      --low: #3c7c58;
      --accent: #254f44;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(37,79,68,0.12), transparent 35%),
        linear-gradient(180deg, #f8f5ee 0%, var(--bg) 100%);
    }
    main { max-width: 1080px; margin: 0 auto; padding: 40px 20px 64px; }
    .hero, .panel, .finding {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 18px;
      box-shadow: 0 10px 30px rgba(24,35,32,0.08);
    }
    .hero { padding: 28px; margin-bottom: 24px; }
    .eyebrow { text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); font-size: 12px; }
    h1, h2, h3 { margin: 0 0 12px; }
    h1 { font-size: 38px; line-height: 1.05; }
    p, li { line-height: 1.6; }
    .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
    .panel { padding: 22px; margin-bottom: 24px; }
    .finding-list { display: grid; gap: 16px; }
    .finding { padding: 20px; }
    .meta { display: flex; gap: 10px; flex-wrap: wrap; color: var(--muted); font-size: 14px; margin-bottom: 12px; }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 999px;
      color: white;
      font-size: 12px;
      letter-spacing: 0.08em;
      background: var(--accent);
    }
    .severity-high .badge { background: var(--high); }
    .severity-medium .badge { background: var(--medium); }
    .severity-low .badge { background: var(--low); }
    code { background: #efe7da; padding: 2px 6px; border-radius: 6px; }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <div class="eyebrow">SpecLens Run</div>
      <h1>${escapeHtml(run.runId)}</h1>
      <p>Read-only analysis for <code>${escapeHtml(run.source.location)}</code> using the <code>${escapeHtml(run.presetPlan.id)}</code> preset.</p>
    </section>
    <section class="panel">
      <h2>Summary</h2>
      <div class="grid">
        <div><strong>Workspace</strong><br>${escapeHtml(run.workspace.name)}</div>
        <div><strong>Classification</strong><br>${escapeHtml(run.inventory.classification.kind)}</div>
        <div><strong>Findings</strong><br>${String(run.findings.length)}</div>
        <div><strong>Generated Spec Pack</strong><br><code>${escapeHtml(run.artifacts.generatedSpecPack)}</code></div>
      </div>
    </section>
    <section class="panel">
      <h2>Findings</h2>
      <div class="finding-list">
        ${findings || "<p>No findings.</p>"}
      </div>
    </section>
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function writeRunArtifacts({ workspace, runDir, run }) {
  const jsonPath = path.join(runDir, "run.json");
  const markdownPath = path.join(runDir, "report.md");
  const dashboardPath = path.join(runDir, "dashboard.html");

  const artifactRun = {
    ...run,
    runFile: jsonPath,
    artifacts: {
      ...run.artifacts,
      runJson: jsonPath,
      markdown: markdownPath,
      dashboard: dashboardPath,
      generatedSpecPack: relativeFrom(runDir, run.generatedSpecPackPath),
    },
  };

  writeJsonFile(jsonPath, artifactRun);
  writeTextFile(markdownPath, renderMarkdown(artifactRun));
  writeTextFile(dashboardPath, renderHtml(artifactRun));
  return artifactRun;
}
