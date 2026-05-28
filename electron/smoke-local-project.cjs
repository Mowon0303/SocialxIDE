const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const pty = require('node-pty');

const { CodeyoStore } = require('./storage.cjs');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codeyo-local-smoke-'));
const workspaceRoot = path.join(tempRoot, 'project');
const remoteRoot = path.join(tempRoot, 'remote.git');
const peerRoot = path.join(tempRoot, 'peer');
const userDataRoot = path.join(tempRoot, 'user-data');
const pythonCommand = process.env.CODEYO_SMOKE_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const cppCommand = process.env.CODEYO_SMOKE_CXX || 'clang++';

const checks = [];

main().catch((error) => {
  console.error('Codeyo local project smoke failed.');
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  if (process.env.CODEYO_KEEP_SMOKE_PROJECT !== '1') {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } else {
    console.log(`Preserved smoke workspace: ${tempRoot}`);
  }
});

async function main() {
  fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
  writeText('.gitignore', '.codeyo/\n');
  writeText('src/main.py', 'print("codeyo python ok")\n');
  writeText('src/broken.py', 'def run():\n    return 1 / 0\n\nrun()\n');
  writeText('src/util.hpp', '#pragma once\nint value();\n');
  writeText('src/util.cpp', '#include "util.hpp"\nint value() { return 42; }\n');
  writeText('src/main.cpp', '#include <iostream>\n#include "util.hpp"\nint main() { std::cout << "cpp " << value() << "\\n"; }\n');
  writeText('src/broken.cpp', 'int main() { return ; }\n');

  checkTool(pythonCommand, ['--version'], 'Python');
  checkTool(cppCommand, ['--version'], 'C++ compiler');
  checkTool('git', ['--version'], 'Git');

  smokeStorage();
  smokePython();
  smokeCpp();
  await smokePty();
  smokeGit();

  console.log('Codeyo local project smoke passed.');
  for (const check of checks) {
    console.log(`- ${check}`);
  }
}

function smokeStorage() {
  const store = new CodeyoStore(userDataRoot);
  const opened = store.openWorkspace(workspaceRoot);
  const workspace = store.trustWorkspace(opened.id);
  assert.equal(workspace.trusted, true);
  store.setStorageMode(workspace.id, 'workspace-codeyo');

  store.putRecovery(workspace.id, 'src/main.py', 'print("recovered")\n');
  store.saveProfile(workspace.id, {
    id: 'python-main',
    name: 'Run Python Main',
    language: 'python',
    command: pythonCommand,
    entryFile: 'src/main.py',
  });
  const run = store.saveRunResult(workspace.id, {
    profileId: 'python-main',
    profileName: 'Run Python Main',
    entryFile: 'src/main.py',
    inputs: [{ path: 'src/main.py', content: readText('src/main.py') }],
    exitCode: 0,
    stdout: 'codeyo python ok\n',
    stderr: '',
    elapsedMs: 1,
    startedAt: new Date().toISOString(),
    diagnostics: [],
  });
  const snapshot = store.createSnapshot(
    workspace.id,
    [{ path: 'src/main.py', content: readText('src/main.py') }],
    'Smoke review snapshot',
    run.id,
    undefined,
  );
  store.addJournal(workspace.id, 'review', 'Smoke review entry', snapshot.id, { runResultId: run.id });

  const portablePath = path.join(workspaceRoot, '.codeyo', 'journal.json');
  assert.equal(fs.existsSync(portablePath), true);
  const portable = JSON.parse(fs.readFileSync(portablePath, 'utf8'));
  assert.equal(portable.version, 2);
  assert.equal(portable.snapshots.length, 1);
  assert.equal(portable.runResults.length, 1);
  assert.equal(portable.runProfiles.length, 1);
  assert.equal(portable.recoveryBuffers.length, 1);
  checks.push('.codeyo journal, snapshot, run evidence, profile, and recovery persisted');
}

