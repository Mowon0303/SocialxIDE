const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const nativeFs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const pty = require('node-pty');
const { CodeyoStore } = require('./storage.cjs');
const { cppCompileSourceFiles } = require('./cpp-run-policy.cjs');
const { normalizeGitAction } = require('./git-action-policy.cjs');
const {
  assertGitPatchPayload,
  assertGitPatchSafety,
  isUntrackedStatus,
  trackedDiscardArgs,
  validateGitPatchPaths,
  writeGitPatchTempFile,
} = require('./git-discard-policy.cjs');
const {
  maxGitDiffOutputBytes,
  parseGitBranches,
  parseGitCommitFiles,
  parseGitCommitHeading,
  parseGitHistory,
  parseGitNumstat,
  parseGitStatus,
  sanitizeGitDiffResult,
} = require('./git-output-policy.cjs');
const { appendCodeyoGitignore } = require('./gitignore-policy.cjs');
const {
  assertKnownIpcChannel,
  isTrustedWorkspaceRequiredChannel,
} = require('./ipc-trust-policy.cjs');
const {
  desktopContentSecurityPolicy,
  isPermittedNavigationUrl,
  shouldOpenExternalUrl,
} = require('./security-policy.cjs');
const {
  assertCanCreateTerminalSession,
  boundedTerminalBuffer,
  clampTerminalSize,
  resolveTerminalShell,
  sanitizeTerminalInput,
  sanitizeTerminalTitle,
} = require('./terminal-policy.cjs');
const {
  sanitizeRunArgs,
  sanitizeTextField,
  sanitizeToolCheck,
  sanitizeToolCommand,
} = require('./tool-command-policy.cjs');
const {
  assertEditableRelativePath,
  ignoredDirectories,
  normalizedRelativePath,
  portableEditableRelativePath,
} = require('./path-policy.cjs');
const { renameWorkspaceFile } = require('./file-operations.cjs');
const {
  assertRealPathInsideWorkspace,
  assertWorkspaceRootDirectory,
  assertWorkspaceRootDirectorySync,
  assertWritableParentInsideWorkspace,
} = require('./workspace-path-policy.cjs');
const { shouldWatchWorkspace } = require('./workspace-watch-policy.cjs');
const { listWorkspaceFiles } = require('./workspace-file-listing.cjs');
const {
  writeConflictState,
  writeWorkspaceTextFile,
} = require('./file-write-policy.cjs');
const {
  assertGitTextObjectSize,
  assertWorkspaceTextContentSize,
  gitTextObjectReadBufferBytes,
  readWorkspaceTextFile,
  readWorkspaceTextFileBounded,
} = require('./file-content-policy.cjs');
const {
  gitActionJournalMetadata,
  gitHunkJournalMetadata,
  reviewSnapshotJournalMetadata,
  sanitizeJournalMetadataInput,
} = require('./journal-metadata-policy.cjs');
const {
  runInputFailureResult,
  runInputReadError,
} = require('./runner-input-policy.cjs');
const {
  appendRunOutputTruncatedDiagnostic,
  appendRunOutputTruncatedNotice,
  runOutputTruncatedMessage,
  runToolOutputBufferBytes,
} = require('./runner-output-policy.cjs');
const {
  cleanupRunnerTempBuild,
  createRunnerTempBuild,
} = require('./runner-temp-policy.cjs');
const {
  desktopResourceCleanupEvent,
  shouldAllowPreventedUnload,
  unsavedQuitPromptOptions,
} = require('./app-lifecycle-policy.cjs');

let mainWindow;
let store;
let workspaceWatcher;
const terminals = new Map();
const watchedChangeTimers = new Map();
const runOutputByteLimit = 512 * 1024;
const runInputEvidenceByteLimit = 2 * 1024 * 1024;
const startupSmoke = process.env.CODEYO_STARTUP_SMOKE === '1';
const workspaceRootRecheckedChannels = new Set([
  'files:list',
  'files:read',
  'files:write',
  'files:create',
  'files:rename',
  'files:remove',
  'files:backup-recovery',
  'files:backup-recovery-sync',
  'files:recovery',
  'files:list-recovery',
  'files:clear-recovery',
  'terminal:create',
  'runner:run',
  'runner:save-profile',
  'git:status',
  'git:branches',
  'git:staged-summary',
  'git:diff',
  'git:compare',
  'git:history',
  'git:commit-detail',
  'git:compare-commit',
  'git:apply-patch',
  'git:action',
  'journal:add',
  'journal:snapshot',
  'settings:storage-mode',
  'environment:check-tools',
]);

if (process.env.CODEYO_USER_DATA_DIR) {
  app.setPath('userData', path.resolve(process.env.CODEYO_USER_DATA_DIR));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'Codeyo',
    width: 1440,
    height: 940,
    minWidth: 1040,
    minHeight: 700,
    show: !startupSmoke,
    backgroundColor: '#f7f1e3',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [desktopContentSecurityPolicy()],
      },
    });
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (shouldOpenExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow.webContents.getURL();
    if (!isPermittedNavigationUrl(url, current)) {
      event.preventDefault();
    }
  });
  mainWindow.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(mainWindow, unsavedQuitPromptOptions());
    if (shouldAllowPreventedUnload(choice)) {
      event.preventDefault();
    }
  });

  const devUrl = process.env.CODEYO_DEV_SERVER_URL;
  mainWindow.codeyoLoadPromise = devUrl
    ? mainWindow.loadURL(devUrl)
    : mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'atelier-ide', 'browser', 'index.html'));
  return mainWindow;
}

