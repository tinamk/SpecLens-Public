import fs from "node:fs";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { JobEnvelope } from "@speclens/contracts";
import type { ApiConfig } from "./config";

function resolveStorageCredentials():
  | { accessKeyId: string; secretAccessKey: string }
  | undefined {
  if (process.env.OBJECT_STORAGE_ACCESS_KEY_ID && process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY) {
    return {
      accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY_ID,
      secretAccessKey: process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY,
    };
  }
  if (process.env.SPACES_ACCESS_KEY_ID && process.env.SPACES_SECRET_ACCESS_KEY) {
    return {
      accessKeyId: process.env.SPACES_ACCESS_KEY_ID,
      secretAccessKey: process.env.SPACES_SECRET_ACCESS_KEY,
    };
  }
  return undefined;
}

function createS3Client(config: ApiConfig): S3Client | null {
  if (config.objectStorageProvider === "local" || !config.objectStorageBucket || !config.objectStorageEndpoint || !config.objectStorageRegion) {
    return null;
  }
  const credentials = resolveStorageCredentials();
  return new S3Client({
    region: config.objectStorageRegion,
    endpoint: config.objectStorageEndpoint,
    forcePathStyle: config.objectStorageForcePathStyle,
    ...(credentials ? { credentials } : {}),
  });
}

function createPublicS3Client(config: ApiConfig): S3Client | null {
  if (config.objectStorageProvider === "local" || !config.objectStorageBucket || !config.objectStoragePublicEndpoint || !config.objectStorageRegion) {
    return null;
  }
  const credentials = resolveStorageCredentials();
  return new S3Client({
    region: config.objectStorageRegion,
    endpoint: config.objectStoragePublicEndpoint,
    forcePathStyle: config.objectStorageForcePathStyle,
    ...(credentials ? { credentials } : {}),
  });
}

export async function mirrorArtifactsToObjectStorage(
  config: ApiConfig,
  envelope: JobEnvelope,
): Promise<JobEnvelope> {
  const client = createS3Client(config);
  const publicClient = createPublicS3Client(config) ?? client;
  if (!client || !envelope.report || !config.objectStorageBucket) {
    return envelope;
  }

  const artifacts = [];
  for (const artifact of envelope.report.artifacts) {
    const absolutePath = path.resolve(process.cwd(), artifact.key);
    if (!fs.existsSync(absolutePath)) {
      artifacts.push(artifact);
      continue;
    }
    const body = fs.readFileSync(absolutePath);
    const objectKey = `reports/${envelope.job.id}/${path.basename(artifact.key)}`;
    await client.send(new PutObjectCommand({
      Bucket: config.objectStorageBucket,
      Key: objectKey,
      Body: body,
      ContentType: artifact.mimeType,
    }));
    const signedUrl = publicClient
      ? await getSignedUrl(publicClient, new GetObjectCommand({
        Bucket: config.objectStorageBucket,
        Key: objectKey,
      }), { expiresIn: 3600 })
      : undefined;
    artifacts.push({
      ...artifact,
      key: objectKey,
      bucket: config.objectStorageBucket,
      region: config.objectStorageRegion ?? "local",
      ...(signedUrl ? { signedUrl } : {}),
    });
  }

  return {
    ...envelope,
    report: {
      ...envelope.report,
      artifacts,
    },
  };
}
