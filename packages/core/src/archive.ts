import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import * as tar from "tar";
import * as yauzl from "yauzl";

export type ArchiveKind = "zip" | "tar" | "tar.gz";

export type ArchiveInspection =
  | { ok: true; kind: ArchiveKind }
  | { ok: false; message: string };

export type GitRepositoryArchiveInspection =
  | { ok: true; kind: ArchiveKind }
  | { ok: false; message: string };

export type GitRepositoryPathInspection =
  | { ok: true; rootPath: string }
  | { ok: false; message: string };

type ArchiveEntryKind = "file" | "directory" | "symlink" | "hardlink" | "other";

type ArchiveEntryRecord = {
  rawPath: string;
  normalizedPath: string;
  kind: ArchiveEntryKind;
};

const ZIP_UNIX_TYPE_MASK = 0o170000;
const ZIP_UNIX_DIRECTORY = 0o040000;
const ZIP_UNIX_FILE = 0o100000;
const ZIP_UNIX_SYMLINK = 0o120000;

function readArchiveHeader(filePath: string, size = 512): Buffer {
  const file = fs.openSync(filePath, "r");
  try {
    const header = Buffer.alloc(size);
    const bytesRead = fs.readSync(file, header, 0, size, 0);
    return header.subarray(0, bytesRead);
  } finally {
    fs.closeSync(file);
  }
}

function looksLikeZip(header: Buffer): boolean {
  if (header.length < 4) {
    return false;
  }
  return header[0] === 0x50
    && header[1] === 0x4b
    && (
      (header[2] === 0x03 && header[3] === 0x04)
      || (header[2] === 0x05 && header[3] === 0x06)
      || (header[2] === 0x07 && header[3] === 0x08)
    );
}

function looksLikeGzip(header: Buffer): boolean {
  return header.length >= 2 && header[0] === 0x1f && header[1] === 0x8b;
}

function looksLikeTar(header: Buffer): boolean {
  return header.length >= 262 && header.subarray(257, 262).toString("utf8") === "ustar";
}

function detectArchiveKindFromName(name: string | null | undefined): ArchiveKind | null {
  if (!name) {
    return null;
  }
  const lower = name.toLowerCase();
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
    return "tar.gz";
  }
  if (lower.endsWith(".tar")) {
    return "tar";
  }
  if (lower.endsWith(".zip")) {
    return "zip";
  }
  return null;
}

function looksLikeHtmlOrXml(header: Buffer): boolean {
  const sample = header.toString("utf8").trimStart().toLowerCase();
  return sample.startsWith("<!doctype html")
    || sample.startsWith("<html")
    || sample.startsWith("<?xml")
    || sample.startsWith("<!doctype");
}

function normalizeArchiveEntry(entry: string): string {
  return entry
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+$/, "");
}

function createArchiveEntryRecord(rawPath: string, kind: ArchiveEntryKind): ArchiveEntryRecord {
  return {
    rawPath,
    normalizedPath: normalizeArchiveEntry(rawPath),
    kind,
  };
}

function classifyZipEntryKind(entry: yauzl.Entry): ArchiveEntryKind {
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
  const typeBits = unixMode & ZIP_UNIX_TYPE_MASK;
  if (entry.fileName.endsWith("/") || (entry.externalFileAttributes & 0x10) !== 0 || typeBits === ZIP_UNIX_DIRECTORY) {
    return "directory";
  }
  if (typeBits === ZIP_UNIX_SYMLINK) {
    return "symlink";
  }
  if (typeBits === ZIP_UNIX_FILE || typeBits === 0) {
    return "file";
  }
  return "other";
}

function classifyTarEntryKind(entryType: string): ArchiveEntryKind {
  switch (entryType) {
    case "Directory":
      return "directory";
    case "File":
    case "OldFile":
    case "ContiguousFile":
      return "file";
    case "SymbolicLink":
      return "symlink";
    case "Link":
      return "hardlink";
    default:
      return "other";
  }
}

async function openZipFileAsync(filePath: string): Promise<yauzl.ZipFile> {
  return await new Promise((resolve, reject) => {
    yauzl.open(filePath, {
      autoClose: false,
      lazyEntries: true,
      strictFileNames: true,
      validateEntrySizes: true,
    }, (error, zipFile) => {
      if (error) {
        reject(error);
        return;
      }
      if (!zipFile) {
        reject(new Error("ZIP archive could not be opened."));
        return;
      }
      resolve(zipFile);
    });
  });
}

