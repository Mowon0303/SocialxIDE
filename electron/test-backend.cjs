const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  assertEditableRelativePath,
  isEditableRelativePath,
  normalizedRelativePath,
  portableEditableRelativePath,
} = require('./path-policy.cjs');
const { cppCompileSourceFiles } = require('./cpp-run-policy.cjs');
const { renameWorkspaceFile } = require('./file-operations.cjs');
const {
  executableOnPath,
  normalizeCodeActions,
  normalizeCompletionResult,
  normalizeDefinitionResult,
  normalizeLspDiagnostics,
  normalizeTextEdits,
  normalizeWorkspaceEdit,
  positionInRegion,
  resolveLanguageServerCommand,
  sanitizeSpellRanges,
} = require('./language-service.cjs');
const { normalizeGitAction, permittedGitActionTypes } = require('./git-action-policy.cjs');
const {
  assertGitPatchPayload,
  assertGitPatchSafety,
  assertSingleGitPatchTarget,
  gitPatchTempPath,
  isUntrackedStatus,
  maxGitPatchBytes,
  trackedDiscardArgs,
  validateGitPatchPaths,
  writeGitPatchTempFile,
} = require('./git-discard-policy.cjs');
const {
  gitDiffTruncatedMarker,
  maxGitDiffOutputBytes,
  parseGitBranches,
  parseGitCommitFiles,
  parseGitCommitHeading,
  parseGitHistory,
  parseGitNumstat,
  parseGitStatus,
  sanitizeGitDiffResult,
} = require('./git-output-policy.cjs');
const { appendCodeyoGitignore, gitignoreOpenFlags } = require('./gitignore-policy.cjs');
const {
  assertIpcTrustPolicyComplete,
  assertPreloadIpcSurfaceComplete,
  isTrustedWorkspaceRequiredChannel,
} = require('./ipc-trust-policy.cjs');
const {
  desktopContentSecurityPolicy,
  isPermittedNavigationUrl,
  shouldOpenExternalUrl,
} = require('./security-policy.cjs');
const { CodeyoStore } = require('./storage.cjs');
const {
  assertCanCreateTerminalSession,
  boundedTerminalBuffer,
  clampTerminalSize,
  maxTerminalBufferChars,
  maxTerminalInputChars,
  maxTerminalSessionsPerWorkspace,
  resolveTerminalShell,
  sanitizeTerminalInput,
  sanitizeTerminalTitle,
  terminalSessionCount,
} = require('./terminal-policy.cjs');
const {
  sanitizeRunArgs,
  sanitizeToolCheck,
  sanitizeToolCommand,
} = require('./tool-command-policy.cjs');
const {
  workspaceExistingTextWriteFlags,
  workspaceNewTextWriteFlags,
  workspaceTextWriteOptions,
  writeConflictState,
  writeWorkspaceTextFile,
} = require('./file-write-policy.cjs');
const {
  assertGitTextObjectSize,
  assertWorkspaceTextContentSize,
  gitTextObjectReadBufferBytes,
  maxWorkspaceTextFileBytes,
  readWorkspaceTextFile,
  readWorkspaceTextFileBounded,
  workspaceTextReadFlags,
} = require('./file-content-policy.cjs');
const {
  gitActionJournalMetadata,
  gitHunkJournalMetadata,
  maxJournalMetadataBytes,
  reviewSnapshotJournalMetadata,
  sanitizeJournalMetadataInput,
} = require('./journal-metadata-policy.cjs');
const {
  runInputFailureResult,
  runInputReadError,
  sanitizeRunFailureMessage,
} = require('./runner-input-policy.cjs');
const {
  appendRunOutputTruncatedDiagnostic,
  appendRunOutputTruncatedNotice,
  runOutputTruncatedMessage,
  runToolOutputBufferBytes,
  stripRunOutputAnsi,
} = require('./runner-output-policy.cjs');
const {
  cleanupRunnerTempBuild,
  createRunnerTempBuild,
  runnerOutputFileName,
} = require('./runner-temp-policy.cjs');
const {
  boundPortablePayload,
  maxPortablePayloadBytes,
  writePortableJournalAtomically,
} = require('./portable-storage-policy.cjs');
const {
  desktopResourceCleanupEvent,
  shouldAllowPreventedUnload,
  shouldCleanupDesktopResources,
  unsavedQuitPromptOptions,
} = require('./app-lifecycle-policy.cjs');
const {
  assertRealPathInsideWorkspace,
  assertWorkspaceRootDirectory,
  assertWorkspaceRootDirectorySync,
  assertWritableParentInsideWorkspace,
} = require('./workspace-path-policy.cjs');
const { shouldWatchWorkspace } = require('./workspace-watch-policy.cjs');
const { listWorkspaceFiles } = require('./workspace-file-listing.cjs');
const {
  canAddWorkspaceFile,
  canEnterWorkspaceDirectory,
  createWorkspaceListBudget,
  maxWorkspaceListDepth,
  maxWorkspaceListDirectories,
  maxWorkspaceListFiles,
} = require('./workspace-list-policy.cjs');

const tests = [];

test('path policy accepts editable project files and normalizes separators', () => {
  assert.equal(portableEditableRelativePath('src\\main.py'), 'src/main.py');
  assert.equal(portableEditableRelativePath('include/lib.hpp'), 'include/lib.hpp');
  assert.equal(portableEditableRelativePath('README'), 'README');
  assert.equal(portableEditableRelativePath('Dockerfile'), 'Dockerfile');
  assert.equal(normalizedRelativePath('src\\nested/file.ts'), path.join('src', 'nested', 'file.ts'));
  assert.equal(isEditableRelativePath('Makefile'), true);
});

test('path policy rejects traversal, absolute paths, hidden paths, control characters, ignored directories, and unknown binaries', () => {
  const rejected = [
    '../secret.py',
    '/tmp/secret.py',
    'C:\\Users\\codeyo\\secret.py',
    'src/../../secret.py',
    'src/.env',
    '.env',
    '.git/config',
    '.codeyo/journal.json',
    'node_modules/pkg/index.js',
    'dist/bundle.js',
    'release/Codeyo.dmg',
    'image.png',
    'archive.zip',
    'src/null\0byte.py',
    'src/new\nline.py',
    'src/tab\tname.py',
  ];
  for (const filePath of rejected) {
    assert.throws(() => assertEditableRelativePath(filePath), Error, filePath);
    assert.equal(isEditableRelativePath(filePath), false, filePath);
  }
});

test('write policy detects external changes and deletions before saving', () => {
  assert.deepEqual(writeConflictState({
    fileExists: true,
    expectedDiskVersion: '1',
    currentDiskVersion: '2',
  }), {
    conflict: true,
    deleted: false,
    diskVersion: '2',
  });
  assert.deepEqual(writeConflictState({
    fileExists: false,
    expectedDiskVersion: '1',
    currentDiskVersion: '',
  }), {
    conflict: true,
    deleted: true,
    diskVersion: '',
    diskContent: '',
  });
  assert.deepEqual(writeConflictState({
    fileExists: false,
    expectedDiskVersion: '',
    currentDiskVersion: '',
  }), { conflict: false });
  assert.equal(
    workspaceTextWriteOptions({ fileExists: true }).flag,
    workspaceExistingTextWriteFlags(),
  );
  assert.equal(
    Boolean(workspaceTextWriteOptions({ fileExists: true }).flag & fs.constants.O_TRUNC),
    true,
  );
  assert.equal(
    workspaceTextWriteOptions({ fileExists: false }).flag,
    workspaceNewTextWriteFlags(),
  );
  assert.equal(
    workspaceTextWriteOptions({ fileExists: false }).flag & fs.constants.O_EXCL,
    fs.constants.O_EXCL,
  );
  assert.equal(
    workspaceTextWriteOptions({ fileExists: false }).flag & (fs.constants.O_NOFOLLOW || 0),
    fs.constants.O_NOFOLLOW || 0,
  );
});

test('write policy refuses to create over a file that appears after conflict checks', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const target = path.join(workspaceRoot, 'race.py');
    fs.writeFileSync(target, 'external\n', 'utf8');

    await assert.rejects(
      () => writeWorkspaceTextFile(fs.promises, target, 'overwrite\n', { fileExists: false }),
      /EEXIST|file already exists/i,
    );
    assert.equal(fs.readFileSync(target, 'utf8'), 'external\n');

    const saved = await writeWorkspaceTextFile(fs.promises, target, 'saved\n', { fileExists: true });
    assert.equal(saved.isFile(), true);
    assert.equal(fs.readFileSync(target, 'utf8'), 'saved\n');

    const created = path.join(workspaceRoot, 'created.py');
    const createdStat = await writeWorkspaceTextFile(fs.promises, created, 'created\n', { fileExists: false });
    assert.equal(createdStat.isFile(), true);
    assert.equal(fs.readFileSync(created, 'utf8'), 'created\n');
  });
});

test('write policy refuses to follow symlinks for existing files', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codeyo-write-outside-'));
    const outsideFile = path.join(outsideRoot, 'target.py');
    const linkPath = path.join(workspaceRoot, 'link.py');
    fs.writeFileSync(outsideFile, 'outside\n', 'utf8');
    try {
      fs.symlinkSync(outsideFile, linkPath);
    } catch {
      return;
    }

    await assert.rejects(
      () => writeWorkspaceTextFile(fs.promises, linkPath, 'changed\n', { fileExists: true }),
      /ELOOP|symbolic link|too many symbolic links|not permitted|invalid argument/i,
    );
    assert.equal(fs.readFileSync(outsideFile, 'utf8'), 'outside\n');
    assert.equal(fs.lstatSync(linkPath).isSymbolicLink(), true);
  });
});

test('file content policy bounds editable text file payloads', async () => {
  assert.equal(assertWorkspaceTextContentSize('print("ok")\n'), 'print("ok")\n');
  assert.equal(assertGitTextObjectSize(String(maxWorkspaceTextFileBytes)), maxWorkspaceTextFileBytes);
  assert.equal(gitTextObjectReadBufferBytes, maxWorkspaceTextFileBytes + 64 * 1024);
  assert.throws(
    () => assertWorkspaceTextContentSize('x'.repeat(maxWorkspaceTextFileBytes + 1)),
    /too large/,
  );
  assert.throws(() => assertWorkspaceTextContentSize(Buffer.from('not text')), /must be text/);
  assert.throws(() => assertGitTextObjectSize(String(maxWorkspaceTextFileBytes + 1)), /too large/);
  assert.throws(() => assertGitTextObjectSize('not-a-size'), /not valid/);

  await withTempWorkspace(async (workspaceRoot) => {
    const sourceDir = path.join(workspaceRoot, 'src');
    fs.mkdirSync(sourceDir, { recursive: true });
    const smallFile = path.join(sourceDir, 'main.py');
    const largeFile = path.join(sourceDir, 'large.py');
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codeyo-read-outside-'));
    const outsideFile = path.join(outsideRoot, 'secret.py');
    const linkFile = path.join(sourceDir, 'link.py');
    fs.writeFileSync(smallFile, 'print("small")\n', 'utf8');
    fs.writeFileSync(largeFile, Buffer.alloc(maxWorkspaceTextFileBytes + 1, 120));
    fs.writeFileSync(outsideFile, 'print("outside")\n', 'utf8');

    const result = await readWorkspaceTextFile(fs.promises, smallFile);
    assert.equal(result.content, 'print("small")\n');
    assert.equal(result.stat.size, Buffer.byteLength('print("small")\n', 'utf8'));
    assert.equal(
      workspaceTextReadFlags() & (fs.constants.O_NOFOLLOW || 0),
      fs.constants.O_NOFOLLOW || 0,
    );
    await assert.rejects(() => readWorkspaceTextFile(fs.promises, largeFile), /too large/);
    await assert.rejects(() => readWorkspaceTextFile(fs.promises, sourceDir), /not a file/);
    try {
      fs.symlinkSync(outsideFile, linkFile);
    } catch {
      return;
    }
    await assert.rejects(
      () => readWorkspaceTextFile(fs.promises, linkFile),
      /ELOOP|symbolic link|too many symbolic links|not permitted|invalid argument|not a file/i,
    );
  });
});

