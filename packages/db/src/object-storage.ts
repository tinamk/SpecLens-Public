import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ArtifactKind, ArtifactReference, JobEnvelope } from "@speclens/contracts";
import { createHomeTempDirSync, resolveSpecLensObjectStorageRoot } from "@speclens/core";

export interface ObjectStorageConfig {
  objectStorageProvider: "local" | "s3-compatible" | "digitalocean-spaces";
  objectStorageBucket: string | null;
  objectStorageEndpoint: string | null;
  objectStoragePublicEndpoint: string | null;
  objectStorageRegion: string | null;
  objectStorageForcePathStyle: boolean;
  objectStorageAccessKeyId?: string | null;
  objectStorageSecretAccessKey?: string | null;
  objectStorageMirror?: ObjectStorageConfig | null;
  objectStorageMirrorRequired?: boolean;
}

function resolveStorageCredentials(config: ObjectStorageConfig):
  | { accessKeyId: string; secretAccessKey: string }
  | undefined {
  if (config.objectStorageAccessKeyId && config.objectStorageSecretAccessKey) {
    return {
      accessKeyId: config.objectStorageAccessKeyId,
      secretAccessKey: config.objectStorageSecretAccessKey,
    };
  }
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

function createS3Client(config: ObjectStorageConfig, publicEndpoint = false): S3Client | null {
  const endpoint = publicEndpoint ? config.objectStoragePublicEndpoint : config.objectStorageEndpoint;
  if (config.objectStorageProvider === "local" || !config.objectStorageBucket || !endpoint || !config.objectStorageRegion) {
    return null;
  }
  const credentials = resolveStorageCredentials(config);
  return new S3Client({
    region: config.objectStorageRegion,
    endpoint,
    forcePathStyle: config.objectStorageForcePathStyle,
    ...(credentials ? { credentials } : {}),
  });
}

function getLocalObjectStorageRoot(): string {
  return resolveSpecLensObjectStorageRoot(process.env);
}

function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

async function createSignedDownloadUrl(config: ObjectStorageConfig, objectKey: string): Promise<string | undefined> {
  const publicClient = createS3Client(config, true) ?? createS3Client(config, false);
  if (!publicClient || !config.objectStorageBucket) {
    return undefined;
  }
  return getSignedUrl(publicClient, new GetObjectCommand({
    Bucket: config.objectStorageBucket,
    Key: objectKey,
  }), { expiresIn: 3600 });
}

async function uploadToConfig(
  config: ObjectStorageConfig,
  objectKey: string,
  filePath: string,
  mimeType: string,
  options: {
    kind?: ArtifactKind;
    jobId?: string;
    reportId?: string | null;
  },
): Promise<ArtifactReference> {
  const sizeBytes = fs.statSync(filePath).size;
  if (config.objectStorageProvider === "local") {
    const targetPath = resolveObjectStoragePath(config, objectKey);
    ensureParentDir(targetPath);
    fs.copyFileSync(filePath, targetPath);
    return {
      id: undefined,
      jobId: options.jobId,
      reportId: options.reportId ?? null,
      kind: options.kind ?? "artifact",
      key: objectKey,
      bucket: "local-object-storage",
      region: "local",
      mimeType,
      sizeBytes,
      createdAt: new Date().toISOString(),
    };
  }

  const client = createS3Client(config, false);
  if (!client || !config.objectStorageBucket) {
    throw new Error("Object storage is not configured for remote uploads.");
  }

  await client.send(new PutObjectCommand({
    Bucket: config.objectStorageBucket,
    Key: objectKey,
    Body: fs.readFileSync(filePath),
    ContentType: mimeType,
  }));

  const signedUrl = await createSignedDownloadUrl(config, objectKey);
  return {
    jobId: options.jobId,
    reportId: options.reportId ?? null,
    kind: options.kind ?? "artifact",
    key: objectKey,
    bucket: config.objectStorageBucket,
    region: config.objectStorageRegion ?? "local",
    mimeType,
    sizeBytes,
    ...(signedUrl ? { signedUrl } : {}),
    createdAt: new Date().toISOString(),
  };
}

export function resolveObjectStoragePath(config: ObjectStorageConfig, objectKey: string): string {
  if (config.objectStorageProvider !== "local") {
    return objectKey;
  }
  return path.join(getLocalObjectStorageRoot(), objectKey);
}

export async function putObjectFromFile(
  config: ObjectStorageConfig,
  objectKey: string,
  filePath: string,
  mimeType: string,
  options: {
    kind?: ArtifactKind;
    jobId?: string;
    reportId?: string | null;
  } = {},
): Promise<ArtifactReference> {
  const mirror = config.objectStorageMirror ?? null;
  const mirrorPromise = mirror
    ? uploadToConfig(mirror, objectKey, filePath, mimeType, options).catch(error => {
        if (config.objectStorageMirrorRequired) {
          throw error;
        }
        console.warn(`[object-storage] mirror upload failed for ${objectKey}:`, error);
        return null;
      })
    : null;

  const primary = await uploadToConfig(config, objectKey, filePath, mimeType, options);
  if (mirrorPromise) {
    await mirrorPromise;
  }
  return primary;
}

export async function putObjectText(
  config: ObjectStorageConfig,
  objectKey: string,
  content: string,
  mimeType: string,
  options: {
    kind?: ArtifactKind;
    jobId?: string;
    reportId?: string | null;
  } = {},
): Promise<ArtifactReference> {
  const tempPath = path.join(getLocalObjectStorageRoot(), ".tmp", `${Date.now()}-${path.basename(objectKey)}`);
  ensureParentDir(tempPath);
  fs.writeFileSync(tempPath, content);
  try {
    return await putObjectFromFile(config, objectKey, tempPath, mimeType, options);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

export async function downloadObjectToFile(
  config: ObjectStorageConfig,
  objectKey: string,
  targetPath: string,
): Promise<string> {
  const attemptDownload = async (source: ObjectStorageConfig, destinationPath: string): Promise<string> => {
    ensureParentDir(destinationPath);
    if (source.objectStorageProvider === "local") {
      fs.copyFileSync(resolveObjectStoragePath(source, objectKey), destinationPath);
      return destinationPath;
    }

    const client = createS3Client(source, false);
    if (!client || !source.objectStorageBucket) {
      throw new Error("Object storage is not configured for remote downloads.");
    }

    const response = await client.send(new GetObjectCommand({
      Bucket: source.objectStorageBucket,
      Key: objectKey,
    }));
    if (!response.Body) {
      throw new Error(`Object storage download returned no body for ${objectKey}.`);
    }

    await pipeline(response.Body as NodeJS.ReadableStream, fs.createWriteStream(destinationPath));
    return destinationPath;
  };

  const mirror = config.objectStorageMirror ?? null;
  if (!mirror) {
    return await attemptDownload(config, targetPath);
  }

  const tempDir = createHomeTempDirSync("speclens-download-");
  const primaryPath = path.join(tempDir, "primary");
  const mirrorPath = path.join(tempDir, "mirror");

  try {
    let winnerPath: string;
    try {
      winnerPath = await attemptDownload(config, primaryPath);
    } catch (primaryError) {
      try {
        winnerPath = await attemptDownload(mirror, mirrorPath);
      } catch (mirrorError) {
        throw new AggregateError(
          [primaryError, mirrorError],
          `Object storage download failed for ${objectKey} from both primary and mirror storage.`,
        );
      }
    }
    ensureParentDir(targetPath);
    fs.copyFileSync(winnerPath, targetPath);
    return targetPath;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function deleteObject(config: ObjectStorageConfig, objectKey: string): Promise<void> {
  const deleteFromConfig = async (source: ObjectStorageConfig): Promise<void> => {
    if (source.objectStorageProvider === "local") {
      fs.rmSync(resolveObjectStoragePath(source, objectKey), { force: true });
      return;
    }
    const client = createS3Client(source, false);
    if (!client || !source.objectStorageBucket) {
      throw new Error("Object storage is not configured for remote deletes.");
    }
    await client.send(new DeleteObjectCommand({
      Bucket: source.objectStorageBucket,
      Key: objectKey,
    }));
  };

  const mirror = config.objectStorageMirror ?? null;
  const primaryPromise = deleteFromConfig(config);
  const mirrorPromise = mirror
    ? deleteFromConfig(mirror).catch(error => {
        if (config.objectStorageMirrorRequired) {
          throw error;
        }
        console.warn(`[object-storage] mirror delete failed for ${objectKey}:`, error);
      })
    : null;
  await primaryPromise;
  if (mirrorPromise) {
    await mirrorPromise;
  }
}

export async function checkObjectStorageHealth(config: ObjectStorageConfig): Promise<{
  ok: boolean;
  mirrorOk?: boolean;
}> {
  const checkSource = async (source: ObjectStorageConfig): Promise<void> => {
    if (source.objectStorageProvider === "local") {
      const root = getLocalObjectStorageRoot();
      fs.mkdirSync(root, { recursive: true });
      return;
    }
    const client = createS3Client(source, false);
    if (!client || !source.objectStorageBucket) {
      throw new Error("Object storage is not configured.");
    }
    await client.send(new HeadBucketCommand({ Bucket: source.objectStorageBucket }));
  };

  await checkSource(config);
  let mirrorOk = true;
  if (config.objectStorageMirror) {
    try {
      await checkSource(config.objectStorageMirror);
    } catch (error) {
      mirrorOk = false;
      if (config.objectStorageMirrorRequired) {
        throw error;
      }
      console.warn("[object-storage] mirror health check failed:", error);
    }
  }

  return {
    ok: true,
    ...(config.objectStorageMirror ? { mirrorOk } : {}),
  };
}

export async function mirrorArtifactsToObjectStorage(
  config: ObjectStorageConfig,
  envelope: JobEnvelope,
  baseDir = process.cwd(),
): Promise<JobEnvelope> {
  if (!envelope.report) {
    return envelope;
  }

  const artifacts: ArtifactReference[] = [];
  for (const artifact of envelope.report.artifacts) {
    const absolutePath = path.resolve(baseDir, artifact.key);
    if (!fs.existsSync(absolutePath)) {
      artifacts.push(artifact);
      continue;
    }
    artifacts.push(await putObjectFromFile(
      config,
      `reports/${envelope.job.id}/${path.basename(artifact.key)}`,
      absolutePath,
      artifact.mimeType,
      {
        kind: artifact.kind ?? "artifact",
        jobId: envelope.job.id,
        reportId: envelope.report.id,
      },
    ));
  }

  return {
    ...envelope,
    report: {
      ...envelope.report,
      artifacts,
    },
  };
}
