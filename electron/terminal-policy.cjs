const maxTerminalSessionsPerWorkspace = 8;
const maxTerminalBufferChars = 200000;
const maxTerminalInputChars = 64 * 1024;
const permittedUnixShellBasenames = new Set(['bash', 'fish', 'sh', 'zsh']);

function resolveTerminalShell(env = process.env, platform = process.platform) {
  if (platform === 'win32') {
    return { command: 'powershell.exe', args: ['-NoLogo'] };
  }
  const candidate = typeof env?.SHELL === 'string' ? env.SHELL.trim() : '';
  if (
    candidate.startsWith('/') &&
    !/[\0\r\n]/.test(candidate) &&
    permittedUnixShellBasenames.has(candidate.split('/').at(-1))
  ) {
    return { command: candidate, args: ['-l'] };
  }
  return { command: platform === 'darwin' ? '/bin/zsh' : '/bin/sh', args: ['-l'] };
}

function sanitizeTerminalTitle(title) {
  const value = typeof title === 'string' ? title.trim() : '';
  const safe = value
    .replace(/[\0\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (safe || 'Shell').slice(0, 40);
}

function sanitizeTerminalInput(data) {
  if (typeof data !== 'string') {
    throw new Error('Terminal input must be text');
  }
  return data.slice(0, maxTerminalInputChars);
}

function boundedTerminalBuffer(buffer, limit = maxTerminalBufferChars) {
  const value = typeof buffer === 'string' ? buffer : '';
  return value.length > limit
    ? value.slice(value.length - limit)
    : value;
}

function clampTerminalSize(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function terminalSessionCount(sessions, workspaceId) {
  let count = 0;
  for (const session of sessions.values()) {
    if (session.workspaceId === workspaceId) {
      count += 1;
    }
  }
  return count;
}

function assertCanCreateTerminalSession(sessions, workspaceId) {
  if (terminalSessionCount(sessions, workspaceId) >= maxTerminalSessionsPerWorkspace) {
    throw new Error(`Terminal session limit reached (${maxTerminalSessionsPerWorkspace})`);
  }
}

module.exports = {
  assertCanCreateTerminalSession,
  boundedTerminalBuffer,
  clampTerminalSize,
  maxTerminalBufferChars,
  maxTerminalInputChars,
  maxTerminalSessionsPerWorkspace,
  resolveTerminalShell,
  sanitizeTerminalInput,
  sanitizeTerminalTitle,
  terminalSessionCount,
};
