import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { App } from './app';
import { DesktopTerminalComponent } from './desktop-terminal.component';
import { CodeyoDesktopApi, RunResult, WorkspaceFileChange, WorkspaceHandle } from './desktop-api';

function createDesktopHarness(
  fileContents: Record<string, string>,
  workspaceOverrides: Partial<WorkspaceHandle> = {},
) {
  const workspace: WorkspaceHandle = {
    id: 'workspace-1',
    rootPath: '/tmp/codeyo-test',
    name: 'codeyo-test',
    trusted: true,
    platform: 'darwin',
    storageMode: 'app-db',
    ...workspaceOverrides,
  };
  let fileListener: ((change: WorkspaceFileChange) => void | Promise<void>) | undefined;
  let version = 1;
  const recoveryBuffers = new Map<string, { content: string; updatedAt: string }>();
  const language = (filePath: string) =>
    filePath.endsWith('.py') ? 'python' : filePath.endsWith('.cpp') ? 'cpp' : 'text';
  const saveProfile = vi.fn(async (_workspaceId, profile) => profile);
  const checkTools = vi.fn(async (_workspaceId, tools: Array<{ id: string; label: string; command: string }>) =>
    tools.map((tool) => ({
      ...tool,
      available: tool.command !== 'missing-python',
      version: tool.command === 'missing-python' ? undefined : `${tool.command} version 1.0.0`,
      message: tool.command === 'missing-python' ? `${tool.command} was not found` : `${tool.command} version 1.0.0`,
    })));
  const run = vi.fn(async (_workspaceId, profile) => ({
    id: 'run-latest',
    profileId: profile.id,
    profileName: profile.name,
    entryFile: profile.entryFile,
    inputs: [{ path: profile.entryFile, content: fileContents[profile.entryFile] }],
    exitCode: 0,
    stdout: 'done\n',
    stderr: '',
    elapsedMs: 4,
    startedAt: new Date().toISOString(),
    diagnostics: [] as RunResult['diagnostics'],
  }));
  const api = {
    workspace: {
      open: vi.fn(async () => workspace),
      recent: vi.fn(async () => []),
      resume: vi.fn(async () => workspace),
      trust: vi.fn(async () => workspace),
    },
    files: {
      list: vi.fn(async () => Object.keys(fileContents).map((filePath) => ({
        path: filePath,
        name: filePath,
        language: language(filePath),
        status: 'saved',
      }))),
      read: vi.fn(async (_workspaceId, filePath: string) => ({
        path: filePath,
        name: filePath,
        language: language(filePath),
        content: fileContents[filePath],
        diskVersion: String(version),
        dirty: false,
      })),
      write: vi.fn(async (_workspaceId, document: { path: string; content: string }) => {
        fileContents[document.path] = document.content;
        recoveryBuffers.delete(document.path);
        version += 1;
        return { conflict: false, diskVersion: String(version) };
      }),
      create: vi.fn(async (_workspaceId, filePath: string, content: string) => {
        if (fileContents[filePath] !== undefined) {
          throw new Error('File already exists');
        }
        fileContents[filePath] = content;
        version += 1;
        return { created: true as const };
      }),
      rename: vi.fn(async (_workspaceId, filePath: string, nextPath: string) => {
        fileContents[nextPath] = fileContents[filePath];
        delete fileContents[filePath];
        version += 1;
        return { renamed: true as const };
      }),
      remove: vi.fn(async (_workspaceId, filePath: string) => {
        delete fileContents[filePath];
        version += 1;
        return { removed: true as const };
      }),
      backupRecovery: vi.fn(async (_workspaceId, filePath: string, content: string) => {
        recoveryBuffers.set(filePath, { content, updatedAt: new Date().toISOString() });
        return { backedUp: true as const };
      }),
      backupRecoverySync: vi.fn((_workspaceId, filePath: string, content: string) => {
        recoveryBuffers.set(filePath, { content, updatedAt: new Date().toISOString() });
        return { backedUp: true as const };
      }),
      recovery: vi.fn(async (_workspaceId, filePath: string) => recoveryBuffers.get(filePath) ?? null),
      listRecovery: vi.fn(async () => [...recoveryBuffers.entries()].map(([filePath, recovery]) => ({
        filePath,
        content: recovery.content,
        updatedAt: recovery.updatedAt,
      }))),
      clearRecovery: vi.fn(async (_workspaceId, filePath: string) => {
        recoveryBuffers.delete(filePath);
        return { cleared: true as const };
      }),
      onChanged: vi.fn((listener) => {
        fileListener = listener;
        return () => {
          fileListener = undefined;
        };
      }),
    },
    terminal: {
      list: vi.fn(async () => []),
      create: vi.fn(async () => ({
        id: 'shell-1',
        title: 'Shell 1',
        cwd: workspace.rootPath,
        shell: '/bin/zsh',
        status: 'running' as const,
      })),
      rename: vi.fn(async (_workspaceId: string, _sessionId: string, title: string) => ({ renamed: true as const, title })),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(() => () => undefined),
      onExit: vi.fn(() => () => undefined),
    },
    runner: {
      run,
      profiles: vi.fn(async () => []),
      saveProfile,
      history: vi.fn(async () => []),
      getResult: vi.fn(async () => null),
    },
    git: {
      status: vi.fn(async () => ({ branch: 'main', ahead: 0, behind: 0, files: [] })),
      branches: vi.fn(async () => ['main', 'feature/editor']),
      stagedSummary: vi.fn(async () => ({ files: [], additions: 0, deletions: 0 })),
      diff: vi.fn(),
      compare: vi.fn(async (_workspaceId, file: { path: string }, mode: 'all' | 'staged' | 'unstaged') => ({
        path: file.path,
        language: language(file.path),
        mode,
        leftLabel: mode === 'unstaged' ? 'INDEX' : 'HEAD',
        rightLabel: mode === 'staged' ? 'INDEX' : 'WORKTREE',
        leftContent: 'print("before")\n',
        rightContent: 'print("after")\n',
        leftExists: true,
        rightExists: true,
      })),
      history: vi.fn(async () => []),
      commitDetail: vi.fn(async (_workspaceId, revision: string) => ({
        revision,
        shortRevision: revision.slice(0, 7).toUpperCase(),
        subject: 'Journal commit',
        files: [{ status: 'M', path: 'main.py' }],
      })),
      compareCommit: vi.fn(async (_workspaceId, revision: string, file: { path: string }) => ({
        path: file.path,
        language: language(file.path),
        mode: 'commit' as const,
        leftLabel: 'PARENT',
        rightLabel: `COMMIT ${revision.slice(0, 7).toUpperCase()}`,
        leftContent: 'print("before")\n',
        rightContent: 'print("after")\n',
        leftExists: true,
        rightExists: true,
      })),
      action: vi.fn(async () => ({ exitCode: 0, stdout: 'done', stderr: '' })),
      applyPatch: vi.fn(async (
        _workspaceId: string,
        _patch: string,
        mode: 'stage' | 'unstage' | 'discard',
        _confirmed?: boolean,
      ) => ({
        applied: true as const,
        mode,
      })),
    },
    journal: {
      list: vi.fn(async () => []),
      add: vi.fn(),
      snapshot: vi.fn(async (
        _workspaceId: string,
        files: Array<{ path: string; content: string }>,
        note: string,
        runResultId?: string,
        sourceRevision?: string,
      ) => ({
        id: 'snapshot-created',
        workspaceId: workspace.id,
        files,
        note,
        runResultId,
        sourceRevision,
        createdAt: new Date().toISOString(),
      })),
      getSnapshot: vi.fn(async () => null),
    },
    settings: {
      storageMode: vi.fn(),
    },
    environment: {
      checkTools,
    },
  } as unknown as CodeyoDesktopApi;
  return {
    api,
    workspace,
    fileContents,
    run,
    saveProfile,
    checkTools,
    async change(filePath: string, content: string): Promise<void> {
      fileContents[filePath] = content;
      version += 1;
      await fileListener?.({
        workspaceId: workspace.id,
        path: filePath,
        type: 'change',
        exists: true,
        directory: false,
        diskVersion: String(version),
      });
    },
    async remove(filePath: string): Promise<void> {
      delete fileContents[filePath];
      version += 1;
      await fileListener?.({
        workspaceId: workspace.id,
        path: filePath,
        type: 'rename',
        exists: false,
        directory: false,
      });
    },
  };
}

