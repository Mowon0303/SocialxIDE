const path = require('node:path');

const shellMetacharacters = /[;&|<>`$]/;

function sanitizeToolCheck(tool) {
  const id = typeof tool?.id === 'string' ? tool.id.trim() : '';
  if (!['python', 'cpp', 'git'].includes(id)) {
    throw new Error('Tool check id is not permitted');
  }
  return {
    id,
    label: sanitizeTextField(tool.label, id, 80),
    command: sanitizeToolCommand(tool.command, ''),
  };
}

function sanitizeToolCommand(command, fallback) {
  const value = typeof command === 'string' && command.trim() ? command.trim() : fallback;
  if (!value) {
    throw new Error('Tool command is not configured');
  }
  if (/[\x00-\x1F\x7F]/.test(value)) {
    throw new Error('Tool command contains unsupported control characters');
  }
  if (shellMetacharacters.test(value)) {
    throw new Error('Tool command contains shell metacharacters');
  }
  if (value.startsWith('-')) {
    throw new Error('Tool command must be an executable name or path, not an option');
  }
  if (Buffer.byteLength(value, 'utf8') > 512) {
    throw new Error('Tool command is too long');
  }
  const hasWhitespace = /\s/.test(value);
  const absolutePath = path.isAbsolute(value) || path.win32.isAbsolute(value);
  if (hasWhitespace && !absolutePath) {
    throw new Error('Tool command must be a command name or executable path without inline arguments');
  }
  if (!absolutePath) {
    const parts = value.split(/[\\/]+/).filter(Boolean);
    if (parts.some((part) => part === '..')) {
      throw new Error('Tool command path cannot traverse directories');
    }
  }
  return value;
}

function sanitizeRunArgs(args, label) {
  if (args === undefined || args === null) {
    return undefined;
  }
  if (!Array.isArray(args)) {
    throw new Error(`${label} must be an array`);
  }
  if (args.length > 64) {
    throw new Error(`${label} limit exceeded`);
  }
  const safe = args.map((arg) => {
    if (typeof arg !== 'string') {
      throw new Error(`${label} must contain text values`);
    }
    const value = arg.trim();
    if (!value) {
      return null;
    }
    if (/[\x00-\x1F\x7F]/.test(value)) {
      throw new Error(`${label} contain unsupported control characters`);
    }
    if (Buffer.byteLength(value, 'utf8') > 512) {
      throw new Error(`${label} value is too long`);
    }
    return value;
  }).filter(Boolean);
  return safe.length > 0 ? safe : undefined;
}

function sanitizeTextField(value, fallback, maxLength) {
  const text = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  if (/[\x00-\x1F\x7F]/.test(text)) {
    throw new Error('Text field contains unsupported control characters');
  }
  return text.slice(0, maxLength);
}

module.exports = {
  sanitizeRunArgs,
  sanitizeTextField,
  sanitizeToolCheck,
  sanitizeToolCommand,
};
