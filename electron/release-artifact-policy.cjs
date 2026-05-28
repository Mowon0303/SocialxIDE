const fs = require('node:fs');
const path = require('node:path');
const { releaseArtifactFromManifest } = require('./dogfood-checklist.cjs');
const {
  sha256File,
  validateReleaseManifest,
} = require('./release-manifest-policy.cjs');

function releaseArtifactForManifest({
  manifestPath,
  rootDir,
  packageJson,
  platform,
  arch,
} = {}) {
  const relativeManifestPath = relativePosix(rootDir, manifestPath) || 'release manifest';
  if (!manifestPath || !fs.existsSync(manifestPath)) {
    return {
      status: 'missing',
      artifact: null,
      detail: `missing ${relativeManifestPath}`,
    };
  }

  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    return {
      status: 'invalid',
      artifact: null,
      detail: `invalid ${relativeManifestPath}: ${error.message}`,
    };
  }

  const errors = validateReleaseManifest(manifest, {
    rootDir,
    packageJson,
    platform,
    arch,
  });
  if (errors.length > 0) {
    return {
      status: 'invalid',
      artifact: null,
      detail: `invalid ${relativeManifestPath}: ${errors.join('; ')}`,
    };
  }

  return {
    status: 'available',
    artifact: releaseArtifactFromManifest(manifest, {
      manifestPath: relativeManifestPath,
      manifestSha256: sha256File(manifestPath),
    }),
    detail: `${platform}/${arch} release artifact binding available`,
  };
}

function relativePosix(rootDir, targetPath) {
  if (!rootDir || !targetPath) {
    return '';
  }
  return path.relative(rootDir, targetPath).split(path.sep).join('/');
}

module.exports = {
  releaseArtifactForManifest,
};