async function readZipEntryAsync(zipFile: yauzl.ZipFile, entry: yauzl.Entry): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error) {
        reject(error);
        return;
      }
      if (!stream) {
        reject(new Error(`ZIP entry could not be read: ${entry.fileName}`));
        return;
      }
      stream.on("error", reject);
      stream.on("end", () => resolve());
      stream.resume();
    });
  });
}

async function listZipEntriesAsync(
  filePath: string,
): Promise<{ ok: true; entries: ArchiveEntryRecord[] } | { ok: false; message: string }> {
  let zipFile: yauzl.ZipFile | null = null;
  try {
    const openedZipFile = await openZipFileAsync(filePath);
    zipFile = openedZipFile;
    const entries: ArchiveEntryRecord[] = [];
    return await new Promise(resolve => {
      const finish = (result: { ok: true; entries: ArchiveEntryRecord[] } | { ok: false; message: string }) => {
        try {
          openedZipFile.close();
        } catch {
          // Best-effort close only.
        }
        resolve(result);
      };

      openedZipFile.on("error", error => {
        finish({
          ok: false,
          message: error instanceof Error ? error.message : "The uploaded ZIP archive is invalid or incomplete.",
        });
      });
      openedZipFile.on("end", () => {
        finish({ ok: true, entries });
      });
      openedZipFile.on("entry", entry => {
        const kind = classifyZipEntryKind(entry);
        entries.push(createArchiveEntryRecord(entry.fileName, kind));
        const continueReading = () => openedZipFile.readEntry();
        if (kind === "directory") {
          continueReading();
          return;
        }
        void readZipEntryAsync(openedZipFile, entry)
          .then(continueReading)
          .catch(error => {
            finish({
              ok: false,
              message: error instanceof Error ? error.message : "The uploaded ZIP archive is invalid or incomplete.",
            });
          });
      });
      openedZipFile.readEntry();
    });
  } catch (error) {
    try {
      zipFile?.close();
    } catch {
      // Best-effort close only.
    }
    return {
      ok: false,
      message: error instanceof Error ? error.message : "The uploaded ZIP archive is invalid or incomplete.",
    };
  }
}

async function listTarEntriesAsync(
  filePath: string,
  kind: Extract<ArchiveKind, "tar" | "tar.gz">,
): Promise<{ ok: true; entries: ArchiveEntryRecord[] } | { ok: false; message: string }> {
  const entries: ArchiveEntryRecord[] = [];
  try {
    await tar.t({
      file: filePath,
      gzip: kind === "tar.gz",
      strict: true,
      onentry: entry => {
        entries.push(createArchiveEntryRecord(entry.path, classifyTarEntryKind(entry.type)));
      },
    });
    return {
      ok: true,
      entries,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "The uploaded TAR archive is invalid or incomplete.",
    };
  }
}

async function listArchiveEntriesAsync(
  filePath: string,
  kind: ArchiveKind,
): Promise<{ ok: true; entries: ArchiveEntryRecord[] } | { ok: false; message: string }> {
  return kind === "zip"
    ? await listZipEntriesAsync(filePath)
    : await listTarEntriesAsync(filePath, kind);
}

async function inspectArchiveEntriesAsync(
  filePath: string,
  originalName?: string | null,
): Promise<{ ok: true; kind: ArchiveKind; entries: ArchiveEntryRecord[] } | { ok: false; message: string }> {
  const header = readArchiveHeader(filePath);
  const hintedKind = detectArchiveKindFromName(originalName ?? filePath);

  try {
    const stats = fs.statSync(filePath);
    if (stats.size === 0) {
      return {
        ok: false,
        message: "The uploaded archive is empty.",
      };
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Could not inspect archive file.",
    };
  }

  let kind: ArchiveKind | null = null;
  if (looksLikeZip(header)) {
    kind = "zip";
  } else if (looksLikeGzip(header)) {
    kind = "tar.gz";
  } else if (looksLikeTar(header)) {
    kind = "tar";
  } else if (looksLikeHtmlOrXml(header)) {
    return {
      ok: false,
      message: "The uploaded file is not a valid ZIP/TAR archive; it looks like an HTML/XML page instead.",
    };
  } else if (hintedKind) {
    return {
      ok: false,
      message: `The uploaded file is named like a ${hintedKind} archive, but its contents do not match a supported ZIP/TAR archive.`,
    };
  } else {
    return {
      ok: false,
      message: "Unsupported archive format. Use a valid .zip, .tar, .tgz, or .tar.gz archive.",
    };
  }

  const entries = await listArchiveEntriesAsync(filePath, kind);
  if (entries.ok === false) {
    return {
      ok: false,
      message: entries.message,
    };
  }
  return {
    ok: true,
    kind,
    entries: entries.entries,
  };
}