test('file content policy checks the opened file handle before reading', async () => {
  let didRead = false;
  const fakeHandle = {
    stat: async () => ({
      isFile: () => true,
      size: maxWorkspaceTextFileBytes + 1,
    }),
    readFile: async () => {
      didRead = true;
      return 'oversized payload';
    },
    close: async () => undefined,
  };
  const fakeFs = {
    open: async (_target, flags) => {
      assert.equal(
        flags & (fs.constants.O_NOFOLLOW || 0),
        fs.constants.O_NOFOLLOW || 0,
      );
      return fakeHandle;
    },
  };

  await assert.rejects(
    () => readWorkspaceTextFile(fakeFs, path.join('workspace', 'race.py')),
    /too large/,
  );
  assert.equal(didRead, false);
});

test('file content policy truncates from the opened file handle for smaller evidence limits', async () => {
  const suffix = '\n[TRUNCATED]\n';
  const maxBytes = 32;
  let requestedBytes = 0;
  const fakeHandle = {
    stat: async () => ({
      isFile: () => true,
      size: 4096,
    }),
    read: async (buffer, offset, length, position) => {
      assert.equal(position, 0);
      requestedBytes = length;
      const source = Buffer.from('abcdefghijklmnopqrstuvwxyz', 'utf8');
      source.copy(buffer, offset, 0, Math.min(source.length, length));
      return { bytesRead: Math.min(source.length, length) };
    },
    readFile: async () => {
      throw new Error('oversized evidence should not read the full file');
    },
    close: async () => undefined,
  };
  const fakeFs = {
    open: async () => fakeHandle,
  };

  const result = await readWorkspaceTextFileBounded(fakeFs, path.join('workspace', 'large.py'), {
    maxBytes,
    truncatedSuffix: suffix,
  });

  assert.equal(result.truncated, true);
  assert.equal(requestedBytes, maxBytes - Buffer.byteLength(suffix, 'utf8'));
  assert.ok(result.content.endsWith(suffix));
  assert.ok(Buffer.byteLength(result.content, 'utf8') <= maxBytes);
});

test('C++ run policy keeps headers as evidence but not compiler inputs', () => {
  assert.deepEqual(
    cppCompileSourceFiles(['src/main.cpp', 'src/lib.cc', 'include/util.hpp', 'include/config.h']),
    ['src/main.cpp', 'src/lib.cc'],
  );
  assert.deepEqual(cppCompileSourceFiles(['include/only.hpp', 'include/config.h']), []);
  assert.deepEqual(cppCompileSourceFiles(undefined), []);
});

test('runner input policy turns missing inputs into run evidence', () => {
  const readError = runInputReadError('src/main.py', { code: 'ENOENT' });
  const result = runInputFailureResult(
    {
      id: 'python-current',
      name: 'Run Python Current File',
      entryFile: 'src/main.py',
    },
    ['src/main.py'],
    readError,
    '2026-05-27T00:00:00.000Z',
    12,
  );

  assert.equal(readError.code, 'CODEYO_RUN_INPUT');
  assert.equal(readError.filePath, 'src/main.py');
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.inputs, []);
  assert.match(result.stderr, /RUN INPUT NOT FOUND/);
  assert.deepEqual(result.diagnostics, [{
    path: 'src/main.py',
    line: 1,
    severity: 'error',
    message: 'RUN INPUT NOT FOUND · src/main.py',
  }]);
  assert.equal(sanitizeRunFailureMessage('bad\nmessage\0here'), 'bad message here');
});

test('runner output policy marks max-buffer truncation without duplicating notices', () => {
  assert.equal(runToolOutputBufferBytes, 576 * 1024);
  assert.equal(
    appendRunOutputTruncatedNotice(''),
    `${runOutputTruncatedMessage}\n`,
  );
  assert.equal(
    appendRunOutputTruncatedNotice('partial stderr'),
    `partial stderr\n${runOutputTruncatedMessage}\n`,
  );
  assert.equal(
    appendRunOutputTruncatedNotice(`partial stderr\n${runOutputTruncatedMessage}\n`),
    `partial stderr\n${runOutputTruncatedMessage}\n`,
  );
  const existing = [{ path: 'src/main.py', line: 3, severity: 'warning', message: 'kept' }];
  const withTruncation = appendRunOutputTruncatedDiagnostic(existing, 'src/main.py');
  assert.equal(withTruncation, existing);
  assert.deepEqual(withTruncation, [
    { path: 'src/main.py', line: 3, severity: 'warning', message: 'kept' },
    { path: 'src/main.py', line: 1, severity: 'error', message: runOutputTruncatedMessage },
  ]);
  assert.equal(appendRunOutputTruncatedDiagnostic(withTruncation, 'src/main.py').length, 2);
});

test('runner output policy strips ANSI color so colored tracebacks stay parseable', () => {
  const esc = String.fromCharCode(27);
  const colored = [
    'Traceback (most recent call last):',
    `  File ${esc}[35m"/x/src/broken.py"${esc}[0m, line ${esc}[35m4${esc}[0m, in ${esc}[35m<module>${esc}[0m`,
    `    ${esc}[31mexplode${esc}[0m${esc}[1;31m()${esc}[0m`,
    `    ${esc}[31m~~~~~~~${esc}[0m${esc}[1;31m^^${esc}[0m`,
    `${esc}[1;35mRuntimeError${esc}[0m: ${esc}[35mcodeyo problem e2e${esc}[0m`,
    '',
  ].join('\n');
  const cleaned = stripRunOutputAnsi(colored);
  assert.equal(cleaned.includes(esc), false);
  assert.match(cleaned, /File "\/x\/src\/broken\.py", line 4/);
  assert.match(cleaned, /RuntimeError: codeyo problem e2e/);
  // Mirrors the parser regex in main.cjs parseDiagnostics; the colored input
  // produces no match, the stripped input recovers the runtime diagnostic.
  const python = /File "([^"]+)", line (\d+)(?:[\s\S]*?\n(?:.*\n)?([A-Za-z]+Error: .*))?/g;
  assert.equal([...colored.matchAll(python)].length, 0);
  const matches = [...cleaned.matchAll(python)];
  assert.equal(matches.length, 1);
  assert.equal(matches[0][1], '/x/src/broken.py');
  assert.equal(matches[0][2], '4');
  assert.equal(matches[0][3], 'RuntimeError: codeyo problem e2e');
  assert.equal(stripRunOutputAnsi(undefined), '');
  assert.equal(stripRunOutputAnsi('plain [not ansi] text'), 'plain [not ansi] text');
});

test('runner temp policy creates and cleans a dedicated C++ build directory', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    assert.equal(runnerOutputFileName('darwin'), 'codeyo-run');
    assert.equal(runnerOutputFileName('win32'), 'codeyo-run.exe');

    const build = await createRunnerTempBuild(
      fs.promises,
      path,
      { tmpdir: () => workspaceRoot },
      'win32',
    );
    assert.ok(build.directoryPath.startsWith(path.join(workspaceRoot, 'codeyo-run-')));
    assert.equal(path.basename(build.outputPath), 'codeyo-run.exe');
    assert.equal(fs.lstatSync(build.directoryPath).isDirectory(), true);

    fs.writeFileSync(build.outputPath, 'binary placeholder\n', 'utf8');
    await cleanupRunnerTempBuild(fs.promises, build);
    assert.equal(fs.existsSync(build.directoryPath), false);
  });
});

test('Git discard policy separates untracked files from tracked staged work', () => {
  assert.equal(isUntrackedStatus('?? scratch.py\n'), true);
  assert.equal(isUntrackedStatus(' M src/main.py\n'), false);
  assert.equal(isUntrackedStatus('M  src/main.py\n'), false);
  assert.deepEqual(
    trackedDiscardArgs('src/main.py'),
    ['restore', '--staged', '--worktree', '--', 'src/main.py'],
  );
  assert.doesNotThrow(() => assertGitPatchSafety('stage', false));
  assert.doesNotThrow(() => assertGitPatchSafety('unstage', false));
  assert.doesNotThrow(() => assertGitPatchSafety('discard', true));
  assert.equal(assertGitPatchPayload('diff --git a/src/main.py b/src/main.py\n'), 'diff --git a/src/main.py b/src/main.py\n');
  assert.deepEqual(assertSingleGitPatchTarget(['src/main.py', 'src/main.py']), ['src/main.py']);
  assert.throws(
    () => assertGitPatchSafety('discard', false),
    /requires explicit confirmation/,
  );
  assert.throws(() => assertGitPatchPayload(''), /required/);
  assert.throws(() => assertGitPatchPayload(`diff\0`), /invalid characters/);
  assert.throws(() => assertGitPatchPayload('x'.repeat(maxGitPatchBytes + 1)), /too large/);
  assert.throws(() => assertSingleGitPatchTarget([]), /exactly one/);
  assert.throws(() => assertSingleGitPatchTarget(['src/main.py', 'src/other.py']), /exactly one/);
});

test('Git patch policy only accepts single-file text hunks', () => {
  const textHunk = [
    'diff --git a/src/main.py b/src/main.py',
    '--- a/src/main.py',
    '+++ b/src/main.py',
    '@@ -1,1 +1,1 @@',
    '-print("old")',
    '+print("new")',
    '',
  ].join('\n');
  assert.deepEqual(validateGitPatchPaths(textHunk), ['src/main.py']);

  const multiFileHunk = [
    textHunk,
    'diff --git a/src/other.py b/src/other.py',
    '--- a/src/other.py',
    '+++ b/src/other.py',
    '@@ -1,1 +1,1 @@',
    '-old',
    '+new',
    '',
  ].join('\n');
  assert.throws(() => validateGitPatchPaths(multiFileHunk), /exactly one/);

  assert.throws(
    () => validateGitPatchPaths([
      'diff --git a/src/main.py b/src/renamed.py',
      'similarity index 100%',
      'rename from src/main.py',
      'rename to src/renamed.py',
      '',
    ].join('\n')),
    /text hunk/,
  );
  assert.throws(
    () => validateGitPatchPaths([
      'diff --git a/src/main.py b/src/main.py',
      'GIT binary patch',
      'literal 0',
      '',
    ].join('\n')),
    /text hunk/,
  );
  assert.throws(
    () => validateGitPatchPaths([
      'diff --git a/.env b/.env',
      '--- a/.env',
      '+++ b/.env',
      '@@ -1,1 +1,1 @@',
      '-SECRET=old',
      '+SECRET=new',
      '',
    ].join('\n')),
    /Hidden files are not editable|File type is not editable|outside Codeyo editable file scope/,
  );
  assert.throws(
    () => validateGitPatchPaths([
      '--- a/src/main.py',
      '+++ b/src/main.py',
      '@@ -1,1 +1,1 @@',
      '-old',
      '+new',
      '',
    ].join('\n')),
    /git diff header/,
  );
  assert.throws(
    () => validateGitPatchPaths([
      'diff --git a/src/main.py b/src/main.py',
      '--- a/src/main.py',
      '+++ b/src/main.py',
      '-old',
      '+new',
      '',
    ].join('\n')),
    /text hunk header/,
  );
});

