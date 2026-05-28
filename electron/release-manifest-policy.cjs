const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function releaseManifestPath({ rootDir, version, platform, arch }) {
  return path.join(rootDir, 'release', `Codeyo-${version}-${platform}-${arch}.manifest.json`);
}

function verificationReceiptRelativePath({ version, platform, arch }) {
  return `release/Codeyo-${version}-${platform}-${arch}.verification.json`;
}

function verificationReceiptPath({ rootDir, version, platform, arch }) {
  return path.join(rootDir, verificationReceiptRelativePath({ version, platform, arch }));
}

function requiredVerificationEntries(platform) {
  const common = [
    'Electron CommonJS syntax checks',
    'Electron backend boundary checks',
    'Local real-project smoke',
    'Angular unit tests',
    'Production web build',
    'Packaged app deep startup smoke',
  ];
  if (platform === 'darwin') {
    return [
      ...common,
      'macOS ARM DMG build',
      'macOS release verification',
      'Mounted DMG app deep startup smoke',
    ];
  }
  if (platform === 'win32') {
    return [
      ...common,
      'Windows x64 NSIS build',
      'Windows release verification',
      'Windows installer install/run/uninstall smoke',
    ];
  }
  return common.slice(0, -1);
}

function platformVerificationEntry(platform) {
  if (platform === 'darwin') {
    return 'macOS release verification';
  }
  if (platform === 'win32') {
    return 'Windows release verification';
  }
  return 'Platform release verification';
}

function requiredVerificationReceiptChecks(platform) {
  if (platform === 'darwin') {
    return [
      'ElectronAsarIntegrity contains Resources/app.asar hash',
      'hdiutil verify passed',
      'codesign deep strict verification passed',
      'mounted DMG Codeyo.app starts and loads renderer',
      'DMG mounts with Codeyo.app, /Applications link, and launchable app',
    ];
  }
  if (platform === 'win32') {
    return [
      'win-unpacked Codeyo.exe starts and loads renderer',
      'NSIS silent install completed',
      'installed Codeyo.exe starts and loads renderer',
      'NSIS silent uninstall completed',
      'NSIS installer installs, installed app starts, and uninstaller removes executable',
    ];
  }
  return [];
}

function requiredArtifactLabels(platform) {
  return requiredArtifactSpecs(platform).map((artifact) => artifact.label);
}

function requiredArtifactSpecs(platform, { version = '' } = {}) {
  if (platform === 'darwin') {
    return [
      {
        label: 'macOS DMG',
        relativePath: `release/Codeyo-${version}-arm64.dmg`,
        minBytes: 50 * 1024 * 1024,
      },
      {
        label: 'macOS app executable',
        relativePath: 'release/mac-arm64/Codeyo.app/Contents/MacOS/Codeyo',
        minBytes: 1024,
      },
      {
        label: 'macOS app icon',
        relativePath: 'release/mac-arm64/Codeyo.app/Contents/Resources/icon.icns',
        minBytes: 1024,
      },
      {
        label: 'macOS node-pty native module',
        relativePath: 'release/mac-arm64/Codeyo.app/Contents/Resources/app.asar.unpacked/node_modules/node-pty/build/Release/pty.node',
        minBytes: 1024,
      },
    ];
  }
  if (platform === 'win32') {
    return [
      {
        label: 'Windows NSIS installer',
        pathPattern: /^release\/.*codeyo.*\.exe$/i,
        minBytes: 50 * 1024 * 1024,
      },
      {
        label: 'Windows app executable',
        relativePath: 'release/win-unpacked/Codeyo.exe',
        minBytes: 1024 * 1024,
      },
      {
        label: 'Windows app.asar',
        relativePath: 'release/win-unpacked/resources/app.asar',
        minBytes: 1024 * 1024,
      },
      {
        label: 'Windows node-pty native module',
        relativePath: 'release/win-unpacked/resources/app.asar.unpacked/node_modules/node-pty/build/Release/pty.node',
        minBytes: 1024,
      },
    ];
  }
  return [];
}

function validateReleaseManifest(manifest, {
  rootDir,
  packageJson,
  platform,
  arch,
  requireVerification = true,
} = {}) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['manifest must be an object'];
  }
  if (!rootDir || !packageJson || !platform || !arch) {
    return ['release manifest validation requires rootDir, packageJson, platform, and arch'];
  }

  const expected = {
    productName: packageJson.build?.productName,
    appId: packageJson.build?.appId,
    version: packageJson.version,
    platform,
    arch,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (manifest[key] !== value) {
      errors.push(`${key} expected ${JSON.stringify(value)}, got ${JSON.stringify(manifest[key])}`);
    }
  }

  validateManifestArtifacts(manifest.artifacts, rootDir, platform, packageJson.version, errors);
  validateManifestVerification(manifest.verification, platform, requireVerification, errors);
  validateManifestVerificationReceipt(manifest.verificationReceipt, rootDir, packageJson, platform, arch, errors);
  return errors;
}

