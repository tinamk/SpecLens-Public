import { HeadObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

function required(value, name) {
  if (!value) {
    throw new Error(`Missing ${name} for mirror verification.`);
  }
  return value;
}

function createClient(prefix) {
  const bucket = required(process.env[`${prefix}_BUCKET`], `${prefix}_BUCKET`);
  const endpoint = required(process.env[`${prefix}_ENDPOINT`], `${prefix}_ENDPOINT`);
  const region = required(process.env[`${prefix}_REGION`], `${prefix}_REGION`);
  const accessKeyId = required(process.env[`${prefix}_ACCESS_KEY_ID`], `${prefix}_ACCESS_KEY_ID`);
  const secretAccessKey = required(process.env[`${prefix}_SECRET_ACCESS_KEY`], `${prefix}_SECRET_ACCESS_KEY`);
  const forcePathStyle = process.env[`${prefix}_FORCE_PATH_STYLE`] === "true";
  return {
    bucket,
    client: new S3Client({
      region,
      endpoint,
      forcePathStyle,
      credentials: { accessKeyId, secretAccessKey },
    }),
  };
}

async function listAllKeys(client, bucket) {
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
    if (!response.IsTruncated) {
      break;
    }
    continuationToken = response.NextContinuationToken;
  }
  return keys;
}

async function existsInMirror(client, bucket, key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

const primary = createClient("OBJECT_STORAGE");
const mirror = createClient("OBJECT_STORAGE_MIRROR");

const keys = await listAllKeys(primary.client, primary.bucket);
let missing = 0;

for (const key of keys) {
  const exists = await existsInMirror(mirror.client, mirror.bucket, key);
  if (!exists) {
    console.log(`[mirror] missing ${key}`);
    missing += 1;
  }
}

console.log(`[mirror] checked ${keys.length} objects; missing ${missing}`);
if (missing > 0) {
  process.exit(1);
}
