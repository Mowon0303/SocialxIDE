const { portableEditableRelativePath } = require('./path-policy.cjs');
const maxGitDiffOutputBytes = 1024 * 1024;
const gitDiffTruncatedMarker = '\n[CODEYO GIT DIFF TRUNCATED]\n';

function parseGitStatus(output) {
  const lines = String(output || '').trim().split(/\r?\n/).filter(Boolean);
  const header = lines.shift() || '## NO REPOSITORY';
  const initial = header.match(/^## No commits yet on (.+)$/);
  const branch = sanitizeGitText(initial?.[1] || header.replace(/^##\s*/, '').split('...')[0], 'NO REPOSITORY', 240);
  const relation = header.match(/\[(?:ahead (\d+))?(?:, )?(?:behind (\d+))?\]/);
  return {
    branch,
    initial: Boolean(initial),
    ahead: safeGitOutputCount(relation?.[1]),
    behind: safeGitOutputCount(relation?.[2]),
    files: lines.map(parseGitStatusFile).filter(Boolean),
  };
}

function parseGitStatusFile(line) {
  if (typeof line !== 'string' || line.length < 4) {
    return null;
  }
  const rawPath = line.slice(3);
  const renamed = rawPath.match(/^(.*?) -> (.*)$/);
  const path = safeGitPath(renamed?.[2] || rawPath);
  if (!path) {
    return null;
  }
  const originalPath = renamed ? safeGitPath(renamed[1]) : null;
  if (renamed && !originalPath) {
    return null;
  }
  const index = safeGitStatusCode(line[0]);
  const workingTree = safeGitStatusCode(line[1]);
  if (index === null || workingTree === null) {
    return null;
  }
  return {
    index,
    workingTree,
    path,
    ...(originalPath ? { originalPath } : {}),
  };
}

function parseGitHistory(output) {
  return String(output || '').split(/\r?\n/).filter(Boolean).map((line) => {
    const [revision, shortRevision, author, authoredAt, ...subject] = line.split('\t');
    const safeRevision = safeGitRevision(revision);
    if (!safeRevision) {
      return null;
    }
    return {
      revision: safeRevision,
      shortRevision: sanitizeGitText(shortRevision, safeRevision.slice(0, 7), 40).toUpperCase(),
      author: sanitizeGitText(author, 'Unknown author', 160),
      authoredAt: sanitizeGitTimestamp(authoredAt),
      subject: sanitizeGitText(subject.join('\t'), 'No subject', 500),
    };
  }).filter(Boolean);
}

function parseGitCommitFiles(output) {
  return String(output || '').split(/\r?\n/).filter(Boolean).map((line) => {
    const [rawStatus, ...paths] = line.split('\t');
    const status = sanitizeCommitStatus(rawStatus);
    if (!status) {
      return null;
    }
    if ((status === 'R' || status === 'C') && paths.length > 1) {
      const originalPath = safeGitPath(paths[0]);
      const path = safeGitPath(paths[1]);
      return originalPath && path ? { status, originalPath, path } : null;
    }
    const path = safeGitPath(paths[0]);
    return path ? { status, path } : null;
  }).filter(Boolean);
}

function parseGitCommitHeading(output) {
  const [revision, ...subjectParts] = String(output || '').trim().split('\0');
  const safeRevision = safeGitRevision(revision);
  if (!safeRevision) {
    return null;
  }
  return {
    revision: safeRevision,
    shortRevision: safeRevision.slice(0, 7).toUpperCase(),
    subject: sanitizeGitText(subjectParts.join('\0'), 'No subject', 500),
  };
}

function parseGitBranches(output) {
  const seen = new Set();
  return String(output || '').split(/\r?\n/).map(safeGitBranchName).filter((branch) => {
    if (!branch || seen.has(branch)) {
      return false;
    }
    seen.add(branch);
    return true;
  });
}

function parseGitNumstat(output) {
  const files = String(output || '').split(/\r?\n/).filter(Boolean).map(parseGitNumstatFile).filter(Boolean);
  return {
    files,
    additions: files.reduce((count, file) => count + file.additions, 0),
    deletions: files.reduce((count, file) => count + file.deletions, 0),
  };
}

function sanitizeGitDiffResult(result) {
  return {
    exitCode: Number.isFinite(Number(result?.exitCode)) ? Number(result.exitCode) : 1,
    stdout: truncateGitOutput(result?.stdout, maxGitDiffOutputBytes),
    stderr: truncateGitOutput(result?.stderr, maxGitDiffOutputBytes),
    ...(result?.timedOut ? { timedOut: true } : {}),
    ...(result?.truncated ? { truncated: true } : {}),
  };
}

function truncateGitOutput(value, limit) {
  const text = typeof value === 'string' ? value : '';
  if (Buffer.byteLength(text, 'utf8') <= limit) {
    return text;
  }
  const suffixBytes = Buffer.byteLength(gitDiffTruncatedMarker, 'utf8');
  return `${Buffer.from(text, 'utf8').subarray(0, Math.max(0, limit - suffixBytes)).toString('utf8')}${gitDiffTruncatedMarker}`;
}

function parseGitNumstatFile(line) {
  if (typeof line !== 'string') {
    return null;
  }
  const [rawAdditions, rawDeletions, ...pathParts] = line.split('\t');
  if (pathParts.length === 0) {
    return null;
  }
  const path = safeGitPath(numstatCurrentPath(pathParts.join('\t')));
  if (!path) {
    return null;
  }
  const binary = rawAdditions === '-' || rawDeletions === '-';
  if (binary) {
    return { path, additions: 0, deletions: 0, binary: true };
  }
  const additions = safeGitNumstatCount(rawAdditions);
  const deletions = safeGitNumstatCount(rawDeletions);
  return additions === null || deletions === null ? null : { path, additions, deletions };
}

function numstatCurrentPath(value) {
  const pathValue = String(value || '').trim();
  if (!pathValue.includes('=>')) {
    return pathValue;
  }
  const bracedRename = pathValue.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  if (bracedRename) {
    return `${bracedRename[1]}${bracedRename[3]}${bracedRename[4]}`.trim();
  }
  return pathValue.split('=>').pop().trim();
}

function safeGitPath(value) {
  try {
    return portableEditableRelativePath(String(value || '').trim());
  } catch {
    return null;
  }
}

function safeGitRevision(value) {
  const revision = typeof value === 'string' ? value.trim() : '';
  return /^[0-9a-f]{7,40}$/i.test(revision) ? revision : null;
}

function safeGitStatusCode(value) {
  const status = typeof value === 'string' && value.length === 1 ? value : '';
  return /^[ MTADRCU?!]$/.test(status) ? status : null;
}

function sanitizeCommitStatus(value) {
  const status = typeof value === 'string' ? value[0] : '';
  return /^[ACDMRTUXB]$/.test(status) ? status : '';
}

function safeGitBranchName(value) {
  const branch = typeof value === 'string' ? value.trim() : '';
  if (
    !branch ||
    branch.length > 240 ||
    branch.startsWith('-') ||
    /[\x00-\x20\x7F~^:?*[\]\\]/.test(branch) ||
    branch.includes('..') ||
    branch.includes('@{') ||
    branch.includes('//') ||
    branch.endsWith('/') ||
    branch.endsWith('.') ||
    branch.endsWith('.lock')
  ) {
    return null;
  }
  return branch;
}

function safeGitNumstatCount(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{1,9}$/.test(text)) {
    return null;
  }
  const count = Number(text);
  return Number.isSafeInteger(count) && count <= 1000000 ? count : null;
}

function safeGitOutputCount(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return /^\d{1,6}$/.test(text) ? Number(text) : 0;
}

function sanitizeGitText(value, fallback, maxLength) {
  const text = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  return text.replace(/[\x00-\x1F\x7F]/g, ' ').replace(/\s+/g, ' ').slice(0, maxLength);
}

function sanitizeGitTimestamp(value) {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  return new Date(0).toISOString();
}

module.exports = {
  gitDiffTruncatedMarker,
  maxGitDiffOutputBytes,
  parseGitBranches,
  parseGitCommitFiles,
  parseGitCommitHeading,
  parseGitHistory,
  parseGitNumstat,
  parseGitStatus,
  sanitizeGitDiffResult,
};
