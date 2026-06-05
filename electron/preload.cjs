const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);
const sendSync = (channel, payload) => {
  const result = ipcRenderer.sendSync(channel, payload);
  if (!result?.ok) {
    throw new Error(result?.error || 'Synchronous IPC failed');
  }
  return result.value;
};
const on = (channel, handler) => {
  const listener = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('codeyo', {
  workspace: {
    open: () => invoke('workspace:open'),
    recent: () => invoke('workspace:recent'),
    resume: (workspaceId) => invoke('workspace:resume', { workspaceId }),
    trust: (workspaceId) => invoke('workspace:trust', { workspaceId }),
  },
  files: {
    list: (workspaceId) => invoke('files:list', { workspaceId }),
    read: (workspaceId, filePath) => invoke('files:read', { workspaceId, filePath }),
    write: (workspaceId, document) => invoke('files:write', { workspaceId, document }),
    create: (workspaceId, filePath, content) => invoke('files:create', { workspaceId, filePath, content }),
    rename: (workspaceId, filePath, nextPath) => invoke('files:rename', { workspaceId, filePath, nextPath }),
    remove: (workspaceId, filePath, confirmed) => invoke('files:remove', { workspaceId, filePath, confirmed }),
    backupRecovery: (workspaceId, filePath, content) =>
      invoke('files:backup-recovery', { workspaceId, filePath, content }),
    backupRecoverySync: (workspaceId, filePath, content) =>
      sendSync('files:backup-recovery-sync', { workspaceId, filePath, content }),
    recovery: (workspaceId, filePath) => invoke('files:recovery', { workspaceId, filePath }),
    listRecovery: (workspaceId) => invoke('files:list-recovery', { workspaceId }),
    clearRecovery: (workspaceId, filePath) => invoke('files:clear-recovery', { workspaceId, filePath }),
    onChanged: (handler) => on('files:changed', handler),
  },
  terminal: {
    list: (workspaceId) => invoke('terminal:list', { workspaceId }),
    create: (workspaceId, title) => invoke('terminal:create', { workspaceId, title }),
    rename: (workspaceId, sessionId, title) => invoke('terminal:rename', { workspaceId, sessionId, title }),
    write: (workspaceId, sessionId, data) => invoke('terminal:write', { workspaceId, sessionId, data }),
    resize: (workspaceId, sessionId, cols, rows) => invoke('terminal:resize', { workspaceId, sessionId, cols, rows }),
    kill: (workspaceId, sessionId) => invoke('terminal:kill', { workspaceId, sessionId }),
    onData: (handler) => on('terminal:data', handler),
    onExit: (handler) => on('terminal:exit', handler),
  },
  runner: {
    run: (workspaceId, profile) => invoke('runner:run', { workspaceId, profile }),
    profiles: (workspaceId) => invoke('runner:profiles', { workspaceId }),
    saveProfile: (workspaceId, profile) => invoke('runner:save-profile', { workspaceId, profile }),
    history: (workspaceId) => invoke('runner:history', { workspaceId }),
    getResult: (workspaceId, runResultId) => invoke('runner:get-result', { workspaceId, runResultId }),
  },
  git: {
    status: (workspaceId) => invoke('git:status', { workspaceId }),
    branches: (workspaceId) => invoke('git:branches', { workspaceId }),
    stagedSummary: (workspaceId) => invoke('git:staged-summary', { workspaceId }),
    diff: (workspaceId, filePath) => invoke('git:diff', { workspaceId, filePath }),
    compare: (workspaceId, file, mode) => invoke('git:compare', { workspaceId, file, mode }),
    history: (workspaceId) => invoke('git:history', { workspaceId }),
    commitDetail: (workspaceId, revision) => invoke('git:commit-detail', { workspaceId, revision }),
    compareCommit: (workspaceId, revision, file) => invoke('git:compare-commit', { workspaceId, revision, file }),
    action: (workspaceId, action) => invoke('git:action', { workspaceId, action }),
    applyPatch: (workspaceId, patch, mode, confirmed = false) =>
      invoke('git:apply-patch', { workspaceId, patch, mode, confirmed }),
  },
  journal: {
    list: (workspaceId) => invoke('journal:list', { workspaceId }),
    add: (workspaceId, kind, body, metadata) =>
      invoke('journal:add', { workspaceId, kind, body, metadata }),
    snapshot: (workspaceId, files, note, runResultId, sourceRevision) =>
      invoke('journal:snapshot', { workspaceId, files, note, runResultId, sourceRevision }),
    getSnapshot: (workspaceId, snapshotId) => invoke('journal:get-snapshot', { workspaceId, snapshotId }),
  },
  settings: {
    storageMode: (workspaceId, mode, addToGitignore) =>
      invoke('settings:storage-mode', { workspaceId, mode, addToGitignore }),
  },
  environment: {
    checkTools: (workspaceId, tools) => invoke('environment:check-tools', { workspaceId, tools }),
  },
  appMenu: {
    onOpenTerminal: (handler) => on('menu:open-terminal', handler),
  },
});