function smokePython() {
  const ok = run(pythonCommand, [path.join(workspaceRoot, 'src', 'main.py')], workspaceRoot);
  assert.match(ok.stdout, /codeyo python ok/);

  const broken = run(pythonCommand, [path.join(workspaceRoot, 'src', 'broken.py')], workspaceRoot, { allowFailure: true });
  assert.notEqual(broken.status, 0);
  assert.match(`${broken.stdout}${broken.stderr}`, /ZeroDivisionError/);
  assert.match(`${broken.stdout}${broken.stderr}`, /broken\.py/);
  checks.push('Python success and traceback failure paths work');
}

function smokeCpp() {
  const outputPath = path.join(tempRoot, process.platform === 'win32' ? 'codeyo-smoke.exe' : 'codeyo-smoke');
  run(cppCommand, [
    '-std=c++20',
    path.join(workspaceRoot, 'src', 'main.cpp'),
    path.join(workspaceRoot, 'src', 'util.cpp'),
    '-o',
    outputPath,
  ], workspaceRoot);
  const ok = run(outputPath, [], workspaceRoot);
  assert.match(ok.stdout, /cpp 42/);

  const broken = run(cppCommand, [
    '-std=c++20',
    path.join(workspaceRoot, 'src', 'broken.cpp'),
    '-o',
    path.join(tempRoot, process.platform === 'win32' ? 'broken.exe' : 'broken'),
  ], workspaceRoot, { allowFailure: true });
  assert.notEqual(broken.status, 0);
  assert.match(`${broken.stdout}${broken.stderr}`, /broken\.cpp/);
  assert.match(`${broken.stdout}${broken.stderr}`, /error:/i);
  checks.push('C++ multi-source build, header include, execution, and compile diagnostics work');
}

async function smokePty() {
  const shell = process.platform === 'win32' ? 'cmd.exe' : (process.env.SHELL || '/bin/sh');
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'echo CODEYO_PTY_OK']
    : ['-lc', 'printf CODEYO_PTY_OK'];
  const output = await runPty(shell, args, workspaceRoot);
  assert.match(output, /CODEYO_PTY_OK/);
  checks.push('node-pty shell launch and output capture work');
}

function smokeGit() {
  gitInit(workspaceRoot);
  git(['config', 'user.email', 'codeyo-smoke@example.invalid'], workspaceRoot);
  git(['config', 'user.name', 'Codeyo Smoke'], workspaceRoot);
  git(['add', '.'], workspaceRoot);
  git(['commit', '-m', 'Initial smoke project'], workspaceRoot);

  git(['init', '--bare', remoteRoot], tempRoot);
  git(['remote', 'add', 'origin', remoteRoot], workspaceRoot);
  git(['push', '-u', 'origin', 'main'], workspaceRoot);

  smokeGitHunks();

  fs.appendFileSync(path.join(workspaceRoot, 'src', 'main.py'), 'print("git change")\n');
  const status = git(['status', '--porcelain=v1', '--branch'], workspaceRoot).stdout;
  assert.match(status, /M src\/main\.py/);
  const diff = git(['diff', '--', 'src/main.py'], workspaceRoot).stdout;
  assert.match(diff, /git change/);
  git(['add', '--', 'src/main.py'], workspaceRoot);
  const staged = git(['diff', '--cached', '--', 'src/main.py'], workspaceRoot).stdout;
  assert.match(staged, /git change/);
  git(['commit', '-m', 'Smoke local change'], workspaceRoot);
  git(['push'], workspaceRoot);

  git(['switch', '-c', 'feature/smoke'], workspaceRoot);
  writeText('src/branch.txt', 'branch work\n');
  git(['add', '--', 'src/branch.txt'], workspaceRoot);
  git(['commit', '-m', 'Smoke branch work'], workspaceRoot);
  git(['switch', 'main'], workspaceRoot);
  git(['branch', '-D', 'feature/smoke'], workspaceRoot);

  git(['clone', remoteRoot, peerRoot], tempRoot);
  git(['config', 'user.email', 'codeyo-peer@example.invalid'], peerRoot);
  git(['config', 'user.name', 'Codeyo Peer'], peerRoot);
  fs.appendFileSync(path.join(peerRoot, 'src', 'main.py'), 'print("remote change")\n');
  git(['add', '--', 'src/main.py'], peerRoot);
  git(['commit', '-m', 'Smoke remote change'], peerRoot);
  git(['push'], peerRoot);
  git(['pull'], workspaceRoot);
  assert.match(readText('src/main.py'), /remote change/);
  checks.push('Git status, diff, stage, commit, branch, local push, and local pull work');
}

