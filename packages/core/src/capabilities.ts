import type { CapabilityId, PresetId } from "@speclens/contracts";
import type { RepoInventory } from "./inventory";

export interface CapabilityDefinition {
  id: CapabilityId;
  title: string;
  runtime: "static" | "browser";
  description: string;
}

export interface PresetDefinition {
  id: Exclude<PresetId, "auto">;
  title: string;
  runtimeMode: "static" | "browser";
  capabilities: CapabilityId[];
  description: string;
}

const capabilityDefinitions: CapabilityDefinition[] = [
  { id: "repo-inventory", title: "Repo inventory", runtime: "static", description: "Repository structure and manifest analysis." },
  { id: "spec-check", title: "Spec check", runtime: "static", description: "Project spec hygiene and rule coverage checks." },
  { id: "spec-generation", title: "Spec generation", runtime: "static", description: "Generate missing spec draft recommendations." },
  { id: "component-inventory", title: "Component inventory", runtime: "static", description: "Discover component-like UI modules and reuse patterns." },
  { id: "ui-text-inventory", title: "UI text inventory", runtime: "static", description: "Collect visible string inventory from UI source." },
  { id: "ui-label-scan", title: "UI label scan", runtime: "static", description: "Check labels and CTA consistency across the UI." },
  { id: "consistency-check", title: "Consistency check", runtime: "static", description: "Find inconsistent naming, text, and metadata patterns." },
  { id: "license-policy", title: "License policy", runtime: "static", description: "Evaluate manifest licenses against the active policy." },
  { id: "browser-self-check", title: "Browser self-check", runtime: "browser", description: "Plan or run route-level browser coverage and failure inspection." },
  { id: "visual-inspection", title: "Visual inspection", runtime: "browser", description: "Inspect UI state, styling, and route presentation." },
  { id: "interaction-test", title: "Interaction test", runtime: "browser", description: "Assess interactive flows and runtime behavior." },
  { id: "chaos-advisor", title: "Chaos advisor", runtime: "static", description: "Synthesize the most important risks into an operator-ready summary." },
  { id: "results-dashboard", title: "Results dashboard", runtime: "static", description: "Project run output into a hosted portal and exportable HTML summary." },
];

const presetDefinitions: PresetDefinition[] = [
  {
    id: "generic",
    title: "Generic repo",
    runtimeMode: "static",
    capabilities: [
      "repo-inventory",
      "spec-check",
      "component-inventory",
      "ui-text-inventory",
      "ui-label-scan",
      "consistency-check",
      "license-policy",
      "spec-generation",
      "chaos-advisor",
      "results-dashboard",
    ],
    description: "Repository-agnostic baseline analysis with static parity capabilities.",
  },
  {
    id: "node-repo",
    title: "Node repo",
    runtimeMode: "static",
    capabilities: [
      "repo-inventory",
      "spec-check",
      "component-inventory",
      "ui-text-inventory",
      "ui-label-scan",
      "consistency-check",
      "license-policy",
      "spec-generation",
      "chaos-advisor",
      "results-dashboard",
    ],
    description: "Static parity baseline with stronger package and script expectations.",
  },
  {
    id: "svelte-web",
    title: "Svelte web",
    runtimeMode: "browser",
    capabilities: [
      "repo-inventory",
      "spec-check",
      "component-inventory",
      "ui-text-inventory",
      "ui-label-scan",
      "consistency-check",
      "license-policy",
      "spec-generation",
      "browser-self-check",
      "visual-inspection",
      "interaction-test",
      "chaos-advisor",
      "results-dashboard",
    ],
    description: "Web UI parity pack with browser-runtime expectations and Svelte-oriented heuristics.",
  },
  {
    id: "tagtwo",
    title: "TagTwo",
    runtimeMode: "browser",
    capabilities: [
      "repo-inventory",
      "spec-check",
      "component-inventory",
      "ui-text-inventory",
      "ui-label-scan",
      "consistency-check",
      "license-policy",
      "spec-generation",
      "browser-self-check",
      "visual-inspection",
      "interaction-test",
      "chaos-advisor",
      "results-dashboard",
    ],
    description: "Behavioral parity preset for the archived TagTwo analysis profile.",
  },
  {
    id: "client-legacy",
    title: "client legacy",
    runtimeMode: "browser",
    capabilities: [
      "repo-inventory",
      "spec-check",
      "component-inventory",
      "ui-text-inventory",
      "ui-label-scan",
      "consistency-check",
      "license-policy",
      "spec-generation",
      "browser-self-check",
      "visual-inspection",
      "interaction-test",
      "chaos-advisor",
      "results-dashboard",
    ],
    description: "Behavioral parity preset for the archived client browser-driven workflow.",
  },
];

export function listCapabilities(): CapabilityDefinition[] {
  return capabilityDefinitions;
}

export function getPresetDefinition(preset: Exclude<PresetId, "auto">): PresetDefinition {
  return presetDefinitions.find(item => item.id === preset) ?? presetDefinitions[0]!;
}

export function listPresetDefinitions(): PresetDefinition[] {
  return presetDefinitions;
}

export function resolvePresetId(requested: PresetId | undefined, inventory: RepoInventory): Exclude<PresetId, "auto"> {
  if (requested && requested !== "auto") {
    return requested;
  }

  const usesSvelte = inventory.rootEntries.some(entry => entry.endsWith(".config.js") && entry.includes("svelte"))
    || inventory.manifests.some(manifest => manifest.relativePath.endsWith("package.json") && manifest.scripts.some(script => script.includes("svelte")));
  if (usesSvelte) {
    return "svelte-web";
  }

  return inventory.classification.kind === "node-npm" ? "node-repo" : "generic";
}

export function resolveCapabilities(
  preset: Exclude<PresetId, "auto">,
  requested: CapabilityId[] | undefined,
): CapabilityId[] {
  const defaults = getPresetDefinition(preset).capabilities;
  if (!requested || requested.length === 0) {
    return defaults;
  }

  const allowed = new Set(defaults);
  return requested.filter(capability => allowed.has(capability));
}

export function resolveRuntimeMode(
  preset: Exclude<PresetId, "auto">,
  capabilities: CapabilityId[],
  requested: "static" | "browser" | undefined,
): "static" | "browser" {
  if (requested) {
    return requested;
  }

  if (capabilities.some(capability =>
    capability === "browser-self-check"
    || capability === "visual-inspection"
    || capability === "interaction-test")) {
    return "browser";
  }

  return getPresetDefinition(preset).runtimeMode;
}
