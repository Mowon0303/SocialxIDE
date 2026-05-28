const path = require('node:path');

const permittedExtensions = new Set([
  '.py', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.md', '.json', '.txt',
  '.ts', '.js', '.html', '.css', '.yaml', '.yml', '.toml', '.ini', '.cfg',
  '.sh', '.bat', '.ps1',
]);

const permittedBasenames = new Set([
  '.editorconfig',
  '.gitignore',
  '.prettierrc',
  'COPYING',
  'Containerfile',
  'Dockerfile',
  'LICENSE',
  'LICENCE',
  'Makefile',
  'NOTICE',
  'Procfile',
  'README',
]);

const ignoredDirectories = new Set(['.git', '.codeyo', 'node_modules', 'dist', 'release', '.angular']);

function pathParts(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new Error('Only workspace-relative paths are permitted');
  }
  if (
    /[\x00-\x1F\x7F]/.test(relativePath) ||
    path.isAbsolute(relativePath) ||
    path.posix.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath) ||
    /^[a-zA-Z]:/.test(relativePath)
  ) {
    throw new Error('Only workspace-relative paths are permitted');
  }

  const parts = relativePath.split(/[\\/]+/).filter(Boolean);
  if (
    parts.length === 0 ||
    parts.some((part) => part === '.' || part === '..')
  ) {
    throw new Error('Path leaves the trusted workspace');
  }
  return parts;
}

function normalizedRelativePath(relativePath) {
  return pathParts(relativePath).join(path.sep);
}

function assertEditableRelativePath(relativePath) {
  const parts = pathParts(relativePath);
  for (const part of parts.slice(0, -1)) {
    if (ignoredDirectories.has(part) || part.startsWith('.')) {
      throw new Error('Path is outside Codeyo editable file scope');
    }
  }

  const fileName = parts.at(-1);
  if (ignoredDirectories.has(fileName)) {
    throw new Error('Path is outside Codeyo editable file scope');
  }
  if (fileName.startsWith('.') && !permittedBasenames.has(fileName)) {
    throw new Error('Hidden files are not editable from Codeyo');
  }
  if (!permittedBasenames.has(fileName) && !permittedExtensions.has(path.extname(fileName).toLowerCase())) {
    throw new Error('File type is not editable from Codeyo');
  }
  return parts.join(path.sep);
}

function isEditableRelativePath(relativePath) {
  try {
    assertEditableRelativePath(relativePath);
    return true;
  } catch {
    return false;
  }
}

function portableEditableRelativePath(relativePath) {
  return assertEditableRelativePath(relativePath).split(path.sep).join('/');
}

module.exports = {
  assertEditableRelativePath,
  isEditableRelativePath,
  ignoredDirectories,
  permittedBasenames,
  normalizedRelativePath,
  portableEditableRelativePath,
  permittedExtensions,
};
