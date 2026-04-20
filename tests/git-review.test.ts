import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test, { type TestContext } from "node:test";
import type { Source } from "@speclens/contracts";
import type { ObjectStorageConfig } from "@speclens/db";
import { createHomeTempDirSync } from "@speclens/core";
import * as gitReviewNamespace from "../apps/api/src/services/git-review";
import { createCommittedGitFixture, toFileGitUrl } from "./helpers/git-fixtures";

const gitReviewModule = ("default" in gitReviewNamespace
  ? gitReviewNamespace.default
  : gitReviewNamespace) as typeof gitReviewNamespace;

const {
  CodeReviewCacheNotReadyError,
  CodeReviewReferenceNotFoundError,
  listGitReferences,
  listCodeTree,
  prewarmCodeReviewSource,
  readCodeDiff,
  readCodeReviewFromSource,
} = gitReviewModule;

const fixturePath = path.join(process.cwd(), "fixtures", "tagtwo-mini");

const unusedStorageConfig: ObjectStorageConfig = {
  objectStorageProvider: "local",
  objectStorageBucket: null,
  objectStorageEndpoint: null,
  objectStoragePublicEndpoint: null,
  objectStorageRegion: null,
  objectStorageForcePathStyle: false,
};

function runGit(args: string[], cwd: string): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "SpecLens Tests",
      GIT_AUTHOR_EMAIL: "tests@speclens.dev",
      GIT_COMMITTER_NAME: "SpecLens Tests",
      GIT_COMMITTER_EMAIL: "tests@speclens.dev",
    },
  });
  assert.equal(result.status, 0, result.stderr.trim() || result.stdout.trim());
  return result.stdout.trim();
}

function setTempCacheRoot(t: TestContext): string {
  const previousCacheRoot = process.env.SPECLENS_CACHE_ROOT;
  const cacheRoot = createHomeTempDirSync("speclens-git-review-cache-");
  process.env.SPECLENS_CACHE_ROOT = cacheRoot;
  t.after(() => {
    if (previousCacheRoot === undefined) {
      delete process.env.SPECLENS_CACHE_ROOT;
    } else {
      process.env.SPECLENS_CACHE_ROOT = previousCacheRoot;
    }
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  });
  return cacheRoot;
}

