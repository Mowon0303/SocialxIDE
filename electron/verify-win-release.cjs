const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  findWindowsUninstaller,
  windowsInstallerInstallArgs,
  windowsUninstallerArgs,
} = require('./windows-installer-policy.cjs');
const {
  writeVerificationReceipt,
} = require('./release-manifest-policy.cjs');

const rootDir = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const version = packageJson.version;
const releaseDir = path.join(rootDir, 'release');
const unpackedDir = path.join(releaseDir, 'win-unpacked');
const executablePath = path.join(unpackedDir, 'Codeyo.exe');
const resourcesDir = path.join(unpackedDir, 'resources');
const appAsarPath = path.join(resourcesDir, 'app.asar');
const ptyPath = path.join(
  resourcesDir,
  'app.asar.unpacked',
  'node_modules',
  'node-pty',
  'build',
  'Release',
  'pty.node',
);

if (process.platform !== 'win32') {
  fail('Windows release verification must run on Windows.');
}

const checks = [];
verifyDirectory(releaseDir, 'release directory');
verifyDirectory(unpackedDir, 'win-unpacked directory');
verifyFile(executablePath, 'Codeyo.exe', 1024 * 1024);
verifyFile(appAsarPath, 'app.asar', 1024 * 1024);
verifyFile(ptyPath, 'node-pty native module', 1024);

const installerPath = findNsisInstaller();
verifyFile(installerPath, 'NSIS installer', 50 * 1024 * 1024);
verifyPackagedAppStarts(executablePath, 'win-unpacked Codeyo.exe');
verifyInstallerE2E(installerPath);
const receiptPath = writeVerificationReceipt({
  rootDir,
  packageJson,
  platform: 'win32',
  arch: 'x64',
  checks,
});
checks.push(`release verification receipt written: ${path.relative(rootDir, receiptPath).split(path.sep).join('/')}`);

console.log(`Codeyo ${version} Windows x64 release verification passed.`);
for (const check of checks) {
  console.log(`- ${check}`);
}

function findNsisInstaller() {
  const candidates = fs.readdirSync(releaseDir)
    .filter((name) => name.toLowerCase().endsWith('.exe'))
    .filter((name) => name.toLowerCase().includes('codeyo'))
    .map((name) => path.join(releaseDir, name))
    .filter((candidate) => fs.statSync(candidate).isFile())
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
  if (candidates.length === 0) {
    fail(`No Codeyo NSIS installer was found in ${releaseDir}`);
  }
  return candidates[0];
}

function verifyInstallerE2E(installerPath) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codeyo-win-install-'));
  const installDir = path.join(tempRoot, 'Codeyo');
  try {
    runInstaller(installerPath, windowsInstallerInstallArgs(installDir), 'NSIS silent install');
    verifyDirectory(installDir, 'silent install directory');
    const installedExe = path.join(installDir, 'Codeyo.exe');
    const installedResources = path.join(installDir, 'resources');
    verifyFile(installedExe, 'installed Codeyo.exe', 1024 * 1024);
    verifyFile(path.join(installedResources, 'app.asar'), 'installed app.asar', 1024 * 1024);
    verifyFile(
      path.join(installedResources, 'app.asar.unpacked', 'node_modules', 'node-pty', 'build', 'Release', 'pty.node'),
      'installed node-pty native module',
      1024,
    );
    verifyPackagedAppStarts(installedExe, 'installed Codeyo.exe');

    const uninstallerPath = findWindowsUninstaller(installDir);
    verifyFile(uninstallerPath, 'installed uninstaller', 1024 * 1024);
    runInstaller(uninstallerPath, windowsUninstallerArgs(), 'NSIS silent uninstall');
    if (fs.existsSync(installedExe)) {
      fail(`silent uninstall left installed executable behind: ${installedExe}`);
    }
    checks.push('NSIS installer installs, installed app starts, and uninstaller removes executable');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function verifyPackagedAppStarts(executable, label) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codeyo-win-app-smoke-'));
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

function runInstaller(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: 'utf8',
    timeout: 120000,
  });
  if (result.error) {
    fail(`${label} failed to launch: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`${label} exited with ${result.status ?? result.signal}.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  checks.push(`${label} completed`);
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

function fail(message) {
  console.error(`Codeyo Windows release verification failed: ${message}`);
  process.exit(1);
}
