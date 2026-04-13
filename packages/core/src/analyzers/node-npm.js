export function runNodeNpmBaseline(inventory) {
  const findings = [];
  const manifest = inventory.node?.rootManifest;

  if (!manifest) return findings;

  if (!manifest.name) {
    findings.push({
      code: "node-missing-package-name",
      analyzer: "node-npm-baseline",
      severity: "medium",
      title: "Root package.json is missing a name",
      message: "Node/npm repositories are easier to reason about when the root package declares a stable name.",
      evidence: {
        file: "package.json",
        field: "name",
      },
      suggestion: "Add a root package name that matches the repo identity or workspace purpose.",
    });
  }

  if (!manifest.license) {
    const finding = {
      code: "node-missing-license-field",
      analyzer: "node-npm-baseline",
      severity: "low",
      title: "Root package.json is missing a license field",
      message: "The root package manifest does not declare license metadata.",
      evidence: {
        file: "package.json",
        field: "license",
      },
      suggestion: manifest.private
        ? "Set the root package license to UNLICENSED or another explicit internal value."
        : "Set the root package license to an explicit SPDX expression after confirming the correct policy choice.",
    };

    if (manifest.private) {
      finding.patch = {
        kind: "set-package-json-field",
        relativePath: "package.json",
        field: "license",
        value: "UNLICENSED",
        description: "Add an explicit UNLICENSED license field to the private root package.",
      };
    }

    findings.push(finding);
  }

  if (!manifest.scripts.includes("test")) {
    findings.push({
      code: "node-missing-test-script",
      analyzer: "node-npm-baseline",
      severity: "medium",
      title: "Root package.json is missing a test script",
      message: "SpecLens did not find a root `test` script, which weakens automated validation discovery.",
      evidence: {
        file: "package.json",
        field: "scripts.test",
      },
      suggestion: "Add a root `test` script or document the validation entrypoint in the README.",
    });
  }

  if (!manifest.scripts.includes("build")) {
    findings.push({
      code: "node-missing-build-script",
      analyzer: "node-npm-baseline",
      severity: "low",
      title: "Root package.json is missing a build script",
      message: "SpecLens did not find a root `build` script.",
      evidence: {
        file: "package.json",
        field: "scripts.build",
      },
      suggestion: "Add a root `build` script when the repo has a buildable artifact, or document that the repo is source-only.",
    });
  }

  if (!inventory.files.packageLock && !inventory.files.pnpmLock && !inventory.files.yarnLock) {
    findings.push({
      code: "node-missing-lockfile",
      analyzer: "node-npm-baseline",
      severity: "low",
      title: "Node repository is missing a lockfile",
      message: "No package-manager lockfile was found at the repo root.",
      evidence: {
        expectedFiles: ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"],
      },
      suggestion: "Commit the preferred package-manager lockfile if reproducible installs are important for this repo.",
    });
  }

  return findings;
}
