export function runGenericBaseline(inventory) {
  const findings = [];

  if (inventory.files.readmeFiles.length === 0) {
    findings.push({
      code: "generic-missing-readme",
      analyzer: "generic-baseline",
      severity: "medium",
      title: "Repository is missing a README",
      message: "SpecLens could not find a root README file. That makes onboarding and generic repo interpretation weaker.",
      evidence: {
        expectedFiles: ["README.md", "README", "README.txt"],
      },
      suggestion: "Add a root README that explains the repo purpose, setup, and validation entrypoints.",
    });
  }

  if (inventory.files.licenseFiles.length === 0 && (!inventory.node || !inventory.node.rootManifest?.license)) {
    findings.push({
      code: "generic-missing-license-signal",
      analyzer: "generic-baseline",
      severity: "low",
      title: "Repository lacks an explicit license signal",
      message: "No root license file was found and no root package license metadata is available.",
      evidence: {
        expectedFiles: ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING"],
      },
      suggestion: "Add a root license file or equivalent package metadata so downstream review starts from an explicit signal.",
    });
  }

  return findings;
}
