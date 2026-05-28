const { portableEditableRelativePath } = require('./path-policy.cjs');

const permittedGitActionTypes = Object.freeze([
  'stage',
  'unstage',
  'commit',
  'create-branch',
  'switch-branch',
  'pull',
  'push',
  'discard',
  'delete-branch',
]);

const branchActionTypes = new Set(['create-branch', 'switch-branch', 'delete-branch']);
const confirmedActionTypes = new Set(['discard', 'delete-branch']);
const pathActionTypes = new Set(['stage', 'unstage', 'discard']);

function normalizeGitAction(action) {
  if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
    throw new Error('Git action is required');
  }
  const type = action.type;
  if (!permittedGitActionTypes.includes(type)) {
    throw new Error('Git action not permitted');
  }
  if (confirmedActionTypes.has(type) && action.confirmed !== true) {
    throw new Error(gitConfirmationMessage(type));
  }

  const normalized = { type };
  if (pathActionTypes.has(type)) {
    normalized.path = requireGitFilePath(action.path, 'Git action path is required');
    if (action.originalPath !== undefined && action.originalPath !== null && action.originalPath !== '') {
      normalized.originalPath = requireGitFilePath(action.originalPath, 'Git action original path is required');
    }
  }
  if (branchActionTypes.has(type)) {
    normalized.name = requireBranchNameCandidate(action.name);
  }
  if (type === 'commit') {
    normalized.message = requireCommitMessage(action.message);
    if (action.runResultId !== undefined && action.runResultId !== null && action.runResultId !== '') {
      normalized.runResultId = requireRecordId(action.runResultId, 'Run evidence id is not permitted');
    }
  }
  if (confirmedActionTypes.has(type)) {
    normalized.confirmed = true;
  }
  return normalized;
}

function requireGitFilePath(value, message) {
  const text = requireText(value, message, 512);
  try {
    return portableEditableRelativePath(text);
  } catch {
    throw new Error('Git action path is outside Codeyo editable file scope');
  }
}

function requireText(value, message, maxLength) {
  if (typeof value !== 'string') {
    throw new Error(message);
  }
  const text = value.trim();
  if (!text || text.includes('\0') || /[\r\n]/.test(text)) {
    throw new Error(message);
  }
  return text.slice(0, maxLength);
}

function requireCommitMessage(value) {
  const message = requireText(value, 'Commit message is required', 501);
  if (message.length > 500) {
    throw new Error('Commit message is too long');
  }
  return message;
}

function requireBranchNameCandidate(value) {
  const name = requireText(value, 'Branch name is not permitted', 240);
  if (name.startsWith('-')) {
    throw new Error('Branch name is not permitted');
  }
  return name;
}

function requireRecordId(value, message) {
  const id = requireText(value, message, 120);
  if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(id)) {
    throw new Error(message);
  }
  return id;
}

function gitConfirmationMessage(type) {
  if (type === 'delete-branch') {
    return 'Deleting a branch requires explicit confirmation';
  }
  return 'Discard requires explicit confirmation';
}

module.exports = {
  normalizeGitAction,
  permittedGitActionTypes,
};