test('Git patch temp files are written with exclusive creation', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    assert.equal(gitPatchTempPath(path, workspaceRoot, 'abcdef12'), path.join(workspaceRoot, 'codeyo-abcdef12.patch'));
    assert.throws(() => gitPatchTempPath(path, workspaceRoot, '../bad'), /not valid/);

    const outsideRoot = path.join(path.dirname(workspaceRoot), 'outside-git-patch');
    const outsideFile = path.join(outsideRoot, 'patch.txt');
    fs.mkdirSync(outsideRoot, { recursive: true });
    fs.writeFileSync(outsideFile, 'outside\n', 'utf8');
    try {
      fs.symlinkSync(outsideFile, path.join(workspaceRoot, 'codeyo-abcdef12.patch'));
    } catch {
      return;
    }

    await assert.rejects(
      () => writeGitPatchTempFile(fs.promises, path, workspaceRoot, 'patch\n', { nonce: 'abcdef12' }),
      /EEXIST|file already exists/i,
    );
    assert.equal(fs.readFileSync(outsideFile, 'utf8'), 'outside\n');

    const tempFile = await writeGitPatchTempFile(
      fs.promises,
      path,
      workspaceRoot,
      'patch\n',
      { nonce: 'abcdef13' },
    );
    assert.equal(tempFile, path.join(workspaceRoot, 'codeyo-abcdef13.patch'));
    assert.equal(fs.readFileSync(tempFile, 'utf8'), 'patch\n');
  });
});

test('Git action policy normalizes allowed actions and rejects unsafe requests', () => {
  assert.deepEqual(permittedGitActionTypes, [
    'stage',
    'unstage',
    'commit',
    'create-branch',
    'switch-branch',
    'pull',
    'push',
    'discard',
    'delete-branch',
  ]);
  assert.deepEqual(
    normalizeGitAction({ type: 'stage', path: ' src\\main.py ', originalPath: ' src/old.py ' }),
    { type: 'stage', path: 'src/main.py', originalPath: 'src/old.py' },
  );
  assert.deepEqual(
    normalizeGitAction({ type: 'commit', message: '  Polish editor ', runResultId: 'run-1' }),
    { type: 'commit', message: 'Polish editor', runResultId: 'run-1' },
  );
  assert.deepEqual(
    normalizeGitAction({ type: 'delete-branch', name: ' feature/old ', confirmed: true }),
    { type: 'delete-branch', name: 'feature/old', confirmed: true },
  );
  assert.deepEqual(normalizeGitAction({ type: 'push' }), { type: 'push' });
  assert.throws(() => normalizeGitAction({ type: 'reset-hard' }), /not permitted/);
  assert.throws(() => normalizeGitAction({ type: 'discard', path: 'main.py' }), /confirmation/);
  assert.throws(() => normalizeGitAction({ type: 'delete-branch', name: 'feature/old' }), /confirmation/);
  assert.throws(() => normalizeGitAction({ type: 'create-branch', name: '-bad' }), /Branch name/);
  assert.throws(() => normalizeGitAction({ type: 'stage', path: '.env' }), /editable file scope/);
  assert.throws(() => normalizeGitAction({ type: 'stage', path: 'node_modules/pkg/index.js' }), /editable file scope/);
  assert.throws(() => normalizeGitAction({ type: 'stage', path: 'image.png' }), /editable file scope/);
  assert.throws(() => normalizeGitAction({ type: 'commit', message: '' }), /Commit message/);
  assert.throws(() => normalizeGitAction({ type: 'commit', message: 'x'.repeat(501) }), /too long/);
});

test('Git output policy sanitizes status, branches, history, commit detail, staged summary, and commit file output', () => {
  assert.deepEqual(
    parseGitStatus([
      '## main...origin/main [ahead 2, behind 1]',
      ' M src/main.py',
      '?? .env',
      'A  image.png',
      'R  src/old.py -> src/new.py',
      'R  ../secret.py -> src/kept.py',
      'Z  src/rejected.py',
      '',
    ].join('\n')),
    {
      branch: 'main',
      initial: false,
      ahead: 2,
      behind: 1,
      files: [
        { index: ' ', workingTree: 'M', path: 'src/main.py' },
        { index: 'R', workingTree: ' ', path: 'src/new.py', originalPath: 'src/old.py' },
      ],
    },
  );
  assert.deepEqual(
    parseGitBranches([
      'main',
      ' feature/editor ',
      'feature/editor',
      '-bad',
      'bad branch',
      'bad..branch',
      'bad.lock',
      'bad\u0001control',
      '',
    ].join('\n')),
    ['main', 'feature/editor'],
  );
  assert.deepEqual(
    parseGitHistory([
      'abc1234\tabc1234\tAlice\u0001Bad\t2026-05-27T00:00:00.000Z\tSubject\u0002with control',
      'not-a-rev\tbad\tMallory\tbad-date\tRejected',
    ].join('\n')),
    [{
      revision: 'abc1234',
      shortRevision: 'ABC1234',
      author: 'Alice Bad',
      authoredAt: '2026-05-27T00:00:00.000Z',
      subject: 'Subject with control',
    }],
  );
  assert.deepEqual(
    parseGitCommitHeading('abcdef1234567890\u0000Commit\u0001subject\n'),
    {
      revision: 'abcdef1234567890',
      shortRevision: 'ABCDEF1',
      subject: 'Commit subject',
    },
  );
  assert.equal(parseGitCommitHeading('not-a-revision\u0000Ignored'), null);
  assert.deepEqual(
    parseGitCommitFiles([
      'M\tsrc/main.py',
      'A\t.env',
      'R100\tsrc/old.py\tsrc/new.py',
      'Z\tsrc/ignored.py',
      '',
    ].join('\n')),
    [
      { status: 'M', path: 'src/main.py' },
      { status: 'R', originalPath: 'src/old.py', path: 'src/new.py' },
    ],
  );
  assert.deepEqual(
    parseGitNumstat([
      '10\t2\tsrc/main.py',
      '-\t-\tsrc/data.json',
      '5\t0\tsrc/{old => new}.py',
      '2\t1\tsrc/older.py => src/newer.py',
      '3\t1\t.env',
      '4\tbad\tsrc/unsafe.py',
      '1\t1\tnode_modules/pkg/index.js',
      '',
    ].join('\n')),
    {
      files: [
        { path: 'src/main.py', additions: 10, deletions: 2 },
        { path: 'src/data.json', additions: 0, deletions: 0, binary: true },
        { path: 'src/new.py', additions: 5, deletions: 0 },
        { path: 'src/newer.py', additions: 2, deletions: 1 },
      ],
      additions: 17,
      deletions: 3,
    },
  );
});

test('Git output policy bounds raw diff output', () => {
  const bounded = sanitizeGitDiffResult({
    exitCode: 0,
    stdout: 'x'.repeat(maxGitDiffOutputBytes + 2048),
    stderr: '',
    truncated: true,
  });
  assert.equal(bounded.exitCode, 0);
  assert.equal(bounded.truncated, true);
  assert.ok(bounded.stdout.endsWith(gitDiffTruncatedMarker));
  assert.ok(Buffer.byteLength(bounded.stdout, 'utf8') <= maxGitDiffOutputBytes);
  assert.deepEqual(
    sanitizeGitDiffResult({ exitCode: 'bad', stdout: null, stderr: undefined, timedOut: true }),
    { exitCode: 1, stdout: '', stderr: '', timedOut: true },
  );
});

test('journal metadata policy bounds internal Git and review metadata', () => {
  const manyFiles = Array.from({ length: 120 }, (_, index) => ({
    path: `src/${'deep/'.repeat(30)}file-${index}.py`,
    originalPath: `src/${'old/'.repeat(30)}file-${index}.py`,
    status: 'M',
    additions: 123,
    deletions: 4,
  }));
  const metadata = gitActionJournalMetadata({
    action: { type: 'commit' },
    result: { stdout: 'x'.repeat(100000), stderr: '' },
    commitSummary: { files: manyFiles, additions: 12345, deletions: 678 },
    commitDetail: { revision: 'abcdef1234567890', files: manyFiles },
    runEvidence: {
      id: 'run-1',
      entryFile: `src/${'nested/'.repeat(30)}main.py`,
      exitCode: 0,
      elapsedMs: 42,
      diagnostics: Array.from({ length: 99 }, () => ({})),
    },
  });

  assert.equal(metadata.action, 'commit');
  assert.equal(metadata.revision, 'abcdef1234567890');
  assert.equal(metadata.runResultId, 'run-1');
  assert.equal(metadata.filesTruncated, true);
  assert.equal(metadata.changedFilesTruncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(metadata), 'utf8') <= maxJournalMetadataBytes);

  const hunk = gitHunkJournalMetadata({
    action: 'discard-hunk',
    paths: manyFiles.map((file) => file.path),
  });
  assert.equal(hunk.action, 'discard-hunk');
  assert.equal(hunk.pathsTruncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(hunk), 'utf8') <= maxJournalMetadataBytes);

  const review = reviewSnapshotJournalMetadata({
    files: manyFiles,
    sourceRevision: 'abcdef1',
    runResultId: 'run-1',
  });
  assert.equal(review.sourceRevision, 'abcdef1');
  assert.equal(review.runResultId, 'run-1');
  assert.equal(review.filesTruncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(review), 'utf8') <= maxJournalMetadataBytes);

  assert.deepEqual(sanitizeJournalMetadataInput({ ok: true }), { ok: true });
  assert.throws(
    () => sanitizeJournalMetadataInput({ huge: 'x'.repeat(maxJournalMetadataBytes + 1) }),
    /too large/,
  );
});

test('terminal policy caps workspace sessions and cleans titles', () => {
  assert.equal(sanitizeTerminalTitle('  Project\nShell\t1  '), 'Project Shell 1');
  assert.equal(sanitizeTerminalTitle('\n\t'), 'Shell');
  assert.equal(sanitizeTerminalTitle('x'.repeat(80)).length, 40);
  assert.equal(maxTerminalInputChars, 64 * 1024);
  assert.equal(maxTerminalBufferChars, 200000);
  assert.equal(sanitizeTerminalInput('echo ok\r'), 'echo ok\r');
  assert.equal(sanitizeTerminalInput('x'.repeat(maxTerminalInputChars + 10)).length, maxTerminalInputChars);
  assert.throws(() => sanitizeTerminalInput(Buffer.from('not text')), /must be text/);
  assert.equal(boundedTerminalBuffer('x'.repeat(maxTerminalBufferChars + 4)).length, maxTerminalBufferChars);
  assert.equal(boundedTerminalBuffer(`${'x'.repeat(maxTerminalBufferChars)}tail`).endsWith('tail'), true);
  assert.equal(clampTerminalSize('120', 20, 500), 120);
  assert.equal(clampTerminalSize('bad', 20, 500), 20);
  assert.equal(clampTerminalSize(1000, 20, 500), 500);
  assert.deepEqual(resolveTerminalShell({ SHELL: '/bin/zsh' }, 'darwin'), { command: '/bin/zsh', args: ['-l'] });
  assert.deepEqual(resolveTerminalShell({ SHELL: '/tmp/custom-shell' }, 'darwin'), { command: '/bin/zsh', args: ['-l'] });
  assert.deepEqual(resolveTerminalShell({ SHELL: 'zsh;rm' }, 'darwin'), { command: '/bin/zsh', args: ['-l'] });
  assert.deepEqual(resolveTerminalShell({}, 'linux'), { command: '/bin/sh', args: ['-l'] });
  assert.deepEqual(resolveTerminalShell({}, 'win32'), { command: 'powershell.exe', args: ['-NoLogo'] });

  const sessions = new Map();
  for (let index = 0; index < maxTerminalSessionsPerWorkspace; index += 1) {
    sessions.set(`session-${index}`, { workspaceId: 'workspace-1' });
  }
  sessions.set('other-workspace', { workspaceId: 'workspace-2' });

  assert.equal(terminalSessionCount(sessions, 'workspace-1'), maxTerminalSessionsPerWorkspace);
  assert.throws(
    () => assertCanCreateTerminalSession(sessions, 'workspace-1'),
    /Terminal session limit reached/,
  );
  assert.doesNotThrow(() => assertCanCreateTerminalSession(sessions, 'workspace-2'));
});

