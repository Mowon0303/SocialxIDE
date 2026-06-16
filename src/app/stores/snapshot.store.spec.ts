import { describe, expect, it } from 'vitest';
import { ReviewSnapshot, RunResult } from '../desktop-api';
import { SnapshotStore } from './snapshot.store';

const snapshot: ReviewSnapshot = {
  id: 'snap-1',
  workspaceId: 'workspace-1',
  note: 'Review snapshot',
  createdAt: '2026-06-15T00:00:00.000Z',
  files: [
    { path: 'main.py', content: 'print("ok")' },
    { path: 'notes.md', content: 'notes' },
  ],
};

const runResult: RunResult = {
  id: 'run-1',
  profileId: 'python-current',
  profileName: 'Run Python',
  entryFile: 'main.py',
  inputs: [{ path: 'main.py', content: 'print("ok")' }],
  exitCode: 1,
  stdout: '',
  stderr: 'error\n',
  elapsedMs: 10,
  startedAt: '2026-06-15T00:00:00.000Z',
  diagnostics: [{ path: 'main.py', line: 1, severity: 'error', message: 'failed' }],
};

describe('SnapshotStore', () => {
  it('opens snapshots and exposes active file metadata', () => {
    const store = new SnapshotStore();

    store.open(snapshot, runResult);

    expect(store.activeFile.path).toBe('main.py');
    expect(store.language).toBe('python');
    expect(store.activeDiagnostics).toEqual(runResult.diagnostics);
    expect(store.runTranscript).toContain('EXIT 1 · 10 MS');
  });

  it('selects files, reveals diagnostics, and closes state', () => {
    const store = new SnapshotStore();
    store.open(snapshot, runResult);

    expect(store.selectFile('notes.md')).toBe(true);
    expect(store.activeFile.path).toBe('notes.md');
    expect(store.language).toBe('text');
    expect(store.selectFile('missing.py')).toBe(false);

    store.revealDiagnostic({ path: 'main.py', line: 3, column: 5, severity: 'error', message: 'failed' });
    expect(store.diagnosticRevealLine).toBe(3);
    expect(store.diagnosticRevealColumn).toBe(5);
    expect(store.diagnosticRevealRequest).toBe(1);

    store.close();
    expect(store.preview).toBeNull();
    expect(store.activePath).toBe('');
    expect(store.runResult).toBeNull();
  });
});
