const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createDogfoodTemplate,
  dogfoodChecklist,
  dogfoodProgressReport,
  releaseArtifactFromManifest,
  validateDogfoodLog,
} = require('./dogfood-checklist.cjs');
const {
  notarizationCredentialSet,
  stapledNotarizationEvidence,
} = require('./notarization-policy.cjs');
const {
  requiredArtifactLabels,
  requiredArtifactSpecs,
  requiredVerificationEntries,
  requiredVerificationReceiptChecks,
  sha256File,
  validateReleaseManifest,
  verificationReceiptRelativePath,
} = require('./release-manifest-policy.cjs');
const { releaseSourceFreshness } = require('./release-freshness-policy.cjs');
const {
  findWindowsUninstaller,
  windowsInstallerInstallArgs,
  windowsUninstallerArgs,
} = require('./windows-installer-policy.cjs');
const { releaseArtifactForManifest } = require('./release-artifact-policy.cjs');

test('dogfood template starts incomplete', () => {
  const fixture = createReleaseManifestFixture('darwin', 'arm64');
  const template = createDogfoodTemplate({
    codeyoVersion: '0.1.0',
    releaseArtifact: fixture.releaseArtifact,
  });
  assert.match(template.checklist[0].requirement, /Install and launch/);
  assert.equal(template.releaseArtifact.artifactSha256, fixture.releaseArtifact.artifactSha256);
  assert.equal(template.releaseArtifact.verificationReceiptSha256, fixture.releaseArtifact.verificationReceiptSha256);
  const result = validateDogfoodLog(template, { expectedVersion: '0.1.0' });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /status "pass"/);
  fs.rmSync(fixture.rootDir, { recursive: true, force: true });
});

test('complete dogfood evidence passes structured validation', () => {
  const log = completeDogfoodLog();
  const result = validateDogfoodLog(log, { expectedVersion: '0.1.0' });
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.match(result.summary, /10\/10 checklist/);
});

test('dogfood progress reports incomplete template state without losing release binding', () => {
  const fixture = createReleaseManifestFixture('darwin', 'arm64');
  try {
    const template = createDogfoodTemplate({
      codeyoVersion: '0.1.0',
      releaseArtifact: fixture.releaseArtifact,
    });
    const progress = dogfoodProgressReport(template, {
      expectedVersion: '0.1.0',
      expectedReleaseArtifact: fixture.releaseArtifact,
    });
    assert.equal(progress.ok, false);
    assert.equal(progress.summary.checklistPassed, 0);
    assert.equal(progress.summary.checklistTotal, dogfoodChecklist.length);
    assert.equal(progress.summary.sessionDays, 0);
    assert.equal(progress.summary.sessionMinutes, 0);
    assert.equal(progress.summary.releaseArtifactStatus, 'pass');
    assert.match(progress.checklist[0].issues.join('\n'), /status is "pending"/);
  } finally {
    fs.rmSync(fixture.rootDir, { recursive: true, force: true });
  }
});

test('dogfood progress reports complete evidence totals', () => {
  const log = completeDogfoodLog();
  const progress = dogfoodProgressReport(log, { expectedVersion: '0.1.0' });
  assert.equal(progress.ok, true);
  assert.equal(progress.summary.checklistPassed, dogfoodChecklist.length);
  assert.equal(progress.summary.sessionDays, 2);
  assert.equal(progress.summary.sessionMinutes, 150);
  assert.equal(progress.summary.openBlockers, 0);
  assert.equal(progress.checklist.every((item) => item.status === 'pass'), true);
});

test('dogfood evidence rejects stale app versions', () => {
  const log = completeDogfoodLog();
  log.codeyoVersion = '0.0.0';
  const result = validateDogfoodLog(log, { expectedVersion: '0.1.0' });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /codeyoVersion must be 0\.1\.0/);
});

test('dogfood evidence rejects incomplete sessions', () => {
  const log = completeDogfoodLog();
  log.sessions = [{ date: '2026-05-27', durationMinutes: 30, summary: 'short pass' }];
  const result = validateDogfoodLog(log, { expectedVersion: '0.1.0' });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /at least 2 distinct day/);
  assert.match(result.errors.join('\n'), /at least 120 total minute/);
});

test('dogfood evidence rejects unresolved blockers', () => {
  const log = completeDogfoodLog();
  log.blockers = [{ status: 'open', note: 'save conflict still reproduces' }];
  const result = validateDogfoodLog(log, { expectedVersion: '0.1.0' });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /unresolved blocker/);
});

