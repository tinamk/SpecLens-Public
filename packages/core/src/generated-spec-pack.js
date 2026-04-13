export function createGeneratedSpecPack({ inventory, presetPlan, source }) {
  const sharedRules = [
    {
      id: "gen-001",
      title: "Repository onboarding baseline",
      description: "The repository should expose enough documentation and metadata to support repeatable analysis and handoff.",
      checks: [
        "Root README should exist.",
        "License metadata should be explicit when package manifests are present.",
      ],
    },
  ];

  const repoSpecificRules = inventory.classification.kind === "node-npm"
    ? [
        {
          id: "gen-node-001",
          title: "Node package hygiene",
          description: "The root package should declare the metadata needed for release and automation review.",
          checks: [
            "Root package.json should define a name.",
            "Root package.json should define a license field or remain explicitly private.",
            "Root package.json should provide a test script.",
          ],
        },
      ]
    : [
        {
          id: "gen-generic-001",
          title: "Generic repo reviewability",
          description: "Generic repositories should provide documentation and a clear entrypoint for maintainers.",
          checks: [
            "A README should explain the repo purpose.",
            "Repository metadata files should be discoverable at the root.",
          ],
        },
      ];

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: {
      type: source.type,
      location: source.location,
      sourceId: source.sourceId,
    },
    presetPlan,
    classification: inventory.classification,
    suggestedRules: [...sharedRules, ...repoSpecificRules],
  };
}