app.whenReady().then(async () => {
  store = new CodeyoStore(app.getPath('userData'));
  registerHandlers();
  const window = createWindow();
  if (startupSmoke) {
    await runStartupSmoke(window);
    return;
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

async function runStartupSmoke(window) {
  const timeout = setTimeout(() => {
    console.error('CODEYO_STARTUP_SMOKE_TIMEOUT');
    app.exit(1);
  }, process.env.CODEYO_STARTUP_SMOKE_DEEP === '1' ? 30000 : 15000);
  try {
    await window.codeyoLoadPromise;
    if (process.env.CODEYO_STARTUP_SMOKE_DEEP === '1') {
      await runStartupDeepSmoke();
    }
    console.log('CODEYO_STARTUP_SMOKE_OK');
    clearTimeout(timeout);
    app.quit();
    setTimeout(() => app.exit(0), 1000).unref();
  } catch (error) {
    clearTimeout(timeout);
    console.error(`CODEYO_STARTUP_SMOKE_FAILED: ${error?.message || error}`);
    app.exit(1);
  }
}

async function runStartupDeepSmoke() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codeyo-main-smoke-'));
  try {
    const workspaceRoot = path.join(tempRoot, 'workspace');
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, '.gitignore'), '.codeyo/\n', 'utf8');
    await fs.writeFile(path.join(workspaceRoot, 'src', 'main.py'), 'print("codeyo main smoke")\n', 'utf8');

    const opened = store.openWorkspace(workspaceRoot);
    const workspace = store.trustWorkspace(opened.id);
    if (!workspace?.trusted) {
      throw new Error('Deep startup smoke could not trust workspace');
    }

    const mainPath = withinEditableFile(workspace, 'src/main.py');
    await fs.writeFile(mainPath, 'print("codeyo main smoke edited")\n', 'utf8');
    const content = await fs.readFile(mainPath, 'utf8');
    if (!content.includes('edited')) {
      throw new Error('Deep startup smoke could not read edited workspace file');
    }

    store.setStorageMode(workspace.id, 'workspace-codeyo');
    store.putRecovery(workspace.id, 'src/main.py', content);
    const snapshot = store.createSnapshot(workspace.id, [{ path: 'src/main.py', content }], 'Startup deep smoke');
    store.addJournal(workspace.id, 'review', 'Startup deep smoke', snapshot.id);
    const portablePath = path.join(workspaceRoot, '.codeyo', 'journal.json');
    if (!nativeFs.existsSync(portablePath)) {
      throw new Error('Deep startup smoke did not write .codeyo journal');
    }

    const pythonResult = await runProfile(workspace, {
      id: 'startup-smoke-python',
      name: 'Startup Smoke Python',
      language: 'python',
      command: process.env.CODEYO_SMOKE_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
      entryFile: 'src/main.py',
    });
    if (pythonResult.exitCode !== 0 || !pythonResult.stdout.includes('codeyo main smoke edited')) {
      throw new Error(`Deep startup smoke Python runner failed: ${pythonResult.stderr || pythonResult.stdout}`);
    }

    await runStartupGitSmoke(workspaceRoot);
    await runStartupPtySmoke(workspaceRoot);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function runStartupGitSmoke(workspaceRoot) {
  let init = await exec('git', ['init', '-b', 'main'], workspaceRoot).catch((error) => ({
    exitCode: 1,
    stdout: '',
    stderr: error.message,
  }));
  if (init.exitCode !== 0) {
    init = await exec('git', ['init'], workspaceRoot);
    ensureGitSuccess(init, 'startup smoke git init');
    ensureGitSuccess(await exec('git', ['branch', '-M', 'main'], workspaceRoot), 'startup smoke git branch');
  }
  ensureGitSuccess(await exec('git', ['config', 'user.email', 'codeyo-smoke@example.invalid'], workspaceRoot), 'startup smoke git email');
  ensureGitSuccess(await exec('git', ['config', 'user.name', 'Codeyo Smoke'], workspaceRoot), 'startup smoke git user');
  ensureGitSuccess(await exec('git', ['add', '--', 'src/main.py', '.gitignore'], workspaceRoot), 'startup smoke git add');
  ensureGitSuccess(await exec('git', ['commit', '-m', 'Startup smoke commit'], workspaceRoot), 'startup smoke git commit');
  await fs.appendFile(path.join(workspaceRoot, 'src', 'main.py'), 'print("git smoke")\n', 'utf8');
  const status = await exec('git', ['status', '--porcelain=v1', '--branch'], workspaceRoot);
  ensureGitSuccess(status, 'startup smoke git status');
  if (!status.stdout.includes('M src/main.py')) {
    throw new Error(`Deep startup smoke Git status did not see edited file: ${status.stdout}`);
  }
}

function runStartupPtySmoke(cwd) {
  return new Promise((resolve, reject) => {
    const command = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
    const args = process.platform === 'win32'
      ? ['/d', '/s', '/c', 'echo CODEYO_MAIN_PTY_OK']
      : ['-lc', 'printf CODEYO_MAIN_PTY_OK'];
    let output = '';
    let shellProcess;
    const timeout = setTimeout(() => {
      try {
        shellProcess?.kill();
      } catch {
        // Ignore cleanup failures after timeout.
      }
      reject(new Error('Deep startup smoke PTY timed out'));
    }, 5000);
    try {
      shellProcess = pty.spawn(command, args, {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd,
        env: { ...process.env, TERM: 'xterm-256color' },
      });
    } catch (error) {
      clearTimeout(timeout);
      reject(error);
      return;
    }
    shellProcess.onData((data) => {
      output += data;
    });
    shellProcess.onExit(({ exitCode }) => {
      clearTimeout(timeout);
      if (exitCode !== 0 || !output.includes('CODEYO_MAIN_PTY_OK')) {
        reject(new Error(`Deep startup smoke PTY failed with ${exitCode}: ${output}`));
        return;
      }
      resolve();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on(desktopResourceCleanupEvent, cleanupDesktopResources);

function cleanupDesktopResources() {
  clearWorkspaceWatcher();
  for (const session of terminals.values()) {
    try {
      session.process.kill();
    } catch {
      // The app is already quitting; stale PTY handles should not block shutdown.
    }
  }
  terminals.clear();
}

function handle(channel, handler) {
  assertKnownIpcChannel(channel);
  ipcMain.handle(channel, async (event, payload = {}) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      throw new Error('IPC sender not permitted');
    }
    if (workspaceRootRecheckedChannels.has(channel)) {
      await requireUsableWorkspaceForChannel(payload?.workspaceId, {
        trusted: isTrustedWorkspaceRequiredChannel(channel),
      });
    } else if (isTrustedWorkspaceRequiredChannel(channel)) {
      requireTrustedWorkspace(payload?.workspaceId);
    }
    return handler(payload, event);
  });
}

function handleSync(channel, handler) {
  assertKnownIpcChannel(channel);
  ipcMain.on(channel, (event, payload = {}) => {
    try {
      if (!mainWindow || event.sender !== mainWindow.webContents) {
        throw new Error('IPC sender not permitted');
      }
      if (workspaceRootRecheckedChannels.has(channel)) {
        requireUsableWorkspaceForChannelSync(payload?.workspaceId, {
          trusted: isTrustedWorkspaceRequiredChannel(channel),
        });
      } else if (isTrustedWorkspaceRequiredChannel(channel)) {
        requireTrustedWorkspace(payload?.workspaceId);
      }
      event.returnValue = { ok: true, value: handler(payload, event) };
    } catch (error) {
      event.returnValue = {
        ok: false,
        error: error?.message || 'Synchronous IPC failed',
      };
    }
  });
}

function registerHandlers() {
  handle('workspace:open', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open a Codeyo workspace',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    const rootPath = await resolveUsableWorkspaceRoot(result.filePaths[0]);
    const workspace = store.openWorkspace(rootPath);
    updateWorkspaceWatcher(workspace);
    return workspace;
  });
  handle('workspace:recent', () => store.listRecentWorkspaces());
  handle('workspace:resume', async ({ workspaceId }) => {
    const stored = requireWorkspace(workspaceId);
    const rootPath = await resolveUsableWorkspaceRoot(stored.rootPath);
    const workspace = store.openWorkspace(rootPath);
    updateWorkspaceWatcher(workspace);
    return workspace;
  });
  handle('workspace:trust', async ({ workspaceId }) => {
    const workspace = requireWorkspace(workspaceId);
    await resolveUsableWorkspaceRoot(workspace.rootPath);
    const trustedWorkspace = store.trustWorkspace(workspaceId);
    updateWorkspaceWatcher(trustedWorkspace);
    return trustedWorkspace;
  });

  handle('files:list', async ({ workspaceId }) => {
    const workspace = requireWorkspace(workspaceId);
    return listWorkspaceFiles(fs, workspace.rootPath, { languageFor });
  });
  handle('files:read', async ({ workspaceId, filePath }) => {
    const workspace = requireWorkspace(workspaceId);
    const safePath = portableEditableRelativePath(filePath);
    const target = withinEditableFile(workspace, safePath);
    await assertRealPathInsideWorkspace(fs, path, workspace.rootPath, target);
    const { content, stat } = await readWorkspaceTextFile(fs, target);
    return {
      path: safePath,
      name: path.basename(safePath),
      language: languageFor(safePath),
      content,
      diskVersion: String(stat.mtimeMs),
      dirty: false,
    };
  });
  handle('files:write', async ({ workspaceId, document }) => {
    const workspace = requireTrustedWorkspace(workspaceId);
    const safePath = portableEditableRelativePath(document.path);
    const content = assertWorkspaceTextContentSize(document.content);
    const target = withinEditableFile(workspace, safePath);
    const linkStat = await fs.lstat(target).catch(() => undefined);
    if (linkStat && !linkStat.isFile()) {
      throw new Error('Workspace path is not a file');
    }
    if (linkStat) {
      await assertRealPathInsideWorkspace(fs, path, workspace.rootPath, target);
    } else {
      await assertWritableParentInsideWorkspace(fs, path, workspace.rootPath, target);
    }
    const conflict = writeConflictState({
      fileExists: Boolean(linkStat),
      expectedDiskVersion: document.diskVersion,
      currentDiskVersion: linkStat ? String(linkStat.mtimeMs) : '',
    });
    if (conflict.conflict) {
      return {
        conflict: true,
        diskVersion: conflict.diskVersion,
        diskContent: conflict.deleted ? '' : (await readWorkspaceTextFile(fs, target)).content,
        ...(conflict.deleted ? { deleted: true } : {}),
      };
    }
    if (!linkStat) {
      await fs.mkdir(path.dirname(target), { recursive: true });
    }
    const saved = await writeWorkspaceTextFile(fs, target, content, { fileExists: Boolean(linkStat) });
    store.clearRecovery(workspaceId, safePath);
    return { conflict: false, diskVersion: String(saved.mtimeMs) };
  });
  handle('files:create', async ({ workspaceId, filePath, content = '' }) => {
    const workspace = requireTrustedWorkspace(workspaceId);
    const safeContent = assertWorkspaceTextContentSize(content);
    const safePath = portableEditableRelativePath(filePath);
    const target = withinEditableFile(workspace, safePath);
    await assertWritableParentInsideWorkspace(fs, path, workspace.rootPath, target);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, safeContent, { encoding: 'utf8', flag: 'wx' });
    return { created: true };
  });
  handle('files:rename', async ({ workspaceId, filePath, nextPath }) => {
    const workspace = requireTrustedWorkspace(workspaceId);
    const safePath = portableEditableRelativePath(filePath);
    const safeNextPath = portableEditableRelativePath(nextPath);
    const sourceTarget = withinEditableFile(workspace, safePath);
    const nextTarget = withinEditableFile(workspace, safeNextPath);
    await assertRealPathInsideWorkspace(fs, path, workspace.rootPath, sourceTarget);
    await assertWritableParentInsideWorkspace(fs, path, workspace.rootPath, nextTarget);
    const result = await renameWorkspaceFile(fs, path, sourceTarget, nextTarget);
    store.moveRecovery(workspaceId, safePath, safeNextPath);
    return result;
  });
  handle('files:remove', async ({ workspaceId, filePath, confirmed }) => {
    const workspace = requireTrustedWorkspace(workspaceId);
    if (!confirmed) {
      throw new Error('Deleting a source file requires confirmation');
    }
    const safePath = portableEditableRelativePath(filePath);
    const target = withinEditableFile(workspace, safePath);
    const linkStat = await fs.lstat(target);
    if (!linkStat.isFile()) {
      throw new Error('Workspace path is not a file');
    }
    await assertRealPathInsideWorkspace(fs, path, workspace.rootPath, target);
    await fs.unlink(target);
    store.clearRecovery(workspaceId, safePath);
    return { removed: true };
  });
  handle('files:backup-recovery', ({ workspaceId, filePath, content }) => {
    requireTrustedWorkspace(workspaceId);
    assertEditableRelativePath(filePath);
    store.putRecovery(workspaceId, filePath, content);
    return { backedUp: true };
  });
  handleSync('files:backup-recovery-sync', ({ workspaceId, filePath, content }) => {
    requireTrustedWorkspace(workspaceId);
    assertEditableRelativePath(filePath);
    store.putRecovery(workspaceId, filePath, content);
    return { backedUp: true };
  });
  handle('files:recovery', ({ workspaceId, filePath }) => {
    requireTrustedWorkspace(workspaceId);
    assertEditableRelativePath(filePath);
    return store.getRecovery(workspaceId, filePath) || null;
  });
  handle('files:list-recovery', ({ workspaceId }) => {
    requireTrustedWorkspace(workspaceId);
    return store.listRecovery(workspaceId).filter((buffer) => {
      try {
        assertEditableRelativePath(buffer.filePath);
        return true;
      } catch {
        return false;
      }
    });
  });
  handle('files:clear-recovery', ({ workspaceId, filePath }) => {
    requireTrustedWorkspace(workspaceId);
    assertEditableRelativePath(filePath);
    return store.clearRecovery(workspaceId, filePath);
  });

  handle('terminal:list', ({ workspaceId }) => {
    requireTrustedWorkspace(workspaceId);
    return [...terminals.entries()]
      .filter(([, session]) => session.workspaceId === workspaceId)
      .map(([id, session]) => terminalDescriptor(id, session));
  });
  handle('terminal:create', ({ workspaceId, title = 'Shell' }) => {
    const workspace = requireTrustedWorkspace(workspaceId);
    assertCanCreateTerminalSession(terminals, workspaceId);
    const id = crypto.randomUUID();
    const shellSpec = resolveTerminalShell();
    const safeTitle = sanitizeTerminalTitle(title);
    const processInstance = pty.spawn(shellSpec.command, shellSpec.args, {
      name: 'xterm-256color',
      cols: 96,
      rows: 24,
      cwd: workspace.rootPath,
      env: { ...process.env, TERM: 'xterm-256color' },
    });
    const session = {
      process: processInstance,
      workspaceId,
      title: safeTitle,
      cwd: workspace.rootPath,
      shell: shellSpec.command,
      status: 'running',
      buffer: '',
    };
    terminals.set(id, session);
    processInstance.onData((data) => {
      session.buffer = boundedTerminalBuffer(`${session.buffer}${data}`);
      mainWindow?.webContents.send('terminal:data', { sessionId: id, data });
    });
    processInstance.onExit(({ exitCode }) => {
      session.status = 'exited';
      session.exitCode = exitCode;
      session.buffer = boundedTerminalBuffer(`${session.buffer}\r\n[PROCESS EXITED ${exitCode}]\r\n`);
      terminals.delete(id);
      mainWindow?.webContents.send('terminal:exit', { sessionId: id, exitCode });
    });
    return terminalDescriptor(id, session);
  });
  handle('terminal:rename', ({ workspaceId, sessionId, title }) => {
    const session = requireTerminalSession(workspaceId, sessionId);
    session.title = sanitizeTerminalTitle(title);
    return { renamed: true, title: session.title };
  });
  handle('terminal:write', ({ workspaceId, sessionId, data }) => {
    const session = requireTerminalSession(workspaceId, sessionId);
    session.process.write(sanitizeTerminalInput(data));
    return { written: true };
  });
  handle('terminal:resize', ({ workspaceId, sessionId, cols, rows }) => {
    const session = requireTerminalSession(workspaceId, sessionId);
    session.process.resize(clampTerminalSize(cols, 20, 500), clampTerminalSize(rows, 5, 200));
    return { resized: true };
  });
  handle('terminal:kill', ({ workspaceId, sessionId }) => {
    requireTrustedWorkspace(workspaceId);
    const session = terminals.get(sessionId);
    if (!session) {
      return { killed: false };
    }
    if (session.workspaceId !== workspaceId) {
      throw new Error('Terminal session does not belong to this workspace');
    }
    session.process.kill();
    terminals.delete(sessionId);
    return { killed: true };
  });

  handle('runner:run', async ({ workspaceId, profile }) => {
    const workspace = requireTrustedWorkspace(workspaceId);
    const result = await runProfile(workspace, profile);
    return store.saveRunResult(workspaceId, result);
  });
  handle('runner:profiles', ({ workspaceId }) => {
    const workspace = requireWorkspace(workspaceId);
    return store.listProfiles(workspaceId)
      .map((profile) => sanitizeStoredRunProfile(workspace, profile))
      .filter(Boolean);
  });
  handle('runner:save-profile', ({ workspaceId, profile }) => {
    const workspace = requireTrustedWorkspace(workspaceId);
    return store.saveProfile(workspaceId, sanitizeRunProfile(workspace, profile));
  });
  handle('runner:history', ({ workspaceId }) => {
    requireWorkspace(workspaceId);
    return store.listRunResults(workspaceId);
  });
  handle('runner:get-result', ({ workspaceId, runResultId }) => {
    requireWorkspace(workspaceId);
    return store.getRunResult(workspaceId, runResultId) || null;
  });

  handle('git:status', async ({ workspaceId }) => {
    const workspace = requireTrustedWorkspace(workspaceId);
    const output = await exec('git', ['status', '--porcelain=v1', '--branch'], workspace.rootPath);
    ensureGitSuccess(output, 'status');
    return parseGitStatus(output.stdout);
  });
  handle('git:branches', async ({ workspaceId }) => {
    const workspace = requireTrustedWorkspace(workspaceId);
    const output = await exec('git', ['branch', '--format=%(refname:short)'], workspace.rootPath);
    ensureGitSuccess(output, 'branches');
    return parseGitBranches(output.stdout);
  });
  handle('git:staged-summary', async ({ workspaceId }) => {
    const workspace = requireTrustedWorkspace(workspaceId);
    return readGitStagedSummary(workspace.rootPath);
  });
  handle('git:diff', async ({ workspaceId, filePath }) => {
    const workspace = requireTrustedWorkspace(workspaceId);
    const args = ['diff', '--no-ext-diff', '--no-color', '--'];
    if (filePath) {
      args.push(gitRelativePath(workspace, filePath));
    }
    return sanitizeGitDiffResult(await exec(
      'git',
      args,
      workspace.rootPath,
      undefined,
      maxGitDiffOutputBytes,
      { allowMaxBuffer: true },
    ));
  });
  handle('git:compare', async ({ workspaceId, file, mode = 'all' }) => {
    const workspace = requireTrustedWorkspace(workspaceId);
    if (!['all', 'staged', 'unstaged'].includes(mode)) {
      throw new Error('Git comparison mode is not permitted');
    }
    const gitPath = gitRelativePath(workspace, file?.path);
    const target = path.join(workspace.rootPath, gitPath);
    const originalTarget = file.originalPath
      ? path.join(workspace.rootPath, gitRelativePath(workspace, file.originalPath))
      : target;
    const originalGitPath = path.relative(workspace.rootPath, originalTarget).split(path.sep).join('/');
    const indexGitPath = file.originalPath && file.index !== 'R' && file.index !== 'C'
      ? originalGitPath
      : gitPath;
    const [head, index, worktree] = await Promise.all([
      readGitContent(workspace.rootPath, `HEAD:${originalGitPath}`),
      readGitContent(workspace.rootPath, `:${indexGitPath}`),
      readWorktreeContent(workspace, target),
    ]);
    const versions = mode === 'staged'
      ? [{ name: 'HEAD', value: head }, { name: 'INDEX', value: index }]
      : mode === 'unstaged'
        ? [{ name: 'INDEX', value: index }, { name: 'WORKTREE', value: worktree }]
        : [{ name: 'HEAD', value: head }, { name: 'WORKTREE', value: worktree }];
    return {
      path: gitPath,
      originalPath: file.originalPath,
      language: languageFor(gitPath),
      mode,
      leftLabel: gitVersionLabel(versions[0].name, versions[0].value.exists),
      rightLabel: gitVersionLabel(versions[1].name, versions[1].value.exists),
      leftContent: versions[0].value.content,
      rightContent: versions[1].value.content,
      leftExists: versions[0].value.exists,
      rightExists: versions[1].value.exists,
    };
  });
  handle('git:history', async ({ workspaceId }) => {
    const workspace = requireTrustedWorkspace(workspaceId);
    return readGitHistory(workspace.rootPath);
  });
  handle('git:commit-detail', async ({ workspaceId, revision }) => {
    const workspace = requireTrustedWorkspace(workspaceId);
    return readGitCommitDetail(workspace.rootPath, requireGitRevision(revision));
  });
  handle('git:compare-commit', async ({ workspaceId, revision, file }) => {
    const workspace = requireTrustedWorkspace(workspaceId);
    const safeRevision = requireGitRevision(revision);
    const gitPath = gitRelativePath(workspace, file?.path);
    const originalTarget = file.originalPath
      ? path.join(workspace.rootPath, gitRelativePath(workspace, file.originalPath))
      : path.join(workspace.rootPath, gitPath);
    const originalGitPath = path.relative(workspace.rootPath, originalTarget).split(path.sep).join('/');
    const [parent, committed] = await Promise.all([
      readGitContent(workspace.rootPath, `${safeRevision}^:${originalGitPath}`),
      readGitContent(workspace.rootPath, `${safeRevision}:${gitPath}`),
    ]);
    const label = safeRevision.slice(0, 7).toUpperCase();
    return {
      path: gitPath,
      originalPath: file.originalPath,
      language: languageFor(gitPath),
      mode: 'commit',
      leftLabel: gitVersionLabel('PARENT', parent.exists),
      rightLabel: committed.exists ? `COMMIT ${label}` : `COMMIT ${label} · EMPTY`,
      leftContent: parent.content,
      rightContent: committed.content,
      leftExists: parent.exists,
      rightExists: committed.exists,
    };
  });
  handle('git:apply-patch', async ({ workspaceId, patch, mode, confirmed }) => {
    const workspace = requireTrustedWorkspace(workspaceId);
    const safePatch = assertGitPatchPayload(patch);
    assertGitPatchSafety(mode, confirmed);
    const patchPaths = validateGitPatchPaths(safePatch);
    const tempFile = await writeGitPatchTempFile(fs, path, os.tmpdir(), safePatch);
    try {
      const args = ['apply'];
      if (mode === 'stage' || mode === 'unstage') {
        args.push('--cached');
      }
      if (mode === 'unstage' || mode === 'discard') {
        args.push('--reverse');
      }
      args.push('--whitespace=nowarn', '--unidiff-zero', tempFile);
      let result = await exec('git', args, workspace.rootPath);
      if (mode === 'stage' && /does not exist in index/i.test(result.stderr || result.stdout)) {
        await prepareIntentToAdd(workspace.rootPath, patchPaths);
        result = await exec('git', args, workspace.rootPath);
        if (result.exitCode !== 0) {
          await clearIntentToAdd(workspace.rootPath, patchPaths);
        }
      }
      ensureGitSuccess(result, `apply-patch (${mode})`);
      store.addJournal(
        workspaceId,
        'git',
        `GIT ${mode.toUpperCase()} HUNK · ${patchPaths.join(', ')}`,
        null,
        gitHunkJournalMetadata({ action: `${mode}-hunk`, paths: patchPaths }),
      );
      return { applied: true, mode };
    } finally {
      await fs.unlink(tempFile).catch(() => undefined);
    }
  });

  handle('git:action', async ({ workspaceId, action }) => {
    const workspace = requireTrustedWorkspace(workspaceId);
    const safeAction = normalizeGitAction(action);
    const runEvidence = safeAction.type === 'commit' && safeAction.runResultId
      ? store.getRunResult(workspaceId, safeAction.runResultId)
      : undefined;
    if (safeAction.type === 'commit' && safeAction.runResultId && !runEvidence) {
      throw new Error('Run evidence does not belong to this workspace');
    }
    const commitSummary = safeAction.type === 'commit'
      ? await readGitStagedSummary(workspace.rootPath)
      : undefined;
    const result = safeAction.type === 'discard'
      ? await discardGitPath(workspace, safeAction)
      : await runGitAction(workspace, safeAction);
    const commitDetail = safeAction.type === 'commit'
      ? await readGitCommitDetail(workspace.rootPath, 'HEAD')
      : undefined;
    const body = safeAction.type === 'commit' && commitSummary
      ? `COMMIT · ${safeAction.message} · ${commitSummary.files.length} FILES · +${commitSummary.additions} / -${commitSummary.deletions}`
      : `GIT ${safeAction.type.toUpperCase()} · ${safeAction.path || safeAction.name || 'WORKSPACE'}`;
    store.addJournal(
      workspaceId,
      'git',
      body,
      null,
      gitActionJournalMetadata({ action: safeAction, result, commitSummary, commitDetail, runEvidence }),
    );
    return result;
  });

  handle('journal:list', ({ workspaceId }) => {
    requireWorkspace(workspaceId);
    return store.listJournal(workspaceId);
  });
  handle('journal:add', ({ workspaceId, kind, body, metadata }) => {
    requireTrustedWorkspace(workspaceId);
    return store.addJournal(
      workspaceId,
      requireJournalKind(kind),
      requireJournalBody(body),
      null,
      sanitizeJournalMetadataInput(metadata),
    );
  });
  handle('journal:snapshot', ({ workspaceId, files, note, runResultId, sourceRevision }) => {
    requireTrustedWorkspace(workspaceId);
    const safeRevision = sourceRevision ? requireGitRevision(sourceRevision) : undefined;
    const safeRunResultId = runResultId && store.getRunResult(workspaceId, runResultId)
      ? runResultId
      : undefined;
    if (runResultId && !safeRunResultId) {
      throw new Error('Run evidence does not belong to this workspace');
    }
    const safeFiles = sanitizeSnapshotFiles(files);
    const safeNote = requireJournalBody(note);
    const snapshot = store.createSnapshot(workspaceId, safeFiles, safeNote, safeRunResultId, safeRevision);
    store.addJournal(
      workspaceId,
      'review',
      safeNote,
      snapshot.id,
      reviewSnapshotJournalMetadata({ files: safeFiles, sourceRevision: safeRevision, runResultId: safeRunResultId }),
    );
    return snapshot;
  });
  handle('journal:get-snapshot', ({ workspaceId, snapshotId }) => {
    requireWorkspace(workspaceId);
    return store.getSnapshot(workspaceId, snapshotId) || null;
  });
  handle('settings:storage-mode', async ({ workspaceId, mode, addToGitignore }) => {
    const workspace = requireTrustedWorkspace(workspaceId);
    if (mode === 'workspace-codeyo' && addToGitignore) {
      await appendCodeyoGitignore(fs, path, workspace.rootPath);
    }
    return store.setStorageMode(workspaceId, mode);
  });
  handle('environment:check-tools', async ({ workspaceId, tools }) => {
    const workspace = requireTrustedWorkspace(workspaceId);
    if (!Array.isArray(tools)) {
      throw new Error('Tool checks must be an array');
    }
    return Promise.all(tools.slice(0, 8).map((tool) => checkTool(workspace, tool)));
  });
}

function requireWorkspace(workspaceId) {
  const workspace = store.getWorkspace(workspaceId);
  if (!workspace) {
    throw new Error('Workspace was not found');
  }
  return workspace;
}

function requireTrustedWorkspace(workspaceId) {
  const workspace = requireWorkspace(workspaceId);
  if (!workspace.trusted) {
    throw new Error('Trust this workspace before executing or writing files');
  }
  return workspace;
}

async function requireUsableWorkspaceForChannel(workspaceId, { trusted }) {
  const workspace = trusted ? requireTrustedWorkspace(workspaceId) : requireWorkspace(workspaceId);
  await resolveUsableWorkspaceRoot(workspace.rootPath);
  return workspace;
}

function requireUsableWorkspaceForChannelSync(workspaceId, { trusted }) {
  const workspace = trusted ? requireTrustedWorkspace(workspaceId) : requireWorkspace(workspaceId);
  try {
    return assertWorkspaceRootDirectorySync(nativeFs, path.resolve(workspace.rootPath));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error('Workspace is no longer available at its saved location');
    }
    throw error;
  }
}

async function resolveUsableWorkspaceRoot(rootPath) {
  try {
    return await assertWorkspaceRootDirectory(fs, path.resolve(rootPath));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error('Workspace is no longer available at its saved location');
    }
    throw error;
  }
}

function watchWorkspace(workspace) {
  clearWorkspaceWatcher();
  try {
    workspaceWatcher = nativeFs.watch(workspace.rootPath, { recursive: true }, (eventType, filename) => {
      if (!filename) {
        return;
      }
      const relativePath = path.normalize(String(filename));
      if (relativePath.split(path.sep).some((part) => ignoredDirectories.has(part))) {
        return;
      }
      let target;
      try {
        target = withinWorkspace(workspace, relativePath);
      } catch {
        return;
      }
      clearTimeout(watchedChangeTimers.get(relativePath));
      watchedChangeTimers.set(relativePath, setTimeout(async () => {
        watchedChangeTimers.delete(relativePath);
        const stat = await fs.stat(target).catch(() => undefined);
        mainWindow?.webContents.send('files:changed', {
          workspaceId: workspace.id,
          path: relativePath,
          type: eventType,
          exists: Boolean(stat),
          directory: Boolean(stat?.isDirectory()),
          diskVersion: stat && !stat.isDirectory() ? String(stat.mtimeMs) : undefined,
        });
      }, 140));
    });
  } catch {
    workspaceWatcher = undefined;
  }
}

function updateWorkspaceWatcher(workspace) {
  if (shouldWatchWorkspace(workspace)) {
    watchWorkspace(workspace);
    return;
  }
  clearWorkspaceWatcher();
}

function clearWorkspaceWatcher() {
  workspaceWatcher?.close();
  workspaceWatcher = undefined;
  for (const timer of watchedChangeTimers.values()) {
    clearTimeout(timer);
  }
  watchedChangeTimers.clear();
}

function withinWorkspace(workspace, relativePath) {
  const normalizedPath = normalizedRelativePath(relativePath);
  const target = path.resolve(workspace.rootPath, normalizedPath);
  const prefix = `${workspace.rootPath}${path.sep}`;
  if (target !== workspace.rootPath && !target.startsWith(prefix)) {
    throw new Error('Path leaves the trusted workspace');
  }
  return target;
}

function withinEditableFile(workspace, relativePath) {
  return withinWorkspace(workspace, assertEditableRelativePath(relativePath));
}

function gitRelativePath(workspace, relativePath) {
  const safePath = portableEditableRelativePath(relativePath);
  const target = withinWorkspace(workspace, safePath);
  return path.relative(workspace.rootPath, target).split(path.sep).join('/');
}

function requireTerminalSession(workspaceId, sessionId) {
  requireTrustedWorkspace(workspaceId);
  const session = terminals.get(sessionId);
  if (!session || session.status !== 'running') {
    throw new Error('Terminal session has ended');
  }
  if (session.workspaceId !== workspaceId) {
    throw new Error('Terminal session does not belong to this workspace');
  }
  return session;
}

function terminalDescriptor(id, session) {
  return {
    id,
    title: session.title,
    cwd: session.cwd,
    shell: session.shell,
    status: session.status,
    buffer: session.buffer,
    ...(session.exitCode === undefined ? {} : { exitCode: session.exitCode }),
  };
}

function sanitizeSnapshotFiles(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('Snapshot must include at least one file');
  }
  if (files.length > 100) {
    throw new Error('Snapshot file limit exceeded');
  }
  const seen = new Set();
  return files.map((file) => {
    if (!file || typeof file !== 'object' || typeof file.path !== 'string') {
      throw new Error('Snapshot file path is required');
    }
    const filePath = portableEditableRelativePath(file.path);
    if (seen.has(filePath)) {
      throw new Error(`Duplicate snapshot file: ${filePath}`);
    }
    seen.add(filePath);
    const content = typeof file.content === 'string' ? file.content : '';
    if (Buffer.byteLength(content, 'utf8') > 5 * 1024 * 1024) {
      throw new Error(`Snapshot file is too large: ${filePath}`);
    }
    return { path: filePath, content };
  });
}