function validateManifestArtifacts(artifacts, rootDir, platform, version, errors) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    errors.push('manifest has no artifacts');
    return;
  }

  const releaseRoot = path.join(rootDir, 'release');
  const seenPaths = new Set();
  const seenLabels = new Set();
  for (const artifact of artifacts) {
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
      errors.push('manifest contains an invalid artifact entry');
      continue;
    }
    if (typeof artifact.label !== 'string' || !artifact.label.trim()) {
      errors.push('manifest artifact is missing label');
    } else if (seenLabels.has(artifact.label)) {
      errors.push(`duplicate artifact label in manifest: ${artifact.label}`);
    } else {
      seenLabels.add(artifact.label);
    }
    if (typeof artifact.relativePath !== 'string' || !artifact.relativePath.trim()) {
      errors.push(`${artifact.label || 'artifact'} is missing relativePath`);
      continue;
    }
    if (seenPaths.has(artifact.relativePath)) {
      errors.push(`duplicate artifact path in manifest: ${artifact.relativePath}`);
      continue;
    }
    seenPaths.add(artifact.relativePath);
    if (typeof artifact.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(artifact.sha256)) {
      errors.push(`${artifact.label || artifact.relativePath} has invalid sha256`);
    }
    if (!Number.isInteger(artifact.bytes) || artifact.bytes <= 0) {
      errors.push(`${artifact.label || artifact.relativePath} has invalid byte size`);
    }

    const artifactPath = path.resolve(rootDir, artifact.relativePath);
    if (artifactPath !== releaseRoot && !artifactPath.startsWith(`${releaseRoot}${path.sep}`)) {
      errors.push(`${artifact.label || artifact.relativePath} points outside release/: ${artifact.relativePath}`);
      continue;
    }
    if (!fs.existsSync(artifactPath)) {
      errors.push(`${artifact.label || artifact.relativePath} is missing on disk: ${artifact.relativePath}`);
      continue;
    }
    const stat = fs.statSync(artifactPath);
    if (!stat.isFile()) {
      errors.push(`${artifact.label || artifact.relativePath} is not a file: ${artifact.relativePath}`);
      continue;
    }
    if (Number.isInteger(artifact.bytes) && stat.size !== artifact.bytes) {
      errors.push(`${artifact.label || artifact.relativePath} byte size expected ${artifact.bytes}, got ${stat.size}`);
    }
    if (typeof artifact.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(artifact.sha256)) {
      const actualHash = sha256File(artifactPath);
      if (artifact.sha256.toLowerCase() !== actualHash) {
        errors.push(`${artifact.label || artifact.relativePath} sha256 expected ${artifact.sha256}, got ${actualHash}`);
      }
    }
  }

  const requiredArtifacts = requiredArtifactSpecs(platform, { version });
  const missingLabels = requiredArtifacts.map((artifact) => artifact.label).filter((label) => !seenLabels.has(label));
  if (missingLabels.length > 0) {
    errors.push(`manifest missing artifact labels: ${missingLabels.join(', ')}`);
  }
  for (const spec of requiredArtifacts) {
    const artifact = artifacts.find((item) => item?.label === spec.label);
    if (!artifact) {
      continue;
    }
    const pathError = requiredArtifactPathError(spec, artifact.relativePath);
    if (pathError) {
      errors.push(pathError);
    }
    if (Number.isInteger(artifact.bytes) && artifact.bytes < spec.minBytes) {
      errors.push(`${spec.label} must be at least ${spec.minBytes} bytes`);
    }
  }
}

function validateManifestVerification(verification, platform, requireVerification, errors) {
  if (!Array.isArray(verification) || verification.length === 0) {
    errors.push('manifest has no verification entries');
    return;
  }
  if (!requireVerification) {
    return;
  }
  const missing = requiredVerificationEntries(platform)
    .filter((entry) => !verification.includes(entry));
  if (missing.length > 0) {
    errors.push(`manifest missing verification entries: ${missing.join(', ')}`);
  }
}

