const fs = require('node:fs');
const path = require('node:path');

const defaultReleaseSourcePaths = [
  'package.json',
  'package-lock.json',
  'README.md',
  'angular.json',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.spec.json',
  'src',
  'electron',
  'build',
];

function releaseSourceFreshness({
  rootDir,
  manifestPath,
  sourcePaths = defaultReleaseSourcePaths,
} = {}) {
  if (!rootDir || !manifestPath) {
    return {
      ok: false,
      status: 'blocked',
      detail: 'release freshness check requires rootDir and manifestPath',
    };
  }
  if (!fs.existsSync(manifestPath)) {
    return {
      ok: false,
      status: 'blocked',
      detail: `missing ${relativePosix(rootDir, manifestPath)}`,
    };
  }

  const manifestStat = fs.statSync(manifestPath);
  if (!manifestStat.isFile()) {
    return {
      ok: false,
      status: 'blocked',
      detail: `${relativePosix(rootDir, manifestPath)} is not a file`,
    };
  }

  const newest = newestReleaseInput(rootDir, sourcePaths);
  if (!newest) {
    return {
      ok: false,
      status: 'blocked',
      detail: 'no release source inputs were found',
    };
  }

  if (newest.mtimeMs > manifestStat.mtimeMs) {
    return {
      ok: false,
      status: 'blocked',
      detail: `${newest.relativePath} is newer than ${relativePosix(rootDir, manifestPath)}; rerun npm run desktop:verify:v0.1`,
      newestInput: newest,
      manifestMtimeMs: manifestStat.mtimeMs,
    };
  }

  return {
    ok: true,
    status: 'pass',
    detail: `release manifest is newer than current release inputs; newest input ${newest.relativePath}`,
    newestInput: newest,
    manifestMtimeMs: manifestStat.mtimeMs,
  };
}

function newestReleaseInput(rootDir, sourcePaths = defaultReleaseSourcePaths) {
  let newest = null;
  for (const sourcePath of sourcePaths) {
    const absolutePath = path.join(rootDir, sourcePath);
    const candidate = newestPathMtime(rootDir, absolutePath);
    if (candidate && (!newest || candidate.mtimeMs > newest.mtimeMs)) {
      newest = candidate;
    }
  }
  return newest;
}

function newestPathMtime(rootDir, absolutePath) {
  const stat = safeLstat(absolutePath);
  if (!stat) {
    return null;
  }
  if (stat.isSymbolicLink()) {
    return {
      relativePath: relativePosix(rootDir, absolutePath),
      mtimeMs: stat.mtimeMs,
    };
  }
  if (stat.isDirectory()) {
    let newest = null;
    for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })) {
      const child = path.join(absolutePath, entry.name);
      const candidate = newestPathMtime(rootDir, child);
      if (candidate && (!newest || candidate.mtimeMs > newest.mtimeMs)) {
        newest = candidate;
      }
    }
    return newest;
  }
  if (!stat.isFile()) {
    return null;
  }
  return {
    relativePath: relativePosix(rootDir, absolutePath),
    mtimeMs: stat.mtimeMs,
  };
}

function safeLstat(absolutePath) {
  try {
    return fs.lstatSync(absolutePath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function relativePosix(rootDir, targetPath) {
  return path.relative(rootDir, targetPath).split(path.sep).join('/');
}

module.exports = {
  defaultReleaseSourcePaths,
  newestReleaseInput,
  releaseSourceFreshness,
};