function requireJournalKind(kind) {
  if (!['note', 'run', 'git', 'review'].includes(kind)) {
    throw new Error('Journal entry kind is not permitted');
  }
  return kind;
}

function requireJournalBody(body) {
  if (typeof body !== 'string' || !body.trim()) {
    throw new Error('Journal entry body is required');
  }
  return body.slice(0, 4000);
}

async function prepareIntentToAdd(rootPath, filePaths) {
  for (const filePath of filePaths) {
    const result = await exec('git', ['add', '-N', '--', filePath], rootPath);
    ensureGitSuccess(result, `prepare intent-to-add (${filePath})`);
  }
}

async function clearIntentToAdd(rootPath, filePaths) {
  await exec('git', ['restore', '--staged', '--', ...filePaths], rootPath).catch(() => undefined);
}

function languageFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.py') {
    return 'python';
  }
  if (['.cpp', '.cc', '.cxx', '.h', '.hpp'].includes(ext)) {
    return 'cpp';
  }
  return 'text';
}

function exec(command, args, cwd, timeoutMs, maxBuffer = 1024 * 1024, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, maxBuffer, timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error?.killed && timeoutMs) {
        resolve({
          exitCode: 124,
          stdout,
          stderr: `${stderr}${stderr ? '\n' : ''}Execution timed out after ${timeoutMs} ms.\n`,
          timedOut: true,
        });
        return;
      }
      if (error && typeof error.code !== 'number') {
        if (options.allowMaxBuffer && error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
          resolve({
            exitCode: options.maxBufferExitCode ?? 0,
            stdout,
            stderr: options.maxBufferMessage
              ? `${stderr}${stderr && !stderr.endsWith('\n') ? '\n' : ''}${options.maxBufferMessage}\n`
              : stderr,
            timedOut: false,
            truncated: true,
          });
          return;
        }
        reject(error);
        return;
      }
      resolve({ exitCode: error?.code || 0, stdout, stderr, timedOut: false });
    });
  });
}

