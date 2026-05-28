const crypto = require('node:crypto');
const { assertEditableRelativePath, portableEditableRelativePath } = require('./path-policy.cjs');

const maxGitPatchBytes = 1024 * 1024;
const forbiddenGitPatchLinePattern = /^(?:GIT binary patch|Binary files |(?:new|deleted) file mode |old mode |new mode |similarity index |dissimilarity index |rename from |rename to |copy from |copy to )/m;

function isUntrackedStatus(statusOutput) {
  return String(statusOutput || '').split(/\r?\n/).some((line) => line.startsWith('?? '));
}

function trackedDiscardArgs(gitPath) {
  return ['restore', '--staged', '--worktree', '--', gitPath];
}

function assertGitPatchSafety(mode, confirmed) {
  if (!['stage', 'unstage', 'discard'].includes(mode)) {
    throw new Error('Patch mode is not permitted');
  }
  if (mode === 'discard' && !confirmed) {
    throw new Error('Discarding a hunk requires explicit confirmation');
  }
}

function assertGitPatchPayload(patch) {
  if (typeof patch !== 'string' || !patch.length) {
    throw new Error('Patch payload is required');
  }
  if (patch.includes('\0')) {
    throw new Error('Patch payload contains invalid characters');
  }
  if (Buffer.byteLength(patch, 'utf8') > maxGitPatchBytes) {
    throw new Error('Patch payload is too large');
  }
  return patch;
}

function assertSingleGitPatchTarget(paths) {
  const uniquePaths = [...new Set(Array.isArray(paths) ? paths : [])];
  if (uniquePaths.length !== 1) {
    throw new Error('Patch must target exactly one editable file');
  }
  return uniquePaths;
}

function validateGitPatchPaths(patch) {
  const safePatch = assertGitPatchPayload(patch);
  if (forbiddenGitPatchLinePattern.test(safePatch)) {
    throw new Error('Patch must be a text hunk, not a file mode, rename, copy, or binary patch');
  }
  if (!/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m.test(safePatch)) {
    throw new Error('Patch is missing a text hunk header');
  }

  const paths = new Set();
  let diffHeaderSeen = false;
  for (const match of safePatch.matchAll(/^diff --git a\/(.+) b\/(.+)$/gm)) {
    diffHeaderSeen = true;
    paths.add(safeGitPatchPath(match[1]));
    paths.add(safeGitPatchPath(match[2]));
  }
  if (!diffHeaderSeen) {
    throw new Error('Patch is missing a git diff header');
  }

  let fileHeaderSeen = false;
  for (const match of safePatch.matchAll(/^(?:---|\+\+\+) (?:([ab])\/(.+)|\/dev\/null)\s*$/gm)) {
    fileHeaderSeen = true;
    const candidate = match[2];
    if (candidate) {
      paths.add(safeGitPatchPath(candidate));
    }
  }
  if (!fileHeaderSeen) {
    throw new Error('Patch is missing file headers');
  }

  return assertSingleGitPatchTarget([...paths]);
}

function safeGitPatchPath(filePath) {
  assertEditableRelativePath(filePath);
  return portableEditableRelativePath(filePath);
}

function gitPatchTempPath(pathApi, tempDir, nonce = crypto.randomUUID()) {
  return pathApi.join(tempDir, `codeyo-${sanitizeGitPatchTempNonce(nonce)}.patch`);
}

async function writeGitPatchTempFile(fsApi, pathApi, tempDir, patch, options = {}) {
  const tempFile = gitPatchTempPath(pathApi, tempDir, options.nonce);
  await fsApi.writeFile(tempFile, patch, { encoding: 'utf8', flag: 'wx' });
  return tempFile;
}

function sanitizeGitPatchTempNonce(nonce) {
  const value = typeof nonce === 'string' ? nonce : '';
  if (!/^[a-fA-F0-9-]{8,80}$/.test(value)) {
    throw new Error('Git patch temp name is not valid');
  }
  return value;
}

module.exports = {
  gitPatchTempPath,
  assertGitPatchPayload,
  assertGitPatchSafety,
  assertSingleGitPatchTarget,
  isUntrackedStatus,
  maxGitPatchBytes,
  trackedDiscardArgs,
  validateGitPatchPaths,
  writeGitPatchTempFile,
};
