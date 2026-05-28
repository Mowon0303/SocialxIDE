const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codeyo-packaged-app-smoke-'));
const userDataDir = path.join(tempRoot, 'user-data');
fs.mkdirSync(userDataDir, { recursive: true });

const executable = packagedExecutable();
if (!fs.existsSync(executable)) {
  fail(`Packaged executable is missing: ${executable}`);
}

const child = spawn(executable, [], {
  cwd: rootDir,
  env: {
    ...process.env,
    CODEYO_STARTUP_SMOKE: '1',
    CODEYO_STARTUP_SMOKE_DEEP: '1',
    CODEYO_USER_DATA_DIR: userDataDir,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
const timeout = setTimeout(() => {
  child.kill('SIGKILL');
  fail(`Packaged app smoke timed out after 20s.\nstdout:\n${stdout}\nstderr:\n${stderr}`);
}, 20000);

child.stdout.on('data', (chunk) => {
  stdout += chunk.toString();
});
child.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
});
child.on('error', (error) => {
  clearTimeout(timeout);
  cleanup();
  fail(`Failed to launch packaged app: ${error.message}`);
});
child.on('exit', (code, signal) => {
  clearTimeout(timeout);
  cleanup();
  if (code !== 0) {
    fail(`Packaged app exited with ${code ?? signal}.\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }
  if (!stdout.includes('CODEYO_STARTUP_SMOKE_OK')) {
    fail(`Packaged app did not report startup success.\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }
  console.log(`Codeyo ${packageJson.version} packaged app startup smoke passed.`);
  console.log(`- executable: ${executable}`);
  console.log('- app ready, renderer loaded, and process exited cleanly');
});

function packagedExecutable() {
  if (process.platform === 'darwin') {
    return path.join(rootDir, 'release', 'mac-arm64', 'Codeyo.app', 'Contents', 'MacOS', 'Codeyo');
  }
  if (process.platform === 'win32') {
    return path.join(rootDir, 'release', 'win-unpacked', 'Codeyo.exe');
  }
  return path.join(rootDir, 'release', 'linux-unpacked', 'codeyo');
}

function cleanup() {
  if (process.env.CODEYO_KEEP_SMOKE_PROJECT !== '1') {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } else {
    console.log(`Preserved smoke data: ${tempRoot}`);
  }
}

function fail(message) {
  console.error(`Codeyo packaged app smoke failed: ${message}`);
  process.exit(1);
}