function meaningfulArchiveEntries(entries: ArchiveEntryRecord[]): ArchiveEntryRecord[] {
  return entries
    .filter(entry =>
      entry.normalizedPath.length > 0
      && entry.normalizedPath !== "__MACOSX"
      && !entry.normalizedPath.startsWith("__MACOSX/"),
    );
}

function archiveHasGitMetadataAtRoot(entries: ArchiveEntryRecord[], rootPrefix: string): boolean {
  const prefix = rootPrefix ? `${rootPrefix.replace(/\/+$/, "")}/` : "";
  return entries.some(entry =>
    (entry.normalizedPath === `${prefix}.git` && entry.kind === "directory")
    || entry.normalizedPath.startsWith(`${prefix}.git/`),
  );
}

function resolveGitArchiveRoot(entries: ArchiveEntryRecord[]): string | null {
  const normalizedEntries = meaningfulArchiveEntries(entries);
  if (normalizedEntries.length === 0) {
    return null;
  }
  if (archiveHasGitMetadataAtRoot(normalizedEntries, "")) {
    return "";
  }
  const topLevelEntries = [...new Set(
    normalizedEntries.map(entry => entry.normalizedPath.split("/")[0] ?? "").filter(Boolean),
  )];
  if (topLevelEntries.length !== 1) {
    return null;
  }
  const candidate = topLevelEntries[0] ?? "";
  return archiveHasGitMetadataAtRoot(normalizedEntries, candidate) ? candidate : null;
}

function findUnsafeArchiveEntry(entries: ArchiveEntryRecord[]): string | null {
  for (const entry of entries) {
    const rawPath = entry.rawPath.replace(/\\/g, "/");
    if (rawPath.startsWith("/") || rawPath.startsWith("//") || /^[A-Za-z]:\//.test(rawPath)) {
      return `Uploaded archives cannot contain absolute paths: ${entry.rawPath}`;
    }
    if (entry.normalizedPath.split("/").some(segment => segment === "..")) {
      return `Uploaded archives cannot contain traversal paths: ${entry.rawPath}`;
    }
    if (entry.kind === "symlink" || entry.kind === "hardlink") {
      return `Uploaded archives cannot contain symbolic links or hard links: ${entry.normalizedPath || entry.rawPath}`;
    }
    if (entry.kind === "other") {
      return `Uploaded archives cannot contain special file types: ${entry.normalizedPath || entry.rawPath}`;
    }
  }
  return null;
}

export async function inspectArchiveFileAsync(filePath: string, originalName?: string | null): Promise<ArchiveInspection> {
  const inspection = await inspectArchiveEntriesAsync(filePath, originalName);
  if (inspection.ok === false) {
    return {
      ok: false,
      message: inspection.message,
    };
  }
  return {
    ok: true,
    kind: inspection.kind,
  };
}

export async function inspectGitRepositoryArchiveFileAsync(
  filePath: string,
  originalName?: string | null,
): Promise<GitRepositoryArchiveInspection> {
  const archiveInspection = await inspectArchiveEntriesAsync(filePath, originalName);
  if (archiveInspection.ok === false) {
    return {
      ok: false,
      message: archiveInspection.message,
    };
  }

  const unsafeEntryMessage = findUnsafeArchiveEntry(archiveInspection.entries);
  if (unsafeEntryMessage) {
    return {
      ok: false,
      message: unsafeEntryMessage,
    };
  }

  if (resolveGitArchiveRoot(archiveInspection.entries) === null) {
    return {
      ok: false,
      message: "Uploaded archives must unpack to a Git repository root or a single top-level directory containing the repository root.",
    };
  }

  return {
    ok: true,
    kind: archiveInspection.kind,
  };
}