async function readGitContent(rootPath, objectPath) {
  const size = await exec('git', ['cat-file', '-s', objectPath], rootPath);
  if (size.exitCode !== 0) {
    return { exists: false, content: '' };
  }
  assertGitTextObjectSize(size.stdout);
  const result = await exec(
    'git',
    ['show', objectPath],
    rootPath,
    undefined,
    gitTextObjectReadBufferBytes,
  );
  return result.exitCode === 0
    ? { exists: true, content: result.stdout }
    : { exists: false, content: '' };
}

async function readWorktreeContent(workspace, target) {
  try {
    await assertRealPathInsideWorkspace(fs, path, workspace.rootPath, target);
    const { content } = await readWorkspaceTextFile(fs, target);
    return { exists: true, content };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { exists: false, content: '' };
    }
    throw error;
  }
}

async function readGitStagedSummary(rootPath) {
  const result = await exec('git', ['diff', '--cached', '--numstat', '--find-renames', '--'], rootPath);
  ensureGitSuccess(result, 'staged summary');
  return parseGitNumstat(result.stdout);
}

async function readGitHistory(rootPath) {
  const result = await exec(
    'git',
    ['log', '--all', '--max-count=40', '--format=%H%x09%h%x09%an%x09%aI%x09%s'],
    rootPath,
  );
  ensureGitSuccess(result, 'history');
  return parseGitHistory(result.stdout);
}

