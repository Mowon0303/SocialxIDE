const fs = require('node:fs');
const path = require('node:path');
const {
  createDogfoodTemplate,
} = require('./dogfood-checklist.cjs');
const { releaseArtifactForManifest } = require('./release-artifact-policy.cjs');
const {
  releaseManifestPath,
} = require('./release-manifest-policy.cjs');

const rootDir = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const releaseDir = path.join(rootDir, 'release');
const manifestPath = releaseManifestPath({
  rootDir,
  version: packageJson.version,
  platform: process.platform,
  arch: process.arch,
});
const args = process.argv.slice(2);
const force = args.includes('--force');
const outputArg = args.find((arg) => !arg.startsWith('--'));
const outputPath = outputArg
  ? path.resolve(process.cwd(), outputArg)
  : path.join(releaseDir, `Codeyo-${packageJson.version}-dogfood-template.json`);

if (fs.existsSync(outputPath) && !force) {
  console.error(`Dogfood template already exists: ${outputPath}`);
  console.error('Pass --force to overwrite it.');
  process.exit(1);
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const releaseArtifactEvidence = releaseArtifactForManifest({
  manifestPath,
  rootDir,
  packageJson,
  platform: process.platform,
  arch: process.arch,
});
const releaseArtifact = releaseArtifactEvidence.artifact || undefined;
fs.writeFileSync(
  outputPath,
  `${JSON.stringify(createDogfoodTemplate({ codeyoVersion: packageJson.version, releaseArtifact }), null, 2)}\n`,
  'utf8',
);

console.log(`Wrote dogfood evidence template: ${outputPath}`);
if (!releaseArtifact?.artifactSha256) {
  console.log(`- releaseArtifact is blank because ${releaseArtifactEvidence.detail}`);
} else {
  console.log(`- releaseArtifact: ${releaseArtifact.artifactPath} (${releaseArtifact.artifactSha256})`);
}
