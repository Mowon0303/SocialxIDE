import { describe, expect, it, vi } from 'vitest';
import { EditorDiagnostic } from '../desktop-api';
import { LanguageStore } from './language.store';

describe('LanguageStore', () => {
  it('merges run, LSP, and spell diagnostics while respecting enabled switches', () => {
    const store = new LanguageStore();
    const runDiagnostics: EditorDiagnostic[] = [
      { path: 'main.py', line: 1, severity: 'error', message: 'run failed' },
    ];
    store.lspDiagnostics = [
      { path: 'main.py', line: 2, severity: 'error', source: 'lsp', message: 'type error' },
    ];
    store.spellDiagnostics = [
      { path: 'notes.md', line: 3, severity: 'warning', source: 'spell', message: 'Possible typo: "recieve"' },
    ];

    expect(store.allDiagnostics(runDiagnostics).map((diagnostic) => diagnostic.source)).toEqual([
      'run',
      'lsp',
      'spell',
    ]);

    store.lspDiagnosticsEnabled = false;
    store.spellCheckEnabled = false;
    expect(store.allDiagnostics(runDiagnostics)).toEqual([
      { path: 'main.py', line: 1, severity: 'error', source: 'run', message: 'run failed' },
    ]);
  });

  it('filters diagnostics by source', () => {
    const store = new LanguageStore();
    const diagnostics: EditorDiagnostic[] = [
      { path: 'main.py', line: 1, severity: 'error', message: 'run failed' },
      { path: 'main.py', line: 2, severity: 'error', source: 'lsp', message: 'type error' },
      { path: 'notes.md', line: 3, severity: 'warning', source: 'spell', message: 'typo' },
    ];

    expect(store.filteredBySource(diagnostics, 'all')).toEqual(diagnostics);
    expect(store.filteredBySource(diagnostics, 'run')).toEqual([diagnostics[0]]);
    expect(store.filteredBySource(diagnostics, 'lsp')).toEqual([diagnostics[1]]);
    expect(store.filteredBySource(diagnostics, 'spell')).toEqual([diagnostics[2]]);
  });

  it('applies diagnostics per workspace, source, and path', () => {
    const store = new LanguageStore();
    store.lspDiagnostics = [
      { path: 'main.py', line: 1, severity: 'error', source: 'lsp', message: 'old' },
      { path: 'lib.py', line: 1, severity: 'error', source: 'lsp', message: 'keep' },
    ];

    expect(store.applyDiagnostics({
      workspaceId: 'other-workspace',
      path: 'main.py',
      source: 'lsp',
      diagnostics: [{ path: 'main.py', line: 2, severity: 'error', message: 'ignored' }],
    }, 'workspace-1')).toBe(false);
    expect(store.lspDiagnostics[0].message).toBe('old');

    expect(store.applyDiagnostics({
      workspaceId: 'workspace-1',
      path: 'main.py',
      source: 'lsp',
      diagnostics: [{ path: '', line: 2, severity: 'error', message: 'new' }],
    }, 'workspace-1')).toBe(true);

    expect(store.lspDiagnostics).toEqual([
      { path: 'lib.py', line: 1, severity: 'error', source: 'lsp', message: 'keep' },
      { path: 'main.py', line: 2, severity: 'error', source: 'lsp', message: 'new' },
    ]);
  });

  it('applies language status updates for the active workspace only', () => {
    const store = new LanguageStore();

    expect(store.applyStatus({
      workspaceId: 'workspace-1',
      language: 'python',
      state: 'starting',
      label: 'Pyright',
    }, 'workspace-1')).toBe(true);
    expect(store.statusFor('python')?.state).toBe('starting');

    expect(store.applyStatus({
      workspaceId: 'other-workspace',
      language: 'python',
      state: 'ready',
      label: 'Pyright',
    }, 'workspace-1')).toBe(false);
    expect(store.statusFor('python')?.state).toBe('starting');

    store.applyStatus({
      workspaceId: 'workspace-1',
      language: 'python',
      state: 'ready',
      label: 'Pyright',
    }, 'workspace-1');
    expect(store.workspaceStatus).toEqual({
      workspaceId: 'workspace-1',
      services: [{ language: 'python', state: 'ready', label: 'Pyright', message: undefined }],
    });
  });

  it('tracks document versions and resets them with workspace state', () => {
    const store = new LanguageStore();

    expect(store.nextDocumentVersion('main.py')).toBe(1);
    expect(store.nextDocumentVersion('main.py')).toBe(2);
    expect(store.nextDocumentVersion('lib.py')).toBe(1);

    store.resetWorkspaceState();
    expect(store.nextDocumentVersion('main.py')).toBe(1);
  });

  it('debounces language document changes per path', () => {
    vi.useFakeTimers();
    try {
      const store = new LanguageStore();
      const first = vi.fn();
      const second = vi.fn();

      store.scheduleChange('main.py', first, 100);
      store.scheduleChange('main.py', second, 100);
      vi.advanceTimersByTime(99);

      expect(first).not.toHaveBeenCalled();
      expect(second).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
