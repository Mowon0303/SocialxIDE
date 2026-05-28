const fs = require('node:fs');
const path = require('node:path');
const {
  validateDogfoodLog,
} = require('./dogfood-checklist.cjs');
const {
  notarizationCredentialSet,
  stapledNotarizationEvidence,
} = require('./notarization-policy.cjs');
const { releaseArtifactForManifest } = require('./release-artifact-policy.cjs');
const {
  releaseManifestPath,
  validateReleaseManifest,
} = require('./release-manifest-policy.cjs');
const { releaseSourceFreshness } = require('./release-freshness-policy.cjs');

const rootDir = path.resolve(__dirname, '..');
const releaseDir = path.join(rootDir, 'release');
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const version = packageJson.version;
const platform = process.platform;
const arch = process.arch;
const manifestPath = releaseManifestPath({ rootDir, version, platform, arch });
const macDmgPath = path.join(releaseDir, `Codeyo-${version}-arm64.dmg`);
const readinessPath = path.join(releaseDir, `Codeyo-${version}-v0.1-readiness.json`);
const releaseArtifactEvidence = releaseArtifactForManifest({
  manifestPath,
  rootDir,
  packageJson,
  platform,
  arch,
});

const localChecks = [
  currentPlatformManifestCheck(),
  releaseFreshnessCheck(),
  platformPackageCheck(),
];

const externalChecks = [
  notarizationCheck(),
  windowsInstallCheck(),
  dogfoodCheck(releaseArtifactEvidence.artifact),
];

const report = {
  productName: packageJson.build.productName,
  appId: packageJson.build.appId,
  version,
  generatedAt: new Date().toISOString(),
  hostPlatform: platform,
  hostArch: arch,
  localAutomationPassed: localChecks.every((check) => check.status === 'pass'),
  publicReleaseReady: [...localChecks, ...externalChecks].every((check) => check.status === 'pass'),
  releaseArtifactStatus: {
    status: releaseArtifactEvidence.status,
    detail: releaseArtifactEvidence.detail,
  },
  releaseArtifact: releaseArtifactEvidence.artifact,
  checks: {
    local: localChecks,
    external: externalChecks,
  },
};

report.blockers = [...localChecks, ...externalChecks]
  .filter((check) => check.status !== 'pass')
  .map((check) => ({
    id: check.id,
    label: check.label,
    status: check.status,
    detail: check.detail,
  }));

