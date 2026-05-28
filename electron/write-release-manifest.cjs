const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  requiredVerificationEntries,
  sha256File,
  verificationReceiptBinding,
} = require('./release-manifest-policy.cjs');

const rootDir = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const releaseDir = path.join(rootDir, 'release');
const version = packageJson.version;
const platform = process.platform;
const arch = process.arch;

const manifest = {
  productName: packageJson.build.productName,
  appId: packageJson.build.appId,
  version,
  platform,
  arch,
  generatedAt: new Date().toISOString(),
  host: os.hostname(),
  node: process.version,
  artifacts: platformArtifacts(),
  verification: verificationSummary(),
  verificationReceipt: verificationReceiptBinding({ rootDir, packageJson, platform, arch }),
};

fs.mkdirSync(releaseDir, { recursive: true });
const manifestPath = path.join(releaseDir, `Codeyo-${version}-${platform}-${arch}.manifest.json`);
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Wrote release manifest: ${manifestPath}`);
for (const artifact of manifest.artifacts) {
  console.log(`- ${artifact.label}: ${artifact.relativePath} (${artifact.bytes} bytes, sha256 ${artifact.sha256})`);
}
console.log(`- release verification receipt: ${manifest.verificationReceipt.relativePath} (${manifest.verificationReceipt.bytes} bytes, sha256 ${manifest.verificationReceipt.sha256})`);

function platformArtifacts() {
  if (platform === 'darwin') {
    return [
      artifact('macOS DMG', path.join(releaseDir, `Codeyo-${version}-arm64.dmg`)),
      artifact('macOS app executable', path.join(releaseDir, 'mac-arm64', 'Codeyo.app', 'Contents', 'MacOS', 'Codeyo')),
      artifact('macOS app icon', path.join(releaseDir, 'mac-arm64', 'Codeyo.app', 'Contents', 'Resources', 'icon.icns')),
      artifact('macOS node-pty native module', path.join(
        releaseDir,
        'mac-arm64',
        'Codeyo.app',
        'Contents',
        'Resources',
        'app.asar.unpacked',
        'node_modules',
        'node-pty',
        'build',
        'Release',
        'pty.node',
      )),
    ];
  }
  if (platform === 'win32') {
    const installer = findWindowsInstaller();
    return [
      artifact('Windows NSIS installer', installer),
      artifact('Windows app executable', path.join(releaseDir, 'win-unpacked', 'Codeyo.exe')),
      artifact('Windows app.asar', path.join(releaseDir, 'win-unpacked', 'resources', 'app.asar')),
      artifact('Windows node-pty native module', path.join(
        releaseDir,
        'win-unpacked',
        'resources',
        'app.asar.unpacked',
        'node_modules',
        'node-pty',
        'build',
        'Release',
        'pty.node',
      )),
    ];
  }
  return [];
}

function findWindowsInstaller() {
  const candidates = fs.readdirSync(releaseDir)
    .filter((name) => name.toLowerCase().endsWith('.exe'))
    .filter((name) => name.toLowerCase().includes('codeyo'))
    .map((name) => path.join(releaseDir, name))
    .filter((candidate) => fs.statSync(candidate).isFile())
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
  if (candidates.length === 0) {
    throw new Error(`No Codeyo Windows installer found in ${releaseDir}`);
  }
  return candidates[0];
}

function artifact(label, artifactPath) {
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`${label} is missing: ${artifactPath}`);
  }
  const stat = fs.statSync(artifactPath);
  if (!stat.isFile()) {
    throw new Error(`${label} is not a file: ${artifactPath}`);
  }
  return {
    label,
    relativePath: path.relative(rootDir, artifactPath).split(path.sep).join('/'),
    bytes: stat.size,
    sha256: sha256File(artifactPath),
  };
}

function verificationSummary() {
  return requiredVerificationEntries(platform);
}
