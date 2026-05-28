const { constants } = require('node:fs');

const maxWorkspaceTextFileBytes = 5 * 1024 * 1024;
const gitTextObjectReadBufferBytes = maxWorkspaceTextFileBytes + 64 * 1024;

function assertWorkspaceTextContentSize(content, label = 'Workspace file') {
  if (typeof content !== 'string') {
    throw new Error(`${label} content must be text`);
  }
  if (Buffer.byteLength(content, 'utf8') > maxWorkspaceTextFileBytes) {
    throw new Error(`${label} is too large`);
  }
  return content;
}

async function readWorkspaceTextFile(fsApi, target) {
  return readWorkspaceTextFileBounded(fsApi, target, {
    maxBytes: maxWorkspaceTextFileBytes,
  });
}

async function readWorkspaceTextFileBounded(fsApi, target, {
  maxBytes = maxWorkspaceTextFileBytes,
  truncatedSuffix = '',
} = {}) {
  const limit = assertByteLimit(maxBytes);
  const handle = await fsApi.open(target, workspaceTextReadFlags());
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw new Error('Workspace path is not a file');
    }
    if (stat.size > limit && !truncatedSuffix) {
      throw new Error('Workspace file is too large');
    }
    if (stat.size > limit) {
      return {
        content: await readUtf8Prefix(handle, limit, truncatedSuffix),
        stat,
        truncated: true,
      };
    }
    return {
      content: await handle.readFile('utf8'),
      stat,
      truncated: false,
    };
  } finally {
    await handle.close();
  }
}

async function readUtf8Prefix(handle, limit, suffix) {
  const suffixBytes = Buffer.byteLength(suffix, 'utf8');
  const buffer = Buffer.alloc(Math.max(0, limit - suffixBytes));
  const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
  return `${buffer.subarray(0, bytesRead).toString('utf8')}${suffix}`;
}

function assertByteLimit(value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('Workspace read byte limit is not valid');
  }
  return value;
}

function workspaceTextReadFlags() {
  return constants.O_RDONLY | (constants.O_NOFOLLOW || 0);
}

function assertGitTextObjectSize(sizeOutput) {
  const bytes = Number(String(sizeOutput || '').trim());
  if (!Number.isFinite(bytes) || !Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error('Git object size is not valid');
  }
  if (bytes > maxWorkspaceTextFileBytes) {
    throw new Error('Git object is too large to compare in Codeyo');
  }
  return bytes;
}

module.exports = {
  assertGitTextObjectSize,
  assertWorkspaceTextContentSize,
  gitTextObjectReadBufferBytes,
  maxWorkspaceTextFileBytes,
  readWorkspaceTextFile,
  readWorkspaceTextFileBounded,
  workspaceTextReadFlags,
};
