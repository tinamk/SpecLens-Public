import fs from "node:fs";
import path from "node:path";
import type {
  AnalysisFinding,
  AnalysisLogEvent,
  AnalysisReportSection,
  AnalysisRuntimeMode,
  CapabilityId,
  PresetId,
} from "@speclens/contracts";
import {
  analysisFindingSchema,
  analysisLogEventSchema,
  analysisReportSectionSchema,
} from "@speclens/contracts";
import { generateWithOrderedProviders } from "./ai";
import type { RepoInventory } from "./inventory";
import { createId, ensureDir, loadJsonIfExists, nowIso, writeTextFile } from "./utils";
import type { WorkspaceHandle } from "./workspace";

interface CapabilityContext {
  jobId: string;
  repoPath: string;
  inventory: RepoInventory;
  preset: Exclude<PresetId, "auto">;
  capabilities: CapabilityId[];
  runtimeMode: AnalysisRuntimeMode;
  workspace: WorkspaceHandle;
}

export interface CapabilityAnalysisResult {
  findings: AnalysisFinding[];
  sections: AnalysisReportSection[];
  logs: AnalysisLogEvent[];
}

interface SourceFileRecord {
  relativePath: string;
  absolutePath: string;
  text: string;
}

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
    id: createId("section", `${capability}:${title}`),
    capability,
    title,
    status,
    summary,
    data,
  });
}

function scanSourceFiles(repoPath: string): SourceFileRecord[] {
  const result: SourceFileRecord[] = [];
  const queue = [repoPath];
  const allowedExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".svelte", ".css", ".scss", ".md"]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".next" || entry.name === "dist") {
        continue;
      }
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolutePath);
        continue;
      }
      if (!allowedExtensions.has(path.extname(entry.name))) {
        continue;
      }
      try {
        result.push({
          relativePath: path.relative(repoPath, absolutePath).replace(/\\/g, "/"),
          absolutePath,
          text: fs.readFileSync(absolutePath, "utf8"),
        });
      } catch {
        // Ignore unreadable files.
      }
    }
  }

  return result;
}

