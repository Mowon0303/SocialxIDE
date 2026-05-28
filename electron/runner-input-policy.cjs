const { portableEditableRelativePath } = require('./path-policy.cjs');

function runInputFailureResult(profile, inputPaths, error, startedAt, elapsedMs) {
  const message = sanitizeRunFailureMessage(error?.message || 'RUN INPUT COULD NOT BE READ');
  const path = safeDiagnosticPath(error?.filePath) || safeDiagnosticPath(inputPaths?.[0]) || profile.entryFile;
  return {
    profileId: profile.id,
    profileName: profile.name,
    entryFile: profile.entryFile,
    inputs: [],
    exitCode: 1,
    stdout: '',
    stderr: `${message}\n`,
    elapsedMs: Math.max(0, Number(elapsedMs) || 0),
    startedAt,
    diagnostics: [{
      path,
      line: 1,
      severity: 'error',
      message,
    }],
  };
}

function runInputReadError(filePath, error) {
  const safePath = safeDiagnosticPath(filePath) || 'workspace file';
  const reason = error?.code === 'ENOENT'
    ? 'NOT FOUND'
    : sanitizeRunFailureMessage(error?.message || 'COULD NOT BE READ');
  const failure = new Error(`RUN INPUT ${reason} · ${safePath}`);
  failure.code = 'CODEYO_RUN_INPUT';
  failure.filePath = safePath;
  return failure;
}

function sanitizeRunFailureMessage(message) {
  const text = typeof message === 'string' && message.trim()
    ? message.trim()
    : 'RUN INPUT COULD NOT BE READ';
  return text.replace(/[\x00-\x1F\x7F]/g, ' ').replace(/\s+/g, ' ').slice(0, 500);
}

function safeDiagnosticPath(filePath) {
  try {
    return portableEditableRelativePath(filePath);
  } catch {
    return '';
  }
}

module.exports = {
  runInputFailureResult,
  runInputReadError,
  sanitizeRunFailureMessage,
};
