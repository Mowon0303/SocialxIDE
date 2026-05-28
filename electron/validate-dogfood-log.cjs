const fs = require('node:fs');
const path = require('node:path');
const {
  validateDogfoodLog,
} = require('./dogfood-checklist.cjs');
const { releaseArtifactForManifest } = require('./release-artifact-policy.cjs');
const {
  releaseManifestPath,
} = require('./release-manifest-policy.cjs');

const rootDir = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const manifestPath = releaseManifestPath({
  rootDir,
  version: packageJson.version,
  platform: process.platform,
  arch: process.arch,
});
const args = process.argv.slice(2);
const help = args.includes('--help') || args.includes('-h');
const inputArg = args.find((arg) => !arg.startsWith('--'));

if (help || !inputArg) {
  console.log('Usage: node electron/validate-dogfood-log.cjs <dogfood-log.json>');
  console.log(`Validates dogfood evidence for Codeyo ${packageJson.version}.`);
  process.exit(help ? 0 : 1);
}

const inputPath = path.resolve(process.cwd(), inputArg);
if (!fs.existsSync(inputPath) || !fs.statSync(inputPath).isFile()) {
  fail(`dogfood log is missing: ${inputPath}`);
}

let log = null;
try {
  log = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
} catch (error) {
  fail(`dogfood log is invalid JSON: ${error.message}`);
}

const result = validateDogfoodLog(log, {
  expectedVersion: packageJson.version,
  expectedReleaseArtifact: releaseArtifactForManifest({
    manifestPath,
    rootDir,
    packageJson,
    platform: process.platform,
    arch: process.arch,
  }).artifact,
});
if (!result.ok) {
  console.error(`Dogfood evidence is incomplete for Codeyo ${packageJson.version}.`);
  for (const error of result.errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Dogfood evidence valid for Codeyo ${packageJson.version}.`);
console.log(`- ${result.summary}`);
console.log(`- file: ${inputPath}`);
console.log(`- artifact binding: ${bindingSummary(log.releaseArtifact.artifactPath, log.releaseArtifact.artifactSha256)}`);
console.log(`- manifest binding: ${bindingSummary(log.releaseArtifact.manifestPath, log.releaseArtifact.manifestSha256)}`);
console.log(`- receipt binding: ${bindingSummary(log.releaseArtifact.verificationReceiptPath, log.releaseArtifact.verificationReceiptSha256)}`);

function fail(message) {
  console.error(`Dogfood evidence validation failed: ${message}`);
  process.exit(1);
}

function bindingSummary(filePath, sha256) {
  const safePath = typeof filePath === 'string' && filePath.trim() ? filePath.trim() : 'missing-path';
  const safeSha = typeof sha256 === 'string' && /^[a-f0-9]{64}$/i.test(sha256)
    ? sha256.slice(0, 12)
    : 'missing-sha';
  return `${safePath} (${safeSha})`;
}
