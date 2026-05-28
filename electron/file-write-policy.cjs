const { constants } = require('node:fs');

function writeConflictState({ fileExists, expectedDiskVersion, currentDiskVersion }) {
  const expected = typeof expectedDiskVersion === 'string' ? expectedDiskVersion : '';
  const current = typeof currentDiskVersion === 'string' ? currentDiskVersion : '';

  if (!fileExists && expected) {
    return {
      conflict: true,
      deleted: true,
      diskVersion: '',
      diskContent: '',
    };
  }

  if (fileExists && expected && current && current !== expected) {
    return {
      conflict: true,
      deleted: false,
      diskVersion: current,
    };
  }

  return { conflict: false };
}

function workspaceTextWriteOptions({ fileExists }) {
  return fileExists
    ? { encoding: 'utf8', flag: workspaceExistingTextWriteFlags() }
    : { encoding: 'utf8', flag: workspaceNewTextWriteFlags() };
}

async function writeWorkspaceTextFile(fsApi, target, content, { fileExists }) {
  const handle = await fsApi.open(target, fileExists
    ? workspaceExistingTextWriteFlags()
    : workspaceNewTextWriteFlags());
  try {
    await handle.writeFile(content, 'utf8');
    return await handle.stat();
  } finally {
    await handle.close();
  }
}

function workspaceExistingTextWriteFlags() {
  return constants.O_WRONLY | constants.O_TRUNC | (constants.O_NOFOLLOW || 0);
}

function workspaceNewTextWriteFlags() {
  return constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0);
}

module.exports = {
  workspaceExistingTextWriteFlags,
  workspaceNewTextWriteFlags,
  workspaceTextWriteOptions,
  writeConflictState,
  writeWorkspaceTextFile,
};
