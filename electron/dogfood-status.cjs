const fs = require('node:fs');
const path = require('node:path');
const {
  dogfoodProgressReport,
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
const releaseDir = path.join(rootDir, 'release');
const defaultLogPath = process.env.CODEYO_DOGFOOD_LOG
  ? path.resolve(rootDir, process.env.CODEYO_DOGFOOD_LOG)
  : path.join(releaseDir, `Codeyo-${packageJson.version}-dogfood-template.json`);
const args = process.argv.slice(2);
const help = args.includes('--help') || args.includes('-h');
const requireComplete = args.includes('--require-complete');
const inputArg = args.find((arg) => !arg.startsWith('--'));

if (help) {
  console.log('Usage: node electron/dogfood-status.cjs [dogfood-log.json] [--require-complete]');
  console.log(`Shows dogfood progress for Codeyo ${packageJson.version}.`);
  console.log('If no file is passed, uses CODEYO_DOGFOOD_LOG or the release dogfood template.');
  process.exit(0);
}

const inputPath = inputArg ? path.resolve(process.cwd(), inputArg) : defaultLogPath;
if (!fs.existsSync(inputPath) || !fs.statSync(inputPath).isFile()) {
  console.error(`Dogfood log is missing: ${inputPath}`);
  console.error('Create one with npm run desktop:dogfood:template -- --force.');
  process.exit(1);
}

let log = null;
try {
  log = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
} catch (error) {
  console.error(`Dogfood log is invalid JSON: ${error.message}`);
  process.exit(1);
}

const releaseArtifactEvidence = releaseArtifactForManifest({
  manifestPath,
  rootDir,
  packageJson,
  platform: process.platform,
  arch: process.arch,
});
const progress = dogfoodProgressReport(log, {
  expectedVersion: packageJson.version,
  expectedReleaseArtifact: releaseArtifactEvidence.artifact,
});
const releaseArtifact = log.releaseArtifact && typeof log.releaseArtifact === 'object' && !Array.isArray(log.releaseArtifact)
  ? log.releaseArtifact
  : {};

console.log(`Dogfood progress for Codeyo ${packageJson.version}`);
console.log(`- file: ${inputPath}`);
console.log(`- status: ${progress.ok ? 'complete' : 'incomplete'}`);
console.log(
  `- sessions: ${progress.summary.sessionDays}/${progress.summary.requiredDays} day(s), `
  + `${progress.summary.sessionMinutes}/${progress.summary.requiredMinutes} minute(s)`,
);
console.log(`- checklist: ${progress.summary.checklistPassed}/${progress.summary.checklistTotal} passed`);
console.log(`- release artifact: ${progress.summary.releaseArtifactStatus}`);
console.log(`- artifact binding: ${bindingSummary(releaseArtifact.artifactPath, releaseArtifact.artifactSha256)}`);
console.log(`- manifest binding: ${bindingSummary(releaseArtifact.manifestPath, releaseArtifact.manifestSha256)}`);
console.log(`- receipt binding: ${bindingSummary(releaseArtifact.verificationReceiptPath, releaseArtifact.verificationReceiptSha256)}`);
console.log(`- blockers: ${progress.summary.openBlockers} open`);

const pendingChecklist = progress.checklist.filter((item) => item.status !== 'pass');
if (pendingChecklist.length > 0) {
  console.log('\nPending checklist:');
  for (const item of pendingChecklist) {
    console.log(`- ${item.id}: ${item.issues.join('; ')}`);
  }
}

const supportingIssues = [
  ...progress.project.issues,
  ...progress.dates.issues,
  ...progress.sessions.issues,
  ...progress.releaseArtifact.issues,
  ...progress.blockers.issues,
];
if (supportingIssues.length > 0) {
  console.log('\nSupporting evidence to fix:');
  for (const issue of supportingIssues) {
    console.log(`- ${issue}`);
  }
}

if (requireComplete && !progress.ok) {
  process.exit(1);
}

function bindingSummary(filePath, sha256) {
  const safePath = typeof filePath === 'string' && filePath.trim() ? filePath.trim() : 'missing-path';
  const safeSha = typeof sha256 === 'string' && /^[a-f0-9]{64}$/i.test(sha256)
    ? sha256.slice(0, 12)
    : 'missing-sha';
  return `${safePath} (${safeSha})`;
}
