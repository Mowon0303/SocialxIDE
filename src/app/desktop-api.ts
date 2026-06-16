export type EditorLanguage = 'python' | 'cpp' | 'text';
export type StorageMode = 'app-db' | 'workspace-codeyo';

export interface WorkspaceHandle {
  id: string;
  rootPath: string;
  name: string;
  trusted: boolean;
  platform: string;
  storageMode: StorageMode;
}

export interface EditorDocument {
  path: string;
  name: string;
  language: EditorLanguage;
  content: string;
  diskVersion: string;
  dirty: boolean;
}

export interface WorkspaceFile {
  path: string;
  name: string;
  language: EditorLanguage;
  status: 'saved' | 'edited' | 'new';
}

export interface WorkspaceFileChange {
  workspaceId: string;
  path: string;
  type: 'change' | 'rename';
  exists: boolean;
  directory: boolean;
  diskVersion?: string;
}

export interface RecoveryBuffer {
  filePath: string;
  content: string;
  updatedAt: string;
}

export interface EditorDiagnostic {
  path: string;
  line: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  severity: 'error' | 'warning';
  source?: 'run' | 'lsp' | 'spell';
  code?: string;
  message: string;
  suggestions?: string[];
}

export interface SpellCheckRegion {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  text: string;
}

export interface LanguageDocument {
  path: string;
  language: EditorLanguage;
  content: string;
  version: number;
  spellRanges?: SpellCheckRegion[];
}

export interface LanguagePositionRequest extends LanguageDocument {
  line: number;
  column: number;
}

export interface LanguageCompletionItem {
  label: string;
  detail?: string;
  info?: string;
  kind?: string;
  apply?: string;
}

export interface LanguageCompletionResult {
  available: boolean;
  reason?: string;
  items: LanguageCompletionItem[];
}

export interface LanguageHoverResult {
  available: boolean;
  contents: string;
  range?: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
}

export interface LanguageDefinitionLocation {
  path: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
}

export interface LanguageDefinitionResult {
  available: boolean;
  locations: LanguageDefinitionLocation[];
}

export interface LanguageTextEdit {
  path: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  newText: string;
}

export interface LanguageWorkspaceEdit {
  edits: LanguageTextEdit[];
}

export interface LanguageRenameResult {
  available: boolean;
  reason?: string;
  edit?: LanguageWorkspaceEdit;
}

export interface LanguageCodeAction {
  title: string;
  kind?: string;
  diagnostics?: EditorDiagnostic[];
  edit?: LanguageWorkspaceEdit;
}

export interface LanguageCodeActionResult {
  available: boolean;
  reason?: string;
  actions: LanguageCodeAction[];
}

export interface LanguageFormatResult {
  available: boolean;
  reason?: string;
  edit?: LanguageWorkspaceEdit;
}

export interface LanguageServiceStatus {
  language: 'python' | 'cpp' | 'spell';
  state: 'idle' | 'starting' | 'ready' | 'missing-tool' | 'error' | 'stopped';
  label: string;
  message?: string;
}

export interface LanguageWorkspaceStatus {
  workspaceId: string;
  services: LanguageServiceStatus[];
}

export interface LanguageDiagnosticsEvent {
  workspaceId: string;
  path: string;
  source: 'lsp' | 'spell';
  diagnostics: EditorDiagnostic[];
}

export interface TerminalSession {
  id: string;
  title: string;
  cwd: string;
  shell: string;
  status: 'running' | 'exited';
  buffer?: string;
  exitCode?: number;
}

export interface RunProfile {
  id: string;
  name: string;
  language: 'python' | 'cpp';
  command?: string;
  entryFile: string;
  sourceFiles?: string[];
  args?: string[];
  programArgs?: string[];
}

export interface ToolCheckRequest {
  id: 'python' | 'cpp' | 'git';
  label: string;
  command: string;
}

export interface ToolCheckResult extends ToolCheckRequest {
  available: boolean;
  version?: string;
  message: string;
}

export interface RunResult {
  id: string;
  profileId: string;
  profileName: string;
  entryFile: string;
  inputs: Array<{ path: string; content: string }>;
  exitCode: number;
  stdout: string;
  stderr: string;
  elapsedMs: number;
  startedAt: string;
  diagnostics: EditorDiagnostic[];
}