function createSource(repoPath: string, sourceId: string): Source {
  return {
    id: sourceId,
    workspaceId: "workspace-test",
    type: "git-public",
    displayName: path.basename(repoPath),
    location: toFileGitUrl(repoPath),
    visibility: "public",
    verificationStatus: "verified",
    verificationError: null,
    githubInstallationId: null,
    uploadObjectKey: null,
    createdAt: new Date().toISOString(),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

test("git review diff disables repo-configured textconv helpers", async t => {
  const tempDir = createHomeTempDirSync("speclens-git-review-textconv-");
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const repoPath = path.join(tempDir, "repo");
  fs.mkdirSync(repoPath, { recursive: true });
  runGit(["init", "--quiet"], repoPath);
  fs.writeFileSync(path.join(repoPath, ".gitattributes"), "*.foo diff=evil\n", "utf8");
  fs.writeFileSync(path.join(repoPath, "sample.foo"), "one\n", "utf8");
  runGit(["add", ".gitattributes", "sample.foo"], repoPath);
  runGit(["commit", "--quiet", "-m", "initial"], repoPath);

  const markerPath = path.join(tempDir, "textconv-ran.txt");
  runGit(["config", "diff.evil.textconv", `sh -c 'echo TEXTCONV_RAN > ${markerPath}; cat'`], repoPath);

  fs.writeFileSync(path.join(repoPath, "sample.foo"), "two\n", "utf8");
  runGit(["add", "sample.foo"], repoPath);
  runGit(["commit", "--quiet", "-m", "update"], repoPath);

  const diff = await readCodeDiff(repoPath, "HEAD", "HEAD~1", "sample.foo");
  assert.equal(fs.existsSync(markerPath), false);
  assert.equal(diff?.includes("+two"), true);
});

test("git review tree listing supports dash-prefixed directories", async t => {
  const tempDir = createHomeTempDirSync("speclens-git-review-dash-dir-");
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const repoPath = path.join(tempDir, "repo");
  fs.mkdirSync(path.join(repoPath, "--dir"), { recursive: true });
  runGit(["init", "--quiet"], repoPath);
  fs.writeFileSync(path.join(repoPath, "--dir", "file.txt"), "value\n", "utf8");
  runGit(["add", "."], repoPath);
  runGit(["commit", "--quiet", "-m", "initial"], repoPath);

  const tree = await listCodeTree(repoPath, "HEAD", "--dir");
  assert.equal(tree.some(entry => entry.path === "--dir/file.txt"), true);
});

test("git review tree listing preserves filenames with trailing spaces", async t => {
  const tempDir = createHomeTempDirSync("speclens-git-review-trailing-space-");
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const repoPath = path.join(tempDir, "repo");
  fs.mkdirSync(repoPath, { recursive: true });
  runGit(["init", "--quiet"], repoPath);
  fs.writeFileSync(path.join(repoPath, "trailing-space.txt "), "value\n", "utf8");
  runGit(["add", "--all"], repoPath);
  runGit(["commit", "--quiet", "-m", "initial"], repoPath);

  const tree = await listCodeTree(repoPath, "HEAD", null);
  assert.equal(tree.some(entry => entry.path === "trailing-space.txt "), true);
});

test("git review rejects missing compare refs instead of returning an empty diff", async t => {
  setTempCacheRoot(t);

  const repoPath = createCommittedGitFixture(fixturePath, "speclens-git-review-compare-");
  const source = createSource(repoPath, "source-missing-compare");
  await prewarmCodeReviewSource(source, unusedStorageConfig);

  await assert.rejects(
    () => readCodeReviewFromSource(source, unusedStorageConfig, { compare: "missing-compare" }),
    error => {
      assert.ok(error instanceof CodeReviewReferenceNotFoundError);
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /missing-compare/);
      return true;
    },
  );
});

test("git review refreshes missing mirror refs instead of falling back to the cached head", async t => {
  setTempCacheRoot(t);

  const repoPath = createCommittedGitFixture(fixturePath, "speclens-git-review-refresh-");
  const source = createSource(repoPath, "source-mirror-refresh");
  await prewarmCodeReviewSource(source, unusedStorageConfig);

  runGit(["checkout", "-b", "feature/pr-head"], repoPath);
  fs.writeFileSync(path.join(repoPath, "FEATURE_BRANCH.md"), "feature branch content\n", "utf8");
  runGit(["add", "FEATURE_BRANCH.md"], repoPath);
  runGit(["commit", "--quiet", "-m", "feature branch"], repoPath);

  const review = await readCodeReviewFromSource(source, unusedStorageConfig, {
    ref: "feature/pr-head",
  });

  assert.equal(review.selectedRef, "feature/pr-head");
  assert.equal(review.tree.some(entry => entry.path === "FEATURE_BRANCH.md"), true);
});

test("git review ref listing preserves pipe characters in branch names", async t => {
  const tempDir = createHomeTempDirSync("speclens-git-review-ref-pipe-");
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const repoPath = path.join(tempDir, "repo");
  fs.mkdirSync(repoPath, { recursive: true });
  runGit(["init", "--quiet"], repoPath);
  fs.writeFileSync(path.join(repoPath, "file.txt"), "value\n", "utf8");
  runGit(["add", "--all"], repoPath);
  runGit(["commit", "--quiet", "-m", "initial"], repoPath);
  runGit(["branch", "feature|pipe"], repoPath);

  const refs = await listGitReferences(repoPath);
  assert.equal(refs.some(ref => ref.name === "feature|pipe"), true);
});

test("git review fails closed while a stale mirror refreshes an existing branch name and recovers without manual prewarm", async t => {
  setTempCacheRoot(t);
  const previousRefreshMs = process.env.GIT_REVIEW_MIRROR_REFRESH_MS;
  process.env.GIT_REVIEW_MIRROR_REFRESH_MS = "1";
  t.after(() => {
    if (previousRefreshMs === undefined) {
      delete process.env.GIT_REVIEW_MIRROR_REFRESH_MS;
    } else {
      process.env.GIT_REVIEW_MIRROR_REFRESH_MS = previousRefreshMs;
    }
  });

  const repoPath = createCommittedGitFixture(fixturePath, "speclens-git-review-stale-existing-ref-");
  const source = createSource(repoPath, "source-stale-existing-ref");
  await prewarmCodeReviewSource(source, unusedStorageConfig);

  const branchName = runGit(["branch", "--show-current"], repoPath);
  await sleep(20);
  fs.writeFileSync(path.join(repoPath, "NEW_HEAD_FILE.md"), "new head content\n", "utf8");
  runGit(["add", "NEW_HEAD_FILE.md"], repoPath);
  runGit(["commit", "--quiet", "-m", "move existing branch"], repoPath);

  await assert.rejects(
    () => readCodeReviewFromSource(source, unusedStorageConfig, {
      ref: branchName,
      requireReadyCache: true,
    }),
    error => error instanceof CodeReviewCacheNotReadyError,
  );

  process.env.GIT_REVIEW_MIRROR_REFRESH_MS = "60000";
  let refreshedReview: Awaited<ReturnType<typeof readCodeReviewFromSource>> | null = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await sleep(50);
    try {
      refreshedReview = await readCodeReviewFromSource(source, unusedStorageConfig, {
        ref: branchName,
        requireReadyCache: true,
      });
      break;
    } catch (error) {
      if (!(error instanceof CodeReviewCacheNotReadyError)) {
        throw error;
      }
    }
  }

  assert.ok(refreshedReview);
  assert.equal(refreshedReview.tree.some(entry => entry.path === "NEW_HEAD_FILE.md"), true);
});
