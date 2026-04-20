import type { RoleDefinition, RoleId } from "@speclens/contracts";
import type { RepoInventory } from "./inventory";
import type { PresetId } from "./presets";

export interface RoleCatalogDefinition {
  id: RoleId;
  title: string;
  runtime: "static" | "browser";
  description: string;
}

export interface PresetDefinition {
  id: Exclude<PresetId, "auto">;
  title: string;
  runtimeMode: "static" | "browser";
  roles: RoleId[];
  description: string;
}

const roleCatalog: RoleCatalogDefinition[] = [
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
    title: "General codebase",
    runtimeMode: "static",
    roles: [
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
    description: "Safe default static analysis for most repositories.",
  },
  {
    id: "node-repo",
    title: "JavaScript or TypeScript project",
    runtimeMode: "static",
    roles: [
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
    description: "Static analysis tuned for npm, pnpm, or yarn-based projects.",
  },
  {
    id: "python-service",
    title: "Python project",
    runtimeMode: "static",
    roles: [
      "repo-inventory",
      "spec-check",
      "consistency-check",
      "license-policy",
      "spec-generation",
      "chaos-advisor",
      "results-dashboard",
    ],
    description: "Static analysis for Python applications and services.",
  },
  {
    id: "go-service",
    title: "Go project",
    runtimeMode: "static",
    roles: [
      "repo-inventory",
      "spec-check",
      "consistency-check",
      "license-policy",
      "spec-generation",
      "chaos-advisor",
      "results-dashboard",
    ],
    description: "Static analysis for Go services and command-line projects.",
  },
  {
    id: "svelte-web",
    title: "Svelte web app with screenshots",
    runtimeMode: "browser",
    roles: [
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
    description: "Browser analysis with crawl, screenshots, and interaction checks for Svelte apps.",
  },
  {
    id: "tagtwo",
    title: "Interactive web app with screenshots",
    runtimeMode: "browser",
    roles: [
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
    description: "Browser analysis for modern web apps when you want visual and interaction evidence.",
  },
];

export function listRoleDefinitions(): RoleDefinition[] {
  return roleCatalog.map((role, index) => ({
    id: role.id,
    title: role.title,
    description: role.description,
    order: index,
    dependsOnRoleIds: [],
    skills: [],
  }));
}

export function resolveRoleDefinitionsForRoles(roles: RoleId[]): RoleDefinition[] {
  const lookup = new Map<RoleId, RoleDefinition>(roleCatalog.map((role, index) => [
    role.id,
    {
      id: role.id,
      title: role.title,
      description: role.description,
      order: index,
      dependsOnRoleIds: [],
      skills: [],
    },
  ]));
  const resolved: RoleDefinition[] = [];
  for (const roleId of roles) {
    const role = lookup.get(roleId);
    if (role) {
      resolved.push(role);
    }
  }
  return resolved;
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

  const hasPython = inventory.rootEntries.some(entry =>
    entry.endsWith("pyproject.toml")
    || entry.endsWith("requirements.txt")
    || entry.endsWith("Pipfile")
    || entry.endsWith("poetry.lock"));
  if (hasPython) {
    return "python-service";
  }

  const hasGo = inventory.rootEntries.some(entry =>
    entry.endsWith("go.mod")
    || entry.endsWith("go.sum"));
  if (hasGo) {
    return "go-service";
  }

  const usesSvelte = inventory.rootEntries.some(entry => entry.endsWith(".config.js") && entry.includes("svelte"))
    || inventory.manifests.some(manifest => manifest.relativePath.endsWith("package.json") && manifest.scripts.some(script => script.includes("svelte")));
  if (usesSvelte) {
    return "svelte-web";
  }

  return inventory.classification.kind === "node-npm" ? "node-repo" : "generic";
}

export function resolvePresetRoles(
  preset: Exclude<PresetId, "auto">,
  requested: RoleId[] | undefined,
): RoleId[] {
  const defaults = getPresetDefinition(preset).roles;
  if (!requested || requested.length === 0) {
    return defaults;
  }

  const allowed = new Set(defaults);
  return requested.filter(roleId => allowed.has(roleId));
}

export function resolveRuntimeMode(
  preset: Exclude<PresetId, "auto">,
  roles: RoleId[],
  requested: "static" | "browser" | undefined,
): "static" | "browser" {
  if (requested) {
    return requested;
  }

  if (roles.some(roleId =>
    roleId === "browser-self-check"
    || roleId === "visual-inspection"
    || roleId === "interaction-test")) {
    return "browser";
  }

  return getPresetDefinition(preset).runtimeMode;
}