function ensureExtractionTarget(rootDir: string, entryPath: string): string {
  const normalizedRoot = path.resolve(rootDir);
  const resolvedPath = path.resolve(normalizedRoot, entryPath);
  if (resolvedPath !== normalizedRoot && !resolvedPath.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error(`Archive entry resolves outside the extraction root: ${entryPath}`);
  }
  return resolvedPath;
}

async function extractZipArchiveAsync(filePath: string, targetDir: string): Promise<void> {
  const zipFile = await openZipFileAsync(filePath);
  await new Promise<void>((resolve, reject) => {
    const fail = (error: unknown) => {
      try {
        zipFile.close();
      } catch {
        // Best-effort close only.
      }
      reject(error);
    };

    zipFile.on("error", fail);
    zipFile.on("end", () => {
      try {
        zipFile.close();
      } catch {
        // Best-effort close only.
      }
      resolve();
    });
    zipFile.on("entry", entry => {
      const kind = classifyZipEntryKind(entry);
      const normalizedPath = normalizeArchiveEntry(entry.fileName);
      const nextEntry = () => zipFile.readEntry();

      try {
        if (!normalizedPath) {
          nextEntry();
          return;
        }
        const destinationPath = ensureExtractionTarget(targetDir, normalizedPath);
        if (kind === "directory") {
          fs.mkdirSync(destinationPath, { recursive: true });
          nextEntry();
          return;
        }
        if (kind !== "file") {
          throw new Error(`Unsupported ZIP entry type during extraction: ${entry.fileName}`);
        }
        fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
        zipFile.openReadStream(entry, (error, stream) => {
          if (error) {
            fail(error);
            return;
          }
          if (!stream) {
            fail(new Error(`ZIP entry could not be read: ${entry.fileName}`));
            return;
          }
          const output = fs.createWriteStream(destinationPath, { mode: 0o644 });
          stream.on("error", fail);
          output.on("error", fail);
          output.on("close", nextEntry);
          stream.pipe(output);
        });
      } catch (error) {
        fail(error);
      }
    });
    zipFile.readEntry();
  });
}

export async function extractArchiveFileAsync(filePath: string, targetDir: string, kind: ArchiveKind): Promise<void> {
  fs.mkdirSync(targetDir, { recursive: true });
  if (kind === "zip") {
    await extractZipArchiveAsync(filePath, targetDir);
    return;
  }
  await tar.x({
    file: filePath,
    cwd: targetDir,
    gzip: kind === "tar.gz",
    portable: true,
    preservePaths: false,
    strict: true,
  });
}

export async function inspectGitRepositoryPathAsync(location: string): Promise<GitRepositoryPathInspection> {
  const absolutePath = path.isAbsolute(location) ? location : path.resolve(process.cwd(), location);
  if (!fs.existsSync(absolutePath)) {
    return {
      ok: false,
      message: `Source path not found: ${absolutePath}`,
    };
  }

  let reportedRoot = "";
  try {
    reportedRoot = (await new Promise<string>((resolve, reject) => {
      const process = spawn("git", ["-C", absolutePath, "rev-parse", "--show-toplevel"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      process.stdout.on("data", chunk => stdout.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      process.stderr.on("data", chunk => stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      process.once("error", reject);
      process.once("close", status => {
        if (status !== 0) {
          reject(new Error(Buffer.concat(stderr).toString("utf8") || Buffer.concat(stdout).toString("utf8") || "git rev-parse failed"));
          return;
        }
        resolve(Buffer.concat(stdout).toString("utf8").trim());
      });
    })).trim();
  } catch {
    return {
      ok: false,
      message: "Local workspace sources must point at a Git repository root.",
    };
  }
  const normalizedAbsolute = fs.realpathSync.native(absolutePath);
  const normalizedRoot = fs.realpathSync.native(reportedRoot);
  if (normalizedAbsolute !== normalizedRoot) {
    return {
      ok: false,
      message: "Local workspace sources must point at the Git repository root, not a nested directory.",
    };
  }

  return {
    ok: true,
    rootPath: normalizedRoot,
  };
}
