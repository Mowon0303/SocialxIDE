const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const {
  writeVerificationReceipt,
} = require('./release-manifest-policy.cjs');

const rootDir = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const version = packageJson.version;
const releaseDir = path.join(rootDir, 'release');
const dmgPath = path.join(releaseDir, `Codeyo-${version}-arm64.dmg`);
const appPath = path.join(releaseDir, 'mac-arm64', 'Codeyo.app');
const infoPath = path.join(appPath, 'Contents', 'Info.plist');
const resourceDir = path.join(appPath, 'Contents', 'Resources');
const iconPath = path.join(resourceDir, 'icon.icns');
const ptyPath = path.join(
  resourceDir,
  'app.asar.unpacked',
  'node_modules',
  'node-pty',
  'build',
  'Release',
  'pty.node',
);

if (process.platform !== 'darwin') {
  fail('macOS release verification must run on macOS.');
}

const checks = [];
verifyFile(dmgPath, 'DMG', 50 * 1024 * 1024);
verifyDirectory(appPath, 'app bundle');
verifyFile(infoPath, 'Info.plist', 1024);
verifyFile(iconPath, 'app icon', 1024);
verifyFile(ptyPath, 'node-pty native module', 1024);

const info = readPlistJson(infoPath);
assertEqual(info.CFBundleShortVersionString, version, 'CFBundleShortVersionString');
assertEqual(info.CFBundleVersion, version, 'CFBundleVersion');
assertEqual(info.CFBundleIconFile, 'icon.icns', 'CFBundleIconFile');
assertEqual(info.CFBundleIdentifier, packageJson.build.appId, 'CFBundleIdentifier');
assertEqual(info.NSAppTransportSecurity?.NSAllowsArbitraryLoads, false, 'ATS arbitrary loads');
assertEqual(info.NSAppTransportSecurity?.NSAllowsLocalNetworking, true, 'ATS local networking');

if (!info.ElectronAsarIntegrity?.['Resources/app.asar']?.hash) {
  fail('ElectronAsarIntegrity is missing Resources/app.asar hash.');
}
checks.push('ElectronAsarIntegrity contains Resources/app.asar hash');

run('hdiutil', ['verify', dmgPath]);
checks.push('hdiutil verify passed');

run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
checks.push('codesign deep strict verification passed');

verifyMountedDmg();
const receiptPath = writeVerificationReceipt({
  rootDir,
  packageJson,
  platform: 'darwin',
  arch: 'arm64',
  checks,
});
checks.push(`release verification receipt written: ${path.relative(rootDir, receiptPath).split(path.sep).join('/')}`);

console.log(`Codeyo ${version} macOS ARM release verification passed.`);
for (const check of checks) {
  console.log(`- ${check}`);
}

function verifyMountedDmg() {
  const mountRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codeyo-dmg-'));
  try {
    run('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mountRoot, dmgPath]);
    verifyDirectory(path.join(mountRoot, 'Codeyo.app'), 'mounted DMG Codeyo.app');
    const applicationsLink = path.join(mountRoot, 'Applications');
    const linkTarget = fs.existsSync(applicationsLink) ? fs.readlinkSync(applicationsLink) : '';
    assertEqual(linkTarget, '/Applications', 'mounted DMG Applications link');
    const mountedAppPath = path.join(mountRoot, 'Codeyo.app');
    const mountedInfo = readPlistJson(path.join(mountedAppPath, 'Contents', 'Info.plist'));
    assertEqual(mountedInfo.CFBundleShortVersionString, version, 'mounted app version');
    verifyPackagedAppStarts(path.join(mountedAppPath, 'Contents', 'MacOS', 'Codeyo'), 'mounted DMG Codeyo.app');
    checks.push('DMG mounts with Codeyo.app, /Applications link, and launchable app');
  } finally {
    try {
      run('hdiutil', ['detach', mountRoot]);
    } catch (error) {
      console.error(`Failed to detach ${mountRoot}: ${error.message}`);
    }
    fs.rmSync(mountRoot, { recursive: true, force: true });
  }
}

function verifyPackagedAppStarts(executable, label) {
  verifyFile(executable, `${label} executable`, 1024);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codeyo-mounted-app-smoke-'));
  try {
    const result = spawnSync(executable, [], {
      cwd: rootDir,
      encoding: 'utf8',
      timeout: 20000,
      env: {
        ...process.env,
        CODEYO_STARTUP_SMOKE: '1',
        CODEYO_STARTUP_SMOKE_DEEP: '1',
        CODEYO_USER_DATA_DIR: path.join(tempRoot, 'user-data'),
      },
    });
    if (result.error) {
      fail(`${label} failed to launch: ${result.error.message}`);
    }
    if (result.status !== 0) {
      fail(`${label} exited with ${result.status ?? result.signal}.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    }
    if (!String(result.stdout || '').includes('CODEYO_STARTUP_SMOKE_OK')) {
      fail(`${label} did not report startup success.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    }
    checks.push(`${label} starts and loads renderer`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function readPlistJson(filePath) {
  const json = run('plutil', ['-convert', 'json', '-o', '-', filePath], { capture: true });
  return JSON.parse(json);
}

function verifyFile(filePath, label, minBytes) {
  if (!fs.existsSync(filePath)) {
    fail(`${label} is missing: ${filePath}`);
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    fail(`${label} is not a file: ${filePath}`);
  }
  if (stat.size < minBytes) {
    fail(`${label} is unexpectedly small: ${stat.size} bytes`);
  }
  checks.push(`${label} exists (${stat.size} bytes)`);
}

function verifyDirectory(dirPath, label) {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    fail(`${label} is missing: ${dirPath}`);
  }
  checks.push(`${label} exists`);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
  }
  checks.push(`${label} = ${JSON.stringify(expected)}`);
}

function run(command, args, options = {}) {
  try {
    const output = execFileSync(command, args, {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'pipe',
    });
    return output;
  } catch (error) {
    const stderr = error.stderr?.toString().trim();
    const stdout = error.stdout?.toString().trim();
    const detail = [stdout, stderr, error.message].filter(Boolean).join('\n');
    fail(`${command} ${args.join(' ')} failed:\n${detail}`);
  }
}

function fail(message) {
  console.error(`Codeyo macOS release verification failed: ${message}`);
  process.exit(1);
}