test('app lifecycle policy defers resource cleanup until quit is committed', () => {
  assert.equal(desktopResourceCleanupEvent, 'will-quit');
  assert.equal(shouldCleanupDesktopResources('before-quit'), false);
  assert.equal(shouldCleanupDesktopResources('will-quit'), true);
  assert.equal(shouldAllowPreventedUnload(0), false);
  assert.equal(shouldAllowPreventedUnload(1), true);

  const prompt = unsavedQuitPromptOptions();
  assert.equal(prompt.defaultId, 0);
  assert.equal(prompt.cancelId, 0);
  assert.deepEqual(prompt.buttons, ['Stay in Codeyo', 'Quit Without Saving']);
});

test('tool command policy rejects inline shell syntax while preserving executable paths', () => {
  assert.equal(sanitizeToolCommand(' python3 ', 'python'), 'python3');
  assert.equal(sanitizeToolCommand('', 'python3'), 'python3');
  assert.equal(sanitizeToolCommand('/opt/homebrew/bin/python3', 'python'), '/opt/homebrew/bin/python3');
  assert.equal(
    sanitizeToolCommand('/Applications/Python 3.13/bin/python3', 'python'),
    '/Applications/Python 3.13/bin/python3',
  );
  assert.equal(sanitizeToolCommand('.venv/bin/python', 'python'), '.venv/bin/python');
  assert.deepEqual(sanitizeRunArgs([' --flag ', '', 'value'], 'profile arguments'), ['--flag', 'value']);
  assert.deepEqual(
    sanitizeToolCheck({ id: 'python', label: ' Python ', command: 'python3' }),
    { id: 'python', label: 'Python', command: 'python3' },
  );

  assert.throws(() => sanitizeToolCommand('python3 --version', 'python'), /inline arguments/);
  assert.throws(() => sanitizeToolCommand('python3;rm', 'python'), /shell metacharacters/);
  assert.throws(() => sanitizeToolCommand('python3|cat', 'python'), /shell metacharacters/);
  assert.throws(() => sanitizeToolCommand('-python', 'python'), /not an option/);
  assert.throws(() => sanitizeToolCommand('../bin/python', 'python'), /traverse/);
  assert.throws(() => sanitizeToolCommand('python\n3', 'python'), /control characters/);
  assert.throws(() => sanitizeRunArgs(['ok', 'bad\narg'], 'profile arguments'), /control characters/);
  assert.throws(() => sanitizeToolCheck({ id: 'node', label: 'Node', command: 'node' }), /not permitted/);
});

test('language service resolves bundled Pyright and reports missing clangd without crashing', () => {
  const pythonCommand = resolveLanguageServerCommand('python');
  assert.equal(pythonCommand.available, true);
  assert.equal(pythonCommand.label, 'Pyright');
  assert.match(pythonCommand.args[0], /pyright[/\\]langserver\.index\.js$/);

  const fakeProcess = { ...process, env: { PATH: path.join(os.tmpdir(), 'missing-codeyo-clangd') } };
  const clangdCommand = resolveLanguageServerCommand('cpp', {
    fsApi: fs,
    pathApi: path,
    processApi: fakeProcess,
  });
  assert.equal(clangdCommand.available, false);
  assert.equal(clangdCommand.label, 'clangd');
  assert.equal(executableOnPath('definitely-missing-codeyo-tool', { fsApi: fs, pathApi: path, processApi: fakeProcess }), false);
});

test('language service normalizes LSP payloads for renderer diagnostics and navigation', () => {
  const root = path.join(os.tmpdir(), 'codeyo-lang-root');
  const sourcePath = path.join(root, 'src', 'main.py');
  const diagnostic = normalizeLspDiagnostics([{
    range: {
      start: { line: 2, character: 4 },
      end: { line: 2, character: 11 },
    },
    severity: 1,
    code: 'reportUndefinedVariable',
    message: 'Unknown name',
  }], 'src/main.py')[0];
  assert.deepEqual(diagnostic, {
    path: 'src/main.py',
    line: 3,
    column: 5,
    endLine: 3,
    endColumn: 12,
    severity: 'error',
    source: 'lsp',
    code: 'reportUndefinedVariable',
    message: 'Unknown name',
  });

  const definitions = normalizeDefinitionResult([{
    uri: new URL(`file://${sourcePath}`).toString(),
    range: {
      start: { line: 0, character: 2 },
      end: { line: 0, character: 5 },
    },
  }], root, path);
  assert.deepEqual(definitions, [{
    path: 'src/main.py',
    line: 1,
    column: 3,
    endLine: 1,
    endColumn: 6,
  }]);

  const completions = normalizeCompletionResult({
    items: [{ label: 'print', kind: 3, detail: 'builtins', documentation: 'Write text' }],
  });
  assert.deepEqual(completions, [{
    label: 'print',
    detail: 'builtins',
    info: 'Write text',
    kind: 'function',
    apply: undefined,
  }]);

  const edits = normalizeTextEdits([
    {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 11 } },
      newText: 'int main() {',
    },
    { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 9 } }, newText: '  return 0;' },
    null,
    { newText: 'ignored without a range' },
  ], 'src/main.cpp');
  assert.deepEqual(edits, [
    { path: 'src/main.cpp', startLine: 1, startColumn: 1, endLine: 1, endColumn: 12, newText: 'int main() {' },
    { path: 'src/main.cpp', startLine: 2, startColumn: 1, endLine: 2, endColumn: 10, newText: '  return 0;' },
  ]);
  assert.deepEqual(normalizeTextEdits(null, 'src/main.cpp'), []);
});

test('language service normalizes workspace edits and code actions for rename and quick-fix', () => {
  const root = path.join(os.tmpdir(), 'codeyo-edit-root');
  const mainUri = new URL(`file://${path.join(root, 'src', 'main.py')}`).toString();
  const utilUri = new URL(`file://${path.join(root, 'src', 'util.py')}`).toString();

  const fromChanges = normalizeWorkspaceEdit({
    changes: {
      [mainUri]: [
        { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, newText: 'count' },
      ],
      [utilUri]: [
        { range: { start: { line: 2, character: 1 }, end: { line: 2, character: 6 } }, newText: 'count' },
      ],
    },
  }, root, path);
  assert.deepEqual(fromChanges, [
    { path: 'src/main.py', startLine: 1, startColumn: 1, endLine: 1, endColumn: 6, newText: 'count' },
    { path: 'src/util.py', startLine: 3, startColumn: 2, endLine: 3, endColumn: 7, newText: 'count' },
  ]);

  const fromDocChanges = normalizeWorkspaceEdit({
    documentChanges: [
      {
        textDocument: { uri: mainUri, version: 1 },
        edits: [{ range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } }, newText: '# fixed\n' }],
      },
    ],
  }, root, path);
  assert.deepEqual(fromDocChanges, [
    { path: 'src/main.py', startLine: 2, startColumn: 1, endLine: 2, endColumn: 1, newText: '# fixed\n' },
  ]);

  assert.deepEqual(normalizeWorkspaceEdit(null, root, path), []);

  const actions = normalizeCodeActions([
    { title: 'Run command', command: { command: 'do.thing' } },
    { title: 'Empty edit', edit: { changes: {} } },
    {
      title: 'Remove import',
      kind: 'quickfix',
      edit: {
        changes: {
          [mainUri]: [
            { range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } }, newText: '' },
          ],
        },
      },
    },
  ], root, path);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].title, 'Remove import');
  assert.equal(actions[0].kind, 'quickfix');
  assert.deepEqual(actions[0].edit.edits, [
    { path: 'src/main.py', startLine: 1, startColumn: 1, endLine: 2, endColumn: 1, newText: '' },
  ]);
});

test('language service maps spell issue offsets back into original document ranges', () => {
  const region = {
    startLine: 10,
    startColumn: 5,
    endLine: 11,
    endColumn: 8,
    text: 'first\nrecieve',
  };
  assert.deepEqual(positionInRegion(region, 0), { line: 10, column: 5 });
  assert.deepEqual(positionInRegion(region, 6), { line: 11, column: 1 });
  assert.deepEqual(positionInRegion(region, 13), { line: 11, column: 8 });

  const ranges = sanitizeSpellRanges([
    { startLine: 1, startColumn: 2, endLine: 1, endColumn: 9, text: 'recieve' },
    { startLine: 2, startColumn: 1, endLine: 2, endColumn: 1, text: '' },
  ]);
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].text, 'recieve');
});

test('IPC trust policy classifies every main-process channel', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8');
  const registeredChannels = [...mainSource.matchAll(/handle(?:Sync)?\('([^']+)'/g)]
    .map((match) => match[1]);
  const rootRecheckedChannels = [...(mainSource
    .match(/workspaceRootRecheckedChannels = new Set\(\[([\s\S]*?)\]\);/)?.[1] || '')
    .matchAll(/'([^']+)'/g)]
    .map((match) => match[1]);
  const classified = assertIpcTrustPolicyComplete(registeredChannels);

  assert.ok(classified.preTrustAllowed.includes('files:read'));
  assert.ok(classified.trustedWorkspaceRequired.includes('terminal:create'));
  assert.ok(classified.trustedWorkspaceRequired.includes('runner:run'));
  assert.ok(classified.trustedWorkspaceRequired.includes('git:action'));
  assert.ok(classified.trustedWorkspaceRequired.includes('settings:storage-mode'));
  assert.equal(isTrustedWorkspaceRequiredChannel('git:status'), true);
  assert.equal(isTrustedWorkspaceRequiredChannel('files:read'), false);
  assert.ok(rootRecheckedChannels.includes('files:list'));
  assert.ok(rootRecheckedChannels.includes('files:backup-recovery-sync'));
  assert.ok(rootRecheckedChannels.includes('terminal:create'));
  assert.ok(rootRecheckedChannels.includes('runner:run'));
  assert.ok(rootRecheckedChannels.includes('language:completion'));
  assert.ok(rootRecheckedChannels.includes('git:action'));
  assert.ok(rootRecheckedChannels.includes('journal:snapshot'));
  assert.ok(rootRecheckedChannels.includes('environment:check-tools'));
  assert.equal(rootRecheckedChannels.includes('terminal:kill'), false);
});