test('dogfood evidence rejects placeholder checklist notes', () => {
  const log = completeDogfoodLog();
  log.checklist[0].evidence = 'verified';
  const result = validateDogfoodLog(log, { expectedVersion: '0.1.0' });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /placeholder evidence|concrete evidence/);
});

test('dogfood evidence rejects missing release artifact binding', () => {
  const log = completeDogfoodLog();
  delete log.releaseArtifact;
  const result = validateDogfoodLog(log, { expectedVersion: '0.1.0' });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /releaseArtifact must be an object/);
});

test('dogfood evidence rejects a stale release artifact binding', () => {
  const fixture = createReleaseManifestFixture('darwin', 'arm64');
  try {
    const log = completeDogfoodLog();
    const result = validateDogfoodLog(log, {
      expectedVersion: '0.1.0',
      expectedReleaseArtifact: {
        ...fixture.releaseArtifact,
        artifactSha256: 'f'.repeat(64),
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /releaseArtifact\.artifactSha256 must match current release manifest/);
  } finally {
    fs.rmSync(fixture.rootDir, { recursive: true, force: true });
  }
});

test('dogfood evidence rejects a stale release manifest binding', () => {
  const fixture = createReleaseManifestFixture('darwin', 'arm64');
  try {
    const log = completeDogfoodLog();
    const result = validateDogfoodLog(log, {
      expectedVersion: '0.1.0',
      expectedReleaseArtifact: {
        ...fixture.releaseArtifact,
        manifestSha256: 'f'.repeat(64),
        verification: fixture.releaseArtifact.verification.slice(0, -1),
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /releaseArtifact\.manifestSha256 must match current release manifest/);
    assert.match(result.errors.join('\n'), /releaseArtifact\.verification must match current release manifest/);
  } finally {
    fs.rmSync(fixture.rootDir, { recursive: true, force: true });
  }
});

test('dogfood progress surfaces stale release artifact binding', () => {
  const fixture = createReleaseManifestFixture('darwin', 'arm64');
  try {
    const progress = dogfoodProgressReport(completeDogfoodLog(), {
      expectedVersion: '0.1.0',
      expectedReleaseArtifact: {
        ...fixture.releaseArtifact,
        artifactSha256: 'f'.repeat(64),
      },
    });
    assert.equal(progress.ok, false);
    assert.equal(progress.summary.releaseArtifactStatus, 'blocked');
    assert.match(progress.releaseArtifact.issues.join('\n'), /releaseArtifact\.artifactSha256/);
  } finally {
    fs.rmSync(fixture.rootDir, { recursive: true, force: true });
  }
});

test('release manifest policy validates Windows x64 evidence artifacts', () => {
  const fixture = createReleaseManifestFixture('win32', 'x64');
  try {
    assert.deepEqual(requiredArtifactLabels('win32'), [
      'Windows NSIS installer',
      'Windows app executable',
      'Windows app.asar',
      'Windows node-pty native module',
    ]);
    assert.ok(fixture.manifest.verification.includes('Windows installer install/run/uninstall smoke'));
    const errors = validateReleaseManifest(fixture.manifest, {
      rootDir: fixture.rootDir,
      packageJson: fixture.packageJson,
      platform: 'win32',
      arch: 'x64',
    });
    assert.deepEqual(errors, []);
  } finally {
    fs.rmSync(fixture.rootDir, { recursive: true, force: true });
  }
});

test('release manifest policy rejects missing required platform artifacts', () => {
  const fixture = createReleaseManifestFixture('win32', 'x64');
  try {
    fixture.manifest.artifacts = fixture.manifest.artifacts
      .filter((artifact) => artifact.label !== 'Windows node-pty native module');
    const errors = validateReleaseManifest(fixture.manifest, {
      rootDir: fixture.rootDir,
      packageJson: fixture.packageJson,
      platform: 'win32',
      arch: 'x64',
    });
    assert.match(errors.join('\n'), /manifest missing artifact labels: Windows node-pty native module/);
  } finally {
    fs.rmSync(fixture.rootDir, { recursive: true, force: true });
  }
});

test('release manifest policy rejects mislabeled artifact paths and undersized required artifacts', () => {
  const fixture = createReleaseManifestFixture('darwin', 'arm64');
  try {
    const dmg = fixture.manifest.artifacts.find((artifact) => artifact.label === 'macOS DMG');
    dmg.relativePath = 'release/not-the-dmg.txt';
    dmg.bytes = 12;
    const errors = validateReleaseManifest(fixture.manifest, {
      rootDir: fixture.rootDir,
      packageJson: fixture.packageJson,
      platform: 'darwin',
      arch: 'arm64',
    });
    assert.match(errors.join('\n'), /macOS DMG path expected release\/Codeyo-0\.1\.0-arm64\.dmg/);
    assert.match(errors.join('\n'), /macOS DMG must be at least 52428800 bytes/);
  } finally {
    fs.rmSync(fixture.rootDir, { recursive: true, force: true });
  }
});

test('release manifest policy rejects weak Windows handoff evidence', () => {
  const fixture = createReleaseManifestFixture('win32', 'x64');
  try {
    fixture.manifest.verification = fixture.manifest.verification
      .filter((entry) => entry !== 'Windows release verification');
    fixture.manifest.artifacts[0].sha256 = '0'.repeat(64);
    const errors = validateReleaseManifest(fixture.manifest, {
      rootDir: fixture.rootDir,
      packageJson: fixture.packageJson,
      platform: 'win32',
      arch: 'x64',
    });
    assert.match(errors.join('\n'), /Windows release verification/);
    assert.match(errors.join('\n'), /sha256/);
  } finally {
    fs.rmSync(fixture.rootDir, { recursive: true, force: true });
  }
});

test('release manifest policy rejects missing or stale verification receipts', () => {
  const fixture = createReleaseManifestFixture('darwin', 'arm64');
  try {
    const missingReceiptManifest = {
      ...fixture.manifest,
      verificationReceipt: undefined,
    };
    let errors = validateReleaseManifest(missingReceiptManifest, {
      rootDir: fixture.rootDir,
      packageJson: fixture.packageJson,
      platform: 'darwin',
      arch: 'arm64',
    });
    assert.match(errors.join('\n'), /verificationReceipt must be an object/);

    const staleReceiptManifest = {
      ...fixture.manifest,
      verificationReceipt: {
        ...fixture.manifest.verificationReceipt,
        sha256: 'f'.repeat(64),
      },
    };
    errors = validateReleaseManifest(staleReceiptManifest, {
      rootDir: fixture.rootDir,
      packageJson: fixture.packageJson,
      platform: 'darwin',
      arch: 'arm64',
    });
    assert.match(errors.join('\n'), /verificationReceipt sha256/);
  } finally {
    fs.rmSync(fixture.rootDir, { recursive: true, force: true });
  }
});

test('release artifact policy creates an auditable manifest binding', () => {
  const fixture = createReleaseManifestFixture('darwin', 'arm64');
  try {
    const manifestPath = path.join(fixture.rootDir, 'release/Codeyo-0.1.0-darwin-arm64.manifest.json');
    fs.writeFileSync(manifestPath, `${JSON.stringify(fixture.manifest, null, 2)}\n`, 'utf8');
    const result = releaseArtifactForManifest({
      manifestPath,
      rootDir: fixture.rootDir,
      packageJson: fixture.packageJson,
      platform: 'darwin',
      arch: 'arm64',
    });
    assert.equal(result.status, 'available');
    assert.equal(result.artifact.artifactLabel, 'macOS DMG');
    assert.equal(result.artifact.artifactPath, 'release/Codeyo-0.1.0-arm64.dmg');
    assert.equal(result.artifact.manifestPath, 'release/Codeyo-0.1.0-darwin-arm64.manifest.json');
    assert.equal(result.artifact.manifestSha256, sha256File(manifestPath));
    assert.equal(result.artifact.verificationReceiptPath, 'release/Codeyo-0.1.0-darwin-arm64.verification.json');
    assert.equal(result.artifact.verificationReceiptSha256, fixture.manifest.verificationReceipt.sha256);
  } finally {
    fs.rmSync(fixture.rootDir, { recursive: true, force: true });
  }
});

test('dogfood evidence rejects a stale verification receipt binding', () => {
  const fixture = createReleaseManifestFixture('darwin', 'arm64');
  try {
    const log = completeDogfoodLog();
    const result = validateDogfoodLog(log, {
      expectedVersion: '0.1.0',
      expectedReleaseArtifact: {
        ...fixture.releaseArtifact,
        verificationReceiptSha256: 'f'.repeat(64),
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /releaseArtifact\.verificationReceiptSha256 must match current release manifest/);
  } finally {
    fs.rmSync(fixture.rootDir, { recursive: true, force: true });
  }
});

test('release freshness policy rejects manifests older than release inputs', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeyo-release-freshness-'));
  try {
    const sourcePath = path.join(rootDir, 'src/app.ts');
    const manifestPath = path.join(rootDir, 'release/Codeyo-0.1.0-darwin-arm64.manifest.json');
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(sourcePath, 'console.log("source")\n', 'utf8');
    fs.writeFileSync(manifestPath, '{}\n', 'utf8');

    const oldTime = new Date('2026-05-27T10:00:00.000Z');
    const newTime = new Date('2026-05-27T11:00:00.000Z');
    fs.utimesSync(sourcePath, oldTime, newTime);
    fs.utimesSync(manifestPath, oldTime, oldTime);

    const stale = releaseSourceFreshness({
      rootDir,
      manifestPath,
      sourcePaths: ['src'],
    });
    assert.equal(stale.ok, false);
    assert.match(stale.detail, /src\/app\.ts is newer/);

    fs.utimesSync(manifestPath, new Date('2026-05-27T12:00:00.000Z'), new Date('2026-05-27T12:00:00.000Z'));
    const fresh = releaseSourceFreshness({
      rootDir,
      manifestPath,
      sourcePaths: ['src'],
    });
    assert.equal(fresh.ok, true);
    assert.match(fresh.detail, /release manifest is newer/);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('release freshness policy tracks release handoff documentation', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeyo-release-doc-freshness-'));
  try {
    const readmePath = path.join(rootDir, 'README.md');
    const manifestPath = path.join(rootDir, 'release/Codeyo-0.1.0-darwin-arm64.manifest.json');
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(readmePath, 'release handoff instructions\n', 'utf8');
    fs.writeFileSync(manifestPath, '{}\n', 'utf8');

    const oldTime = new Date('2026-05-27T10:00:00.000Z');
    const newTime = new Date('2026-05-27T11:00:00.000Z');
    fs.utimesSync(readmePath, oldTime, newTime);
    fs.utimesSync(manifestPath, oldTime, oldTime);

    const stale = releaseSourceFreshness({ rootDir, manifestPath });
    assert.equal(stale.ok, false);
    assert.match(stale.detail, /README\.md is newer/);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('notarization policy requires a complete credential set', () => {
  assert.equal(notarizationCredentialSet({ APPLE_API_KEY: 'key' }), undefined);
  assert.equal(notarizationCredentialSet({
    APPLE_API_KEY: 'key',
    APPLE_API_KEY_ID: 'id',
    APPLE_API_ISSUER: 'issuer',
  })?.name, 'App Store Connect API key');
});

test('notarization policy accepts stapled DMG evidence', () => {
  const fixture = createArtifactFixture('release/Codeyo-0.1.0-arm64.dmg');
  try {
    const result = stapledNotarizationEvidence(fixture.filePath, {
      platform: 'darwin',
      spawn: fakeSpawn({ status: 0, stdout: 'The validate action worked!\n' }),
    });
    assert.deepEqual(result, {
      ok: true,
      status: 'pass',
      detail: 'xcrun stapler validate passed',
    });
  } finally {
    fs.rmSync(fixture.rootDir, { recursive: true, force: true });
  }
});

test('notarization policy rejects unstapled DMG evidence', () => {
  const fixture = createArtifactFixture('release/Codeyo-0.1.0-arm64.dmg');
  try {
    const result = stapledNotarizationEvidence(fixture.filePath, {
      platform: 'darwin',
      spawn: fakeSpawn({ status: 65, stderr: 'The validate action failed.\n' }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'blocked');
    assert.match(result.detail, /validate action failed/);
  } finally {
    fs.rmSync(fixture.rootDir, { recursive: true, force: true });
  }
});

test('Windows installer policy preserves NSIS silent install conventions', () => {
  assert.deepEqual(
    windowsInstallerInstallArgs('C:\\Temp\\Codeyo'),
    ['/S', '/D=C:\\Temp\\Codeyo'],
  );
  assert.deepEqual(windowsUninstallerArgs(), ['/S']);
});

test('Windows installer policy finds the installed uninstaller', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeyo-win-uninstaller-'));
  try {
    const stale = path.join(rootDir, 'Uninstall Codeyo old.exe');
    const latest = path.join(rootDir, 'Uninstall Codeyo.exe');
    fs.writeFileSync(stale, 'old\n', 'utf8');
    fs.writeFileSync(latest, 'new\n', 'utf8');
    const now = new Date();
    fs.utimesSync(stale, new Date(now.getTime() - 1000), new Date(now.getTime() - 1000));
    fs.utimesSync(latest, now, now);
    assert.equal(findWindowsUninstaller(rootDir), latest);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

console.log('26 release evidence checks passed.');

function completeDogfoodLog() {
  return {
    schema: 'codeyo-dogfood-v1',
    codeyoVersion: '0.1.0',
    releaseArtifact: releaseArtifactFixture('darwin', 'arm64'),
    project: {
      name: 'real-workspace',
      path: '/Users/example/project',
      notes: 'daily IDE dogfood',
    },
    startedAt: '2026-05-27T09:00:00.000Z',
    completedAt: '2026-05-28T12:00:00.000Z',
    sessions: [
      { date: '2026-05-27', durationMinutes: 75, summary: 'edited, ran, committed, and reviewed code' },
      { date: '2026-05-28', durationMinutes: 75, summary: 'reopened workspace and verified persisted state' },
    ],
    checklist: dogfoodChecklist.map((step) => ({
      id: step.id,
      label: step.label,
      status: 'pass',
      evidence: `${step.id}: used /Users/example/project, recorded command output, snapshot id, or commit evidence.`,
    })),
    blockers: [],
  };
}

function createReleaseManifestFixture(platform, arch) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeyo-release-manifest-'));
  const packageJson = {
    version: '0.1.0',
    build: {
      productName: 'Codeyo',
      appId: 'dev.codeyo.editorial',
    },
  };
  const files = platform === 'win32'
    ? [
      ['Windows NSIS installer', 'release/Codeyo Setup 0.1.0.exe'],
      ['Windows app executable', 'release/win-unpacked/Codeyo.exe'],
      ['Windows app.asar', 'release/win-unpacked/resources/app.asar'],
      ['Windows node-pty native module', 'release/win-unpacked/resources/app.asar.unpacked/node_modules/node-pty/build/Release/pty.node'],
    ]
    : [
      ['macOS DMG', 'release/Codeyo-0.1.0-arm64.dmg'],
      ['macOS app executable', 'release/mac-arm64/Codeyo.app/Contents/MacOS/Codeyo'],
      ['macOS app icon', 'release/mac-arm64/Codeyo.app/Contents/Resources/icon.icns'],
      ['macOS node-pty native module', 'release/mac-arm64/Codeyo.app/Contents/Resources/app.asar.unpacked/node_modules/node-pty/build/Release/pty.node'],
    ];
  const artifactSpecs = requiredArtifactSpecs(platform, { version: packageJson.version });
  const artifacts = files.map(([label, relativePath], index) => {
    const filePath = path.join(rootDir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `artifact ${index} ${label}\n`, 'utf8');
    const minBytes = artifactSpecs.find((artifact) => artifact.label === label)?.minBytes || 1;
    fs.truncateSync(filePath, minBytes + index + 1);
    return {
      label,
      relativePath,
      bytes: fs.statSync(filePath).size,
      sha256: sha256File(filePath),
    };
  });
  const manifest = {
    productName: packageJson.build.productName,
    appId: packageJson.build.appId,
    version: packageJson.version,
    platform,
    arch,
    artifacts,
    verification: requiredVerificationEntries(platform),
    verificationReceipt: createVerificationReceiptFixture(rootDir, packageJson, platform, arch),
  };
  return {
    rootDir,
    packageJson,
    manifest,
    releaseArtifact: releaseArtifactFromManifest(manifest, {
      manifestPath: `release/Codeyo-0.1.0-${platform}-${arch}.manifest.json`,
      manifestSha256: 'a'.repeat(64),
    }),
  };
}

function createVerificationReceiptFixture(rootDir, packageJson, platform, arch) {
  const relativePath = verificationReceiptRelativePath({
    version: packageJson.version,
    platform,
    arch,
  });
  const receiptPath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify({
    productName: packageJson.build.productName,
    appId: packageJson.build.appId,
    version: packageJson.version,
    platform,
    arch,
    verificationEntry: platform === 'darwin' ? 'macOS release verification' : 'Windows release verification',
    generatedAt: '2026-05-27T12:00:00.000Z',
    host: 'test-host',
    node: process.version,
    checks: requiredVerificationReceiptChecks(platform),
  }, null, 2)}\n`, 'utf8');
  return {
    relativePath,
    bytes: fs.statSync(receiptPath).size,
    sha256: sha256File(receiptPath),
  };
}

function releaseArtifactFixture(platform, arch) {
  const fixture = createReleaseManifestFixture(platform, arch);
  const releaseArtifact = fixture.releaseArtifact;
  fs.rmSync(fixture.rootDir, { recursive: true, force: true });
  return releaseArtifact;
}

function createArtifactFixture(relativePath) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeyo-artifact-'));
  const filePath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'artifact\n', 'utf8');
  return { rootDir, filePath };
}

function fakeSpawn(result) {
  return (command, args) => {
    assert.equal(command, 'xcrun');
    assert.deepEqual(args.slice(0, 2), ['stapler', 'validate']);
    return {
      stdout: '',
      stderr: '',
      ...result,
    };
  };
}

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}
