import { describe, expect, it } from 'vitest';
import { RunResult } from '../desktop-api';
import { RunnerStore } from './runner.store';

function runResult(id: string, entryFile = 'main.py'): RunResult {
  return {
    id,
    profileId: 'python-current',
    profileName: 'Run Python',
    entryFile,
    inputs: [{ path: entryFile, content: 'print("ok")' }],
    exitCode: 0,
    stdout: 'ok\n',
    stderr: '',
    elapsedMs: 5,
    startedAt: '2026-06-14T00:00:00.000Z',
    diagnostics: [],
  };
}

describe('RunnerStore', () => {
  it('remembers latest run results, dedupes by id, and caps history', () => {
    const store = new RunnerStore();

    for (let index = 0; index < 14; index += 1) {
      store.rememberResult(runResult(`run-${index}`));
    }
    store.rememberResult({
      ...runResult('run-5'),
      elapsedMs: 99,
      diagnostics: [{
        path: 'main.py',
        line: 2,
        severity: 'error',
        message: 'failed',
      }],
    });

    expect(store.recentResults).toHaveLength(12);
    expect(store.recentResults[0].id).toBe('run-5');
    expect(store.recentResults[0].elapsedMs).toBe(99);
    expect(store.recentResults.filter((result) => result.id === 'run-5')).toHaveLength(1);
    expect(store.diagnostics).toEqual(store.recentResults[0].diagnostics);
  });

  it('clears diagnostics for a path without touching other files', () => {
    const store = new RunnerStore();
    store.diagnostics = [
      { path: 'main.py', line: 1, severity: 'error', message: 'main failed' },
      { path: 'lib.py', line: 1, severity: 'warning', message: 'lib warning' },
    ];

    store.clearDiagnosticsForPath('main.py');

    expect(store.diagnostics).toEqual([
      { path: 'lib.py', line: 1, severity: 'warning', message: 'lib warning' },
    ]);
  });

  it('tracks and resets pending dirty runs', () => {
    const store = new RunnerStore();
    const profile = {
      id: 'python-current',
      name: 'Run Python',
      language: 'python' as const,
      entryFile: 'main.py',
    };

    store.setPendingRun(profile, 'main.py');
    expect(store.pendingProfile).toBe(profile);
    expect(store.pendingDirtyPath).toBe('main.py');

    store.busy = true;
    store.diagnostics = [{ path: 'main.py', line: 1, severity: 'error', message: 'failed' }];
    store.recentResults = [runResult('run-1')];
    store.resetWorkspaceState();

    expect(store.pendingProfile).toBeNull();
    expect(store.pendingDirtyPath).toBe('');
    expect(store.busy).toBe(false);
    expect(store.diagnostics).toEqual([]);
    expect(store.recentResults).toEqual([]);
  });
});
