const crypto = require('node:crypto');

const maxPortablePayloadBytes = 25 * 1024 * 1024;
const portableArrayKeys = ['snapshots', 'runResults', 'recoveryBuffers', 'journal', 'runProfiles'];
const portableStorageDirectoryName = '.codeyo';
const portableJournalFileName = 'journal.json';

function boundPortablePayload(payload, { maxBytes = maxPortablePayloadBytes } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Portable payload must be an object');
  }
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new Error('Portable payload byte limit is not valid');
  }

  const bounded = clonePortablePayload(payload);
  const truncated = {};
  let json = portablePayloadJson(bounded);

  while (Buffer.byteLength(json, 'utf8') > maxBytes) {
    const key = largestTrailingArrayItemKey(bounded);
    if (!key) {
      throw new Error('Portable payload cannot fit within the byte limit');
    }
    bounded[key].pop();
    truncated[key] = (truncated[key] || 0) + 1;
    json = portablePayloadJson(bounded);
  }

  if (Object.keys(truncated).length > 0) {
    bounded.truncated = truncated;
    json = portablePayloadJson(bounded);
    while (Buffer.byteLength(json, 'utf8') > maxBytes) {
      const key = largestTrailingArrayItemKey(bounded);
      if (!key) {
        delete bounded.truncated;
        json = portablePayloadJson(bounded);
        break;
      }
      bounded[key].pop();
      truncated[key] = (truncated[key] || 0) + 1;
      bounded.truncated = truncated;
      json = portablePayloadJson(bounded);
    }
  }

  if (Buffer.byteLength(json, 'utf8') > maxBytes) {
    throw new Error('Portable payload cannot fit within the byte limit');
  }

  return {
    payload: bounded,
    json,
    bytes: Buffer.byteLength(json, 'utf8'),
    truncated,
  };
}

function portablePayloadJson(payload) {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function largestTrailingArrayItemKey(payload) {
  let selected = '';
  let selectedBytes = -1;
  for (const key of portableArrayKeys) {
    const value = payload[key];
    if (!Array.isArray(value) || value.length === 0) {
      continue;
    }
    const bytes = Buffer.byteLength(JSON.stringify(value.at(-1)), 'utf8');
    if (bytes > selectedBytes) {
      selected = key;
      selectedBytes = bytes;
    }
  }
  return selected;
}

function clonePortablePayload(payload) {
  const clone = {
    ...payload,
  };
  for (const key of portableArrayKeys) {
    clone[key] = Array.isArray(payload[key]) ? payload[key].slice() : [];
  }
  delete clone.truncated;
  return clone;
}

function portableStoragePaths(pathApi, workspaceRoot) {
  const directoryPath = pathApi.join(workspaceRoot, portableStorageDirectoryName);
  return {
    directoryPath,
    journalPath: pathApi.join(directoryPath, portableJournalFileName),
  };
}

function preparePortableStorageDirectory(fsApi, pathApi, workspaceRoot) {
  const paths = portableStoragePaths(pathApi, workspaceRoot);
  const directoryStat = lstatIfExists(fsApi, paths.directoryPath);
  if (!directoryStat) {
    fsApi.mkdirSync(paths.directoryPath, { recursive: false });
  } else if (directoryStat.isSymbolicLink()) {
    throw new Error('Portable storage directory must not be a symlink');
  } else if (!directoryStat.isDirectory()) {
    throw new Error('Portable storage path is not a directory');
  }
  assertPortablePathInsideWorkspace(fsApi, pathApi, workspaceRoot, paths.directoryPath);
  return paths;
}

function resolvePortableJournalReadPath(fsApi, pathApi, workspaceRoot) {
  const paths = portableStoragePaths(pathApi, workspaceRoot);
  const directoryStat = lstatIfExists(fsApi, paths.directoryPath);
  if (!directoryStat || directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
    return null;
  }
  const journalStat = lstatIfExists(fsApi, paths.journalPath);
  if (!journalStat || journalStat.isSymbolicLink() || !journalStat.isFile()) {
    return null;
  }
  try {
    assertPortablePathInsideWorkspace(fsApi, pathApi, workspaceRoot, paths.directoryPath);
    assertPortablePathInsideWorkspace(fsApi, pathApi, workspaceRoot, paths.journalPath);
  } catch {
    return null;
  }
  return paths.journalPath;
}

function writePortableJournalAtomically(fsApi, pathApi, directoryPath, journalPath, json, {
  nonce = crypto.randomUUID(),
} = {}) {
  const safeNonce = sanitizePortableTempNonce(nonce);
  const tempPath = pathApi.join(directoryPath, `journal.${safeNonce}.tmp`);
  fsApi.writeFileSync(tempPath, json, { encoding: 'utf8', flag: 'wx' });
  try {
    fsApi.renameSync(tempPath, journalPath);
  } catch (error) {
    try {
      fsApi.unlinkSync(tempPath);
    } catch {
      // Preserve the original atomic-write failure.
    }
    throw error;
  }
  return { written: true };
}

function assertPortablePathInsideWorkspace(fsApi, pathApi, workspaceRoot, targetPath) {
  const rootRealPath = fsApi.realpathSync(workspaceRoot);
  const targetRealPath = fsApi.realpathSync(targetPath);
  const relativePath = pathApi.relative(rootRealPath, targetRealPath);
  if (relativePath && (relativePath.startsWith('..') || pathApi.isAbsolute(relativePath))) {
    throw new Error('Portable storage path leaves the trusted workspace');
  }
}

function sanitizePortableTempNonce(nonce) {
  const value = typeof nonce === 'string' ? nonce : '';
  if (!/^[a-fA-F0-9-]{8,80}$/.test(value)) {
    throw new Error('Portable journal temp name is not valid');
  }
  return value;
}

function lstatIfExists(fsApi, targetPath) {
  try {
    return fsApi.lstatSync(targetPath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

module.exports = {
  boundPortablePayload,
  maxPortablePayloadBytes,
  portablePayloadJson,
  portableStoragePaths,
  preparePortableStorageDirectory,
  resolvePortableJournalReadPath,
  writePortableJournalAtomically,
};