async function readGitCommitDetail(rootPath, revision) {
  const heading = await exec('git', ['show', '-s', '--format=%H%x00%s', revision, '--'], rootPath);
  ensureGitSuccess(heading, 'commit detail');
  const commit = parseGitCommitHeading(heading.stdout);
  if (!commit) {
    throw new Error('Git commit heading is not valid');
  }
  const changes = await exec(
    'git',
    ['diff-tree', '--root', '--no-commit-id', '--name-status', '-r', '-M', commit.revision, '--'],
    rootPath,
  );
  ensureGitSuccess(changes, 'commit files');
  const files = parseGitCommitFiles(changes.stdout);
  return {
    ...commit,
    files,
  };
}

function requireGitRevision(revision) {
  if (typeof revision !== 'string' || !/^[0-9a-f]{7,40}$/i.test(revision)) {
    throw new Error('Git revision is not permitted');
  }
  return revision;
}

function ensureGitSuccess(result, operation) {
  if (result.exitCode !== 0) {
    throw new Error((result.stderr || result.stdout || `git ${operation} failed`).trim());
  }
}

function gitVersionLabel(name, exists) {
  if (exists) {
    return name;
  }
  return name === 'WORKTREE' ? 'WORKTREE · MISSING' : `${name} · EMPTY`;
}

