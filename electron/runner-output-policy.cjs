const runToolOutputBufferBytes = 576 * 1024;
const runOutputTruncatedMessage = 'EXECUTION OUTPUT EXCEEDED CODEYO CAPTURE LIMIT.';

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
};
