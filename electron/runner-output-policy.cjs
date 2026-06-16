const runToolOutputBufferBytes = 576 * 1024;
const runOutputTruncatedMessage = 'EXECUTION OUTPUT EXCEEDED CODEYO CAPTURE LIMIT.';
// Strips ANSI/CSI escape sequences so diagnostic parsing survives colored
// runtime output (Python 3.13+ and clang colorize tracebacks/errors when
// FORCE_COLOR is inherited from the launching process, even on a pipe).
// eslint-disable-next-line no-control-regex
const ansiEscapePattern = /\x1b\[[0-9;:<=>?]*[ -/]*[@-~]/g;

function stripRunOutputAnsi(output) {
  return typeof output === 'string' ? output.replace(ansiEscapePattern, '') : '';
}

function appendRunOutputTruncatedNotice(stderr) {
  const text = typeof stderr === 'string' ? stderr : '';
  if (text.includes(runOutputTruncatedMessage)) {
    return text;
  }
  return `${text}${text && !text.endsWith('\n') ? '\n' : ''}${runOutputTruncatedMessage}\n`;
}

function appendRunOutputTruncatedDiagnostic(diagnostics, entryFile) {
  const list = Array.isArray(diagnostics) ? diagnostics : [];
  if (list.some((diagnostic) => diagnostic?.message === runOutputTruncatedMessage)) {
    return list;
  }
  list.push({
    path: entryFile,
    line: 1,
    severity: 'error',
    message: runOutputTruncatedMessage,
  });
  return list;
}

module.exports = {
  appendRunOutputTruncatedDiagnostic,
  appendRunOutputTruncatedNotice,
  runOutputTruncatedMessage,
  runToolOutputBufferBytes,
  stripRunOutputAnsi,
};
