import assert from "node:assert/strict";
import test from "node:test";

async function loadBuildJobArtifactProxyDownloadUrl(): Promise<(
  jobId: string,
  artifactId: string,
  artifacts: Array<{
    id?: string;
    key: string;
    bucket: string;
    region: string;
    mimeType: string;
    sizeBytes: number;
  }>,
) => string> {
  const module = await import("../apps/api/src/routes/durable-artifacts");
  const candidate = (module.default as { default?: unknown; buildJobArtifactProxyDownloadUrl?: unknown } | undefined)?.default
    ?? module.default;
  const helper = (candidate as { buildJobArtifactProxyDownloadUrl?: unknown } | undefined)?.buildJobArtifactProxyDownloadUrl;
  assert.equal(typeof helper, "function");
  return helper as (
    jobId: string,
    artifactId: string,
    artifacts: Array<{
      id?: string;
      key: string;
      bucket: string;
      region: string;
      mimeType: string;
      sizeBytes: number;
    }>,
  ) => string;
}

test("buildJobArtifactProxyDownloadUrl resolves the matching artifact index", async () => {
  const buildJobArtifactProxyDownloadUrl = await loadBuildJobArtifactProxyDownloadUrl();
  const downloadUrl = buildJobArtifactProxyDownloadUrl("job_demo", "artifact_export", [
    {
      id: "artifact_old",
      key: "exports/reports/report_demo-old.tar.gz",
      bucket: "local",
      region: "local",
      mimeType: "application/gzip",
      sizeBytes: 128,
    },
    {
      id: "artifact_export",
      key: "exports/reports/report_demo.tar.gz",
      bucket: "local",
      region: "local",
      mimeType: "application/gzip",
      sizeBytes: 256,
    },
  ]);

  assert.equal(downloadUrl, "/api/proxy/api/jobs/job_demo/artifacts/1");
});

test("buildJobArtifactProxyDownloadUrl fails closed when the persisted artifact is not visible", async () => {
  const buildJobArtifactProxyDownloadUrl = await loadBuildJobArtifactProxyDownloadUrl();
  assert.throws(
    () => buildJobArtifactProxyDownloadUrl("job_demo", "artifact_export", [
      {
        id: "artifact_old",
        key: "exports/reports/report_demo-old.tar.gz",
        bucket: "local",
        region: "local",
        mimeType: "application/gzip",
        sizeBytes: 128,
      },
    ]),
    error => {
      assert.equal(error instanceof Error, true);
      assert.equal((error as Error & { statusCode?: number }).statusCode, 404);
      assert.equal((error as Error).message.includes("Artifact not found in visible artifact list"), true);
      return true;
    },
  );
});