fs.mkdirSync(releaseDir, { recursive: true });
fs.writeFileSync(readinessPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(`Wrote v0.1 readiness report: ${readinessPath}`);
console.log(`- local automation: ${report.localAutomationPassed ? 'pass' : 'blocked'}`);
console.log(`- public release readiness: ${report.publicReleaseReady ? 'pass' : 'blocked'}`);
for (const blocker of report.blockers) {
  console.log(`- ${blocker.label}: ${blocker.detail}`);
}

if (!report.publicReleaseReady && process.env.CODEYO_REQUIRE_RELEASE_READY === '1') {
  console.error('Public release readiness is blocked.');
  process.exit(1);
}

function currentPlatformManifestCheck() {
  const result = validateManifestFile({
    manifestPath,
    platform,
    arch,
    id: 'current-platform-manifest',
    label: 'Current platform release manifest',
  });
  if (result.status !== 'pass') {
    return result;
  }
  return pass(
    'current-platform-manifest',
    'Current platform release manifest',
    `${result.manifest.artifacts.length} artifact(s) verified`,
  );
}

function platformPackageCheck() {
  const result = validateManifestFile({
    manifestPath,
    platform,
    arch,
    id: 'current-platform-package',
    label: 'Current platform package evidence',
  });
  if (result.status !== 'pass') {
    return result;
  }
  return pass(
    'current-platform-package',
    'Current platform package evidence',
    `${platform}/${arch} package verification recorded`,
  );
}

function releaseFreshnessCheck() {
  const result = releaseSourceFreshness({ rootDir, manifestPath });
  if (!result.ok) {
    return blocked('release-manifest-freshness', 'Release manifest freshness', result.detail);
  }
  return pass('release-manifest-freshness', 'Release manifest freshness', result.detail);
}

function notarizationCheck() {
  if (platform !== 'darwin') {
    return pending(
      'macos-notarization',
      'macOS public notarization',
      'run this check on macOS with Apple notarization credentials before public distribution',
    );
  }

  const credentialSet = notarizationCredentialSet();
  const evidence = stapledNotarizationEvidence(macDmgPath);
  if (evidence.ok) {
    const credentialDetail = credentialSet ? `credential set detected: ${credentialSet.name}; ` : '';
    return pass('macos-notarization', 'macOS public notarization', `${credentialDetail}${evidence.detail}`);
  }
  if (!credentialSet) {
    return pending(
      'macos-notarization',
      'macOS public notarization',
      'no Apple notarization credential set detected; local personal DMG remains usable',
    );
  }
  return blocked(
    'macos-notarization',
    'macOS public notarization',
    `credential set detected: ${credentialSet.name}; ${evidence.detail}`,
  );
}

function windowsInstallCheck() {
  const windowsManifestPath = releaseManifestPath({ rootDir, version, platform: 'win32', arch: 'x64' });
  if (platform === 'win32') {
    const result = validateManifestFile({
      manifestPath: windowsManifestPath,
      platform: 'win32',
      arch: 'x64',
      id: 'windows-install-e2e',
      label: 'Windows x64 install E2E',
    });
    if (result.status === 'pass') {
      return pass('windows-install-e2e', 'Windows x64 install E2E', 'Windows release manifest verified on this host');
    }
    return blocked('windows-install-e2e', 'Windows x64 install E2E', result.detail);
  }

  if (fs.existsSync(windowsManifestPath)) {
    const result = validateManifestFile({
      manifestPath: windowsManifestPath,
      platform: 'win32',
      arch: 'x64',
      id: 'windows-install-e2e',
      label: 'Windows x64 install E2E',
    });
    if (result.status === 'pass') {
      return pass('windows-install-e2e', 'Windows x64 install E2E', 'Windows release manifest verified');
    }
    return blocked('windows-install-e2e', 'Windows x64 install E2E', result.detail);
  }

  return pending(
    'windows-install-e2e',
    'Windows x64 install E2E',
    'pending Windows x64 machine build and smoke verification',
  );
}

function validateManifestFile({ manifestPath: targetManifestPath, platform: targetPlatform, arch: targetArch, id, label }) {
  if (!fs.existsSync(targetManifestPath)) {
    return blocked(id, label, `missing ${path.relative(rootDir, targetManifestPath)}`);
  }

  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(targetManifestPath, 'utf8'));
  } catch (error) {
    return blocked(id, label, error.message);
  }

  const errors = validateReleaseManifest(manifest, {
    rootDir,
    packageJson,
    platform: targetPlatform,
    arch: targetArch,
  });
  if (errors.length > 0) {
    return blocked(id, label, errors.join('; '));
  }

  return {
    ...pass(id, label, `${targetPlatform}/${targetArch} release manifest verified`),
    manifest,
  };
}

function dogfoodCheck(expectedReleaseArtifact) {
  const dogfoodLog = process.env.CODEYO_DOGFOOD_LOG;
  if (dogfoodLog) {
    const absoluteLog = path.resolve(rootDir, dogfoodLog);
    if (!fs.existsSync(absoluteLog) || !fs.statSync(absoluteLog).isFile()) {
      return blocked('real-project-dogfood', 'Real-project dogfood', `dogfood log is missing: ${absoluteLog}`);
    }
    try {
      const log = JSON.parse(fs.readFileSync(absoluteLog, 'utf8'));
      const validation = validateDogfoodLog(log, {
        expectedVersion: version,
        expectedReleaseArtifact,
      });
      if (validation.ok) {
        return pass(
          'real-project-dogfood',
          'Real-project dogfood',
          `${validation.summary}; evidence ${path.relative(rootDir, absoluteLog)}`,
        );
      }
      return blocked(
        'real-project-dogfood',
        'Real-project dogfood',
        `dogfood log is incomplete: ${validation.errors.join('; ')}`,
      );
    } catch (error) {
      return blocked('real-project-dogfood', 'Real-project dogfood', `dogfood log is invalid JSON: ${error.message}`);
    }
  }

  return pending(
    'real-project-dogfood',
    'Real-project dogfood',
    'pending sustained use on a real project; create a template with npm run desktop:dogfood:template, then set CODEYO_DOGFOOD_LOG',
  );
}

function pass(id, label, detail) {
  return { id, label, status: 'pass', detail };
}

function blocked(id, label, detail) {
  return { id, label, status: 'blocked', detail };
}

function pending(id, label, detail) {
  return { id, label, status: 'pending_external', detail };
}