function extractQuotedStrings(text: string): string[] {
  const matches = text.matchAll(/["'`](.{2,80}?)["'`]/g);
  const values: string[] = [];
  for (const match of matches) {
    const candidate = match[1]?.trim();
    if (!candidate) continue;
    if (/^[a-z0-9\-_/.:]+$/i.test(candidate) && !/\s/.test(candidate)) continue;
    if (candidate.includes("{") || candidate.includes("}") || candidate.includes("${")) continue;
    if (candidate.length < 2) continue;
    values.push(candidate);
  }
  return values;
}

function buildLabelVariants(values: string[]): Map<string, Set<string>> {
  const variants = new Map<string, Set<string>>();
  for (const value of values) {
    const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!normalized) continue;
    const current = variants.get(normalized) ?? new Set<string>();
    current.add(value);
    variants.set(normalized, current);
  }
  return variants;
}

function loadLicensePolicy(): {
  classifications: { allow: string[]; review: string[]; block: string[] };
  aliases: Record<string, string>;
} {
  return loadJsonIfExists(path.resolve(process.cwd(), "policies/license-policy.json"), {
    classifications: { allow: ["MIT", "Apache-2.0", "UNLICENSED"], review: ["MPL-2.0"], block: ["GPL-3.0-only"] },
    aliases: {},
  });
}

function normalizeLicense(value: string | null, aliases: Record<string, string>): string {
  if (!value) return "UNLICENSED";
  return aliases[value] ?? value;
}

export async function analyzeCapabilities(context: CapabilityContext): Promise<CapabilityAnalysisResult> {
  const files = scanSourceFiles(context.repoPath);
  const uiFiles = files.filter(file => /\.(tsx|jsx|svelte)$/.test(file.relativePath));
  const componentFiles = uiFiles.filter(file => /(^|\/)[A-Z][A-Za-z0-9_-]*\.(tsx|jsx|svelte)$/.test(file.relativePath));
  const allStrings = uiFiles.flatMap(file => extractQuotedStrings(file.text));
  const labelStrings = allStrings.filter(value => /^[A-Z][A-Za-z0-9 ,./()&:-]+$/.test(value));
  const labelVariants = buildLabelVariants(labelStrings);
  const licensePolicy = loadLicensePolicy();

  const findings: AnalysisFinding[] = [];
  const sections: AnalysisReportSection[] = [];
  const logs: AnalysisLogEvent[] = [];

  if (context.capabilities.includes("repo-inventory")) {
    sections.push(createSection(
      "repo-inventory",
      "Repository inventory",
      "ready",
      `${context.inventory.summary.manifestCount} manifest(s), ${context.inventory.rootEntries.length} root entry(s), and ${context.inventory.summary.readmeCount} README signal(s) detected.`,
      {
        classification: context.inventory.classification,
        manifests: context.inventory.manifests.map(manifest => ({
          relativePath: manifest.relativePath,
          name: manifest.name,
          scripts: manifest.scripts,
          license: manifest.license,
        })),
        rootEntries: context.inventory.rootEntries,
        summary: context.inventory.summary,
      },
    ));
    logs.push(createLog(context.jobId, "inventory", "Repository inventory capability completed."));
  }

  if (context.capabilities.includes("spec-check")) {
    const specFiles = files.filter(file => /(^|\/)specs\/.*\.md$/.test(file.relativePath) || /^specs\/.*\.md$/.test(file.relativePath));
    if (specFiles.length === 0) {
      findings.push(createFinding(
        "spec-check",
        "medium",
        "No project-local specs found",
        "SpecLens did not detect any project-local spec markdown files in this repository.",
        "Add repository-specific specs or select a domain preset that provides expected spec packs.",
      ));
    }
    const malformedSpecs = specFiles.filter(file =>
      !(file.text.includes("## Goal") && file.text.includes("## Rules") && file.text.includes("## Acceptance checks")));
    if (malformedSpecs.length > 0) {
      findings.push(createFinding(
        "spec-check",
        "medium",
        "Spec files are missing standard sections",
        `${malformedSpecs.length} spec file(s) do not include the expected Goal, Rules, and Acceptance checks sections.`,
        "Normalize the project specs so they can support automated parity checks.",
        malformedSpecs.map(file => file.relativePath),
      ));
    }
    sections.push(createSection(
      "spec-check",
      "Spec checks",
      "ready",
      `${specFiles.length} spec file(s) scanned with ${malformedSpecs.length} formatting concern(s).`,
      {
        specFiles: specFiles.map(file => file.relativePath),
        malformedSpecs: malformedSpecs.map(file => file.relativePath),
      },
    ));
    logs.push(createLog(context.jobId, "spec-check", "Spec check capability completed."));
  }

  if (context.capabilities.includes("component-inventory")) {
    const components = componentFiles.map(file => ({
      path: file.relativePath,
      importMentions: files.reduce((count, candidate) => count + (candidate.text.includes(path.basename(file.relativePath)) ? 1 : 0), 0),
    })).sort((left, right) => right.importMentions - left.importMentions);
    if (uiFiles.length > 0 && components.length === 0) {
      findings.push(createFinding(
        "component-inventory",
        "low",
        "UI files found without reusable component signals",
        "The repository has UI source files, but SpecLens did not detect reusable component-style file naming patterns.",
        "Adopt clearer component boundaries or configure a preset that reflects this UI architecture.",
      ));
    }
    sections.push(createSection(
      "component-inventory",
      "Component inventory",
      "ready",
      `${components.length} component-like file(s) detected across ${uiFiles.length} UI file(s).`,
      {
        componentCount: components.length,
        uiFileCount: uiFiles.length,
        components: components.slice(0, 20),
      },
    ));
    logs.push(createLog(context.jobId, "component-inventory", "Component inventory capability completed."));
  }

  if (context.capabilities.includes("ui-text-inventory")) {
    sections.push(createSection(
      "ui-text-inventory",
      "UI text inventory",
      "ready",
      `${allStrings.length} candidate UI string(s) extracted from ${uiFiles.length} UI file(s).`,
      {
        sample: allStrings.slice(0, 40),
        uiFiles: uiFiles.map(file => file.relativePath),
      },
    ));
    logs.push(createLog(context.jobId, "ui-text", "UI text inventory capability completed."));
  }

  if (context.capabilities.includes("ui-label-scan")) {
    const duplicateLabels = [...labelVariants.entries()]
      .filter(([, variants]) => variants.size > 1)
      .map(([normalized, variants]) => ({ normalized, variants: [...variants].sort() }));
    if (duplicateLabels.length > 0) {
      findings.push(createFinding(
        "ui-label-scan",
        "medium",
        "Inconsistent UI label variants detected",
        `${duplicateLabels.length} normalized label group(s) use multiple visible text variants.`,
        "Standardize repeated labels and CTAs so the UI reads consistently across pages.",
        duplicateLabels.flatMap(item => item.variants),
      ));
    }
    sections.push(createSection(
      "ui-label-scan",
      "UI label scan",
      "ready",
      `${labelStrings.length} label-like string(s) scanned with ${duplicateLabels.length} inconsistent variant group(s).`,
      {
        labelCount: labelStrings.length,
        duplicateLabels,
      },
    ));
    logs.push(createLog(context.jobId, "ui-labels", "UI label scan capability completed."));
  }

  if (context.capabilities.includes("consistency-check")) {
    const inconsistentLabels = [...labelVariants.values()].filter(variants => variants.size > 1).length;
    const duplicateManifestNames = context.inventory.manifests.filter((manifest, index, manifests) =>
      manifest.name && manifests.findIndex(candidate => candidate.name === manifest.name) !== index);
    if (duplicateManifestNames.length > 0) {
      findings.push(createFinding(
        "consistency-check",
        "low",
        "Duplicate manifest package names detected",
        `${duplicateManifestNames.length} manifest(s) repeat an existing package name.`,
        "Use unique manifest names or document the intentional duplication clearly.",
        duplicateManifestNames.map(manifest => manifest.relativePath),
      ));
    }
    sections.push(createSection(
      "consistency-check",
      "Consistency review",
      "ready",
      `${inconsistentLabels} label inconsistency group(s) and ${duplicateManifestNames.length} duplicate manifest-name concern(s) detected.`,
      {
        inconsistentLabelGroups: inconsistentLabels,
        duplicateManifestNames: duplicateManifestNames.map(manifest => manifest.relativePath),
      },
    ));
    logs.push(createLog(context.jobId, "consistency", "Consistency capability completed."));
  }

  if (context.capabilities.includes("license-policy")) {
    const licenseRecords = context.inventory.manifests.map(manifest => {
      const normalized = normalizeLicense(manifest.license, licensePolicy.aliases);
      const classification = licensePolicy.classifications.block.includes(normalized)
        ? "block"
        : licensePolicy.classifications.review.includes(normalized)
          ? "review"
          : "allow";
      return {
        path: manifest.relativePath,
        name: manifest.name,
        raw: manifest.license,
        normalized,
        classification,
      };
    });
    const blocked = licenseRecords.filter(item => item.classification === "block");
    const review = licenseRecords.filter(item => item.classification === "review");
    if (blocked.length > 0) {
      findings.push(createFinding(
        "license-policy",
        "high",
        "Blocked licenses detected",
        `${blocked.length} manifest(s) resolved to blocked license classifications under the active policy.`,
        "Replace or explicitly exclude blocked dependencies before using this repo in restricted contexts.",
        blocked.map(item => `${item.path}:${item.normalized}`),
      ));
    }
    if (review.length > 0) {
      findings.push(createFinding(
        "license-policy",
        "medium",
        "Review-required licenses detected",
        `${review.length} manifest(s) resolved to licenses that require manual review under the active policy.`,
        "Review these packages before approving the repository for broader use.",
        review.map(item => `${item.path}:${item.normalized}`),
      ));
    }
    sections.push(createSection(
      "license-policy",
      "License policy review",
      "ready",
      `${licenseRecords.length} manifest license signal(s) evaluated with ${blocked.length} blocked and ${review.length} review-required result(s).`,
      {
        policyPath: "policies/license-policy.json",
        records: licenseRecords,
      },
    ));
    logs.push(createLog(context.jobId, "license", "License policy capability completed."));
  }

  if (context.capabilities.includes("spec-generation")) {
    const draftPath = path.join(context.workspace.generatedDir, `${context.jobId}.spec-draft.md`);
    const aiSpecNotes = await generateWithOrderedProviders({
      task: "spec-generation",
      prompt: [
        `Repository: ${context.inventory.repoName}`,
        `Preset: ${context.preset}`,
        `Capabilities: ${context.capabilities.join(", ")}`,
        "Top findings:",
        ...findings.slice(0, 5).map(finding => `- ${finding.title}: ${finding.message}`),
        "Write 3 short bullets for a parity-spec draft, focusing on what behavior should be preserved.",
      ].join("\n"),
    });
    const draftLines = [
      `# ${context.inventory.repoName} parity spec draft`,
      "",
      `Generated: ${nowIso()}`,
      "",
      "## Goal",
      "Document the highest-value observable behaviors this repository should preserve.",
      "",
      "## Coverage candidates",
      ...context.capabilities.map(capability => `- ${capability}`),
      "",
      "## Immediate gaps",
      ...findings.slice(0, 8).map(finding => `- ${finding.title}: ${finding.suggestion}`),
    ];
    if (aiSpecNotes.content) {
      draftLines.push("");
      draftLines.push("## AI notes");
      draftLines.push(`Provider: ${aiSpecNotes.providerId}`);
      draftLines.push(aiSpecNotes.content);
    }
    ensureDir(context.workspace.generatedDir);
    writeTextFile(draftPath, draftLines.join("\n"));
    sections.push(createSection(
      "spec-generation",
      "Spec generation",
      "ready",
      "A hosted parity spec draft was generated from the current analysis coverage and findings.",
      {
        draftPath: path.relative(context.workspace.rootDir, draftPath).replace(/\\/g, "/"),
        generatedFromCapabilities: context.capabilities,
        aiProvider: aiSpecNotes.providerId,
      },
    ));
    if (aiSpecNotes.attempted.length > 0) {
      logs.push(createLog(context.jobId, "spec-generation", `AI providers attempted for spec generation: ${aiSpecNotes.attempted.join(", ")}.`));
    }
    logs.push(createLog(context.jobId, "spec-generation", "Spec generation capability completed."));
  }

  if (context.capabilities.includes("chaos-advisor")) {
    const topFindings = [...findings].sort((left, right) => {
      const rank = { high: 0, medium: 1, low: 2 };
      return rank[left.severity] - rank[right.severity];
    }).slice(0, 5);
    const aiChaosSummary = await generateWithOrderedProviders({
      task: "chaos-advisor",
      prompt: [
        `Repository: ${context.inventory.repoName}`,
        "Summarize the most important next moves from these findings in 2 short sentences.",
        ...topFindings.map(finding => `- [${finding.severity}] ${finding.title}: ${finding.suggestion}`),
      ].join("\n"),
    });
    sections.push(createSection(
      "chaos-advisor",
      "Chaos advisor",
      "ready",
      `${topFindings.length} top risk signal(s) were synthesized from the parity analysis results.`,
      {
        topFindings: topFindings.map(finding => ({
          title: finding.title,
          severity: finding.severity,
          capability: finding.capability,
          suggestion: finding.suggestion,
        })),
        aiSummary: aiChaosSummary.content,
        aiProvider: aiChaosSummary.providerId,
      },
    ));
    if (aiChaosSummary.attempted.length > 0) {
      logs.push(createLog(context.jobId, "chaos-advisor", `AI providers attempted for chaos advisor: ${aiChaosSummary.attempted.join(", ")}.`));
    }
    logs.push(createLog(context.jobId, "chaos-advisor", "Chaos advisor capability completed."));
  }

  if (context.capabilities.includes("results-dashboard")) {
    sections.push(createSection(
      "results-dashboard",
      "Results dashboard projection",
      "ready",
      "This run includes the normalized sections needed for the hosted portal and standalone HTML export.",
      {
        reportSurface: "portal-first-with-static-export",
        sectionCount: sections.length,
      },
    ));
    logs.push(createLog(context.jobId, "results-dashboard", "Results dashboard projection prepared."));
  }

  return { findings, sections, logs };
}