export interface GitFileState {
  index: string;
  workingTree: string;
  path: string;
  originalPath?: string;
}

export interface GitStatus {
  branch: string;
  initial?: boolean;
  ahead: number;
  behind: number;
  files: GitFileState[];
}

export interface GitStagedFileSummary {
  path: string;
  additions: number;
  deletions: number;
  binary?: boolean;
}

export interface GitStagedSummary {
  files: GitStagedFileSummary[];
  additions: number;
  deletions: number;
}

export type GitWorkspaceCompareMode = 'all' | 'staged' | 'unstaged';
export type GitCompareMode = GitWorkspaceCompareMode | 'commit';

export interface GitComparison {
  path: string;
  originalPath?: string;
  language: EditorLanguage;
  mode: GitCompareMode;
  leftLabel: string;
  rightLabel: string;
  leftContent: string;
  rightContent: string;
  leftExists: boolean;
  rightExists: boolean;
}

export interface GitCommitFile {
  status: string;
  path: string;
  originalPath?: string;
}

export interface GitCommitDetail {
  revision: string;
  shortRevision: string;
  subject: string;
  files: GitCommitFile[];
}

export interface GitCommitSummary {
  revision: string;
  shortRevision: string;
  subject: string;
  author: string;
  authoredAt: string;
}

export type GitAction =
  | { type: 'stage' | 'unstage'; path: string; originalPath?: string }
  | { type: 'commit'; message: string; runResultId?: string }
  | { type: 'create-branch' | 'switch-branch'; name: string }
  | { type: 'pull' | 'push' }
  | { type: 'discard'; path: string; confirmed: boolean }
  | { type: 'delete-branch'; name: string; confirmed: boolean };

export type GitPatchMode = 'stage' | 'unstage' | 'discard';

export interface JournalEntry {
  id: string;
  workspaceId: string;
  kind: 'note' | 'run' | 'git' | 'review';
  body: string;
  createdAt: string;
  snapshotId?: string;
  metadata?: Record<string, unknown>;
}

export interface ReviewSnapshot {
  id: string;
  workspaceId: string;
  files: Array<{ path: string; content: string }>;
  note: string;
  sourceRevision?: string;
  runResultId?: string;
  createdAt: string;
}