function sanitizeStoredRunProfile(workspace, profile) {
  try {
    return sanitizeRunProfile(workspace, profile);
  } catch {
    return null;
  }
}

function sanitizeRunProfile(workspace, profile) {
  if (!profile || typeof profile !== 'object') {
    throw new Error('Run profile is required');
  }
  const language = profile.language;
  if (!['python', 'cpp'].includes(language)) {
    throw new Error('Run profile language is not permitted');
  }
  const defaultCommand = language === 'cpp'
    ? 'clang++'
    : process.platform === 'win32' ? 'python' : 'python3';
  const entryFile = portableEditableRelativePath(profile.entryFile);
  withinEditableFile(workspace, entryFile);
  if (language === 'python' && path.extname(entryFile).toLowerCase() !== '.py') {
    throw new Error('Python run profile must use a .py entry file');
  }
  if (language === 'cpp' && !/\.(cpp|cc|cxx|h|hpp)$/i.test(entryFile)) {
    throw new Error('C++ run profile must use a C++ entry file');
  }
  const name = sanitizeTextField(profile.name, `Run ${language.toUpperCase()} Current File`, 120);
  const id = sanitizeProfileId(profile.id, `${language}-current`);
  const command = sanitizeToolCommand(profile.command, defaultCommand);
  const args = sanitizeRunArgs(profile.args, 'profile arguments');
  const programArgs = language === 'cpp'
    ? sanitizeRunArgs(profile.programArgs, 'program arguments')
    : undefined;
  const sourceFiles = language === 'cpp'
    ? sanitizeRunSourceFiles(workspace, profile.sourceFiles, entryFile)
    : undefined;
  return {
    id,
    name,
    language,
    command,
    entryFile,
    ...(sourceFiles ? { sourceFiles } : {}),
    ...(args ? { args } : {}),
    ...(programArgs ? { programArgs } : {}),
  };
}

