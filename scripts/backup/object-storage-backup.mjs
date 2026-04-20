import { CopyObjectCommand, GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const bucket = process.env.OBJECT_STORAGE_BUCKET;
const endpoint = process.env.OBJECT_STORAGE_ENDPOINT;
const region = process.env.OBJECT_STORAGE_REGION;
const accessKeyId = process.env.OBJECT_STORAGE_ACCESS_KEY_ID;
const secretAccessKey = process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY;

if (!bucket || !endpoint || !region || !accessKeyId || !secretAccessKey) {
  throw new Error("OBJECT_STORAGE_* env vars are required to back up object storage.");
}

const backupBucket = process.env.BACKUP_BUCKET ?? null;
const backupDir = process.env.BACKUP_DIR ?? path.resolve(process.cwd(), "backups", "object-storage");
const client = new S3Client({
  region,
  endpoint,
  forcePathStyle: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE === "true",
  credentials: { accessKeyId, secretAccessKey },
});

async function listAllKeys() {
  let continuationToken = undefined;
  const keys = [];
  for (;;) {
    const response = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      ContinuationToken: continuationToken,
    }));
    for (const entry of response.Contents ?? []) {
      if (entry.Key) {
        keys.push(entry.Key);
      }
    }
    if (!response.IsTruncated) break;
    continuationToken = response.NextContinuationToken;
  }
  return keys;
}

async function copyToBucket(key) {
  await client.send(new CopyObjectCommand({
    Bucket: backupBucket,
    CopySource: `${bucket}/${key}`,
    Key: key,
  }));
}

async function downloadToDir(key) {
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) return;
  const targetPath = path.join(backupDir, key);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  await pipeline(response.Body, fs.createWriteStream(targetPath));
}

const keys = await listAllKeys();
if (backupBucket) {
  for (const key of keys) {
    await copyToBucket(key);
  }
  console.log(`Copied ${keys.length} objects to ${backupBucket}.`);
} else {
  for (const key of keys) {
    await downloadToDir(key);
  }
  console.log(`Downloaded ${keys.length} objects to ${backupDir}.`);
}
