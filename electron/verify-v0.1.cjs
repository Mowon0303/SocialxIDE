const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const nodeCommand = process.execPath;

const electronScripts = [
  'after-pack.cjs',
  'app-lifecycle-policy.cjs',
  'check-notarization-evidence.cjs',
  'check-notarization-env.cjs',
  'check-package-platform.cjs',
  'cpp-run-policy.cjs',
  'dogfood-checklist.cjs',
  'dogfood-status.cjs',
  'file-content-policy.cjs',
  'file-operations.cjs',
  'file-write-policy.cjs',
  'generate-icons.cjs',
  'git-action-policy.cjs',
  'git-discard-policy.cjs',
  'gitignore-policy.cjs',
  'git-output-policy.cjs',
  'ipc-trust-policy.cjs',
  'journal-metadata-policy.cjs',
  'main.cjs',
  'path-policy.cjs',
  'preload.cjs',
  'prepare-desktop-build.cjs',
  'notarization-policy.cjs',
  'release-artifact-policy.cjs',
  'release-freshness-policy.cjs',
  'release-manifest-policy.cjs',
  'portable-storage-policy.cjs',
  'security-policy.cjs',
  'smoke-local-project.cjs',
  'smoke-packaged-app.cjs',
  'storage.cjs',
  'runner-input-policy.cjs',
  'runner-output-policy.cjs',
  'runner-temp-policy.cjs',
  'terminal-policy.cjs',
  'test-backend.cjs',
  'test-release-evidence.cjs',
  'tool-command-policy.cjs',
  'validate-dogfood-log.cjs',
  'verify-mac-release.cjs',
  'verify-release-manifest.cjs',
  'verify-v0.1.cjs',
  'verify-win-release.cjs',
  'windows-installer-policy.cjs',
  'workspace-file-listing.cjs',
  'workspace-list-policy.cjs',
  'workspace-path-policy.cjs',
  'workspace-watch-policy.cjs',
  'write-dogfood-log-template.cjs',
  'write-release-readiness.cjs',
  'write-release-manifest.cjs',
];

const steps = [
  {
    name: 'Electron CommonJS syntax checks',
    run: () => {
      for (const script of electronScripts) {
        run(nodeCommand, ['--check', path.join('electron', script)]);
      }
    },
  },
  { name: 'Electron backend boundary checks', run: () => npmRun(['run', 'desktop:test:backend']) },
  { name: 'Local real-project smoke', run: () => npmRun(['run', 'desktop:smoke:local']) },
  { name: 'Angular unit tests', run: () => npmRun(['test', '--', '--watch=false']) },
  { name: 'Production web build', run: () => npmRun(['run', 'build']) },
  ...notarizationPreflightSteps(),
  ...platformReleaseSteps(),
  ...notarizationEvidenceSteps(),
];

console.log(`Codeyo ${packageJson.version} v0.1 verification starting on ${process.platform}/${process.arch}.`);
const started = Date.now();
for (const [index, step] of steps.entries()) {
  const stepStarted = Date.now();
  console.log(`\n[${index + 1}/${steps.length}] ${step.name}`);
  step.run();
  const elapsed = ((Date.now() - stepStarted) / 1000).toFixed(1);
  console.log(`ok - ${step.name} (${elapsed}s)`);
}
const elapsed = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\nCodeyo ${packageJson.version} v0.1 verification passed in ${elapsed}s.`);

function platformReleaseSteps() {
  if (process.platform === 'darwin') {
    return [
      { name: 'macOS ARM DMG build', run: () => npmRun(['run', 'desktop:dist:mac']) },
      { name: 'Packaged app startup smoke', run: () => npmRun(['run', 'desktop:smoke:app']) },
      { name: 'macOS release verification', run: () => npmRun(['run', 'desktop:verify:mac']) },
      { name: 'Release manifest', run: () => npmRun(['run', 'desktop:release:manifest']) },
      { name: 'Release manifest verification', run: () => npmRun(['run', 'desktop:release:verify-manifest']) },
      { name: 'v0.1 readiness report', run: () => npmRun(['run', 'desktop:release:readiness']) },
    ];
  }
  if (process.platform === 'win32') {
    return [
      { name: 'Windows x64 NSIS build', run: () => npmRun(['run', 'desktop:dist:win']) },
      { name: 'Packaged app startup smoke', run: () => npmRun(['run', 'desktop:smoke:app']) },
      { name: 'Windows release verification', run: () => npmRun(['run', 'desktop:verify:win']) },
      { name: 'Release manifest', run: () => npmRun(['run', 'desktop:release:manifest']) },
      { name: 'Release manifest verification', run: () => npmRun(['run', 'desktop:release:verify-manifest']) },
      { name: 'v0.1 readiness report', run: () => npmRun(['run', 'desktop:release:readiness']) },
    ];
  }
  return [];
}

function notarizationPreflightSteps() {
  if (process.platform !== 'darwin' || process.env.CODEYO_REQUIRE_NOTARIZATION !== '1') {
    return [];
  }
  return [
    { name: 'macOS notarization credential preflight', run: () => npmRun(['run', 'desktop:check:notarization']) },
  ];
}

function notarizationEvidenceSteps() {
  if (process.platform !== 'darwin' || process.env.CODEYO_REQUIRE_NOTARIZATION !== '1') {
    return [];
  }
  return [
    { name: 'macOS notarization evidence verification', run: () => npmRun(['run', 'desktop:check:notarization-evidence']) },
  ];
}

function npmRun(args) {
  run(npmCommand, args);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