function validateManifestVerificationReceipt(receipt, rootDir, packageJson, platform, arch, errors) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    errors.push('manifest verificationReceipt must be an object');
    return;
  }
  const expectedRelativePath = verificationReceiptRelativePath({
    version: packageJson.version,
    platform,
    arch,
  });
  if (receipt.relativePath !== expectedRelativePath) {
    errors.push(`verificationReceipt path expected ${expectedRelativePath}, got ${JSON.stringify(receipt.relativePath)}`);
  }
  if (!Number.isInteger(receipt.bytes) || receipt.bytes <= 0) {
    errors.push('verificationReceipt has invalid byte size');
  }
  if (typeof receipt.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(receipt.sha256)) {
    errors.push('verificationReceipt has invalid sha256');
  }

  const releaseRoot = path.join(rootDir, 'release');
  const receiptPath = path.resolve(rootDir, typeof receipt.relativePath === 'string' ? receipt.relativePath : '');
  if (receiptPath !== releaseRoot && !receiptPath.startsWith(`${releaseRoot}${path.sep}`)) {
    errors.push(`verificationReceipt points outside release/: ${receipt.relativePath}`);
    return;
  }
  if (!fs.existsSync(receiptPath)) {
    errors.push(`verificationReceipt is missing on disk: ${receipt.relativePath}`);
    return;
  }
  const stat = fs.statSync(receiptPath);
  if (!stat.isFile()) {
    errors.push(`verificationReceipt is not a file: ${receipt.relativePath}`);
    return;
  }
  if (Number.isInteger(receipt.bytes) && stat.size !== receipt.bytes) {
    errors.push(`verificationReceipt byte size expected ${receipt.bytes}, got ${stat.size}`);
  }
  if (typeof receipt.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(receipt.sha256)) {
    const actualHash = sha256File(receiptPath);
    if (receipt.sha256.toLowerCase() !== actualHash) {
      errors.push(`verificationReceipt sha256 expected ${receipt.sha256}, got ${actualHash}`);
    }
  }

  let payload = null;
  try {
    payload = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  } catch (error) {
    errors.push(`verificationReceipt is invalid JSON: ${error.message}`);
    return;
  }
  validateVerificationReceiptPayload(payload, packageJson, platform, arch, errors);
}

function validateVerificationReceiptPayload(payload, packageJson, platform, arch, errors) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    errors.push('verificationReceipt payload must be an object');
    return;
  }
  const expected = {
    productName: packageJson.build?.productName,
    appId: packageJson.build?.appId,
    version: packageJson.version,
    platform,
    arch,
    verificationEntry: platformVerificationEntry(platform),
  };
  for (const [key, value] of Object.entries(expected)) {
    if (payload[key] !== value) {
      errors.push(`verificationReceipt.${key} expected ${JSON.stringify(value)}, got ${JSON.stringify(payload[key])}`);
    }
  }
  if (!payload.generatedAt || Number.isNaN(new Date(payload.generatedAt).getTime())) {
    errors.push('verificationReceipt.generatedAt must be an ISO date-time string');
  }
  if (!Array.isArray(payload.checks) || payload.checks.length === 0) {
    errors.push('verificationReceipt.checks must be a non-empty array');
    return;
  }
  if (!payload.checks.every((check) => typeof check === 'string' && check.trim())) {
    errors.push('verificationReceipt.checks must contain only non-empty strings');
    return;
  }
  const missing = requiredVerificationReceiptChecks(platform)
    .filter((check) => !payload.checks.includes(check));
  if (missing.length > 0) {
    errors.push(`verificationReceipt missing checks: ${missing.join(', ')}`);
  }
}

function writeVerificationReceipt({ rootDir, packageJson, platform, arch, checks }) {
  const receiptPath = verificationReceiptPath({
    rootDir,
    version: packageJson.version,
    platform,
    arch,
  });
  const payload = {
    productName: packageJson.build?.productName,
    appId: packageJson.build?.appId,
    version: packageJson.version,
    platform,
    arch,
    verificationEntry: platformVerificationEntry(platform),
    generatedAt: new Date().toISOString(),
    host: require('node:os').hostname(),
    node: process.version,
    checks: Array.isArray(checks) ? checks.filter((check) => typeof check === 'string' && check.trim()) : [],
  };
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return receiptPath;
}

function verificationReceiptBinding({ rootDir, packageJson, platform, arch }) {
  const receiptPath = verificationReceiptPath({
    rootDir,
    version: packageJson.version,
    platform,
    arch,
  });
  if (!fs.existsSync(receiptPath)) {
    throw new Error(`Release verification receipt is missing: ${receiptPath}`);
  }
  const stat = fs.statSync(receiptPath);
  if (!stat.isFile()) {
    throw new Error(`Release verification receipt is not a file: ${receiptPath}`);
  }
  return {
    relativePath: path.relative(rootDir, receiptPath).split(path.sep).join('/'),
    bytes: stat.size,
    sha256: sha256File(receiptPath),
  };
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) {
        hash.update(buffer.subarray(0, bytesRead));
      }
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function requiredArtifactPathError(spec, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    return '';
  }
  if (spec.relativePath && relativePath !== spec.relativePath) {
    return `${spec.label} path expected ${spec.relativePath}, got ${relativePath}`;
  }
  if (spec.pathPattern && !spec.pathPattern.test(relativePath)) {
    return `${spec.label} path does not match ${spec.pathPattern}`;
  }
  return '';
}

module.exports = {
  platformVerificationEntry,
  requiredArtifactLabels,
  requiredArtifactSpecs,
  releaseManifestPath,
  requiredVerificationReceiptChecks,
  requiredVerificationEntries,
  sha256File,
  validateReleaseManifest,
  verificationReceiptBinding,
  verificationReceiptPath,
  verificationReceiptRelativePath,
  writeVerificationReceipt,
};