test('preload IPC surface matches main handlers and renderer events', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8');
  const registeredChannels = [...mainSource.matchAll(/handle(?:Sync)?\('([^']+)'/g)]
    .map((match) => match[1]);
  const preloadRequestChannels = [...preloadSource.matchAll(/(?:invoke|sendSync)\('([^']+)'/g)]
    .map((match) => match[1]);
  const preloadSubscriptionChannels = [...preloadSource.matchAll(/\bon\('([^']+)'/g)]
    .map((match) => match[1]);
  const mainPublishedChannels = [...mainSource.matchAll(/webContents\.send\('([^']+)'/g)]
    .map((match) => match[1]);

  const surface = assertPreloadIpcSurfaceComplete({
    registeredChannels,
    preloadRequestChannels,
    preloadSubscriptionChannels,
    mainPublishedChannels,
  });

  assert.ok(surface.requested.includes('files:backup-recovery-sync'));
  assert.ok(surface.requested.includes('git:apply-patch'));
  assert.deepEqual(surface.subscribed, [
    'files:changed',
    'language:diagnostics',
    'language:status-changed',
    'menu:open-terminal',
    'terminal:data',
    'terminal:exit',
  ]);
  assert.deepEqual(surface.published, [
    'files:changed',
    'language:diagnostics',
    'language:status-changed',
    'menu:open-terminal',
    'terminal:data',
    'terminal:exit',
  ]);
  assert.throws(
    () => assertPreloadIpcSurfaceComplete({
      registeredChannels,
      preloadRequestChannels: [...preloadRequestChannels, 'git:force-push'],
      preloadSubscriptionChannels,
      mainPublishedChannels,
    }),
    /unclassified preload requests|preload requests without main handlers/,
  );
});

test('workspace watcher starts only after workspace trust', () => {
  assert.equal(shouldWatchWorkspace(undefined), false);
  assert.equal(shouldWatchWorkspace({ id: 'workspace-1', trusted: false }), false);
  assert.equal(shouldWatchWorkspace({ id: 'workspace-1', trusted: 1 }), false);
  assert.equal(shouldWatchWorkspace({ id: 'workspace-1', trusted: true }), true);

  const mainSource = fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8');
  assert.ok([...mainSource.matchAll(/updateWorkspaceWatcher\(workspace\)/g)].length >= 2);
  assert.match(mainSource, /const trustedWorkspace = store\.trustWorkspace\(workspaceId\);\s+updateWorkspaceWatcher\(trustedWorkspace\);/);
});

test('Electron security policy locks down CSP, external links, and navigation', () => {
  const csp = desktopContentSecurityPolicy();
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
  assert.match(csp, /form-action 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /unsafe-eval/);

  assert.equal(shouldOpenExternalUrl('https://codeyo.dev/docs'), true);
  assert.equal(shouldOpenExternalUrl('http://codeyo.dev/docs'), false);
  assert.equal(shouldOpenExternalUrl('javascript:alert(1)'), false);
  assert.equal(shouldOpenExternalUrl('file:///tmp/index.html'), false);

  assert.equal(isPermittedNavigationUrl('app://current', 'app://current'), true);
  assert.equal(isPermittedNavigationUrl('http://localhost:4200/workspace', 'app://current'), true);
  assert.equal(isPermittedNavigationUrl('http://127.0.0.1:4200/workspace', 'app://current'), false);
  assert.equal(isPermittedNavigationUrl('https://codeyo.dev', 'app://current'), false);
  assert.equal(isPermittedNavigationUrl('file:///tmp/index.html', 'app://current'), false);
});

test('file operations rename files into nested folders without overwriting', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const sourcePath = path.join(workspaceRoot, 'main.py');
    const nestedPath = path.join(workspaceRoot, 'src', 'features', 'main.py');
    fs.writeFileSync(sourcePath, 'print("ready")\n', 'utf8');

    assert.deepEqual(
      await renameWorkspaceFile(fs.promises, path, sourcePath, nestedPath),
      { renamed: true },
    );
    assert.equal(fs.existsSync(sourcePath), false);
    assert.equal(fs.readFileSync(nestedPath, 'utf8'), 'print("ready")\n');

    const nextPath = path.join(workspaceRoot, 'src', 'features', 'next.py');
    fs.writeFileSync(nextPath, 'print("next")\n', 'utf8');
    await assert.rejects(
      () => renameWorkspaceFile(fs.promises, path, nestedPath, nextPath),
      /Cannot rename over an existing workspace file/,
    );
    assert.equal(fs.readFileSync(nestedPath, 'utf8'), 'print("ready")\n');
    assert.equal(fs.readFileSync(nextPath, 'utf8'), 'print("next")\n');
  });
});

test('file operations do not overwrite a rename target that appears after the precheck', async () => {
  const calls = [];
  const fakeFs = {
    lstat: async (target) => {
      if (target === '/workspace/source.py') {
        return { isFile: () => true };
      }
      const error = new Error('missing');
      error.code = 'ENOENT';
      throw error;
    },
    mkdir: async () => undefined,
    copyFile: async (_source, _target, mode) => {
      calls.push(['copyFile', mode]);
      const error = new Error('file already exists');
      error.code = 'EEXIST';
      throw error;
    },
    unlink: async () => {
      calls.push(['unlink']);
    },
  };

  await assert.rejects(
    () => renameWorkspaceFile(fakeFs, path, '/workspace/source.py', '/workspace/target.py'),
    /Cannot rename over an existing workspace file/,
  );
  assert.deepEqual(calls, [['copyFile', fs.constants.COPYFILE_EXCL]]);
});

test('file operations only rename regular files', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const sourceDir = path.join(workspaceRoot, 'src');
    const sourceFile = path.join(sourceDir, 'main.py');
    const sourceLink = path.join(sourceDir, 'link.py');
    const targetFile = path.join(workspaceRoot, 'renamed.py');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(sourceFile, 'print("ready")\n', 'utf8');

    await assert.rejects(
      () => renameWorkspaceFile(fs.promises, path, sourceDir, targetFile),
      /regular workspace files/,
    );
    assert.equal(fs.existsSync(sourceDir), true);
    assert.equal(fs.existsSync(targetFile), false);

    try {
      fs.symlinkSync(sourceFile, sourceLink);
    } catch {
      return;
    }
    await assert.rejects(
      () => renameWorkspaceFile(fs.promises, path, sourceLink, targetFile),
      /regular workspace files/,
    );
    assert.equal(fs.readFileSync(sourceFile, 'utf8'), 'print("ready")\n');
    assert.equal(fs.lstatSync(sourceLink).isSymbolicLink(), true);
    assert.equal(fs.existsSync(targetFile), false);
  });
});

test('workspace real path policy rejects symlink escapes', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const sourceDir = path.join(workspaceRoot, 'src');
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codeyo-outside-'));
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'main.py'), 'print("inside")\n', 'utf8');
    fs.writeFileSync(path.join(outsideRoot, 'secret.py'), 'print("outside")\n', 'utf8');

    assert.equal(
      await assertRealPathInsideWorkspace(fs.promises, path, workspaceRoot, path.join(sourceDir, 'main.py')),
      fs.realpathSync(path.join(sourceDir, 'main.py')),
    );
    assert.equal(
      await assertWritableParentInsideWorkspace(fs.promises, path, workspaceRoot, path.join(sourceDir, 'new.py')),
      fs.realpathSync(sourceDir),
    );
    assert.equal(await assertWorkspaceRootDirectory(fs.promises, workspaceRoot), fs.realpathSync(workspaceRoot));
    assert.equal(assertWorkspaceRootDirectorySync(fs, workspaceRoot), fs.realpathSync(workspaceRoot));

    const linkedRoot = path.join(path.dirname(workspaceRoot), 'linked-workspace-root');
    try {
      fs.symlinkSync(workspaceRoot, linkedRoot, 'dir');
    } catch {
      return;
    }
    await assert.rejects(
      () => assertWorkspaceRootDirectory(fs.promises, linkedRoot),
      /Workspace root must not be a symlink/,
    );
    assert.throws(
      () => assertWorkspaceRootDirectorySync(fs, linkedRoot),
      /Workspace root must not be a symlink/,
    );
    await assert.rejects(
      () => assertRealPathInsideWorkspace(
        fs.promises,
        path,
        linkedRoot,
        path.join(linkedRoot, 'src', 'main.py'),
      ),
      /Workspace root must not be a symlink/,
    );

    try {
      fs.symlinkSync(outsideRoot, path.join(sourceDir, 'outside'), 'dir');
    } catch {
      return;
    }
    await assert.rejects(
      () => assertRealPathInsideWorkspace(
        fs.promises,
        path,
        workspaceRoot,
        path.join(sourceDir, 'outside', 'secret.py'),
      ),
      /trusted workspace/,
    );
    await assert.rejects(
      () => assertWritableParentInsideWorkspace(
        fs.promises,
        path,
        workspaceRoot,
        path.join(sourceDir, 'outside', 'new.py'),
      ),
      /trusted workspace/,
    );
  });
});

test('gitignore policy appends .codeyo without following symlinks outside the workspace', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    assert.deepEqual(
      await appendCodeyoGitignore(fs.promises, path, workspaceRoot),
      { appended: true },
    );
    assert.equal(fs.readFileSync(path.join(workspaceRoot, '.gitignore'), 'utf8'), '.codeyo/\n');
    fs.writeFileSync(path.join(workspaceRoot, '.gitignore'), 'dist');
    assert.deepEqual(
      await appendCodeyoGitignore(fs.promises, path, workspaceRoot),
      { appended: true },
    );
    assert.equal(fs.readFileSync(path.join(workspaceRoot, '.gitignore'), 'utf8'), 'dist\n.codeyo/\n');
    assert.deepEqual(
      await appendCodeyoGitignore(fs.promises, path, workspaceRoot),
      { appended: false },
    );

    fs.unlinkSync(path.join(workspaceRoot, '.gitignore'));
    const outsideRoot = path.join(path.dirname(workspaceRoot), 'outside-gitignore');
    fs.mkdirSync(outsideRoot, { recursive: true });
    fs.writeFileSync(path.join(outsideRoot, '.gitignore'), 'outside\n', 'utf8');
    try {
      fs.symlinkSync(path.join(outsideRoot, '.gitignore'), path.join(workspaceRoot, '.gitignore'));
    } catch {
      return;
    }
    await assert.rejects(
      () => appendCodeyoGitignore(fs.promises, path, workspaceRoot),
      /Workspace \.gitignore must not be a symlink/,
    );
    assert.equal(fs.readFileSync(path.join(outsideRoot, '.gitignore'), 'utf8'), 'outside\n');
  });

  const openCalls = [];
  const fakeFs = {
    lstat: async (target) => target === '/workspace'
      ? {
        isSymbolicLink: () => false,
        isDirectory: () => true,
      }
      : {
      isSymbolicLink: () => false,
      isFile: () => true,
      },
    realpath: async (target) => target,
    open: async (_target, flags) => {
      openCalls.push(flags);
      const error = new Error('too many symbolic links');
      error.code = 'ELOOP';
      throw error;
    },
  };
  await assert.rejects(
    () => appendCodeyoGitignore(fakeFs, path, '/workspace'),
    /too many symbolic links/,
  );
  assert.equal(
    openCalls[0] & (fs.constants.O_NOFOLLOW || 0),
    fs.constants.O_NOFOLLOW || 0,
  );
  assert.equal(
    gitignoreOpenFlags(true) & (fs.constants.O_NOFOLLOW || 0),
    fs.constants.O_NOFOLLOW || 0,
  );
  assert.equal(
    gitignoreOpenFlags(false) & fs.constants.O_EXCL,
    fs.constants.O_EXCL,
  );
});