function sanitizeRunSourceFiles(workspace, sourceFiles, entryFile) {
  const raw = Array.isArray(sourceFiles) && sourceFiles.length > 0 ? sourceFiles : [entryFile];
  if (raw.length > 32) {
    throw new Error('C++ source file limit exceeded');
  }
  const safe = [];
  const seen = new Set();
  for (const source of raw) {
    const filePath = portableEditableRelativePath(source);
    withinEditableFile(workspace, filePath);
    if (!/\.(cpp|cc|cxx|h|hpp)$/i.test(filePath)) {
      throw new Error('C++ source files must be C++ editable files');
    }
    if (!seen.has(filePath)) {
      seen.add(filePath);
      safe.push(filePath);
    }
  }
  if (!seen.has(entryFile)) {
    safe.unshift(entryFile);
  }
  return safe;
}

function sanitizeProfileId(value, fallback) {
  const id = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  if (!/^[a-zA-Z0-9._:-]{1,80}$/.test(id)) {
    throw new Error('Run profile id is not permitted');
  }
  return id;
}

async function checkTool(workspace, tool) {
  let request;
  try {
    request = sanitizeToolCheck(tool);
  } catch (error) {
    const id = typeof tool?.id === 'string' && tool.id.trim() ? tool.id.trim().slice(0, 32) : 'tool';
    const label = typeof tool?.label === 'string' && tool.label.trim() ? tool.label.trim().slice(0, 80) : id;
    return {
      id,
      label,
      command: typeof tool?.command === 'string' ? tool.command.trim().slice(0, 512) : '',
      available: false,
      message: error?.message || 'Tool command is not configured',
    };
  }
  const { id, label, command } = request;
  try {
    const result = await exec(command, ['--version'], workspace.rootPath, 3000);
    const version = firstOutputLine(result.stdout || result.stderr);
    return {
      id,
      label,
      command,
      available: result.exitCode === 0,
      ...(version ? { version } : {}),
      message: result.exitCode === 0
        ? version || 'Tool responded successfully'
        : firstOutputLine(result.stderr || result.stdout) || `Exited with ${result.exitCode}`,
    };
  } catch (error) {
    return {
      id,
      label,
      command,
      available: false,
      message: error?.code === 'ENOENT'
        ? `${command} was not found`
        : (error?.message || 'Tool check failed'),
    };
  }
}

