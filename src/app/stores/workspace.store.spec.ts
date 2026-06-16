import { describe, expect, it } from 'vitest';
import { WorkspaceHandle } from '../desktop-api';
import { WorkspaceStore } from './workspace.store';

function workspace(overrides: Partial<WorkspaceHandle> = {}): WorkspaceHandle {
  return {
    id: 'workspace-1',
    rootPath: '/tmp/project',
    name: 'project',
    trusted: false,
    platform: 'darwin',
    storageMode: 'app-db',
    ...overrides,
  };
}

describe('WorkspaceStore', () => {
  it('activates and trusts workspace state with user-facing notices', () => {
    const store = new WorkspaceStore();

    store.activate(workspace());
    expect(store.workspace?.trusted).toBe(false);
    expect(store.recentWorkspace?.id).toBe('workspace-1');
    expect(store.notice).toBe('project · READ ONLY UNTIL TRUSTED');

    store.trustActive(workspace({ trusted: true }));
    expect(store.workspace?.trusted).toBe(true);
    expect(store.notice).toBe('project · TRUSTED · EXECUTION ENABLED');
  });

  it('tracks recovery buffers and conflict state', () => {
    const store = new WorkspaceStore();
    store.setRecoveries([{ filePath: 'main.py', content: 'print(1)', updatedAt: '2026-06-15T00:00:00.000Z' }]);
    store.setConflict({ conflict: true, diskVersion: '2', diskContent: 'disk' });

    expect(store.recoveryBuffers).toHaveLength(1);
    expect(store.fileConflict?.diskContent).toBe('disk');

    store.clearConflict();
    expect(store.fileConflict).toBeNull();
    expect(store.conflictCompareOpen).toBe(false);
  });

  it('filters dirty workspace files only', () => {
    const store = new WorkspaceStore();
    expect(store.dirtyWorkspaceFiles([
      { name: 'main.py', path: 'main.py', lang: 'python', status: 'edited', lines: [], workspaceFile: true },
      { name: 'scratch.py', path: 'scratch.py', lang: 'python', status: 'edited', lines: [] },
      { name: 'lib.py', path: 'lib.py', lang: 'python', status: 'saved', lines: [], workspaceFile: true },
    ])).toEqual([
      { name: 'main.py', path: 'main.py', lang: 'python', status: 'edited', lines: [], workspaceFile: true },
    ]);
  });
});
