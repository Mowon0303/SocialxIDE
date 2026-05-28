const maxJournalMetadataBytes = 16 * 1024;
const maxJournalMetadataTextChars = 1200;
const maxJournalMetadataPathChars = 240;
const maxJournalMetadataFileEntries = 24;

function sanitizeJournalMetadataInput(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {};
  }
  const json = stringifyMetadata(metadata);
  if (Buffer.byteLength(json, 'utf8') > maxJournalMetadataBytes) {
    throw new Error('Journal metadata is too large');
  }
  return JSON.parse(json);
}

function gitActionJournalMetadata({ action, result, commitSummary, commitDetail, runEvidence }) {
  const metadata = {
    action: sanitizeMetadataText(action?.type, 'git', 80),
  };
  const output = sanitizeMetadataText(result?.stdout || result?.stderr, '', maxJournalMetadataTextChars);
  if (output) {
    metadata.output = output;
  }
  if (commitSummary) {
    const summary = summarizeFiles(commitSummary.files);
    metadata.files = summary.files;
    metadata.additions = sanitizeCount(commitSummary.additions);
    metadata.deletions = sanitizeCount(commitSummary.deletions);
    if (summary.truncated) {
      metadata.filesTruncated = true;
    }
  }
  if (commitDetail) {
    const revision = sanitizeRevision(commitDetail.revision);
    if (revision) {
      metadata.revision = revision;
    }
    const changed = summarizeFiles(commitDetail.files);
    metadata.changedFiles = changed.files;
    if (changed.truncated) {
      metadata.changedFilesTruncated = true;
    }
  }
  if (runEvidence) {
    const runResultId = sanitizeRecordId(runEvidence.id);
    if (runResultId) {
      metadata.runResultId = runResultId;
    }
    metadata.runEvidence = {
      entryFile: sanitizePathText(runEvidence.entryFile),
      exitCode: sanitizeCount(runEvidence.exitCode),
      elapsedMs: sanitizeCount(runEvidence.elapsedMs),
      diagnostics: sanitizeCount(runEvidence.diagnostics?.length ?? runEvidence.diagnostics),
    };
  }
  return fitJournalMetadata(metadata);
}

function gitHunkJournalMetadata({ action, paths }) {
  const summarized = summarizePaths(paths);
  return fitJournalMetadata({
    action: sanitizeMetadataText(action, 'git-hunk', 80),
    paths: summarized.paths,
    ...(summarized.truncated ? { pathsTruncated: true } : {}),
  });
}

function reviewSnapshotJournalMetadata({ files, sourceRevision, runResultId }) {
  const summarized = summarizePaths((Array.isArray(files) ? files : []).map((file) => file?.path));
  const revision = sanitizeRevision(sourceRevision);
  const safeRunResultId = sanitizeRecordId(runResultId);
  return fitJournalMetadata({
    files: summarized.paths,
    ...(summarized.truncated ? { filesTruncated: true } : {}),
    ...(revision ? { sourceRevision: revision } : {}),
    ...(safeRunResultId ? { runResultId: safeRunResultId } : {}),
  });
}

function fitJournalMetadata(metadata) {
  let candidate = cloneMetadata(metadata);
  if (fitsMetadata(candidate)) {
    return candidate;
  }
  if (typeof candidate.output === 'string') {
    candidate.output = sanitizeMetadataText(candidate.output, '', 300);
  }
  candidate = reduceFileArrays(candidate, 12);
  if (fitsMetadata(candidate)) {
    return candidate;
  }
  delete candidate.output;
  candidate = reduceFileArrays(candidate, 6);
  if (fitsMetadata(candidate)) {
    return candidate;
  }
  delete candidate.files;
  delete candidate.changedFiles;
  delete candidate.paths;
  return fitsMetadata(candidate) ? candidate : { action: sanitizeMetadataText(metadata.action, 'git', 80) };
}

function reduceFileArrays(metadata, limit) {
  const candidate = cloneMetadata(metadata);
  for (const key of ['files', 'changedFiles', 'paths']) {
    if (Array.isArray(candidate[key]) && candidate[key].length > limit) {
      candidate[key] = candidate[key].slice(0, limit);
      candidate[`${key}Truncated`] = true;
    }
  }
  return candidate;
}

function fitsMetadata(metadata) {
  return Buffer.byteLength(stringifyMetadata(metadata), 'utf8') <= maxJournalMetadataBytes;
}

function cloneMetadata(metadata) {
  return JSON.parse(stringifyMetadata(metadata));
}

function summarizeFiles(files) {
  const safeFiles = (Array.isArray(files) ? files : [])
    .map(sanitizeFileEntry)
    .filter(Boolean);
  return {
    files: safeFiles.slice(0, maxJournalMetadataFileEntries),
    truncated: safeFiles.length > maxJournalMetadataFileEntries,
  };
}

function summarizePaths(paths) {
  const safePaths = (Array.isArray(paths) ? paths : [])
    .map(sanitizePathText)
    .filter(Boolean);
  return {
    paths: safePaths.slice(0, maxJournalMetadataFileEntries),
    truncated: safePaths.length > maxJournalMetadataFileEntries,
  };
}

function sanitizeFileEntry(file) {
  if (!file || typeof file !== 'object') {
    return null;
  }
  const path = sanitizePathText(file.path);
  if (!path) {
    return null;
  }
  const entry = { path };
  const originalPath = sanitizePathText(file.originalPath);
  const status = sanitizeMetadataText(file.status, '', 8);
  if (originalPath) {
    entry.originalPath = originalPath;
  }
  if (status) {
    entry.status = status;
  }
  if (file.binary === true) {
    entry.binary = true;
  }
  if (file.additions !== undefined) {
    entry.additions = sanitizeCount(file.additions);
  }
  if (file.deletions !== undefined) {
    entry.deletions = sanitizeCount(file.deletions);
  }
  return entry;
}

function sanitizeMetadataText(value, fallback, maxLength) {
  const text = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  return text.replace(/[\x00-\x1F\x7F]/g, ' ').replace(/\s+/g, ' ').slice(0, maxLength);
}

function sanitizePathText(value) {
  return sanitizeMetadataText(value, '', maxJournalMetadataPathChars);
}

function sanitizeCount(value) {
  const count = Number(value);
  return Number.isFinite(count) ? Math.max(0, Math.min(1000000, Math.floor(count))) : 0;
}

function sanitizeRecordId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  return /^[a-zA-Z0-9._:-]{1,120}$/.test(id) ? id : '';
}

function sanitizeRevision(value) {
  const revision = typeof value === 'string' ? value.trim() : '';
  return /^[0-9a-f]{7,40}$/i.test(revision) ? revision : '';
}

function stringifyMetadata(metadata) {
  try {
    return JSON.stringify(metadata || {});
  } catch {
    throw new Error('Journal metadata must be JSON serializable');
  }
}

module.exports = {
  gitActionJournalMetadata,
  gitHunkJournalMetadata,
  maxJournalMetadataBytes,
  reviewSnapshotJournalMetadata,
  sanitizeJournalMetadataInput,
};