function smokeGitHunks() {
  const hunkLine = 'print("hunk staged")';
  fs.appendFileSync(path.join(workspaceRoot, 'src', 'main.py'), `${hunkLine}\n`);
  const patch = buildAppendHunkPatch('src/main.py', hunkLine);

  gitApplyHunkPatch('stage', patch);
  assert.match(git(['diff', '--cached', '--', 'src/main.py'], workspaceRoot).stdout, /hunk staged/);
  assert.doesNotMatch(git(['diff', '--', 'src/main.py'], workspaceRoot).stdout, /hunk staged/);

  gitApplyHunkPatch('unstage', patch);
  assert.doesNotMatch(git(['diff', '--cached', '--', 'src/main.py'], workspaceRoot).stdout, /hunk staged/);
  assert.match(git(['diff', '--', 'src/main.py'], workspaceRoot).stdout, /hunk staged/);

  gitApplyHunkPatch('discard', patch);
  assert.doesNotMatch(readText('src/main.py'), /hunk staged/);
  assert.equal(git(['diff', '--', 'src/main.py'], workspaceRoot).stdout, '');
  checks.push('Git hunk stage, unstage, and discard work through patch application');
}

function buildAppendHunkPatch(filePath, line) {
  return [
    `diff --git a/${filePath} b/${filePath}`,
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    '@@ -1,0 +2,1 @@',
    `+${line}`,
    '',
  ].join('\n');
}

function gitApplyHunkPatch(mode, patch) {
  const tempPatch = path.join(tempRoot, `codeyo-hunk-${mode}-${Date.now()}.patch`);
  fs.writeFileSync(tempPatch, patch, 'utf8');
  try {
    const args = ['apply'];
    if (mode === 'stage' || mode === 'unstage') {
      args.push('--cached');
    }
    if (mode === 'unstage' || mode === 'discard') {
      args.push('--reverse');
    }
    args.push('--whitespace=nowarn', '--unidiff-zero', tempPatch);
    git(args, workspaceRoot);
  } finally {
    fs.rmSync(tempPatch, { force: true });
  }
}

function gitInit(cwd) {
  const init = run('git', ['init', '-b', 'main'], cwd, { allowFailure: true });
  if (init.status !== 0) {
    git(['init'], cwd);
    git(['branch', '-M', 'main'], cwd);
  }
}

function git(args, cwd) {
  const result = run('git', args, cwd);
  return result;
}

function checkTool(command, args, label) {
  const result = run(command, args, workspaceRoot, { allowFailure: true });
  if (result.status !== 0) {
    throw new Error(`${label} is unavailable via ${command}: ${result.stderr || result.stdout}`);
  }
  checks.push(`${label} available via ${command}`);
}

function run(command, args, cwd, options = {}) {
  try {
    const stdout = execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const result = {
      status: typeof error.status === 'number' ? error.status : 1,
      stdout: error.stdout?.toString() || '',
      stderr: error.stderr?.toString() || error.message,
    };
    if (options.allowFailure) {
      return result;
    }
    throw new Error(`${command} ${args.join(' ')} failed in ${cwd}\n${result.stdout}${result.stderr}`);
  }
}

function runPty(command, args, cwd) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      try {
        term.kill();
      } catch {
        // Ignore best-effort cleanup failures after timeout.
      }
      reject(new Error(`PTY smoke timed out: ${command}`));
    }, 5000);
    const term = pty.spawn(command, args, {
      cwd,
      cols: 80,
      rows: 24,
      env: process.env,
      name: process.platform === 'win32' ? 'xterm-256color' : 'xterm-color',
    });
    term.onData((data) => {
      output += data;
    });
    term.onExit(({ exitCode }) => {
      clearTimeout(timer);
      if (exitCode === 0) {
        resolve(output);
      } else {
        reject(new Error(`PTY exited with ${exitCode}: ${output}`));
      }
    });
  });
}

function writeText(relativePath, content) {
  const target = path.join(workspaceRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

function readText(relativePath) {
  return fs.readFileSync(path.join(workspaceRoot, relativePath), 'utf8');
}
