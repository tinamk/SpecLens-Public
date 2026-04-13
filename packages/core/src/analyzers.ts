import type { RepoInventory } from "./inventory";

export interface GeneratedSpecPack {
  version: number;
  generatedAt: string;
  classification: RepoInventory["classification"];
  suggestedRules: Array<{
    id: string;
    title: string;
    checks: string[];
  }>;
}

export function createGeneratedSpecPack(inventory: RepoInventory): GeneratedSpecPack {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    classification: inventory.classification,
    suggestedRules: inventory.classification.kind === "node-npm"
      ? [
          {
            id: "node-baseline",
            title: "Node repository baseline",
            checks: [
              "Package metadata should be explicit.",
              "Validation scripts should be discoverable.",
              "A lockfile should exist when reproducibility matters.",
            ],
          },
        ]
      : [
          {
            id: "generic-baseline",
            title: "Generic repository baseline",
            checks: [
              "A README should explain the project.",
              "A license signal should exist at the repo root.",
            ],
          },
        ],
  };
}