export interface CodeyoDesktopApi {
  workspace: {
    open(): Promise<WorkspaceHandle | null>;
    recent(): Promise<WorkspaceHandle[]>;
    resume(workspaceId: string): Promise<WorkspaceHandle>;
    trust(workspaceId: string): Promise<WorkspaceHandle>;
  };
  files: {
    list(workspaceId: string): Promise<WorkspaceFile[]>;
    read(workspaceId: string, filePath: string): Promise<EditorDocument>;
    write(
      workspaceId: string,
      document: Pick<EditorDocument, 'path' | 'content' | 'diskVersion'>,
    ): Promise<{ conflict: boolean; diskVersion: string; diskContent?: string; deleted?: boolean }>;
    create(workspaceId: string, filePath: string, content: string): Promise<{ created: true }>;
    rename(workspaceId: string, filePath: string, nextPath: string): Promise<{ renamed: true }>;
    remove(workspaceId: string, filePath: string, confirmed: boolean): Promise<{ removed: true }>;
    backupRecovery(workspaceId: string, filePath: string, content: string): Promise<{ backedUp: true }>;
    backupRecoverySync(workspaceId: string, filePath: string, content: string): { backedUp: true };
    recovery(workspaceId: string, filePath: string): Promise<{ content: string; updatedAt: string } | null>;
    listRecovery(workspaceId: string): Promise<RecoveryBuffer[]>;
    clearRecovery(workspaceId: string, filePath: string): Promise<{ cleared: true }>;
    onChanged(handler: (change: WorkspaceFileChange) => void): () => void;
  };
  terminal: {
    list(workspaceId: string): Promise<TerminalSession[]>;
    create(workspaceId: string, title: string): Promise<TerminalSession>;
    rename(workspaceId: string, sessionId: string, title: string): Promise<{ renamed: true; title: string }>;
    write(workspaceId: string, sessionId: string, data: string): Promise<{ written: true }>;
    resize(workspaceId: string, sessionId: string, cols: number, rows: number): Promise<{ resized: true }>;
    kill(workspaceId: string, sessionId: string): Promise<{ killed: boolean }>;
    onData(handler: (payload: { sessionId: string; data: string }) => void): () => void;
    onExit(handler: (payload: { sessionId: string; exitCode: number }) => void): () => void;
  };
  runner: {
    run(workspaceId: string, profile: RunProfile): Promise<RunResult>;
    profiles(workspaceId: string): Promise<RunProfile[]>;
    saveProfile(workspaceId: string, profile: RunProfile): Promise<RunProfile>;
    history(workspaceId: string): Promise<RunResult[]>;
    getResult(workspaceId: string, runResultId: string): Promise<RunResult | null>;
  };
  language: {
    status(workspaceId: string): Promise<LanguageWorkspaceStatus>;
    openDocument(workspaceId: string, document: LanguageDocument): Promise<{ opened: true }>;
    changeDocument(workspaceId: string, document: LanguageDocument): Promise<{ changed: true }>;
    closeDocument(workspaceId: string, document: LanguageDocument): Promise<{ closed: true }>;
    completion(workspaceId: string, request: LanguagePositionRequest): Promise<LanguageCompletionResult>;
    hover(workspaceId: string, request: LanguagePositionRequest): Promise<LanguageHoverResult>;
    definition(workspaceId: string, request: LanguagePositionRequest): Promise<LanguageDefinitionResult>;
    renameSymbol(workspaceId: string, request: LanguagePositionRequest, newName: string): Promise<LanguageRenameResult>;
    codeActions(workspaceId: string, request: LanguagePositionRequest): Promise<LanguageCodeActionResult>;
    formatDocument(workspaceId: string, document: LanguageDocument): Promise<LanguageFormatResult>;
    onDiagnostics(handler: (event: LanguageDiagnosticsEvent) => void): () => void;
    onStatus(handler: (event: LanguageServiceStatus & { workspaceId: string }) => void): () => void;
  };
  git: {
    status(workspaceId: string): Promise<GitStatus>;
    branches(workspaceId: string): Promise<string[]>;
    stagedSummary(workspaceId: string): Promise<GitStagedSummary>;
    diff(workspaceId: string, filePath?: string): Promise<{ exitCode: number; stdout: string; stderr: string }>;
    compare(workspaceId: string, file: GitFileState, mode: GitWorkspaceCompareMode): Promise<GitComparison>;
    history(workspaceId: string): Promise<GitCommitSummary[]>;
    commitDetail(workspaceId: string, revision: string): Promise<GitCommitDetail>;
    compareCommit(workspaceId: string, revision: string, file: GitCommitFile): Promise<GitComparison>;
    action(workspaceId: string, action: GitAction): Promise<{ exitCode: number; stdout: string; stderr: string }>;
    applyPatch(
      workspaceId: string,
      patch: string,
      mode: GitPatchMode,
      confirmed?: boolean,
    ): Promise<{ applied: true; mode: GitPatchMode }>;
  };
  journal: {
    list(workspaceId: string): Promise<JournalEntry[]>;
    add(
      workspaceId: string,
      kind: JournalEntry['kind'],
      body: string,
      metadata?: Record<string, unknown>,
    ): Promise<JournalEntry>;
    snapshot(
      workspaceId: string,
      files: Array<{ path: string; content: string }>,
      note: string,
      runResultId?: string,
      sourceRevision?: string,
    ): Promise<ReviewSnapshot>;
    getSnapshot(workspaceId: string, snapshotId: string): Promise<ReviewSnapshot | null>;
  };
  settings: {
    storageMode(
      workspaceId: string,
      mode: StorageMode,
      addToGitignore: boolean,
    ): Promise<{ storageMode: StorageMode; migrated: boolean; imported?: boolean }>;
  };
  environment: {
    checkTools(workspaceId: string, tools: ToolCheckRequest[]): Promise<ToolCheckResult[]>;
  };
  appMenu?: {
    onOpenTerminal(handler: () => void): () => void;
  };
}

declare global {
  interface Window {
    codeyo?: CodeyoDesktopApi;
  }
}