test('workspace list policy bounds files and directories without treating deep branches as global truncation', () => {
  assert.equal(maxWorkspaceListFiles, 400);
  assert.equal(maxWorkspaceListDirectories, 1200);
  assert.equal(maxWorkspaceListDepth, 7);

  const depthBudget = createWorkspaceListBudget({ maxFiles: 2, maxDirectories: 2, maxDepth: 1 });
  assert.equal(canEnterWorkspaceDirectory(depthBudget, 0), true);
  assert.equal(canEnterWorkspaceDirectory(depthBudget, 1), true);
  assert.equal(canEnterWorkspaceDirectory(depthBudget, 2), false);
  assert.equal(depthBudget.truncated, false);
  assert.equal(canAddWorkspaceFile(depthBudget), true);
  assert.equal(canAddWorkspaceFile(depthBudget), true);
  assert.equal(canAddWorkspaceFile(depthBudget), false);
  assert.equal(depthBudget.truncated, true);

  const directoryBudget = createWorkspaceListBudget({ maxFiles: 10, maxDirectories: 1, maxDepth: 7 });
  assert.equal(canEnterWorkspaceDirectory(directoryBudget, 0), true);
  assert.equal(canEnterWorkspaceDirectory(directoryBudget, 1), false);
  assert.equal(directoryBudget.truncated, true);
});

test('workspace file listing skips too-deep branches without aborting sibling files', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    fs.mkdirSync(path.join(workspaceRoot, 'aaa', 'bbb'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'aaa', 'bbb', 'hidden.py'), 'print("deep")\n', 'utf8');
    fs.writeFileSync(path.join(workspaceRoot, 'zzz.py'), 'print("sibling")\n', 'utf8');

    const budget = createWorkspaceListBudget({ maxFiles: 10, maxDirectories: 10, maxDepth: 1 });
    const files = await listWorkspaceFiles(fs.promises, workspaceRoot, {
      budget,
      languageFor: (filePath) => (filePath.endsWith('.py') ? 'python' : 'text'),
    });

    assert.equal(budget.truncated, false);
    assert.deepEqual(files, [{
      path: 'zzz.py',
      name: 'zzz.py',
      language: 'python',
      status: 'saved',
    }]);
  });
});

test('workspace file listing applies one global file cap across nested directories', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    for (const dirName of ['dir-a', 'dir-b']) {
      fs.mkdirSync(path.join(workspaceRoot, dirName), { recursive: true });
      for (let index = 0; index < 3; index += 1) {
        fs.writeFileSync(path.join(workspaceRoot, dirName, `file-${index}.py`), 'print("ok")\n', 'utf8');
      }
    }

    const budget = createWorkspaceListBudget({ maxFiles: 4, maxDirectories: 10, maxDepth: 7 });
    const files = await listWorkspaceFiles(fs.promises, workspaceRoot, {
      budget,
      languageFor: () => 'python',
    });

    assert.equal(budget.files, 4);
    assert.equal(budget.truncated, true);
    assert.deepEqual(files.map((file) => file.path), [
      'dir-a/file-0.py',
      'dir-a/file-1.py',
      'dir-a/file-2.py',
      'dir-b/file-0.py',
    ]);
  });
});

test('store persists recovery buffers and clears them explicitly', () => {
  withStore((store, workspaceRoot) => {
    const workspace = store.trustWorkspace(store.openWorkspace(workspaceRoot).id);
    store.putRecovery(workspace.id, 'src/main.py', 'print("draft")\n');
    assert.equal(store.getRecovery(workspace.id, 'src/main.py').content, 'print("draft")\n');
    assert.equal(store.listRecovery(workspace.id).length, 1);
    assert.deepEqual(store.clearRecovery(workspace.id, 'src/main.py'), { cleared: true });
    assert.equal(store.listRecovery(workspace.id).length, 0);
    assert.throws(() => store.putRecovery(workspace.id, '../secret.py', 'ignored\n'), /not valid/);
    assert.throws(() => store.putRecovery(workspace.id, 'src/object.py', { text: 'ignored' }), /not valid/);
    assert.throws(
      () => store.putRecovery(workspace.id, 'src/huge.py', 'x'.repeat(6 * 1024 * 1024)),
      /not valid/,
    );
    assert.throws(() => store.getRecovery(workspace.id, '.env'), /not permitted/);
  });
});

test('store keeps portable recovery buffers aligned with file moves and deletion', () => {
  withStore((store, workspaceRoot) => {
    const workspace = store.trustWorkspace(store.openWorkspace(workspaceRoot).id);
    store.setStorageMode(workspace.id, 'workspace-codeyo');
    store.putRecovery(workspace.id, 'src/main.py', 'print("draft")\n');
    assert.deepEqual(
      readPortable(workspaceRoot).recoveryBuffers.map((buffer) => buffer.filePath),
      ['src/main.py'],
    );

    assert.deepEqual(
      store.moveRecovery(workspace.id, 'src/main.py', 'src/renamed.py'),
      { moved: true },
    );
    assert.equal(store.getRecovery(workspace.id, 'src/main.py'), undefined);
    assert.equal(store.getRecovery(workspace.id, 'src/renamed.py').content, 'print("draft")\n');
    assert.deepEqual(
      readPortable(workspaceRoot).recoveryBuffers.map((buffer) => buffer.filePath),
      ['src/renamed.py'],
    );

    assert.deepEqual(store.clearRecovery(workspace.id, 'src/renamed.py'), { cleared: true });
    assert.deepEqual(readPortable(workspaceRoot).recoveryBuffers, []);
  });
});

test('store sanitizes legacy recovery buffers on read', () => {
  withStore((store, workspaceRoot) => {
    const workspace = store.trustWorkspace(store.openWorkspace(workspaceRoot).id);
    const insert = store.db.prepare(`
      INSERT INTO recovery_buffers (workspace_id, file_path, content, updated_at)
      VALUES (?, ?, ?, ?)
    `);
    insert.run(workspace.id, 'src/main.py', 'print("legacy")\n', 'not a date');
    insert.run(workspace.id, '../secret.py', 'ignored\n', '2026-05-27T00:00:00.000Z');
    insert.run(workspace.id, 'src/huge.py', 'x'.repeat(6 * 1024 * 1024), '2026-05-27T00:00:01.000Z');

    const buffer = store.getRecovery(workspace.id, 'src/main.py');
    const buffers = store.listRecovery(workspace.id);

    assert.equal(buffer.content, 'print("legacy")\n');
    assert.equal(buffer.updatedAt.length, '2026-05-27T00:00:00.000Z'.length);
    assert.equal(store.getRecovery(workspace.id, 'src/huge.py'), undefined);
    assert.deepEqual(buffers.map((entry) => entry.filePath), ['src/main.py']);
    assert.equal(buffers[0].updatedAt.length, '2026-05-27T00:00:00.000Z'.length);
  });
});

test('store sanitizes direct journal entries before persistence', () => {
  withStore((store, workspaceRoot) => {
    const workspace = store.trustWorkspace(store.openWorkspace(workspaceRoot).id);
    store.setStorageMode(workspace.id, 'workspace-codeyo');
    const saved = store.addJournal(
      workspace.id,
      'note',
      `Daily note ${'x'.repeat(5000)}`,
      null,
      { source: 'backend-test', nested: { ok: true } },
    );
    const [loaded] = store.listJournal(workspace.id);
    const [portable] = readPortable(workspaceRoot).journal;

    assert.equal(saved.kind, 'note');
    assert.equal(loaded.kind, 'note');
    assert.equal(loaded.body.length, 4000);
    assert.deepEqual(loaded.metadata, { source: 'backend-test', nested: { ok: true } });
    assert.equal(portable.body.length, 4000);
    assert.deepEqual(portable.metadata, { source: 'backend-test', nested: { ok: true } });
    assert.throws(() => store.addJournal(workspace.id, 'unsafe', 'body'), /kind is not valid/);
    assert.throws(() => store.addJournal(workspace.id, 'note', '   '), /body is required/);
    assert.throws(() => store.addJournal(workspace.id, 'note', 'body', 'bad id'), /snapshot id/);
    assert.throws(
      () => store.addJournal(workspace.id, 'note', 'body', null, { huge: 'x'.repeat(20 * 1024) }),
      /metadata is too large/,
    );
  });
});

