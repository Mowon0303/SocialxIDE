import { beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceHandle } from '../desktop-api';
import { ProjectSettingsStore } from './project-settings.store';

function workspace(overrides: Partial<WorkspaceHandle> = {}): WorkspaceHandle {
  return {
    id: 'workspace-1',
    rootPath: '/tmp/project',
    name: 'project',
    trusted: true,
    platform: 'darwin',
    storageMode: 'app-db',
    ...overrides,
  };
}

describe('ProjectSettingsStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('loads defaults and uses Windows Python fallback when needed', () => {
    const store = new ProjectSettingsStore();

    store.load(workspace({ platform: 'win32' }));

    expect(store.current.pythonCommand).toBe('python');
    expect(store.current.cppCommand).toBe('clang++');
    expect(store.current.lspDiagnosticsEnabled).toBe(true);
  });

  it('saves and reloads settings per workspace', () => {
    const store = new ProjectSettingsStore();
    const currentWorkspace = workspace();

    store.load(currentWorkspace);
    store.update(currentWorkspace, 'pythonCommand', 'python3.12');
    store.update(currentWorkspace, 'autoSaveEnabled', true);

    const nextStore = new ProjectSettingsStore();
    nextStore.load(currentWorkspace);
    expect(nextStore.current.pythonCommand).toBe('python3.12');
    expect(nextStore.current.autoSaveEnabled).toBe(true);

    nextStore.load(workspace({ id: 'workspace-2', rootPath: '/tmp/other' }));
    expect(nextStore.current.pythonCommand).toBe('python3');
    expect(nextStore.current.autoSaveEnabled).toBe(false);
  });

  it('falls back from malformed stored values', () => {
    const store = new ProjectSettingsStore();
    const currentWorkspace = workspace();
    localStorage.setItem(store.storageKey(currentWorkspace), JSON.stringify({
      autoSaveEnabled: 'yes',
      pythonCommand: '',
      cppCommand: 'clang++\nrm',
      profileArgs: 42,
    }));

    store.load(currentWorkspace);

    expect(store.current.autoSaveEnabled).toBe(false);
    expect(store.current.pythonCommand).toBe('python3');
    expect(store.current.cppCommand).toBe('clang++');
    expect(store.current.profileArgs).toBe('');
  });
});
