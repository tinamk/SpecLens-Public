import type { ArtifactReference } from "@speclens/contracts";
import { statusError } from "@speclens/db";

function buildJobArtifactProxyDownloadUrl(
  jobId: string,
  artifactId: string,
  artifacts: ReadonlyArray<ArtifactReference>,
): string {
  const artifactIndex = artifacts.findIndex(artifact => artifact.id === artifactId);
  if (artifactIndex < 0) {
    throw statusError(404, `Artifact not found in visible artifact list for job ${jobId}: ${artifactId}`);
  }
  return `/api/proxy/api/jobs/${jobId}/artifacts/${artifactIndex}`;
}

export default {
  buildJobArtifactProxyDownloadUrl,
};