test('store sanitizes legacy journal entries on read', () => {
  withStore((store, workspaceRoot) => {
    const workspace = store.trustWorkspace(store.openWorkspace(workspaceRoot).id);
    const now = '2026-05-27T00:00:00.000Z';
    const insert = store.db.prepare(`
      INSERT INTO journal_entries (id, workspace_id, kind, body, created_at, snapshot_id, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run(
      'legacy-1',
      workspace.id,
      'unexpected',
      `Legacy note ${'x'.repeat(5000)}`,
      now,
      'bad id',
      JSON.stringify({ keep: true }),
    );
    insert.run(
      'legacy-2',
      workspace.id,
      'git',
      'Git entry',
      'not a date',
      'snapshot-1',
      'not json',
    );
    insert.run('bad id', workspace.id, 'note', 'Bad id', now, null, '{}');
    insert.run('empty-body', workspace.id, 'note', '   ', now, null, '{}');

    const journal = store.listJournal(workspace.id);
    const byId = new Map(journal.map((entry) => [entry.id, entry]));
    const legacy1 = byId.get('legacy-1');
    const legacy2 = byId.get('legacy-2');

    assert.deepEqual([...byId.keys()].sort(), ['legacy-1', 'legacy-2']);
    assert.equal(legacy1.kind, 'note');
    assert.equal(legacy1.body.length, 4000);
    assert.equal(legacy1.snapshotId, undefined);
    assert.deepEqual(legacy1.metadata, { keep: true });
    assert.equal(legacy2.kind, 'git');
    assert.equal(legacy2.snapshotId, 'snapshot-1');
    assert.deepEqual(legacy2.metadata, {});
    assert.equal(legacy2.createdAt.length, '2026-05-27T00:00:00.000Z'.length);
  });
});

test('store writes portable snapshots with only editable unique files', () => {
  withStore((store, workspaceRoot) => {
    const workspace = store.trustWorkspace(store.openWorkspace(workspaceRoot).id);
    store.setStorageMode(workspace.id, 'workspace-codeyo');
    const snapshot = store.createSnapshot(workspace.id, [
      { path: 'src/main.py', content: 'print("ok")\n' },
      { path: 'src\\main.py', content: 'duplicate ignored\n' },
      { path: 'src/object.py', content: { text: 'ignored' } },
      { path: '../secret.py', content: 'ignored\n' },
      { path: 'node_modules/pkg/index.js', content: 'ignored\n' },
    ], 'Review safe files');

    assert.deepEqual(snapshot.files, [{ path: 'src/main.py', content: 'print("ok")\n' }]);
    const portable = readPortable(workspaceRoot);
    assert.equal(portable.snapshots.length, 1);
    assert.deepEqual(portable.snapshots[0].files, [{ path: 'src/main.py', content: 'print("ok")\n' }]);
  });
});

test('portable storage policy trims old entries to stay importable', () => {
  const payload = {
    version: 2,
    exportedAt: '2026-05-27T00:00:00.000Z',
    journal: [{ id: 'journal-1', body: 'small' }],
    snapshots: [
      { id: 'snapshot-new', files: [{ path: 'src/new.py', content: 'new'.repeat(10) }] },
      { id: 'snapshot-old', files: [{ path: 'src/old.py', content: 'old'.repeat(1000) }] },
    ],
    runResults: [{ id: 'run-1', stdout: 'run'.repeat(10) }],
    runProfiles: [{ id: 'python-current', command: 'python3' }],
    recoveryBuffers: [{ filePath: 'src/main.py', content: 'draft'.repeat(10) }],
  };

  const bounded = boundPortablePayload(payload, { maxBytes: 1400 });
  assert.ok(bounded.bytes <= 1400);
  assert.ok(Object.values(bounded.truncated).reduce((sum, count) => sum + count, 0) > 0);
  assert.equal(bounded.payload.snapshots[0].id, 'snapshot-new');
  assert.notEqual(bounded.payload.snapshots.at(-1)?.id, 'snapshot-old');
});

test('store compacts portable exports before they exceed the import limit', () => {
  withStore((store, workspaceRoot) => {
    const workspace = store.trustWorkspace(store.openWorkspace(workspaceRoot).id);
    store.setStorageMode(workspace.id, 'workspace-codeyo');
    const largeContent = 'x'.repeat(4 * 1024 * 1024);
    for (let index = 0; index < 7; index += 1) {
      store.createSnapshot(
        workspace.id,
        [{ path: `src/large-${index}.py`, content: largeContent }],
        `Large snapshot ${index}`,
      );
    }

    const portablePath = path.join(workspaceRoot, '.codeyo', 'journal.json');
    const exported = fs.readFileSync(portablePath, 'utf8');
    const portable = JSON.parse(exported);
    assert.ok(Buffer.byteLength(exported, 'utf8') <= maxPortablePayloadBytes);
    assert.ok(portable.snapshots.length < 7);
    assert.ok(portable.truncated.snapshots > 0);
  });
});

test('store sanitizes direct snapshots before persistence', () => {
  withStore((store, workspaceRoot) => {
    const workspace = store.trustWorkspace(store.openWorkspace(workspaceRoot).id);
    store.setStorageMode(workspace.id, 'workspace-codeyo');
    const run = store.saveRunResult(workspace.id, {
      profileId: 'python-current',
      profileName: 'Run Python Current File',
      entryFile: 'src/main.py',
      inputs: [{ path: 'src/main.py', content: 'print("run")\n' }],
      exitCode: 0,
      stdout: 'ok\n',
      stderr: '',
      elapsedMs: 5,
      startedAt: '2026-05-27T00:00:05.000Z',
      diagnostics: [],
    });
    const revision = 'abc1234';
    const snapshot = store.createSnapshot(
      workspace.id,
      [{ path: 'src/main.py', content: 'print("snapshot")\n' }],
      `Review note ${'x'.repeat(5000)}`,
      run.id,
      revision,
    );
    const loaded = store.getSnapshot(workspace.id, snapshot.id);
    const portable = readPortable(workspaceRoot).snapshots[0];

    assert.equal(snapshot.note.length, 4000);
    assert.equal(loaded.note.length, 4000);
    assert.equal(loaded.runResultId, run.id);
    assert.equal(loaded.sourceRevision, revision);
    assert.equal(portable.note.length, 4000);
    assert.equal(portable.runResultId, run.id);
    assert.equal(portable.sourceRevision, revision);
    assert.throws(
      () => store.createSnapshot(workspace.id, [{ path: '../secret.py', content: 'ignored\n' }], 'Review'),
      /at least one editable file/,
    );
    assert.throws(
      () => store.createSnapshot(workspace.id, [{ path: 'src/main.py', content: 'ok\n' }], '   '),
      /note is required/,
    );
    assert.throws(
      () => store.createSnapshot(workspace.id, [{ path: 'src/main.py', content: 'ok\n' }], 'Review', 'bad id'),
      /run result id/,
    );
    assert.throws(
      () => store.createSnapshot(workspace.id, [{ path: 'src/main.py', content: 'ok\n' }], 'Review', null, 'main'),
      /source revision/,
    );
  });
});

test('store enforces workspace ownership for snapshot references', () => {
  withStore((store, workspaceRoot) => {
    const otherRoot = path.join(path.dirname(workspaceRoot), 'other-snapshot-workspace');
    fs.mkdirSync(path.join(otherRoot, 'src'), { recursive: true });
    const workspaceA = store.trustWorkspace(store.openWorkspace(workspaceRoot).id);
    const workspaceB = store.trustWorkspace(store.openWorkspace(otherRoot).id);
    const runA = store.saveRunResult(workspaceA.id, {
      profileId: 'python-current',
      profileName: 'Workspace A run',
      entryFile: 'src/main.py',
      inputs: [],
      exitCode: 0,
      stdout: 'ok\n',
      stderr: '',
      elapsedMs: 1,
      startedAt: '2026-05-27T00:00:05.000Z',
      diagnostics: [],
    });
    const snapshotA = store.createSnapshot(
      workspaceA.id,
      [{ path: 'src/main.py', content: 'print("a")\n' }],
      'Workspace A snapshot',
      runA.id,
    );

    assert.equal(store.getSnapshot(workspaceB.id, snapshotA.id), undefined);
    assert.throws(
      () => store.createSnapshot(
        workspaceB.id,
        [{ path: 'src/main.py', content: 'print("b")\n' }],
        'Workspace B snapshot',
        runA.id,
      ),
      /run evidence does not belong/,
    );
    assert.throws(
      () => store.addJournal(workspaceB.id, 'review', 'Workspace B review', snapshotA.id),
      /snapshot does not belong/,
    );
  });
});

test('store sanitizes legacy run results and snapshots on read', () => {
  withStore((store, workspaceRoot) => {
    const workspace = store.trustWorkspace(store.openWorkspace(workspaceRoot).id);
    const now = '2026-05-27T00:00:05.000Z';
    store.db.prepare(`
      INSERT INTO run_results (id, workspace_id, result_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run('legacy-run', workspace.id, JSON.stringify({
      id: 'legacy-run',
      profileId: 'python-current',
      profileName: 'Legacy Python',
      entryFile: 'src/main.py',
      inputs: [
        { path: 'src/main.py', content: 'print("legacy")\n' },
        { path: '../secret.py', content: 'ignored\n' },
      ],
      exitCode: 1,
      stdout: 'x'.repeat(700 * 1024),
      stderr: '',
      elapsedMs: 10,
      startedAt: now,
      diagnostics: [
        { path: 'src/main.py', line: 2, severity: 'warning', message: 'kept' },
        { path: '../secret.py', line: 1, severity: 'error', message: 'ignored' },
      ],
    }), now);
    store.db.prepare(`
      INSERT INTO run_results (id, workspace_id, result_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run('bad-run', workspace.id, '{bad json', now);
    store.db.prepare(`
      INSERT INTO snapshots (id, workspace_id, note, files_json, created_at, source_revision, run_result_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'legacy-snap',
      workspace.id,
      `Legacy snapshot ${'x'.repeat(5000)}`,
      JSON.stringify([
        { path: 'src/main.py', content: 'print("snapshot")\n' },
        { path: '../secret.py', content: 'ignored\n' },
      ]),
      now,
      'main',
      'bad id',
    );
    store.db.prepare(`
      INSERT INTO snapshots (id, workspace_id, note, files_json, created_at, source_revision, run_result_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('bad-snap', workspace.id, 'Bad snapshot', JSON.stringify([{ path: '../secret.py', content: 'ignored\n' }]), now, null, null);

    const runs = store.listRunResults(workspace.id);
    const run = store.getRunResult(workspace.id, 'legacy-run');
    const snapshot = store.getSnapshot(workspace.id, 'legacy-snap');
    const portableSnapshots = store.listPortableSnapshots(workspace.id);

    assert.deepEqual(runs.map((result) => result.id), ['legacy-run']);
    assert.equal(store.getRunResult(workspace.id, 'bad-run'), undefined);
    assert.deepEqual(run.inputs, [{ path: 'src/main.py', content: 'print("legacy")\n' }]);
    assert.equal(run.diagnostics.length, 1);
    assert.ok(run.stdout.includes('[CODEYO PORTABLE DATA TRUNCATED]'));
    assert.equal(snapshot.note.length, 4000);
    assert.deepEqual(snapshot.files, [{ path: 'src/main.py', content: 'print("snapshot")\n' }]);
    assert.equal(snapshot.sourceRevision, undefined);
    assert.equal(snapshot.runResultId, undefined);
    assert.equal(store.getSnapshot(workspace.id, 'bad-snap'), undefined);
    assert.deepEqual(portableSnapshots.map((entry) => entry.id), ['legacy-snap']);
  });
});

test('store bounds direct run results before persistence', () => {
  withStore((store, workspaceRoot) => {
    const workspace = store.trustWorkspace(store.openWorkspace(workspaceRoot).id);
    const saved = store.saveRunResult(workspace.id, {
      profileId: 'python-current',
      profileName: 'Run Python Current File',
      entryFile: 'src/main.py',
      inputs: [
        { path: 'src/main.py', content: 'print("run")\n' },
        { path: 'src/object.py', content: { text: 'ignored' } },
        { path: '../secret.py', content: 'ignored\n' },
      ],
      exitCode: 1,
      stdout: 'x'.repeat(700 * 1024),
      stderr: 'y'.repeat(700 * 1024),
      elapsedMs: 5,
      startedAt: '2026-05-27T00:00:05.000Z',
      diagnostics: [
        { path: 'src/main.py', line: 3, severity: 'warning', message: 'kept' },
        { path: '../secret.py', line: 1, severity: 'error', message: 'ignored' },
      ],
    });
    const loaded = store.getRunResult(workspace.id, saved.id);

    assert.equal(loaded.profileId, 'python-current');
    assert.deepEqual(loaded.inputs, [{ path: 'src/main.py', content: 'print("run")\n' }]);
    assert.equal(loaded.diagnostics.length, 1);
    assert.equal(loaded.diagnostics[0].path, 'src/main.py');
    assert.equal(loaded.diagnostics[0].severity, 'warning');
    assert.ok(loaded.stdout.includes('[CODEYO PORTABLE DATA TRUNCATED]'));
    assert.ok(loaded.stderr.includes('[CODEYO PORTABLE DATA TRUNCATED]'));
    assert.ok(Buffer.byteLength(JSON.stringify(loaded), 'utf8') < 1200 * 1024);
  });
});

test('store sanitizes direct run profiles before persistence', () => {
  withStore((store, workspaceRoot) => {
    const workspace = store.trustWorkspace(store.openWorkspace(workspaceRoot).id);
    store.setStorageMode(workspace.id, 'workspace-codeyo');
    const saved = store.saveProfile(workspace.id, {
      id: 'cpp-current',
      name: 'Run C++ Current File',
      language: 'cpp',
      command: 'clang++ --version',
      entryFile: 'src/main.cpp',
      sourceFiles: ['src/main.cpp', 'src\\util.cpp', '../secret.cpp'],
      args: ['-O2', 'bad\narg'],
      programArgs: ['--case', 'bad\0arg'],
    });

    assert.deepEqual(saved, {
      id: 'cpp-current',
      name: 'Run C++ Current File',
      language: 'cpp',
      entryFile: 'src/main.cpp',
      sourceFiles: ['src/main.cpp', 'src/util.cpp'],
      args: ['-O2'],
      programArgs: ['--case'],
    });
    assert.deepEqual(store.listProfiles(workspace.id), [saved]);
    assert.deepEqual(readPortable(workspaceRoot).runProfiles, [saved]);
    assert.throws(
      () => store.saveProfile(workspace.id, { id: 'bad id', language: 'python', entryFile: 'src/main.py' }),
      /Run profile is not valid/,
    );
  });
});

test('store imports portable data through path and payload sanitizers', () => {
  withStore((store, workspaceRoot) => {
    fs.mkdirSync(path.join(workspaceRoot, '.codeyo'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, '.codeyo', 'journal.json'), JSON.stringify({
      version: 2,
      exportedAt: '2026-05-27T00:00:00.000Z',
      journal: [
        { id: 'entry-1', kind: 'git', body: 'Imported git entry', createdAt: '2026-05-27T00:00:00.000Z', metadata: { ok: true } },
        { id: 'entry-2', kind: 'unexpected', body: 'Fallback kind', createdAt: '2026-05-27T00:00:01.000Z' },
        { id: 'bad id', kind: 'note', body: 'Rejected id' },
      ],
      snapshots: [{
        id: 'snap-1',
        note: 'Imported snapshot',
        createdAt: '2026-05-27T00:00:02.000Z',
        files: [
          { path: 'src/main.py', content: 'print("snapshot")\n' },
          { path: '../secret.py', content: 'ignored\n' },
          { path: '.env', content: 'ignored\n' },
        ],
      }],
      runProfiles: [{
        id: 'python-main',
        name: 'Run Python',
        language: 'python',
        command: 'python3 --version',
        entryFile: 'src/main.py',
        sourceFiles: ['src/helper.py', '../bad.py'],
        args: ['--safe', 'bad\narg'],
      }],
      runResults: [{
        id: 'run-1',
        profileId: 'python-main',
        profileName: 'Run Python',
        entryFile: 'src/main.py',
        inputs: [{ path: 'src/main.py', content: 'print("run")\n' }],
        exitCode: 1,
        stdout: 'x'.repeat(700 * 1024),
        stderr: '',
        elapsedMs: 3,
        startedAt: '2026-05-27T00:00:03.000Z',
        diagnostics: [
          { path: '../bad.py', line: 1, message: 'ignored' },
          { path: 'src/main.py', line: 2, severity: 'warning', message: 'kept' },
        ],
      }],
      recoveryBuffers: [
        { filePath: 'src/main.py', content: 'print("recovery")\n', updatedAt: '2026-05-27T00:00:04.000Z' },
        { filePath: 'node_modules/pkg/index.js', content: 'ignored\n' },
      ],
    }, null, 2));

    const workspace = store.openWorkspace(workspaceRoot);
    const migration = store.setStorageMode(workspace.id, 'workspace-codeyo');
    assert.deepEqual(migration, { storageMode: 'workspace-codeyo', migrated: true, imported: true });

    const journal = store.listJournal(workspace.id);
    assert.deepEqual(journal.map((entry) => entry.id).sort(), ['entry-1', 'entry-2']);
    assert.equal(journal.find((entry) => entry.id === 'entry-2').kind, 'note');

    const snapshot = store.getSnapshot(workspace.id, 'snap-1');
    assert.deepEqual(snapshot.files, [{ path: 'src/main.py', content: 'print("snapshot")\n' }]);

    const profiles = store.listProfiles(workspace.id);
    assert.equal(profiles[0].command, undefined);
    assert.deepEqual(profiles[0].sourceFiles, ['src/helper.py']);
    assert.deepEqual(profiles[0].args, ['--safe']);

    const run = store.getRunResult(workspace.id, 'run-1');
    assert.equal(run.diagnostics.length, 1);
    assert.equal(run.diagnostics[0].path, 'src/main.py');
    assert.ok(run.stdout.includes('[CODEYO PORTABLE DATA TRUNCATED]'));

    assert.deepEqual(store.listRecovery(workspace.id).map((buffer) => buffer.filePath), ['src/main.py']);
  });
});

test('store refuses to import or export portable data through a .codeyo symlink', () => {
  withStore((store, workspaceRoot) => {
    const outsideRoot = path.join(path.dirname(workspaceRoot), 'outside-codeyo');
    fs.mkdirSync(outsideRoot, { recursive: true });
    fs.writeFileSync(path.join(outsideRoot, 'journal.json'), JSON.stringify({
      version: 2,
      exportedAt: '2026-05-27T00:00:00.000Z',
      journal: [{
        id: 'outside-entry',
        kind: 'note',
        body: 'Outside symlink entry',
        createdAt: '2026-05-27T00:00:00.000Z',
      }],
    }), 'utf8');
    try {
      fs.symlinkSync(outsideRoot, path.join(workspaceRoot, '.codeyo'), 'dir');
    } catch {
      return;
    }

    const workspace = store.trustWorkspace(store.openWorkspace(workspaceRoot).id);
    assert.deepEqual(store.importPortable(workspace.id), { imported: false });
    assert.deepEqual(store.listJournal(workspace.id), []);
    assert.throws(
      () => store.setStorageMode(workspace.id, 'workspace-codeyo'),
      /Portable storage directory must not be a symlink/,
    );
    assert.equal(store.getWorkspace(workspace.id).storageMode, 'app-db');
    assert.match(fs.readFileSync(path.join(outsideRoot, 'journal.json'), 'utf8'), /Outside symlink entry/);
  });
});

test('portable journal atomic writer refuses to overwrite preexisting temp paths', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const codeyoRoot = path.join(workspaceRoot, '.codeyo');
    const outsideRoot = path.join(path.dirname(workspaceRoot), 'outside-portable-temp');
    const outsideFile = path.join(outsideRoot, 'journal.json');
    fs.mkdirSync(codeyoRoot, { recursive: true });
    fs.mkdirSync(outsideRoot, { recursive: true });
    fs.writeFileSync(outsideFile, 'outside\n', 'utf8');
    try {
      fs.symlinkSync(outsideFile, path.join(codeyoRoot, 'journal.abcdef12.tmp'));
    } catch {
      return;
    }

    assert.throws(
      () => writePortableJournalAtomically(
        fs,
        path,
        codeyoRoot,
        path.join(codeyoRoot, 'journal.json'),
        '{"ok":true}\n',
        { nonce: 'abcdef12' },
      ),
      /EEXIST|file already exists/i,
    );
    assert.equal(fs.readFileSync(outsideFile, 'utf8'), 'outside\n');

    assert.deepEqual(
      writePortableJournalAtomically(
        fs,
        path,
        codeyoRoot,
        path.join(codeyoRoot, 'journal.json'),
        '{"ok":true}\n',
        { nonce: 'abcdef13' },
      ),
      { written: true },
    );
    assert.equal(fs.readFileSync(path.join(codeyoRoot, 'journal.json'), 'utf8'), '{"ok":true}\n');
  });
});

test('store isolates portable import ids across workspaces', () => {
  withStore((store, workspaceRoot) => {
    const otherRoot = path.join(path.dirname(workspaceRoot), 'other-workspace');
    fs.mkdirSync(path.join(otherRoot, '.codeyo'), { recursive: true });
    const workspaceA = store.trustWorkspace(store.openWorkspace(workspaceRoot).id);
    const workspaceB = store.trustWorkspace(store.openWorkspace(otherRoot).id);
    const now = '2026-05-27T00:00:00.000Z';

    store.db.prepare(`
      INSERT INTO run_results (id, workspace_id, result_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run('shared-run', workspaceA.id, JSON.stringify({
      id: 'shared-run',
      profileId: 'python-current',
      profileName: 'Workspace A run',
      entryFile: 'src/main.py',
      inputs: [],
      exitCode: 0,
      stdout: 'workspace A\n',
      stderr: '',
      elapsedMs: 1,
      startedAt: now,
      diagnostics: [],
    }), now);
    store.db.prepare(`
      INSERT INTO snapshots (id, workspace_id, note, files_json, created_at, source_revision, run_result_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'shared-snap',
      workspaceA.id,
      'Workspace A snapshot',
      JSON.stringify([{ path: 'src/main.py', content: 'print("a")\n' }]),
      now,
      null,
      'shared-run',
    );
    store.db.prepare(`
      INSERT INTO journal_entries (id, workspace_id, kind, body, created_at, snapshot_id, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('shared-entry', workspaceA.id, 'review', 'Workspace A journal', now, 'shared-snap', '{}');

    fs.writeFileSync(path.join(otherRoot, '.codeyo', 'journal.json'), JSON.stringify({
      version: 2,
      exportedAt: now,
      runResults: [{
        id: 'shared-run',
        profileId: 'python-current',
        profileName: 'Workspace B run',
        entryFile: 'src/main.py',
        inputs: [],
        exitCode: 0,
        stdout: 'workspace B\n',
        stderr: '',
        elapsedMs: 1,
        startedAt: now,
        diagnostics: [],
      }],
      snapshots: [{
        id: 'shared-snap',
        note: 'Workspace B snapshot',
        files: [{ path: 'src/main.py', content: 'print("b")\n' }],
        createdAt: now,
        runResultId: 'shared-run',
      }],
      journal: [{
        id: 'shared-entry',
        kind: 'review',
        body: 'Workspace B journal',
        createdAt: now,
        snapshotId: 'shared-snap',
      }],
    }), 'utf8');

    store.setStorageMode(workspaceB.id, 'workspace-codeyo');
    const [journalA] = store.listJournal(workspaceA.id);
    const [journalB] = store.listJournal(workspaceB.id);
    const [runB] = store.listRunResults(workspaceB.id);
    const [snapshotB] = store.listPortableSnapshots(workspaceB.id);

    assert.equal(journalA.id, 'shared-entry');
    assert.equal(journalA.body, 'Workspace A journal');
    assert.equal(store.getRunResult(workspaceA.id, 'shared-run').stdout, 'workspace A\n');
    assert.equal(store.getSnapshot(workspaceA.id, 'shared-snap').note, 'Workspace A snapshot');

    assert.notEqual(runB.id, 'shared-run');
    assert.notEqual(snapshotB.id, 'shared-snap');
    assert.notEqual(journalB.id, 'shared-entry');
    assert.equal(runB.stdout, 'workspace B\n');
    assert.equal(snapshotB.runResultId, runB.id);
    assert.equal(journalB.snapshotId, snapshotB.id);
  });
});

runTests();

function test(name, fn) {
  tests.push({ name, fn });
}

function withStore(fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codeyo-backend-test-'));
  try {
    const workspaceRoot = path.join(tempRoot, 'workspace');
    const userDataRoot = path.join(tempRoot, 'user-data');
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    const store = new CodeyoStore(userDataRoot);
    fn(store, workspaceRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function withTempWorkspace(fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codeyo-file-op-test-'));
  try {
    const workspaceRoot = path.join(tempRoot, 'workspace');
    fs.mkdirSync(workspaceRoot, { recursive: true });
    await fn(workspaceRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function readPortable(workspaceRoot) {
  return JSON.parse(fs.readFileSync(path.join(workspaceRoot, '.codeyo', 'journal.json'), 'utf8'));
}

async function runTests() {
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok - ${name}`);
    } catch (error) {
      console.error(`not ok - ${name}`);
      console.error(error);
      process.exitCode = 1;
      break;
    }
  }

  if (!process.exitCode) {
    console.log(`${tests.length} backend checks passed.`);
  }
}
