const fs = require('node:fs');
const path = require('node:path');
const {
  releaseManifestPath,
  validateReleaseManifest,
} = require('./release-manifest-policy.cjs');

const rootDir = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const manifestPath = releaseManifestPath({
  rootDir,
  version: packageJson.version,
  platform: process.platform,
  arch: process.arch,
});

if (!fs.existsSync(manifestPath)) {
  fail(`Release manifest is missing: ${manifestPath}`);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const errors = validateReleaseManifest(manifest, {
  rootDir,
  packageJson,
  platform: process.platform,
  arch: process.arch,
});
if (errors.length > 0) {
  fail(errors.join('\n- '));
}

console.log(`Release manifest verified: ${manifestPath}`);
for (const artifact of manifest.artifacts) {
  console.log(`- ${artifact.label}: ${artifact.relativePath} (${artifact.bytes} bytes, sha256 ${artifact.sha256})`);
}
console.log(`- release verification receipt: ${manifest.verificationReceipt.relativePath} (${manifest.verificationReceipt.bytes} bytes, sha256 ${manifest.verificationReceipt.sha256})`);

function fail(message) {
  console.error(`Release manifest verification failed: ${message}`);
  process.exit(1);
}