function firstOutputLine(output) {
  return String(output || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
}

async function readRunInput(workspace, filePath) {
  const safePath = portableEditableRelativePath(filePath);
  const target = withinEditableFile(workspace, safePath);
  try {
    await assertRealPathInsideWorkspace(fs, path, workspace.rootPath, target);
    const { content } = await readWorkspaceTextFileBounded(fs, target, {
      maxBytes: runInputEvidenceByteLimit,
      truncatedSuffix: '\n[CODEYO INPUT TRUNCATED]\n',
    });
    return {
      path: safePath,
      content,
    };
  } catch (error) {
    throw runInputReadError(safePath, error);
  }
}

function truncateUtf8(value, limit) {
  const text = String(value ?? '');
  if (Buffer.byteLength(text, 'utf8') <= limit) {
    return text;
  }
  const suffix = '\n[CODEYO OUTPUT TRUNCATED]\n';
  const suffixBytes = Buffer.byteLength(suffix, 'utf8');
  return `${Buffer.from(text, 'utf8').subarray(0, Math.max(0, limit - suffixBytes)).toString('utf8')}${suffix}`;
}

async function runProfile(workspace, profile) {
  const safeProfile = sanitizeRunProfile(workspace, profile);
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const timeoutMs = 10000;
  const inputPaths = safeProfile.language === 'cpp'
    ? (safeProfile.sourceFiles || [safeProfile.entryFile])
    : [safeProfile.entryFile];
  let inputs;
  try {
    inputs = await Promise.all([...new Set(inputPaths)].map((file) => readRunInput(workspace, file)));
  } catch (error) {
    return runInputFailureResult(safeProfile, inputPaths, error, startedAt, Date.now() - started);
  }
  let result;
  let tempBuild;
  if (safeProfile.language === 'cpp') {
    tempBuild = await createRunnerTempBuild(fs, path, os, process.platform);
    try {
      const compiler = safeProfile.command || 'clang++';
      const compileSourcePaths = cppCompileSourceFiles(inputPaths);
      if (compileSourcePaths.length === 0) {
        result = {
          exitCode: 1,
          stdout: '',
          stderr: 'C++ PROFILE NEEDS AT LEAST ONE .cpp/.cc/.cxx SOURCE FILE.\n',
          timedOut: false,
          profileConfigurationFailure: 'C++ PROFILE NEEDS AT LEAST ONE .cpp/.cc/.cxx SOURCE FILE.',
        };
      } else {
        const sources = compileSourcePaths.map((file) => withinEditableFile(workspace, file));
        const compile = await execTool(
          compiler,
          ['-std=c++20', ...sources, '-o', tempBuild.outputPath, ...(safeProfile.args || [])],
          workspace.rootPath,
          timeoutMs,
          'cpp',
        );
        result = compile.exitCode === 0
          ? await execTool(tempBuild.outputPath, safeProfile.programArgs || [], workspace.rootPath, timeoutMs, 'cpp-program')
          : compile;
      }
    } finally {
      await cleanupRunnerTempBuild(fs, tempBuild);
    }
  } else {
    result = await execTool(
      safeProfile.command || 'python3',
      [withinEditableFile(workspace, safeProfile.entryFile), ...(safeProfile.args || [])],
      workspace.rootPath,
      timeoutMs,
      'python',
    );
  }
  const output = `${result.stdout}${result.stderr}`;
  const diagnostics = parseDiagnostics(output, workspace.rootPath);
  if (result.toolLaunchFailure && !diagnostics.length) {
    diagnostics.push({
      path: safeProfile.entryFile,
      line: 1,
      severity: 'error',
      message: result.toolLaunchFailure,
    });
  }
  if (result.profileConfigurationFailure && !diagnostics.length) {
    diagnostics.push({
      path: safeProfile.entryFile,
      line: 1,
      severity: 'error',
      message: result.profileConfigurationFailure,
    });
  }
  if (result.timedOut && !diagnostics.length) {
    diagnostics.push({
      path: safeProfile.entryFile,
      line: 1,
      severity: 'error',
      message: `Execution timed out after ${timeoutMs / 1000}s`,
    });
  }
  if (result.truncated) {
    result.stderr = appendRunOutputTruncatedNotice(result.stderr);
    appendRunOutputTruncatedDiagnostic(diagnostics, safeProfile.entryFile);
  }
  return {
    profileId: safeProfile.id,
    profileName: safeProfile.name,
    entryFile: safeProfile.entryFile,
    inputs,
    exitCode: result.exitCode,
    stdout: truncateUtf8(result.stdout, runOutputByteLimit),
    stderr: truncateUtf8(result.stderr, runOutputByteLimit),
    elapsedMs: Date.now() - started,
    startedAt,
    diagnostics,
  };
}

async function execTool(command, args, cwd, timeoutMs, language) {
  try {
    return await exec(command, args, cwd, timeoutMs, runToolOutputBufferBytes, {
      allowMaxBuffer: true,
      maxBufferExitCode: 1,
      maxBufferMessage: runOutputTruncatedMessage,
    });
  } catch (error) {
    return toolLaunchFailure(command, language, error);
  }
}

function toolLaunchFailure(command, language, error) {
  const code = error?.code === 'ENOENT' ? 127 : 126;
  const message = toolLaunchFailureMessage(command, language, error);
  return {
    exitCode: code,
    stdout: '',
    stderr: `${message}\n`,
    timedOut: false,
    toolLaunchFailure: message,
  };
}

function toolLaunchFailureMessage(command, language, error) {
  if (error?.code === 'ENOENT' && language === 'cpp') {
    return `COMPILER NOT FOUND · ${command} · INSTALL LLVM OR SET THE CLANG++ PATH.`;
  }
  if (error?.code === 'ENOENT' && language === 'python') {
    return `PYTHON NOT FOUND · ${command} · CONFIGURE A VALID INTERPRETER PATH.`;
  }
  if (error?.code === 'ENOENT') {
    return `EXECUTABLE NOT FOUND · ${command}`;
  }
  return `EXECUTABLE LAUNCH FAILED · ${command} · ${error?.message || 'UNKNOWN ERROR'}`;
}

function parseDiagnostics(output, rootPath) {
  const diagnostics = [];
  const python = /File "([^"]+)", line (\d+)(?:[\s\S]*?\n(?:.*\n)?([A-Za-z]+Error: .*))?/g;
  const cpp = /^(.+?):(\d+):(\d+):\s+(warning|error):\s+(.+)$/gm;
  for (const match of output.matchAll(python)) {
    const filePath = diagnosticPath(match[1], rootPath);
    if (!filePath) {
      continue;
    }
    diagnostics.push({
      path: filePath,
      line: Number(match[2]),
      severity: 'error',
      message: match[3] || 'Python execution error',
    });
  }
  for (const match of output.matchAll(cpp)) {
    const filePath = diagnosticPath(match[1], rootPath);
    if (!filePath) {
      continue;
    }
    diagnostics.push({
      path: filePath,
      line: Number(match[2]),
      column: Number(match[3]),
      severity: match[4],
      message: match[5],
    });
  }
  return diagnostics;
}

function diagnosticPath(filePath, rootPath) {
  const candidate = path.isAbsolute(filePath)
    ? path.relative(rootPath, filePath)
    : filePath;
  try {
    return portableEditableRelativePath(candidate);
  } catch {
    return null;
  }
}

async function runGitAction(workspace, action) {
  const safeAction = normalizeGitAction(action);
  if (['create-branch', 'switch-branch', 'delete-branch'].includes(safeAction.type)) {
    await ensureGitBranchName(workspace.rootPath, safeAction.name);
  }
  const args = gitArgs(workspace, safeAction);
  const result = await exec('git', args, workspace.rootPath);
  ensureGitSuccess(result, safeAction.type);
  return result;
}

async function discardGitPath(workspace, action) {
  if (!action.confirmed) {
    throw new Error('Discard requires explicit confirmation');
  }
  const gitPath = gitRelativePath(workspace, action.path);
  const target = path.join(workspace.rootPath, gitPath);
  const status = await exec('git', ['status', '--porcelain=v1', '--', gitPath], workspace.rootPath);
  ensureGitSuccess(status, 'discard status');
  if (!isUntrackedStatus(status.stdout)) {
    const result = await exec('git', trackedDiscardArgs(gitPath), workspace.rootPath);
    ensureGitSuccess(result, action.type);
    return result;
  }

  const stat = await fs.stat(target).catch(() => undefined);
  if (!stat?.isFile()) {
    throw new Error('Discarding an untracked directory is not supported from Codeyo');
  }
  await fs.unlink(target);
  return {
    exitCode: 0,
    stdout: `Deleted untracked file ${gitPath}\n`,
    stderr: '',
    timedOut: false,
  };
}

async function ensureGitBranchName(rootPath, name) {
  const result = await exec('git', ['check-ref-format', '--branch', name], rootPath);
  ensureGitSuccess(result, 'branch name validation');
}

function gitArgs(workspace, action) {
  switch (action.type) {
    case 'stage': {
      const target = gitRelativePath(workspace, action.path);
      const original = action.originalPath ? gitRelativePath(workspace, action.originalPath) : undefined;
      return ['add', '--', ...(original ? [original] : []), target];
    }
    case 'unstage': {
      const target = gitRelativePath(workspace, action.path);
      const original = action.originalPath ? gitRelativePath(workspace, action.originalPath) : undefined;
      return ['restore', '--staged', '--', ...(original ? [original] : []), target];
    }
    case 'commit': {
      return ['commit', '-m', action.message];
    }
    case 'create-branch':
      return ['switch', '-c', action.name];
    case 'switch-branch':
      return ['switch', '--', action.name];
    case 'pull':
      return ['pull'];
    case 'push':
      return ['push'];
    case 'discard':
      return trackedDiscardArgs(gitRelativePath(workspace, action.path));
    case 'delete-branch':
      return ['branch', '-D', '--', action.name];
    default:
      throw new Error('Git action not permitted');
  }
}