describe('App', () => {
  beforeEach(async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        media: '',
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      measureText: () => ({ width: 8 }),
    } as unknown as CanvasRenderingContext2D);
    if (typeof Range !== 'undefined') {
      const rect = {
        x: 0,
        y: 0,
        width: 8,
        height: 18,
        top: 0,
        right: 8,
        bottom: 18,
        left: 0,
        toJSON: () => ({}),
      } as DOMRect;
      const rects = {
        length: 1,
        item: (index: number) => index === 0 ? rect : null,
        [Symbol.iterator]: function* iterator() {
          yield rect;
        },
      } as DOMRectList;
      Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: vi.fn(() => rect),
      });
      Object.defineProperty(Range.prototype, 'getClientRects', {
        configurable: true,
        value: vi.fn(() => rects),
      });
    }
    await TestBed.configureTestingModule({
      imports: [App, DesktopTerminalComponent],
    }).compileComponents();
  });

  afterEach(() => {
    delete window.codeyo;
    localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the editorial IDE workspace and explorer', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.ide-plane')).toBeTruthy();
    expect(compiled.querySelector('.side-file-system')).toBeTruthy();
    expect(compiled.querySelector('.codeyo-editor-host')?.getAttribute('aria-label')).toContain('fib.py');
    expect(compiled.querySelector('.cm-editor')).toBeTruthy();
  });

  it('should toggle the floating assist slot', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.ide-inspector')).toBeTruthy();

    (fixture.nativeElement.querySelector('.panel-toggle') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.ide-inspector')).toBeFalsy();
  });

  it('should switch channels and direct messages from the shell navigation', async () => {
    const channelFixture = TestBed.createComponent(App);
    const channelApp = channelFixture.componentInstance;
    channelApp.selectChannel('resources');
    channelFixture.detectChanges();
    await channelFixture.whenStable();
    expect(channelApp.activeChannelId).toBe('resources');
    expect(channelApp.activeChannelView).toBe('thread');
    expect(channelFixture.nativeElement.querySelector('.workspace-tabs span')?.textContent).toContain('Snapshots');

    const dmFixture = TestBed.createComponent(App);
    const dmApp = dmFixture.componentInstance;
    dmApp.openDm('jay');
    dmFixture.detectChanges();
    await dmFixture.whenStable();
    expect(dmApp.focusedScreen).toBe('dm');
    expect(dmApp.activeDmThread.name).toBe('jay');
    expect(dmFixture.nativeElement.querySelector('.letter-head h1')?.textContent).toContain('jay');
    expect(dmFixture.nativeElement.querySelector('.letter-stream')?.textContent).toContain('树图');
  });

  it('should create and remove an editable buffer', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    app.newFileName = 'draft.py';
    app.createFile();
    expect(app.activeIdeFile.name).toBe('draft.py');
    expect(app.canDeleteActiveFile).toBe(true);

    app.deleteActiveFile();
    expect(app.ideFiles.some((file) => file.name === 'draft.py')).toBe(false);
  });

  it('should filter files and execute terminal commands against buffers', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    app.fileQuery = 'test';
    expect(app.filteredIdeFiles.map((file) => file.name)).toEqual(['tests.py']);

    app.ideFiles.push({
      name: 'helper.py',
      path: 'src/lib/helper.py',
      lang: 'python',
      status: 'saved',
      lines: ['def helper():', '    return 1'],
    });
    app.fileQuery = 'src/lib';
    expect(app.filteredIdeFiles.map((file) => file.path)).toEqual(['src/lib/helper.py']);

    app.terminalCommand = 'open notes.md';
    app.executeTerminalCommand();
    expect(app.activeIdeFile.name).toBe('notes.md');

    app.terminalCommand = 'python fib.py';
    app.executeTerminalCommand();
    expect(app.activeIdeFile.name).toBe('fib.py');
    expect(app.runOutput.join(' ')).toContain('memo hits');
  });

  it('should render real nested workspace folders in the Explorer', async () => {
    const desktop = createDesktopHarness({
      'README.md': '# Project\n',
      'src/main.py': 'print("ready")\n',
      'src/lib/util.py': 'print("util")\n',
    });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();
    fixture.detectChanges();

    const treeText = fixture.nativeElement.querySelector('.vscode-tree')?.textContent ?? '';
    expect(treeText).toContain('src');
    expect(treeText).toContain('lib');
    expect(treeText).toContain('main.py');
    expect(treeText).toContain('util.py');

    app.toggleExplorerFolder('src/lib');
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.vscode-tree')?.textContent).not.toContain('util.py');
  });

  it('should open editable files when optional workspace state cannot load', async () => {
    const desktop = createDesktopHarness({
      'main.py': 'print("ready")\n',
      'util.py': 'print("util")\n',
    });
    vi.mocked(desktop.api.journal.list).mockRejectedValueOnce(new Error('journal database locked'));
    vi.mocked(desktop.api.files.listRecovery).mockRejectedValueOnce(new Error('recovery store corrupt'));
    vi.mocked(desktop.api.runner.profiles).mockRejectedValueOnce(new Error('profile store corrupt'));
    vi.mocked(desktop.api.runner.history).mockRejectedValueOnce(new Error('run history corrupt'));
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();

    await app.openDesktopWorkspace();

    expect(app.activeIdeFile.path).toBe('main.py');
    expect(app.activeEditorText).toContain('ready');
    expect(app.workspaceNotice).toContain('JOURNAL');
    expect(app.workspaceNotice).toContain('RECOVERY');
    expect(app.workspaceNotice).toContain('RUNNER STATE');
    expect(app.workspaceNotice).toContain('UNAVAILABLE');
    expect(app.workspaceNotice).not.toContain('COULD NOT OPEN WORKSPACE');
  });

  it('should open a file from disk when recovery lookup fails', async () => {
    const desktop = createDesktopHarness({
      'main.py': 'print("ready")\n',
    });
    desktop.api.files.recovery = vi.fn(async () => {
      throw new Error('recovery database locked');
    });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();

    await app.openDesktopWorkspace();

    expect(app.activeIdeFile.path).toBe('main.py');
    expect(app.activeEditorText).toContain('ready');
    expect(app.activeIdeFile.status).toBe('saved');
    expect(app.workspaceNotice).toContain('RECOVERY UNAVAILABLE');
    expect(app.workspaceNotice).not.toContain('COULD NOT OPEN WORKSPACE');
  });

  it('should keep an external file update when workspace index refresh fails', async () => {
    const desktop = createDesktopHarness({
      'main.py': 'print("initial")\n',
    });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();
    vi.spyOn(
      app as unknown as { refreshDesktopFileIndex: (preserveBuffers: boolean) => Promise<void> },
      'refreshDesktopFileIndex',
    ).mockRejectedValueOnce(new Error('index unavailable'));

    await desktop.change('main.py', 'print("changed")\n');

    expect(app.activeEditorText).toContain('changed');
    expect(app.workspaceNotice).toContain('WORKSPACE FILE INDEX REFRESH FAILED');
  });

  it('should create nested desktop files and select them from the tree', async () => {
    const desktop = createDesktopHarness({ 'src/main.py': 'print("ready")\n' });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    app.newFileName = 'src/features/new_tool.py';
    app.createFile();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    expect(desktop.api.files.create).toHaveBeenCalledWith(
      'workspace-1',
      'src/features/new_tool.py',
      expect.stringContaining('def main'),
    );
    expect(app.activeIdeFile.path).toBe('src/features/new_tool.py');
    expect(fixture.nativeElement.querySelector('.vscode-tree')?.textContent).toContain('features');
    expect(fixture.nativeElement.querySelector('.vscode-tree')?.textContent).toContain('new_tool.py');
  });

  it('should block deleting unsaved desktop files', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("ready")\n' });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    app.updateActiveFile('print("dirty")\n');
    app.deleteActiveFile();

    expect(confirm).not.toHaveBeenCalled();
    expect(desktop.api.files.remove).not.toHaveBeenCalled();
    expect(app.workspaceNotice).toContain('SAVE OR RESOLVE BUFFER BEFORE DELETING');
  });

  it('should confirm and delete saved desktop files', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("ready")\n' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    app.deleteActiveFile();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(desktop.api.files.remove).toHaveBeenCalledWith('workspace-1', 'main.py', true);
    expect(app.workspaceNotice).toContain('DELETED FILE');
  });

  it('should surface desktop file create and rename failures', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("ready")\n' });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    vi.mocked(desktop.api.files.create).mockRejectedValueOnce(new Error('File already exists'));
    app.newFileName = 'main.py';
    app.createFile();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(app.workspaceNotice).toContain('COULD NOT CREATE FILE');

    vi.spyOn(window, 'prompt').mockReturnValue('src/main.py');
    vi.mocked(desktop.api.files.rename).mockRejectedValueOnce(new Error('Path is outside Codeyo editable file scope'));
    app.renameActiveFile();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(app.workspaceNotice).toContain('COULD NOT RENAME FILE');
  });

  it('should rename desktop files into nested folders', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("ready")\n' });
    vi.spyOn(window, 'prompt').mockReturnValue('src/features/renamed.py');
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    app.renameActiveFile();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    expect(desktop.api.files.rename).toHaveBeenCalledWith(
      'workspace-1',
      'main.py',
      'src/features/renamed.py',
    );
    expect(app.activeIdeFile.path).toBe('src/features/renamed.py');
    expect(fixture.nativeElement.querySelector('.vscode-tree')?.textContent).toContain('features');
    expect(app.workspaceNotice).toContain('RENAMED FILE');
  });

  it('should quick-open buffers by path from the IDE keyboard', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.ideFiles.push({
      name: 'helper.py',
      path: 'src/lib/helper.py',
      lang: 'python',
      status: 'saved',
      lines: ['def helper():', '    return 1'],
    });

    app.handleEditorShortcut(new KeyboardEvent('keydown', { key: 'p', metaKey: true }));
    fixture.detectChanges();
    expect(app.quickOpenVisible).toBe(true);
    expect(fixture.nativeElement.querySelector('.quick-open-palette')).toBeTruthy();

    app.quickOpenQuery = 'src helper';
    expect(app.quickOpenResults[0].path).toBe('src/lib/helper.py');

    app.handleEditorShortcut(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(app.quickOpenVisible).toBe(false);
    expect(app.activeIdeFile.path).toBe('src/lib/helper.py');
  });

  it('should send the current buffer to the discussion for review', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    app.selectIdeFile('tests.py');
    app.requestPeerReview();

    expect(app.activeChannelView).toBe('thread');
    expect(app.threadUpdates[0]).toMatchObject({
      file: 'tests.py',
      kind: 'review',
    });
  });

  it('should only verify the memo path after adding a large-value test', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    app.selectIdeFile('tests.py');
    app.runTests();
    expect(app.lastRunSummary).toContain('large input not covered');

    app.performAssistantAction();
    app.runTests();
    expect(app.lastRunSummary).toContain('memo path verified');
  });

  it('should keep a dirty desktop buffer when the file changes on disk', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("initial")\n' });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.activeConsolePanel = 'output';
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    app.updateActiveFile('print("mine")\n');
    desktop.change('main.py', 'print("outside")\n');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(app.activeEditorText).toContain('mine');
    expect(app.fileConflict?.diskContent).toContain('outside');
  });

  it('should compare a dirty buffer against the external disk version before resolving', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("initial")\nkeep = True\n' });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    app.updateActiveFile('print("mine")\nkeep = True\n');
    desktop.change('main.py', 'print("outside")\nkeep = True\n');
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.file-conflict')?.textContent).toContain('Compare');
    app.openConflictCompare();
    fixture.detectChanges();

    expect(app.conflictCompareOpen).toBe(true);
    expect(app.conflictComparison.leftLines).toEqual([1]);
    expect(app.conflictComparison.rightLines).toEqual([1]);
    expect(fixture.nativeElement.querySelector('.conflict-compare-workbench')?.textContent)
      .toContain('Disk Version');

    await app.resolveConflict(true);
    expect(app.activeEditorText).toContain('outside');
    expect(app.fileConflict).toBeNull();
    expect(app.conflictCompareOpen).toBe(false);
  });

  it('should keep the current buffer when an external change cannot be read', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("initial")\n' });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    vi.mocked(desktop.api.files.read).mockRejectedValueOnce(new Error('Workspace file is too large'));
    await desktop.change('main.py', 'print("too large")\n');

    expect(app.activeIdeFile.path).toBe('main.py');
    expect(app.activeEditorText).toBe('print("initial")\n');
    expect(app.fileConflict).toBeNull();
    expect(app.workspaceNotice).toContain('EXTERNAL CHANGE READ FAILED');
    expect(app.workspaceNotice).toContain('WORKSPACE FILE IS TOO LARGE');
  });

  it('should pause save when a dirty desktop file was deleted on disk', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("initial")\n' });
    desktop.api.files.write = vi.fn(async () => ({
      conflict: true,
      diskVersion: '',
      diskContent: '',
      deleted: true,
    }));
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    app.updateActiveFile('print("mine")\n');
    app.saveCurrentFile();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(app.fileConflict?.deleted).toBe(true);
    expect(app.activeIdeFile.status).toBe('edited');
    expect(app.workspaceNotice).toContain('FILE DELETED ON DISK');

    await app.resolveConflict(false);
    expect(app.activeIdeFile.missingOnDisk).toBe(true);
    expect(app.workspaceNotice).toContain('SAVE TO WRITE');
  });

  it('should resume a recent trusted workspace without showing the native picker again', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("ready")\n' });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();

    app.recentWorkspace = {
      id: 'workspace-1',
      rootPath: '/tmp/codeyo-test',
      name: 'codeyo-test',
      trusted: true,
      platform: 'darwin',
      storageMode: 'app-db',
    };
    await app.resumeRecentWorkspace();

    expect(desktop.api.workspace.resume).toHaveBeenCalledWith('workspace-1');
    expect(app.workspace?.name).toBe('codeyo-test');
    expect(app.activeIdeFile.path).toBe('main.py');
  });

  it('should refuse to run a desktop file whose current buffer is unsaved', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("on disk")\n' });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    app.updateActiveFile('print("not yet saved")\n');
    app.runCode();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(desktop.run).not.toHaveBeenCalled();
    expect(app.workspaceNotice).toContain('SAVE BEFORE RUNNING');
    expect(app.desktopOutput.join(' ')).toContain('UNSAVED BUFFER');
  });

  it('should save all edited desktop buffers in one explicit action', async () => {
    const desktop = createDesktopHarness({
      'main.py': 'print("initial")\n',
      'util.py': 'print("utility")\n',
    });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    app.updateActiveFile('print("changed main")\n');
    app.selectIdeFile('util.py');
    await new Promise((resolve) => setTimeout(resolve, 0));
    app.updateActiveFile('print("changed util")\n');
    await app.saveAllFiles();

    expect(desktop.api.files.write).toHaveBeenCalledTimes(2);
    expect(app.editedFileCount).toBe(0);
    expect(app.workspaceNotice).toContain('SAVED 2 BUFFERS');
  });

  it('should keep Save All success visible when recovery refresh fails afterward', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("initial")\n' });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    app.updateActiveFile('print("changed")\n');
    vi.mocked(desktop.api.files.listRecovery).mockRejectedValueOnce(new Error('recovery store locked'));
    await app.saveAllFiles();

    expect(app.activeIdeFile.status).toBe('saved');
    expect(desktop.fileContents['main.py']).toBe('print("changed")\n');
    expect(app.workspaceNotice).toContain('SAVED 1 BUFFERS');
    expect(app.workspaceNotice).toContain('RECOVERY REFRESH FAILED');
    expect(app.workspaceNotice).not.toContain('COULD NOT REFRESH RECOVERY BUFFERS');
  });

  it('should surface single-file save failures without marking the buffer saved', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("initial")\n' });
    vi.mocked(desktop.api.files.write).mockRejectedValueOnce(new Error('disk full'));
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    app.updateActiveFile('print("unsaved")\n');
    app.saveCurrentFile();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(app.activeIdeFile.status).toBe('edited');
    expect(app.activeEditorText).toBe('print("unsaved")\n');
    expect(desktop.fileContents['main.py']).toBe('print("initial")\n');
    expect(app.workspaceNotice).toContain('SAVE FAILED');
    expect(app.workspaceNotice).toContain('DISK FULL');
  });

  it('should stop Save All on write failure and keep the failed buffer dirty', async () => {
    const desktop = createDesktopHarness({
      'main.py': 'print("initial")\n',
      'util.py': 'print("utility")\n',
    });
    vi.mocked(desktop.api.files.write).mockImplementation(async (_workspaceId, document) => {
      if (document.path === 'util.py') {
        throw new Error('permission denied');
      }
      desktop.fileContents[document.path] = document.content;
      return { conflict: false, diskVersion: 'saved-main' };
    });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    app.updateActiveFile('print("changed main")\n');
    app.selectIdeFile('util.py');
    await new Promise((resolve) => setTimeout(resolve, 0));
    app.updateActiveFile('print("changed util")\n');
    await app.saveAllFiles();

    const mainFile = app.ideFiles.find((file) => file.path === 'main.py');
    const utilFile = app.ideFiles.find((file) => file.path === 'util.py');
    expect(mainFile?.status).toBe('saved');
    expect(utilFile?.status).toBe('edited');
    expect(app.activeIdeFile.path).toBe('util.py');
    expect(desktop.fileContents['main.py']).toBe('print("changed main")\n');
    expect(desktop.fileContents['util.py']).toBe('print("utility")\n');
    expect(app.workspaceNotice).toContain('SAVE ALL FAILED');
    expect(app.workspaceNotice).toContain('PERMISSION DENIED');
  });

  it('should keep recovery backups bound to the edited file after switching buffers', async () => {
    const desktop = createDesktopHarness({
      'main.py': 'print("initial")\n',
      'util.py': 'print("utility")\n',
    });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    vi.useFakeTimers();
    app.updateActiveFile('print("changed main")\n');
    app.selectIdeFile('util.py');
    await vi.advanceTimersByTimeAsync(500);

    expect(desktop.api.files.backupRecovery).toHaveBeenCalledWith(
      'workspace-1',
      'main.py',
      'print("changed main")\n',
    );
  });

  it('should surface recovery backup failures without discarding the dirty buffer', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("initial")\n' });
    vi.mocked(desktop.api.files.backupRecovery).mockRejectedValueOnce(new Error('Recovery buffer is not valid'));
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    vi.useFakeTimers();
    app.updateActiveFile('print("changed")\n');
    await vi.advanceTimersByTimeAsync(500);

    expect(desktop.api.files.backupRecovery).toHaveBeenCalledWith(
      'workspace-1',
      'main.py',
      'print("changed")\n',
    );
    expect(app.activeIdeFile.status).toBe('edited');
    expect(app.activeEditorText).toBe('print("changed")\n');
    expect(app.workspaceNotice).toContain('RECOVERY BACKUP FAILED');
  });

  it('should auto-save edited desktop buffers when project auto-save is enabled', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("initial")\n' });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    vi.useFakeTimers();
    app.setAutoSave(true);
    app.updateActiveFile('print("autosaved")\n');
    await vi.advanceTimersByTimeAsync(app.autoSaveDelayMs + 20);

    expect(desktop.api.files.write).toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({
        path: 'main.py',
        content: 'print("autosaved")\n',
      }),
    );
    expect(app.activeIdeFile.status).toBe('saved');
    expect(app.workspaceNotice).toContain('AUTO-SAVED');
  });

  it('should keep auto-save success visible when recovery refresh fails afterward', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("initial")\n' });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    vi.useFakeTimers();
    vi.mocked(desktop.api.files.listRecovery)
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('recovery store locked'));
    app.setAutoSave(true);
    app.updateActiveFile('print("autosaved")\n');
    await vi.advanceTimersByTimeAsync(app.autoSaveDelayMs + 20);

    expect(app.activeIdeFile.status).toBe('saved');
    expect(desktop.fileContents['main.py']).toBe('print("autosaved")\n');
    expect(app.workspaceNotice).toContain('AUTO-SAVED');
    expect(app.workspaceNotice).toContain('RECOVERY REFRESH FAILED');
    expect(app.workspaceNotice).not.toContain('COULD NOT REFRESH RECOVERY BUFFERS');
  });

  it('should block app unload and flush recovery when desktop buffers are unsaved', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("initial")\n' });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    app.updateActiveFile('print("unsaved")\n');
    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    const preventDefault = vi.spyOn(event, 'preventDefault');
    app.handleBeforeUnload(event);

    expect(preventDefault).toHaveBeenCalled();
    expect(desktop.api.files.backupRecoverySync).toHaveBeenCalledWith(
      'workspace-1',
      'main.py',
      'print("unsaved")\n',
    );
  });

  it('should allow app unload when there are no unsaved desktop buffers', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("saved")\n' });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    const preventDefault = vi.spyOn(event, 'preventDefault');
    app.handleBeforeUnload(event);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(desktop.api.files.backupRecoverySync).not.toHaveBeenCalled();
  });

  it('should expose recovery buffers for explicit restore or discard', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("disk")\n' });
    await desktop.api.files.backupRecovery('workspace-1', 'scratch.py', 'print("recovered")\n');
    window.codeyo = desktop.api;
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();
    fixture.detectChanges();

    expect(app.recoveryBufferCount).toBe(1);
    expect(fixture.nativeElement.querySelector('.recovery-center')?.textContent).toContain('scratch.py');

    await app.restoreRecovery(app.recoveryBuffers[0]);
    expect(app.activeIdeFile.path).toBe('scratch.py');
    expect(app.activeEditorText).toContain('recovered');
    expect(app.activeIdeFile.status).toBe('edited');

    await app.discardRecovery(app.recoveryBuffers[0]);
    expect(app.recoveryBufferCount).toBe(0);
    expect(desktop.api.files.clearRecovery).toHaveBeenCalledWith('workspace-1', 'scratch.py');
  });

  it('should surface recovery discard failures without clearing the local list', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("disk")\n' });
    await desktop.api.files.backupRecovery('workspace-1', 'scratch.py', 'print("recovered")\n');
    desktop.api.files.clearRecovery = vi.fn(async () => {
      throw new Error('recovery clear failed');
    });
    window.codeyo = desktop.api;
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    await app.discardRecovery(app.recoveryBuffers[0]);

    expect(app.recoveryBufferCount).toBe(1);
    expect(app.workspaceNotice).toContain('COULD NOT DISCARD RECOVERY BUFFER');
    expect(app.workspaceNotice).toContain('RECOVERY CLEAR FAILED');
  });

  it('should keep storage migration success when sidecar refresh fails', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("disk")\n' });
    desktop.api.settings.storageMode = vi.fn(async () => ({
      storageMode: 'workspace-codeyo' as const,
      migrated: true,
      imported: true,
    }));
    window.codeyo = desktop.api;
    vi.spyOn(window, 'confirm')
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();
    vi.mocked(desktop.api.journal.list).mockRejectedValueOnce(new Error('journal refresh failed'));
    vi.mocked(desktop.api.files.listRecovery).mockRejectedValueOnce(new Error('recovery refresh failed'));

    await app.migrateStorage('workspace-codeyo');

    expect(app.workspace?.storageMode).toBe('workspace-codeyo');
    expect(app.workspaceNotice).toContain('STORAGE MIGRATED');
    expect(app.workspaceNotice).toContain('JOURNAL');
    expect(app.workspaceNotice).toContain('RECOVERY');
    expect(app.workspaceNotice).toContain('REFRESH FAILED');
  });

  it('should create, rename, and close terminal tabs explicitly', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("ready")\n' });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(DesktopTerminalComponent);
    const terminal = fixture.componentInstance;
    terminal.workspace = desktop.workspace;
    terminal.enabled = true;

    await terminal.newSession();
    expect(desktop.api.terminal.create).toHaveBeenCalledWith('workspace-1', 'Shell 1');
    expect(terminal.activeSessionId).toBe('shell-1');

    terminal.startRename(terminal.sessions[0]);
    terminal.updateRenameDraft({ target: { value: 'Project Shell' } } as unknown as Event);
    await terminal.commitRename('shell-1');
    expect(terminal.sessions[0].title).toBe('Project Shell');
    expect(desktop.api.terminal.rename).toHaveBeenCalledWith('workspace-1', 'shell-1', 'Project Shell');
    expect(terminal.sessionStatusLabel(terminal.sessions[0])).toBe('RUNNING');

    await terminal.close('shell-1');
    expect(desktop.api.terminal.kill).toHaveBeenCalledWith('workspace-1', 'shell-1');
    expect(terminal.sessions).toEqual([]);
  });

  it('should restore running terminal tabs from the desktop process', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("ready")\n' });
    vi.mocked(desktop.api.terminal.list).mockResolvedValueOnce([{
      id: 'shell-restored',
      title: 'Project Shell',
      cwd: desktop.workspace.rootPath,
      shell: '/bin/zsh',
      status: 'running',
      buffer: '$ pytest\r\n1 passed\r\n',
    }]);
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(DesktopTerminalComponent);
    const terminal = fixture.componentInstance;
    terminal.workspace = desktop.workspace;
    terminal.enabled = true;

    await terminal.restoreWorkspaceSessions();

    expect(desktop.api.terminal.list).toHaveBeenCalledWith('workspace-1');
    expect(desktop.api.terminal.create).not.toHaveBeenCalled();
    expect(terminal.sessions[0].id).toBe('shell-restored');
    expect(terminal.sessions[0].buffer).toContain('1 passed');
    expect(terminal.activeSessionId).toBe('shell-restored');
  });

  it('should bound restored terminal buffers and sanitize tab titles', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("ready")\n' });
    const hugeBuffer = `${'x'.repeat(210000)}tail`;
    vi.mocked(desktop.api.terminal.list).mockResolvedValueOnce([{
      id: 'shell-restored',
      title: 'Project Shell',
      cwd: desktop.workspace.rootPath,
      shell: '/bin/zsh',
      status: 'running',
      buffer: hugeBuffer,
    }]);
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(DesktopTerminalComponent);
    const terminal = fixture.componentInstance;
    terminal.workspace = desktop.workspace;
    terminal.enabled = true;

    await terminal.restoreWorkspaceSessions();

    expect(terminal.sessions[0].buffer.length).toBe(200000);
    expect(terminal.sessions[0].buffer.endsWith('tail')).toBe(true);

    terminal.startRename(terminal.sessions[0]);
    terminal.updateRenameDraft({ target: { value: '  Project\nShell\t1  ' } } as unknown as Event);
    await terminal.commitRename('shell-restored');

    expect(terminal.sessions[0].title).toBe('Project Shell 1');
    expect(desktop.api.terminal.rename).toHaveBeenCalledWith(
      'workspace-1',
      'shell-restored',
      'Project Shell 1',
    );
  });

  it('should surface terminal session limit failures', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("ready")\n' });
    vi.mocked(desktop.api.terminal.create).mockRejectedValueOnce(new Error('Terminal session limit reached (8)'));
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(DesktopTerminalComponent);
    const terminal = fixture.componentInstance;
    terminal.workspace = desktop.workspace;
    terminal.enabled = true;

    await terminal.newSession();

    expect(terminal.sessions).toEqual([]);
    expect(terminal.creatingSession).toBe(false);
    expect(terminal.terminalNotice).toContain('TERMINAL CREATE FAILED');
    expect(terminal.terminalNotice).toContain('TERMINAL SESSION LIMIT REACHED');
  });

  it('should revert terminal tab titles when remote rename fails', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("ready")\n' });
    vi.mocked(desktop.api.terminal.rename).mockRejectedValueOnce(new Error('session is gone'));
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(DesktopTerminalComponent);
    const terminal = fixture.componentInstance;
    terminal.workspace = desktop.workspace;
    terminal.enabled = true;
    await terminal.newSession();

    terminal.startRename(terminal.sessions[0]);
    terminal.updateRenameDraft({ target: { value: 'Broken Rename' } } as unknown as Event);
    await terminal.commitRename('shell-1');

    expect(terminal.sessions[0].title).toBe('Shell 1');
    expect(terminal.terminalNotice).toContain('TERMINAL RENAME FAILED');
    expect(terminal.terminalNotice).toContain('SESSION IS GONE');
  });

  it('should keep terminal tabs visible when remote close fails', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("ready")\n' });
    vi.mocked(desktop.api.terminal.kill).mockRejectedValueOnce(new Error('wrong workspace'));
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(DesktopTerminalComponent);
    const terminal = fixture.componentInstance;
    terminal.workspace = desktop.workspace;
    terminal.enabled = true;
    await terminal.newSession();

    await terminal.close('shell-1');

    expect(terminal.sessions.map((session) => session.id)).toEqual(['shell-1']);
    expect(terminal.terminalNotice).toContain('TERMINAL CLOSE FAILED');
    expect(terminal.terminalNotice).toContain('WRONG WORKSPACE');
  });

  it('should navigate a problem to its file and CodeMirror location request', async () => {
    const desktop = createDesktopHarness({
      'main.cpp': 'int main() { return helper(); }\n',
      'util.cpp': 'int helper() { return ; }\n',
    });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    const diagnostic = {
      path: 'util.cpp',
      line: 1,
      column: 16,
      severity: 'error' as const,
      message: 'expected expression',
    };
    app.runDiagnostics = [diagnostic];
    await app.openDiagnostic(diagnostic);

    expect(app.activeIdeFile.path).toBe('util.cpp');
    expect(app.diagnosticRevealLine).toBe(1);
    expect(app.diagnosticRevealColumn).toBe(16);
    expect(app.diagnosticRevealRequest).toBe(1);
  });

  it('should clear stale diagnostics when a saved file reloads from disk', async () => {
    const desktop = createDesktopHarness({ 'main.cpp': 'int main() { return 1; }\n' });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();
    app.runDiagnostics = [{
      path: 'main.cpp',
      line: 1,
      severity: 'error',
      message: 'stale compiler result',
    }];

    desktop.change('main.cpp', 'int main() { return 0; }\n');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(app.runDiagnostics).toEqual([]);
    expect(app.activeEditorText).toContain('return 0');
  });

  it('should explain a missing C++ compiler instead of failing silently', async () => {
    const desktop = createDesktopHarness({ 'main.cpp': 'int main() { return 0; }\n' });
    desktop.run.mockRejectedValueOnce(new Error('spawn clang++ ENOENT'));
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    app.runCode();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(app.desktopOutput.join(' ')).toContain('COMPILER NOT FOUND');
    expect(app.activeConsolePanel).toBe('output');
  });

  it('should surface structured runner tool failures as diagnostics', async () => {
    const desktop = createDesktopHarness({ 'main.cpp': 'int main() { return 0; }\n' });
    desktop.run.mockResolvedValueOnce({
      id: 'run-missing-compiler',
      profileId: 'cpp-current',
      profileName: 'Run main.cpp',
      entryFile: 'main.cpp',
      inputs: [{ path: 'main.cpp', content: 'int main() { return 0; }\n' }],
      exitCode: 127,
      stdout: '',
      stderr: 'COMPILER NOT FOUND · missing-clang++\n',
      elapsedMs: 3,
      startedAt: new Date().toISOString(),
      diagnostics: [{
        path: 'main.cpp',
        line: 1,
        severity: 'error',
        message: 'COMPILER NOT FOUND · missing-clang++',
      }],
    });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    app.runCode();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(app.runDiagnostics[0].message).toContain('COMPILER NOT FOUND');
    expect(app.activeConsolePanel).toBe('problems');
    expect(desktop.api.journal.add).toHaveBeenCalledWith(
      'workspace-1',
      'run',
      expect.stringContaining('EXIT 127'),
      expect.objectContaining({ runResultId: 'run-missing-compiler', diagnostics: 1 }),
    );
  });

  it('should preserve a completed run when journal recording fails', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("ready")\n' });
    desktop.api.journal.add = vi.fn(async () => {
      throw new Error('journal disk full');
    });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    app.runCode();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(app.lastRunSummary).toContain('EXIT 0');
    expect(app.workspaceNotice).toContain('RUN COMPLETE');
    expect(app.workspaceNotice).toContain('JOURNAL WRITE FAILED');
    expect(app.activeConsolePanel).toBe('terminal');
  });

  it('should expose existing Git branches and switch explicitly selected branches', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("ok")\n' });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    expect(app.gitBranches).toEqual(['main', 'feature/editor']);
    app.selectedBranch = 'feature/editor';
    app.switchBranch();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(desktop.api.git.action).toHaveBeenCalledWith(
      'workspace-1',
      { type: 'switch-branch', name: 'feature/editor' },
    );
  });

  it('should block branch switching with unsaved editor buffers', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("ok")\n' });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    app.updateActiveFile('print("dirty")\n');
    app.selectedBranch = 'feature/editor';
    app.switchBranch();

    expect(confirm).not.toHaveBeenCalled();
    expect(desktop.api.git.action).not.toHaveBeenCalled();
    expect(app.gitNotice).toContain('SWITCH BRANCH BLOCKED');
  });

  it('should confirm branch switching with local Git changes', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("ok")\n' });
    vi.mocked(desktop.api.git.status).mockResolvedValue({
      branch: 'main',
      ahead: 0,
      behind: 0,
      files: [{ index: ' ', workingTree: 'M', path: 'main.py' }],
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    app.selectedBranch = 'feature/editor';
    app.switchBranch();

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Switch to feature/editor'));
    expect(desktop.api.git.action).not.toHaveBeenCalled();
  });

  it('should confirm before deleting a selected local branch', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("ok")\n' });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    app.selectedBranch = 'feature/editor';
    app.deleteSelectedBranch();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Delete local branch feature/editor'));
    expect(desktop.api.git.action).toHaveBeenCalledWith(
      'workspace-1',
      { type: 'delete-branch', name: 'feature/editor', confirmed: true },
    );
  });

  it('should guard pull with local changes and block empty push', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("ok")\n' });
    vi.mocked(desktop.api.git.status).mockResolvedValue({
      branch: 'main',
      ahead: 0,
      behind: 1,
      files: [{ index: ' ', workingTree: 'M', path: 'main.py' }],
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    app.pullRemote();
    app.pushRemote();

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Pull with local changes'));
    expect(desktop.api.git.action).not.toHaveBeenCalled();
    expect(app.gitNotice).toContain('NO LOCAL COMMITS TO PUSH');
  });

  it('should block pull with unsaved editor buffers', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("ok")\n' });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    app.updateActiveFile('print("dirty")\n');
    app.pullRemote();

    expect(confirm).not.toHaveBeenCalled();
    expect(desktop.api.git.action).not.toHaveBeenCalled();
    expect(app.gitNotice).toContain('PULL BLOCKED');
  });

  it('should push only when the branch is ahead', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("ok")\n' });
    vi.mocked(desktop.api.git.status).mockResolvedValue({
      branch: 'main',
      ahead: 2,
      behind: 0,
      files: [],
    });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    app.pushRemote();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(desktop.api.git.action).toHaveBeenCalledWith('workspace-1', { type: 'push' });
  });

  it('should review staged change totals before sending a commit action', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("ready")\n' });
    vi.mocked(desktop.api.git.status).mockResolvedValue({
      branch: 'main',
      ahead: 0,
      behind: 0,
      files: [{ index: 'M', workingTree: ' ', path: 'main.py' }],
    });
    vi.mocked(desktop.api.git.stagedSummary).mockResolvedValue({
      files: [{ path: 'main.py', additions: 3, deletions: 1 }],
      additions: 3,
      deletions: 1,
    });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();
    app.setRightPanel('git');
    app.recentRunResults = [{
      id: 'run-latest',
      profileId: 'python-current',
      profileName: 'Run main.py',
      entryFile: 'main.py',
      inputs: [{ path: 'main.py', content: 'print("ready")\n' }],
      exitCode: 0,
      stdout: 'done\n',
      stderr: '',
      elapsedMs: 4,
      startedAt: new Date().toISOString(),
      diagnostics: [],
    }];
    app.selectedCommitRunResultId = 'run-latest';

    app.commitMessage = 'Polish compare review';
    app.reviewCommit();
    fixture.detectChanges();

    expect(app.commitReviewOpen).toBe(true);
    expect(fixture.nativeElement.querySelector('.git-commit-review')?.textContent).toContain('+3 / -1');
    expect(desktop.api.git.action).not.toHaveBeenCalled();

    app.commitReviewedChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(desktop.api.git.action).toHaveBeenCalledWith(
      'workspace-1',
      { type: 'commit', message: 'Polish compare review', runResultId: 'run-latest' },
    );
    expect(app.commitMessage).toBe('');
    expect(app.selectedCommitRunResultId).toBe('');
  });

  it('should open a Git comparison surface and switch between staged versions', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("current")\n' });
    vi.mocked(desktop.api.git.status).mockResolvedValue({
      branch: 'main',
      ahead: 0,
      behind: 0,
      files: [{ index: 'M', workingTree: 'M', path: 'main.py' }],
    });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    await app.showGitDiff('main.py');
    fixture.detectChanges();

    expect(desktop.api.git.compare).toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({ path: 'main.py' }),
      'all',
    );
    expect(app.gitComparisonSummary).toContain('ALL · +1 / -1');
    expect(app.gitComparisonLeftLines).toEqual([1]);
    expect(app.gitComparisonRightLines).toEqual([1]);
    expect(fixture.nativeElement.querySelector('.git-compare-workbench')).toBeTruthy();
    expect(fixture.nativeElement.querySelectorAll('.git-compare-editors codeyo-editor')).toHaveLength(2);
    expect(fixture.nativeElement.querySelector('.git-compare-editors .cm-diff-removed')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.git-compare-editors .cm-diff-added')).toBeTruthy();

    await app.setGitComparisonMode('staged');
    expect(desktop.api.git.compare).toHaveBeenLastCalledWith(
      'workspace-1',
      expect.objectContaining({ path: 'main.py' }),
      'staged',
    );
  });

  it('should apply a selected unstaged Git hunk as a patch', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("current")\n' });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    await app.showGitDiff('main.py', 'unstaged');
    await app.applyGitHunk(1, 'stage');

    expect(desktop.api.git.applyPatch).toHaveBeenCalledWith(
      'workspace-1',
      expect.stringContaining('@@ -1,1 +1,1 @@'),
      'stage',
      false,
    );
    const patch = vi.mocked(desktop.api.git.applyPatch).mock.calls[0][1];
    expect(patch).toContain('-print("before")');
    expect(patch).toContain('+print("after")');
  });

  it('should require confirmation before discarding a Git hunk', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("current")\n' });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    await app.showGitDiff('main.py', 'unstaged');
    await app.applyGitHunk(1, 'discard');

    expect(app.pendingDiscardHunkId).toBe(1);
    expect(desktop.api.git.applyPatch).not.toHaveBeenCalled();

    await app.applyGitHunk(1, 'discard');
    expect(desktop.api.git.applyPatch).toHaveBeenCalledWith(
      'workspace-1',
      expect.stringContaining('@@ -1,1 +1,1 @@'),
      'discard',
      true,
    );
  });

  it('should reopen a journal commit as a read-only historical comparison', async () => {
    const desktop = createDesktopHarness({
      'main.py': 'print("after")\n',
      'util.py': 'print("helper")\n',
    });
    vi.mocked(desktop.api.journal.list).mockResolvedValue([{
      id: 'journal-commit',
      workspaceId: 'workspace-1',
      kind: 'git',
      body: 'COMMIT · Review from journal · 2 FILES · +2 / -1',
      createdAt: new Date().toISOString(),
      metadata: { action: 'commit', output: '[main 7c100f1] Review from journal' },
    }]);
    vi.mocked(desktop.api.git.commitDetail).mockResolvedValue({
      revision: '7c100f1cb26ac9e',
      shortRevision: '7C100F1',
      subject: 'Review from journal',
      files: [
        { status: 'M', path: 'main.py' },
        { status: 'A', path: 'util.py' },
      ],
    });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();
    app.setChannelView('thread');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.journal-entry.commit .btn')?.textContent).toContain('Open Commit');
    await app.openJournalCommit(app.journalEntries[0]);
    fixture.detectChanges();

    expect(desktop.api.git.commitDetail).toHaveBeenCalledWith('workspace-1', '7c100f1');
    expect(desktop.api.git.compareCommit).toHaveBeenCalledWith(
      'workspace-1',
      '7c100f1cb26ac9e',
      { status: 'M', path: 'main.py' },
    );
    expect(app.gitComparison?.mode).toBe('commit');
    expect(fixture.nativeElement.querySelector('.git-compare-modes.history')?.textContent).toContain('Review from journal');

    await app.selectGitHistoryFile({ status: 'A', path: 'util.py' });
    expect(desktop.api.git.compareCommit).toHaveBeenLastCalledWith(
      'workspace-1',
      '7c100f1cb26ac9e',
      { status: 'A', path: 'util.py' },
    );
  });

  it('should filter repository history and open a selected commit comparison', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("after")\n' });
    vi.mocked(desktop.api.git.history).mockResolvedValue([
      {
        revision: '7c100f1cb26ac9e',
        shortRevision: '7C100F1',
        subject: 'Verify commit desk',
        author: 'Codeyo-QA',
        authoredAt: '2026-05-25T14:07:02-07:00',
      },
      {
        revision: '4772310a53879b0',
        shortRevision: '4772310',
        subject: 'Stage compare fixture',
        author: 'Codeyo-QA',
        authoredAt: '2026-05-25T13:25:15-07:00',
      },
    ]);
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();
    app.setRightPanel('git');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.git-history-row')).toHaveLength(2);
    app.updateGitHistoryQuery({ target: { value: 'verify' } } as unknown as Event);
    expect(app.filteredGitHistory).toHaveLength(1);
    expect(app.filteredGitHistory[0].subject).toBe('Verify commit desk');

    await app.openGitHistoryCommit(app.filteredGitHistory[0]);
    expect(desktop.api.git.commitDetail).toHaveBeenCalledWith('workspace-1', '7c100f1cb26ac9e');
    expect(app.gitComparison?.mode).toBe('commit');
  });

  it('should save the viewed commit file as a sourced review snapshot', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("current")\n' });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();
    app.gitHistoryDetail = {
      revision: '7c100f1cb26ac9e',
      shortRevision: '7C100F1',
      subject: 'Reviewable commit',
      files: [{ status: 'M', path: 'main.py' }],
    };
    app.gitComparison = {
      path: 'main.py',
      language: 'python',
      mode: 'commit',
      leftLabel: 'PARENT',
      rightLabel: 'COMMIT 7C100F1',
      leftContent: 'print("before")\n',
      rightContent: 'print("committed")\n',
      leftExists: true,
      rightExists: true,
    };
    app.updateReviewSnapshotDraft({
      target: { value: 'Keep this rename as the teaching example.' },
    } as unknown as Event);

    await app.captureGitHistorySnapshot();

    expect(desktop.api.journal.snapshot).toHaveBeenCalledWith(
      'workspace-1',
      [{ path: 'main.py', content: 'print("committed")\n' }],
      'REVIEW SNAPSHOT · COMMIT 7C100F1 · main.py · Keep this rename as the teaching example.',
      undefined,
      '7c100f1cb26ac9e',
    );
    expect(app.activeChannelView).toBe('thread');
    expect(app.workspaceNotice).toContain('SAVED REVIEW SNAPSHOT');
    expect(app.reviewSnapshotDraft).toBe('');
  });

  it('should filter activity journal by entry kind and review text', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.journalEntries = [
      {
        id: 'review-1',
        workspaceId: 'workspace-1',
        kind: 'review',
        body: 'REVIEW SNAPSHOT · COMMIT 7C100F1 · MEMO LESSON',
        snapshotId: 'snapshot-1',
        createdAt: '2026-05-25T20:00:00.000Z',
      },
      {
        id: 'run-1',
        workspaceId: 'workspace-1',
        kind: 'run',
        body: 'RUN main.py · EXIT 0',
        createdAt: '2026-05-25T20:01:00.000Z',
      },
    ];

    expect(app.journalEntryCount('all')).toBe(2);
    expect(app.journalEntryCount('review')).toBe(1);
    app.setJournalKindFilter('review');
    app.updateJournalQuery({ target: { value: 'memo' } } as unknown as Event);

    expect(app.filteredJournalEntries).toHaveLength(1);
    expect(app.filteredJournalEntries[0].id).toBe('review-1');
    app.updateJournalQuery({ target: { value: 'exit' } } as unknown as Event);
    expect(app.filteredJournalEntries).toHaveLength(0);
  });

  it('should require a trusted workspace before adding journal notes', async () => {
    const desktop = createDesktopHarness(
      { 'main.py': 'print("ready")\n' },
      { trusted: false },
    );
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    app.journalDraft = 'do not write before trust';
    await app.addJournalNote();

    expect(desktop.api.journal.add).not.toHaveBeenCalled();
    expect(app.workspaceNotice).toContain('TRUST WORKSPACE');
  });

  it('should open run evidence from a journal entry', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("ready")\n' });
    desktop.api.runner.getResult = vi.fn(async () => ({
      id: 'run-latest',
      profileId: 'python-current',
      profileName: 'Run main.py',
      entryFile: 'main.py',
      inputs: [{ path: 'main.py', content: 'print("ready")\n' }],
      exitCode: 0,
      stdout: 'done\n',
      stderr: '',
      elapsedMs: 4,
      startedAt: new Date().toISOString(),
      diagnostics: [],
    }));
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    await app.openJournalRunEvidence({
      id: 'run-entry',
      workspaceId: 'workspace-1',
      kind: 'run',
      body: 'Run main.py',
      createdAt: new Date().toISOString(),
      metadata: { runResultId: 'run-latest' },
    });

    expect(desktop.api.runner.getResult).toHaveBeenCalledWith('workspace-1', 'run-latest');
    expect(app.desktopOutput.join(' ')).toContain('done');
    expect(app.activeChannelView).toBe('ide');
    expect(app.workspaceNotice).toContain('RUN EVIDENCE OPENED');
  });

  it('should carry journal commit run evidence into commit review snapshots', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("ready")\n' });
    desktop.api.runner.getResult = vi.fn(async () => ({
      id: 'run-latest',
      profileId: 'python-current',
      profileName: 'Run main.py',
      entryFile: 'main.py',
      inputs: [{ path: 'main.py', content: 'print("ready")\n' }],
      exitCode: 0,
      stdout: 'done\n',
      stderr: '',
      elapsedMs: 4,
      startedAt: new Date().toISOString(),
      diagnostics: [],
    }));
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    await app.openJournalCommit({
      id: 'git-entry',
      workspaceId: 'workspace-1',
      kind: 'git',
      body: 'COMMIT · Journal commit',
      createdAt: new Date().toISOString(),
      metadata: {
        action: 'commit',
        revision: '7c100f1cb26ac9e',
        runResultId: 'run-latest',
      },
    });

    expect(desktop.api.git.commitDetail).toHaveBeenCalledWith('workspace-1', '7c100f1cb26ac9e');
    expect(app.selectedReviewRunResultId).toBe('run-latest');
    expect(app.recentRunResults[0].id).toBe('run-latest');
  });

  it('should save all present files in a commit as one review set', async () => {
    const desktop = createDesktopHarness({
      'main.py': 'print("current")\n',
      'util.py': 'print("utility")\n',
    });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();
    app.gitHistoryDetail = {
      revision: '7c100f1cb26ac9e',
      shortRevision: '7C100F1',
      subject: 'Teach two changes together',
      files: [
        { status: 'M', path: 'main.py' },
        { status: 'A', path: 'util.py' },
        { status: 'D', path: 'removed.py' },
      ],
    };
    app.gitComparison = {
      path: 'main.py',
      language: 'python',
      mode: 'commit',
      leftLabel: 'PARENT',
      rightLabel: 'COMMIT 7C100F1',
      leftContent: 'print("before")\n',
      rightContent: 'print("committed")\n',
      leftExists: true,
      rightExists: true,
    };
    app.reviewSnapshotDraft = 'These files form one lesson.';
    app.selectedReviewRunResultId = 'run-latest';

    await app.captureGitHistorySnapshot('commit');

    expect(desktop.api.git.compareCommit).toHaveBeenCalledTimes(1);
    expect(desktop.api.git.compareCommit).toHaveBeenCalledWith(
      'workspace-1',
      '7c100f1cb26ac9e',
      { status: 'A', path: 'util.py' },
    );
    expect(desktop.api.journal.snapshot).toHaveBeenCalledWith(
      'workspace-1',
      [
        { path: 'main.py', content: 'print("committed")\n' },
        { path: 'util.py', content: 'print("after")\n' },
      ],
      'REVIEW SET · COMMIT 7C100F1 · 2 FILES · These files form one lesson.',
      'run-latest',
      '7c100f1cb26ac9e',
    );
    expect(app.workspaceNotice).toContain('REVIEW SET');
  });

  it('should save readable commit files when one review-set comparison fails', async () => {
    const desktop = createDesktopHarness({
      'main.py': 'print("current")\n',
      'util.py': 'print("utility")\n',
    });
    vi.mocked(desktop.api.git.compareCommit).mockImplementation(async (_workspaceId, revision: string, file) => {
      if (file.path === 'broken.py') {
        throw new Error('git object is not readable as text');
      }
      return {
        path: file.path,
        language: 'python',
        mode: 'commit' as const,
        leftLabel: 'PARENT',
        rightLabel: `COMMIT ${revision.slice(0, 7).toUpperCase()}`,
        leftContent: 'print("before")\n',
        rightContent: 'print("utility committed")\n',
        leftExists: true,
        rightExists: true,
      };
    });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();
    app.gitHistoryDetail = {
      revision: '7c100f1cb26ac9e',
      shortRevision: '7C100F1',
      subject: 'Keep readable files',
      files: [
        { status: 'M', path: 'main.py' },
        { status: 'M', path: 'broken.py' },
        { status: 'M', path: 'util.py' },
      ],
    };
    app.gitComparison = {
      path: 'main.py',
      language: 'python',
      mode: 'commit',
      leftLabel: 'PARENT',
      rightLabel: 'COMMIT 7C100F1',
      leftContent: 'print("before")\n',
      rightContent: 'print("committed")\n',
      leftExists: true,
      rightExists: true,
    };

    await app.captureGitHistorySnapshot('commit');

    expect(desktop.api.journal.snapshot).toHaveBeenCalledWith(
      'workspace-1',
      [
        { path: 'main.py', content: 'print("committed")\n' },
        { path: 'util.py', content: 'print("utility committed")\n' },
      ],
      'REVIEW SET · COMMIT 7C100F1 · 2 FILES · Keep readable files',
      undefined,
      '7c100f1cb26ac9e',
    );
    expect(app.workspaceNotice).toContain('2 FILES');
    expect(app.workspaceNotice).toContain('1 SKIPPED');
  });

  it('should retain a completed run as attachable review evidence', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("ready")\n' });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    app.runCode();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(app.recentRunResults[0].id).toBe('run-latest');
    expect(desktop.api.journal.add).toHaveBeenCalledWith(
      'workspace-1',
      'run',
      expect.stringContaining('EXIT 0'),
      expect.objectContaining({ runResultId: 'run-latest', exitCode: 0 }),
    );
  });

  it('should attach exact run evidence when reviewing the active desktop buffer', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("ready")\n' });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    app.runCode();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(app.activeBufferRunEvidence?.id).toBe('run-latest');

    app.requestPeerReview();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(desktop.api.journal.snapshot).toHaveBeenCalledWith(
      'workspace-1',
      [{ path: 'main.py', content: 'print("ready")\n' }],
      expect.stringContaining('REVIEW SNAPSHOT'),
      'run-latest',
    );
    expect(app.workspaceNotice).toContain('RUN EVIDENCE');
  });

  it('should surface review snapshot creation failures without leaving the user guessing', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("ready")\n' });
    desktop.api.journal.snapshot = vi.fn(async () => {
      throw new Error('Snapshot file is too large');
    });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    app.requestPeerReview();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(app.workspaceNotice).toContain('COULD NOT SAVE REVIEW SNAPSHOT');
    expect(app.workspaceNotice).toContain('SNAPSHOT FILE IS TOO LARGE');
  });

  it('should preserve a saved review snapshot when journal refresh fails', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("ready")\n' });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();
    vi.mocked(desktop.api.journal.list).mockRejectedValueOnce(new Error('sqlite busy'));

    app.requestPeerReview();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(desktop.api.journal.snapshot).toHaveBeenCalledWith(
      'workspace-1',
      [{ path: 'main.py', content: 'print("ready")\n' }],
      expect.stringContaining('REVIEW SNAPSHOT'),
      undefined,
    );
    expect(app.workspaceNotice).toContain('REVIEW SNAPSHOT SAVED');
    expect(app.workspaceNotice).toContain('JOURNAL REFRESH FAILED');
  });

  it('should follow the remaining staged layer after staging an unstaged comparison', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("current")\n' });
    vi.mocked(desktop.api.git.status)
      .mockResolvedValueOnce({
        branch: 'main',
        ahead: 0,
        behind: 0,
        files: [{ index: 'M', workingTree: 'M', path: 'main.py' }],
      })
      .mockResolvedValue({
        branch: 'main',
        ahead: 0,
        behind: 0,
        files: [{ index: 'M', workingTree: ' ', path: 'main.py' }],
      });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    await app.showGitDiff('main.py');
    await app.setGitComparisonMode('unstaged');
    await app.gitAction({ type: 'stage', path: 'main.py' });

    expect(desktop.api.git.compare).toHaveBeenLastCalledWith(
      'workspace-1',
      expect.objectContaining({ path: 'main.py' }),
      'staged',
    );
  });

  it('should open a compared nested buffer when Git and Windows use different separators', async () => {
    const desktop = createDesktopHarness({ 'src\\main.py': 'print("windows")\n' });
    vi.mocked(desktop.api.git.status).mockResolvedValue({
      branch: 'main',
      ahead: 0,
      behind: 0,
      files: [{ index: ' ', workingTree: 'M', path: 'src/main.py' }],
    });
    vi.mocked(desktop.api.git.compare).mockResolvedValue({
      path: 'src/main.py',
      language: 'python',
      mode: 'all',
      leftLabel: 'HEAD',
      rightLabel: 'WORKTREE',
      leftContent: 'print("old")\n',
      rightContent: 'print("windows")\n',
      leftExists: true,
      rightExists: true,
    });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    await app.showGitDiff('src/main.py');
    expect(app.canOpenGitComparisonBuffer).toBe(true);
    app.openGitComparisonBuffer();

    expect(app.activeIdeFile.path).toBe('src\\main.py');
  });

  it('should preserve a renamed file original path when requesting a Git comparison', async () => {
    const desktop = createDesktopHarness({ 'answer.py': 'print("new name")\n' });
    vi.mocked(desktop.api.git.status).mockResolvedValue({
      branch: 'main',
      ahead: 0,
      behind: 0,
      files: [{ index: 'R', workingTree: ' ', path: 'answer.py', originalPath: 'main.py' }],
    });
    vi.mocked(desktop.api.git.compare).mockResolvedValue({
      path: 'answer.py',
      originalPath: 'main.py',
      language: 'python',
      mode: 'all',
      leftLabel: 'HEAD',
      rightLabel: 'WORKTREE',
      leftContent: 'print("old name")\n',
      rightContent: 'print("new name")\n',
      leftExists: true,
      rightExists: true,
    });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    await app.showGitDiff('answer.py');

    expect(desktop.api.git.compare).toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({ path: 'answer.py', originalPath: 'main.py' }),
      'all',
    );
    fixture.detectChanges();
    const actions = fixture.nativeElement.querySelectorAll('.git-compare-workbench footer button');
    (actions[1] as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(desktop.api.git.action).toHaveBeenCalledWith(
      'workspace-1',
      { type: 'unstage', path: 'answer.py', originalPath: 'main.py' },
    );
  });

  it('should clear diagnostics when a saved file reloads after an external fix', async () => {
    const desktop = createDesktopHarness({ 'util.cpp': 'int util() { return ; }\n' });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    app.runDiagnostics = [{
      path: 'util.cpp',
      line: 1,
      column: 20,
      severity: 'error',
      message: 'expected expression',
    }];
    desktop.change('util.cpp', 'int util() { return 7; }\n');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(app.runDiagnostics).toEqual([]);
    expect(app.activeEditorText).toContain('return 7');
  });

  it('should clear conflict messaging when keeping an edited desktop buffer', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("initial")\n' });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.activeConsolePanel = 'output';
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    app.updateActiveFile('print("mine")\n');
    desktop.change('main.py', 'print("outside")\n');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await app.resolveConflict(false);

    expect(app.fileConflict).toBeNull();
    expect(app.activeEditorText).toContain('mine');
    expect(app.workspaceNotice).toContain('KEEPING UNSAVED BUFFER');
  });

  it('should discard a dirty buffer after its file is removed on disk', async () => {
    const desktop = createDesktopHarness({
      'main.py': 'print("initial")\n',
      'util.py': 'print("utility")\n',
    });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.activeConsolePanel = 'output';
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    app.updateActiveFile('print("mine")\n');
    desktop.remove('main.py');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await app.resolveConflict(true);

    expect(app.ideFiles.some((file) => file.path === 'main.py')).toBe(false);
    expect(app.activeIdeFile.path).toBe('util.py');
    expect(app.workspaceNotice).toContain('DISCARDED DELETED BUFFER');
  });

  it('should restore a review snapshot into an unsaved desktop buffer', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("current")\n' });
    desktop.api.journal.getSnapshot = vi.fn(async () => ({
      id: 'snapshot-1',
      workspaceId: 'workspace-1',
      files: [{ path: 'main.py', content: 'print("snapshot")\n' }],
      note: 'restore',
      createdAt: new Date().toISOString(),
    }));
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.activeConsolePanel = 'output';
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    await app.openSnapshot('snapshot-1');
    app.restoreSnapshotToBuffer();

    expect(app.activeEditorText).toContain('snapshot');
    expect(app.activeIdeFile.status).toBe('edited');
    expect(app.workspaceNotice).toContain('SAVE TO WRITE');
  });

  it('should decorate snapshot differences and restore only a selected hunk', async () => {
    const desktop = createDesktopHarness({
      'main.py': 'title = "current"\nkeep = True\nresult = "today"\n',
    });
    desktop.api.journal.getSnapshot = vi.fn(async () => ({
      id: 'snapshot-hunks',
      workspaceId: 'workspace-1',
      files: [{ path: 'main.py', content: 'title = "snapshot"\nkeep = True\nresult = "saved"\n' }],
      note: 'restore one teaching edit',
      createdAt: new Date().toISOString(),
    }));
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    await app.openSnapshot('snapshot-hunks');
    app.activeChannelView = 'thread';
    app.toggleSnapshotCompare();
    fixture.detectChanges();

    expect(app.snapshotComparison.hunks).toHaveLength(2);
    expect(app.snapshotComparison.leftLines).toEqual([1, 3]);
    expect(app.snapshotComparison.rightLines).toEqual([1, 3]);
    expect(fixture.nativeElement.querySelectorAll('.snapshot-hunk-desk article')).toHaveLength(2);
    expect(fixture.nativeElement.querySelector('.snapshot-editors .cm-diff-removed')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.snapshot-editors .cm-diff-added')).toBeTruthy();

    app.restoreSnapshotHunk(app.snapshotComparison.hunks[0].id);
    fixture.detectChanges();

    expect(app.activeEditorText).toContain('title = "snapshot"');
    expect(app.activeEditorText).toContain('result = "today"');
    expect(app.activeIdeFile.status).toBe('edited');
    expect(app.snapshotPreview?.id).toBe('snapshot-hunks');
    expect(app.snapshotComparison.hunks).toHaveLength(1);
    expect(desktop.api.files.backupRecovery).toHaveBeenCalledWith(
      'workspace-1',
      'main.py',
      expect.stringContaining('title = "snapshot"'),
    );
  });

  it('should restore the selected file from a multi-file review set', async () => {
    const desktop = createDesktopHarness({
      'main.py': 'print("current")\n',
      'util.py': 'print("utility")\n',
    });
    desktop.api.journal.getSnapshot = vi.fn(async () => ({
      id: 'snapshot-set',
      workspaceId: 'workspace-1',
      files: [
        { path: 'main.py', content: 'print("saved main")\n' },
        { path: 'util.py', content: 'print("saved util")\n' },
      ],
      note: 'review set',
      sourceRevision: '7c100f1cb26ac9e',
      runResultId: 'run-latest',
      createdAt: new Date().toISOString(),
    }));
    desktop.api.runner.getResult = vi.fn(async () => ({
      id: 'run-latest',
      profileId: 'cpp-current',
      profileName: 'Run util.cpp',
      entryFile: 'util.cpp',
      inputs: [{ path: 'util.cpp', content: 'print("saved util")\n' }],
      exitCode: 0,
      stdout: 'done\n',
      stderr: '',
      elapsedMs: 9,
      startedAt: new Date().toISOString(),
      diagnostics: [],
    }));
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    await app.openSnapshot('snapshot-set');
    expect(app.snapshotRunResult?.id).toBe('run-latest');
    await app.selectSnapshotFile('util.py');
    app.restoreSnapshotToBuffer();

    expect(app.activeIdeFile.path).toBe('util.py');
    expect(app.activeEditorText).toContain('saved util');
    expect(app.activeIdeFile.status).toBe('edited');
  });

  it('should keep a review snapshot open when attached run evidence is unavailable', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("current")\n' });
    desktop.api.journal.getSnapshot = vi.fn(async () => ({
      id: 'snapshot-still-readable',
      workspaceId: 'workspace-1',
      files: [{ path: 'main.py', content: 'print("snapshot")\n' }],
      note: 'review without readable evidence',
      runResultId: 'run-missing',
      createdAt: new Date().toISOString(),
    }));
    desktop.api.runner.getResult = vi.fn(async () => {
      throw new Error('database row is corrupt');
    });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    await app.openSnapshot('snapshot-still-readable');
    app.activeChannelView = 'thread';
    fixture.detectChanges();

    expect(app.snapshotPreview?.id).toBe('snapshot-still-readable');
    expect(app.snapshotRunResult).toBeNull();
    expect(app.workspaceNotice).toContain('RUN EVIDENCE UNAVAILABLE');
    expect(fixture.nativeElement.querySelector('.snapshot-run-evidence.unavailable')?.textContent)
      .toContain('Evidence unavailable');
  });

  it('should inspect and replay failed run evidence from a review snapshot', async () => {
    const desktop = createDesktopHarness({
      'main.cpp': 'int main() { return helper(); }\n',
      'util.cpp': 'int helper() { return ; }\n',
    });
    const diagnostic = {
      path: 'util.cpp',
      line: 1,
      column: 20,
      severity: 'error' as const,
      message: 'expected expression',
    };
    desktop.api.journal.getSnapshot = vi.fn(async () => ({
      id: 'snapshot-failed-run',
      workspaceId: 'workspace-1',
      files: [
        { path: 'main.cpp', content: 'int main() { return helper(); }\n' },
        { path: 'util.cpp', content: 'int helper() { return ; }\n' },
      ],
      note: 'failed compile evidence',
      runResultId: 'run-failed',
      createdAt: new Date().toISOString(),
    }));
    desktop.api.runner.getResult = vi.fn(async () => ({
      id: 'run-failed',
      profileId: 'cpp-current',
      profileName: 'Run main.cpp',
      entryFile: 'main.cpp',
      inputs: [
        { path: 'main.cpp', content: 'int main() { return helper(); }\n' },
        { path: 'util.cpp', content: 'int helper() { return ; }\n' },
      ],
      exitCode: 1,
      stdout: '',
      stderr: 'util.cpp:1:20: error: expected expression\n',
      elapsedMs: 24,
      startedAt: new Date().toISOString(),
      diagnostics: [diagnostic],
    }));
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    await app.openSnapshot('snapshot-failed-run');
    app.activeChannelView = 'thread';
    app.toggleSnapshotEvidence();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.snapshot-transcript')?.textContent).toContain('expected expression');
    expect(app.canRevealSnapshotDiagnostic(diagnostic)).toBe(true);
    await app.openSnapshotDiagnostic(diagnostic);
    expect(app.activeSnapshotFile.path).toBe('util.cpp');
    expect(app.snapshotDiagnosticRevealLine).toBe(1);
    expect(app.snapshotDiagnosticRevealColumn).toBe(20);
    expect(app.snapshotDiagnosticRevealRequest).toBe(1);

    app.replaySnapshotRunInTerminal();
    expect(app.activeChannelView).toBe('ide');
    expect(app.activeConsolePanel).toBe('terminal');
    expect(app.runTaskTranscript.join(' ')).toContain('expected expression');
    expect(app.snapshotPreview).toBeNull();
  });

  it('should not position snapshot diagnostics against a different source revision', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("current")\n' });
    const diagnostic = {
      path: 'main.py',
      line: 1,
      severity: 'error' as const,
      message: 'runtime failure',
    };
    desktop.api.journal.getSnapshot = vi.fn(async () => ({
      id: 'snapshot-old',
      workspaceId: 'workspace-1',
      files: [{ path: 'main.py', content: 'print("older revision")\n' }],
      note: 'prior revision',
      runResultId: 'run-newer',
      createdAt: new Date().toISOString(),
    }));
    desktop.api.runner.getResult = vi.fn(async () => ({
      id: 'run-newer',
      profileId: 'python-current',
      profileName: 'Run main.py',
      entryFile: 'main.py',
      inputs: [{ path: 'main.py', content: 'raise RuntimeError("newer")\n' }],
      exitCode: 1,
      stdout: '',
      stderr: 'runtime failure\n',
      elapsedMs: 7,
      startedAt: new Date().toISOString(),
      diagnostics: [diagnostic],
    }));
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();
    await app.openSnapshot('snapshot-old');

    expect(app.canRevealSnapshotDiagnostic(diagnostic)).toBe(false);
    expect(app.snapshotDiagnosticAction(diagnostic)).toBe('Source differs');
    expect(app.activeSnapshotDiagnostics).toEqual([]);
    await app.openSnapshotDiagnostic(diagnostic);
    expect(app.snapshotDiagnosticRevealRequest).toBe(0);
    expect(app.workspaceNotice).toContain('DOES NOT MATCH SNAPSHOT');
  });

  it('should persist selected C++ source files in a run profile', async () => {
    const desktop = createDesktopHarness({
      'main.cpp': 'int main() { return 0; }\n',
      'util.cpp': 'int util() { return 1; }\n',
    });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.activeConsolePanel = 'output';
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    app.toggleCppSource('util.cpp', { target: { checked: true } } as unknown as Event);
    await app.saveRunProfile();

    expect(desktop.saveProfile).toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({ sourceFiles: ['main.cpp', 'util.cpp'] }),
    );
  });

  it('should apply normalized run profile values returned by the desktop process', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("ready")\n' });
    desktop.saveProfile.mockResolvedValueOnce({
      id: 'python-current',
      name: 'Run PYTHON Current File',
      language: 'python',
      command: 'python3.13',
      entryFile: 'main.py',
      args: ['--verbose', 'input.txt'],
    });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    app.pythonExecutable = '  python3.13  ';
    app.profileArgs = '  --verbose   input.txt  ';
    await app.saveRunProfile();

    expect(app.pythonExecutable).toBe('python3.13');
    expect(app.profileArgs).toBe('--verbose input.txt');
    expect(localStorage.getItem('codeyo:/tmp/codeyo-test:python-command')).toBe('python3.13');
    expect(app.workspaceNotice).toContain('SAVED RUN PROFILE');
  });

  it('should restore active Python profile settings over stale local tool settings', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("ready")\n' });
    vi.mocked(desktop.api.runner.profiles).mockResolvedValueOnce([{
      id: 'python-current',
      name: 'Run Python',
      language: 'python',
      command: 'python3.12',
      entryFile: 'main.py',
      args: ['--case', 'smoke'],
    }]);
    localStorage.setItem('codeyo:/tmp/codeyo-test:python-command', 'python-old');
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();

    await app.openDesktopWorkspace();

    expect(app.pythonExecutable).toBe('python3.12');
    expect(app.profileArgs).toBe('--case smoke');
    expect(localStorage.getItem('codeyo:/tmp/codeyo-test:python-command')).toBe('python3.12');
  });

  it('should restore active C++ profile compiler flags, program args and sources', async () => {
    const desktop = createDesktopHarness({
      'main.cpp': 'int main() { return 0; }\n',
      'util.cpp': 'int util() { return 1; }\n',
    });
    vi.mocked(desktop.api.runner.profiles).mockResolvedValueOnce([{
      id: 'cpp-current',
      name: 'Run C++',
      language: 'cpp',
      command: 'clang++-18',
      entryFile: 'main.cpp',
      args: ['-Wall', '-O2'],
      programArgs: ['--smoke'],
      sourceFiles: ['main.cpp', 'util.cpp'],
    }]);
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();

    await app.openDesktopWorkspace();

    expect(app.cppExecutable).toBe('clang++-18');
    expect(app.profileArgs).toBe('-Wall -O2');
    expect(app.cppProgramArgs).toBe('--smoke');
    expect(app.cppSelectedSources).toEqual(['main.cpp', 'util.cpp']);
  });

  it('should surface run profile validation failures when saving', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("ready")\n' });
    desktop.saveProfile.mockRejectedValueOnce(new Error('Tool command must be a command name'));
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    await app.saveRunProfile();

    expect(app.workspaceNotice).toContain('RUN PROFILE SAVE FAILED');
    expect(app.workspaceNotice).toContain('TOOL COMMAND');
  });

  it('should check configured Python, C++ and Git tool availability', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("ready")\n' });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    app.pythonExecutable = 'missing-python';
    await app.checkEnvironment();
    fixture.detectChanges();

    expect(desktop.checkTools).toHaveBeenCalledWith(
      'workspace-1',
      [
        { id: 'python', label: 'Python', command: 'missing-python' },
        { id: 'cpp', label: 'C++ Compiler', command: 'clang++' },
        { id: 'git', label: 'Git', command: 'git' },
      ],
    );
    expect(app.environmentSummary).toBe('2/3 READY');
    expect(app.environmentChecks.find((check) => check.id === 'python')?.available).toBe(false);
    expect(fixture.nativeElement.querySelector('.environment-card')?.textContent).toContain('Missing');
  });

  it('should retain previous environment results when a later check fails', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("ready")\n' });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    await app.checkEnvironment();
    const previousChecks = app.environmentChecks;
    desktop.checkTools.mockRejectedValueOnce(new Error('tool check IPC failed'));

    await app.checkEnvironment();

    expect(app.environmentChecks).toBe(previousChecks);
    expect(app.environmentSummary).toBe('3/3 READY');
    expect(app.workspaceNotice).toContain('ENVIRONMENT CHECK FAILED');
    expect(app.workspaceNotice).toContain('RETAINED 3/3 READY');
  });

  it('should default Python command to python on Windows workspaces', async () => {
    const desktop = createDesktopHarness(
      { 'main.py': 'print("ready")\n' },
      { platform: 'win32', rootPath: 'C:\\Codeyo\\Project' },
    );
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    expect(app.pythonExecutable).toBe('python');
    await app.checkEnvironment();

    expect(desktop.checkTools).toHaveBeenCalledWith(
      'workspace-1',
      expect.arrayContaining([{ id: 'python', label: 'Python', command: 'python' }]),
    );
  });

  it('should persist workspace toolchain commands across reopening the project', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("ready")\n' });
    window.codeyo = desktop.api;
    const firstFixture = TestBed.createComponent(App);
    const firstApp = firstFixture.componentInstance;
    firstFixture.detectChanges();
    await firstApp.openDesktopWorkspace();

    firstApp.updatePythonExecutable({ target: { value: '/opt/codeyo/python' } } as unknown as Event);
    firstApp.updateCppExecutable({ target: { value: '/opt/codeyo/clang++' } } as unknown as Event);

    const secondFixture = TestBed.createComponent(App);
    const secondApp = secondFixture.componentInstance;
    secondFixture.detectChanges();
    await secondApp.openDesktopWorkspace();

    expect(secondApp.pythonExecutable).toBe('/opt/codeyo/python');
    expect(secondApp.cppExecutable).toBe('/opt/codeyo/clang++');
    await secondApp.checkEnvironment();

    expect(desktop.checkTools).toHaveBeenLastCalledWith(
      'workspace-1',
      [
        { id: 'python', label: 'Python', command: '/opt/codeyo/python' },
        { id: 'cpp', label: 'C++ Compiler', command: '/opt/codeyo/clang++' },
        { id: 'git', label: 'Git', command: 'git' },
      ],
    );
  });

  it('should expose project settings for storage, toolchain, and safety status', async () => {
    const desktop = createDesktopHarness({ 'main.py': 'print("ready")\n' });
    window.codeyo = desktop.api;
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    await app.openDesktopWorkspace();

    app.setRightPanel('settings');
    fixture.detectChanges();
    const settings = fixture.nativeElement.querySelector('.settings-panel') as HTMLElement;
    expect(settings.textContent).toContain('Project Settings');
    expect(settings.textContent).toContain('Toolchain');
    expect(settings.textContent).toContain('Safety');
    expect(settings.textContent).toContain('Auto Save');

    const pythonInput = fixture.nativeElement.querySelector('input[aria-label="Python command"]') as HTMLInputElement;
    pythonInput.value = 'missing-python';
    pythonInput.dispatchEvent(new Event('input'));
    await app.checkEnvironment();

    expect(desktop.checkTools).toHaveBeenCalledWith(
      'workspace-1',
      expect.arrayContaining([{ id: 'python', label: 'Python', command: 'missing-python' }]),
    );
  });
});
