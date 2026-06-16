import {
  ChangeDetectorRef,
  Component,
  HostListener,
  OnDestroy,
  OnInit,
  ViewEncapsulation,
} from '@angular/core';
import { NgStyle } from '@angular/common';
import { CodeEditorComponent } from './code-editor.component';
import { DesktopTerminalComponent } from './desktop-terminal.component';
import { EmptyStateComponent } from './panels/empty-state.component';
import { ExplorerPanelComponent } from './panels/explorer-panel.component';
import { GitPanelComponent } from './panels/git-panel.component';
import { ReviewPanelComponent } from './panels/review-panel.component';
import { SettingsPanelComponent } from './panels/settings-panel.component';
import {
  EditorDiagnostic,
  EditorLanguage,
  GitAction,
  GitCommitDetail,
  GitCommitFile,
  GitCommitSummary,
  GitComparison,
  GitFileState,
  GitPatchMode,
  GitStagedSummary,
  GitStatus,
  GitWorkspaceCompareMode,
  JournalEntry,
  LanguageCodeAction,
  LanguageCodeActionResult,
  LanguageCompletionResult,
  LanguageDefinitionLocation,
  LanguageFormatResult,
  LanguageHoverResult,
  LanguageRenameResult,
  LanguageServiceStatus,
  LanguageWorkspaceEdit,
  LanguageWorkspaceStatus,
  RecoveryBuffer,
  RunProfile,
  RunResult,
  ReviewSnapshot,
  StorageMode,
  ToolCheckRequest,
  ToolCheckResult,
  WorkspaceFileChange,
  WorkspaceHandle,
} from './desktop-api';
import { EditorLanguagePosition } from './code-editor.component';
import {
  defaultEditorFontId,
  defaultEditorThemeId,
  editorFontPreset,
  editorFontPresets,
  editorThemePreset,
  editorThemePresets,
  EditorFontId,
  EditorThemeId,
} from './editor-appearance';
import { extractSpellCheckRegions } from './spell-regions';
import { applyTextEdits, groupTextEditsByPath } from './language-edits';
import {
  ChannelItem,
  ChannelView,
  ConsolePanel,
  EditorDensity,
  ExplorerTreeEntry,
  FileWriteResult,
  FilesAction,
  IdeFile,
  JournalKindFilter,
  JournalWriteResult,
  LineComparison,
  LineDiffHunk,
  RailResizeTarget,
  RightPanel,
  ScreenId,
  StoredChannelItem,
  ThreadUpdate,
} from './ide-types';
import { ExplorerStore } from './stores/explorer.store';
import { GitStore } from './stores/git.store';
import { JournalStore } from './stores/journal.store';
import { LanguageStore, ProblemSourceFilter } from './stores/language.store';
import { ProjectSettingsStore } from './stores/project-settings.store';
import { RunnerStore } from './stores/runner.store';
import { SettingsStore } from './stores/settings.store';
import { SnapshotStore } from './stores/snapshot.store';
import { WorkspaceStore } from './stores/workspace.store';

export type ConfirmDialogVariant = 'default' | 'danger' | 'warning';

export interface ConfirmDialogRequest {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  variant: ConfirmDialogVariant;
  details?: string;
}

@Component({
  selector: 'app-root',
  imports: [
    NgStyle,
    CodeEditorComponent,
    DesktopTerminalComponent,
    EmptyStateComponent,
    ExplorerPanelComponent,
    GitPanelComponent,
    ReviewPanelComponent,
    SettingsPanelComponent,
  ],
  templateUrl: './app.html',
  styleUrls: ['./app.css', './git-panel.css'],
  encapsulation: ViewEncapsulation.None,
})
export class App implements OnInit, OnDestroy {
  readonly isDesktop = typeof window !== 'undefined' && Boolean(window.codeyo);
  focusedScreen: ScreenId | null = 'channels';
  activeChannelView: ChannelView = 'ide';
  activeChannelId = 'ide';
  channelMenuOpen = false;
  channelMenuChannelId = '';
  channelMenuX = 0;
  channelMenuY = 0;
  channelDraftName = '';
  channelMenuNotice = '';
  channelDeleteArmed = false;
  filesActionsMenuOpen = false;
  workspaceTrustPromptOpen = false;
  confirmDialog: ConfirmDialogRequest | null = null;
  terminalPaneOpen = !this.isDesktop;
  terminalRequestedAfterTrust = false;
  activeRightPanel: RightPanel = 'files';
  activeConsolePanel: ConsolePanel = 'terminal';
  editorDensity: EditorDensity = 'compact';
  editorFontSizePx = 13;
  editorFontId: EditorFontId = defaultEditorFontId;
  editorThemeId: EditorThemeId = defaultEditorThemeId;
  workspaceRailWidth = 212;
  explorerRailWidth = 206;
  resizingRail: RailResizeTarget | null = null;
  activeIdePath = 'fib.py';
  assistantPanelOpen = false;
  assistantNotice = 'Assist slot is paused for v0.1. Use run output, diagnostics, Git, and journal entries for review.';
  lastSavedAt = '14:24';
  workspaceExpanded = true;
  srcExpanded = true;
  private explorerTreeRebuildQueued = false;
  creatingFile = false;
  newFileName = '';
  renamingFilePath = '';
  renameDraft = '';
  terminalCommand = '';
  private removeOpenTerminalMenuListener?: () => void;
  runShared = false;
  lastRunTarget = 'fib.py';
  lastRunSummary = 'memo hits: 38 · cache size: 41';
  threadUpdates: ThreadUpdate[] = [];
  desktopOutput: string[] = [];
  runTaskTranscript: string[] = [];
  runTaskSequence = 0;
  problemFilter: 'all' | 'active' = 'all';
  problemSourceFilter: ProblemSourceFilter = 'all';
  diagnosticRevealLine = 0;
  diagnosticRevealColumn = 1;
  diagnosticRevealRequest = 0;
  editorCursorLine = 1;
  editorCursorColumn = 1;
  editorSearchRequest = 0;
  editorDefinitionRequest = 0;
  goToLineOpen = false;
  goToLineDraft = '';
  shortcutPanelOpen = false;
  renameSymbolOpen = false;
  renameSymbolDraft = '';
  codeActionMenuOpen = false;
  codeActionItems: LanguageCodeAction[] = [];
  cppSelectedSources: string[] = [];
  environmentChecks: ToolCheckResult[] = [];
  storageBusy = false;
  environmentBusy = false;
  readonly autoSaveDelayMs = 1400;
  private readonly channelStorageKey = 'codeyo.channels.v1';
  readonly editorFontSizeMin = 12;
  readonly editorFontSizeMax = 18;
  readonly editorFontPresets = editorFontPresets;
  readonly editorThemePresets = editorThemePresets;
  private railResizeBounds: { left: number; right: number; width: number } | null = null;
  private readonly recoveryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly autoSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private confirmDialogResolver: ((confirmed: boolean) => void) | null = null;
  private removeFileChangeListener?: () => void;
  private removeLanguageDiagnosticsListener?: () => void;
  private removeLanguageStatusListener?: () => void;
  runOutput = [
    '$ python fib.py',
    'fib(40) = 102334155',
    'memo hits: 38 · cache size: 41',
    'done in 0.0002s',
  ];

  channels: ChannelItem[] = [
    { id: 'ide', index: '01', name: 'IDE Workspace', topic: 'local buffers · fib.py' },
    { id: 'run-log', index: '02', name: 'Run Logs', topic: 'terminal output · diagnostics', unread: 12 },
    { id: 'journal', index: '03', name: 'Journal', topic: 'notes · decisions · handoff', unread: 1, mention: true },
    { id: 'snapshots', index: '04', name: 'Snapshots', topic: 'review sets · run evidence' },
    { id: 'problems', index: '05', name: 'Problems', topic: 'debug desk · blockers', marker: true },
  ];

  readonly ideFiles: IdeFile[] = [
    {
      name: 'fib.py',
      path: 'fib.py',
      lang: 'python',
      status: 'edited',
      builtIn: true,
      lines: [
        'from functools import cache',
        '',
        '@cache',
        'def fib(n):',
        '    if n < 2:',
        '        return n',
        '    return fib(n - 1) + fib(n - 2)',
        '',
        'print("fib(40) =", fib(40))',
      ],
    },
    {
      name: 'notes.md',
      path: 'notes.md',
      lang: 'text',
      status: 'saved',
      builtIn: true,
      lines: [
        '# memo notes',
        '',
        '- 用输入 n 当 key',
        '- 用 fib(n) 当 value',
        '- 第一次算, 第二次查表',
        '',
        '> 递归不是少走路, 是不走第二遍。',
      ],
    },
    {
      name: 'tests.py',
      path: 'tests.py',
      lang: 'python',
      status: 'new',
      builtIn: true,
      lines: [
        'from fib import fib',
        '',
        'def test_small_values():',
        '    assert fib(0) == 0',
        '    assert fib(1) == 1',
        '    assert fib(7) == 13',
      ],
    },
  ];

  readonly homeReadmeFile: IdeFile = {
    name: 'README.md',
    path: 'README.md',
    lang: 'text',
    status: 'saved',
    builtIn: true,
    lines: [
      '# Codeyo',
      '',
      'No folder is open.',
      '',
      'Open a local folder to start editing workspace files.',
      'Choose Trust in the workspace prompt when you want Terminal, Run, Git, Journal, and file writes enabled.',
      '',
      'Until a folder is opened, this page is a read-only home buffer.',
    ],
  };

  constructor(
    private readonly changeDetector: ChangeDetectorRef,
    private readonly explorerStore: ExplorerStore,
    private readonly gitStore: GitStore,
    private readonly journalStore: JournalStore,
    private readonly languageStore: LanguageStore,
    private readonly projectSettingsStore: ProjectSettingsStore,
    private readonly runnerStore: RunnerStore,
    private readonly settingsStore: SettingsStore,
    private readonly snapshotStore: SnapshotStore,
    private readonly workspaceStore: WorkspaceStore,
  ) {
    this.workspaceStore.reset();
    this.journalStore.resetWorkspaceState();
    this.snapshotStore.close();
    this.runnerStore.resetWorkspaceState();
    this.languageStore.resetWorkspaceState();
    this.gitStore.resetWorkspaceState();
    this.explorerStore.clearExpanded();
    this.explorerStore.rebuild(this.visibleIdeFiles);
    this.settingsStore.load();
    this.editorDensity = this.settingsStore.editorDensity;
    this.editorFontSizePx = this.settingsStore.editorFontSizePx;
    this.editorFontId = this.settingsStore.editorFontId;
    this.editorThemeId = this.settingsStore.editorThemeId;
    this.workspaceRailWidth = this.settingsStore.workspaceRailWidth;
    this.explorerRailWidth = this.settingsStore.explorerRailWidth;
  }

  readonly languageCompletionProvider = async (position: EditorLanguagePosition): Promise<LanguageCompletionResult> => {
    if (!this.workspace?.trusted || !window.codeyo?.language || !this.autocompleteEnabled || !this.isTrustedWorkspaceFile(this.activeIdeFile)) {
      return { available: false, items: [] };
    }
    return window.codeyo.language.completion(
      this.workspace.id,
      this.languageRequestFor(this.activeIdeFile, position),
    );
  };

  readonly languageHoverProvider = async (position: EditorLanguagePosition): Promise<LanguageHoverResult> => {
    if (!this.workspace?.trusted || !window.codeyo?.language || !this.lspDiagnosticsEnabled || !this.isTrustedWorkspaceFile(this.activeIdeFile)) {
      return { available: false, contents: '' };
    }
    return window.codeyo.language.hover(
      this.workspace.id,
      this.languageRequestFor(this.activeIdeFile, position),
    );
  };

  ngOnInit(): void {
    this.loadStoredChannels();
    this.rebuildExplorerTree();
    if (this.isDesktop) {
      this.removeFileChangeListener = window.codeyo?.files.onChanged((change) => {
        void this.handleWorkspaceFileChange(change);
      });
      this.removeOpenTerminalMenuListener = window.codeyo?.appMenu?.onOpenTerminal(() => {
        this.openTerminalFromMenu();
      });
      this.removeLanguageDiagnosticsListener = window.codeyo?.language?.onDiagnostics((event) => {
        this.applyLanguageDiagnostics(event);
      });
      this.removeLanguageStatusListener = window.codeyo?.language?.onStatus((event) => {
        this.applyLanguageStatus(event);
      });
      void this.loadRecentWorkspaceHint();
    }
  }

  ngOnDestroy(): void {
    if (this.confirmDialogResolver) {
      this.closeConfirmDialog(false);
    }
    this.clearWorkspaceTimers();
    this.removeFileChangeListener?.();
    this.removeOpenTerminalMenuListener?.();
    this.removeLanguageDiagnosticsListener?.();
    this.removeLanguageStatusListener?.();
  }

  get workspace(): WorkspaceHandle | null {
    return this.workspaceStore.workspace;
  }

  set workspace(value: WorkspaceHandle | null) {
    this.workspaceStore.workspace = value;
  }

  get recentWorkspace(): WorkspaceHandle | null {
    return this.workspaceStore.recentWorkspace;
  }

  set recentWorkspace(value: WorkspaceHandle | null) {
    this.workspaceStore.recentWorkspace = value;
  }

  get workspaceNotice(): string {
    return this.workspaceStore.notice;
  }

  set workspaceNotice(value: string) {
    this.workspaceStore.notice = value;
  }

  get recoveryBuffers(): RecoveryBuffer[] {
    return this.workspaceStore.recoveryBuffers;
  }

  set recoveryBuffers(value: RecoveryBuffer[]) {
    this.workspaceStore.recoveryBuffers = value;
  }

  get fileConflict(): { diskContent: string; diskVersion: string; deleted?: boolean } | null {
    return this.workspaceStore.fileConflict;
  }

  set fileConflict(value: { diskContent: string; diskVersion: string; deleted?: boolean } | null) {
    this.workspaceStore.fileConflict = value;
  }

  get conflictCompareOpen(): boolean {
    return this.workspaceStore.conflictCompareOpen;
  }

  set conflictCompareOpen(value: boolean) {
    this.workspaceStore.conflictCompareOpen = value;
  }

  get conflictComparison(): LineComparison {
    return this.workspaceStore.conflictComparison;
  }

  set conflictComparison(value: LineComparison) {
    this.workspaceStore.conflictComparison = value;
  }

  get journalEntries(): JournalEntry[] {
    return this.journalStore.entries;
  }

  set journalEntries(value: JournalEntry[]) {
    this.journalStore.entries = value;
  }

  get journalDraft(): string {
    return this.journalStore.draft;
  }

  set journalDraft(value: string) {
    this.journalStore.draft = value;
  }

  get journalQuery(): string {
    return this.journalStore.query;
  }

  set journalQuery(value: string) {
    this.journalStore.query = value;
  }

  get journalKindFilter(): JournalKindFilter {
    return this.journalStore.kindFilter;
  }

  set journalKindFilter(value: JournalKindFilter) {
    this.journalStore.kindFilter = value;
  }

  get snapshotPreview(): ReviewSnapshot | null {
    return this.snapshotStore.preview;
  }

  set snapshotPreview(value: ReviewSnapshot | null) {
    this.snapshotStore.preview = value;
  }

  get snapshotActivePath(): string {
    return this.snapshotStore.activePath;
  }

  set snapshotActivePath(value: string) {
    this.snapshotStore.activePath = value;
  }

  get snapshotRunResult(): RunResult | null {
    return this.snapshotStore.runResult;
  }

  set snapshotRunResult(value: RunResult | null) {
    this.snapshotStore.runResult = value;
  }

  get snapshotEvidenceOpen(): boolean {
    return this.snapshotStore.evidenceOpen;
  }

  set snapshotEvidenceOpen(value: boolean) {
    this.snapshotStore.evidenceOpen = value;
  }

  get snapshotDiagnosticRevealLine(): number {
    return this.snapshotStore.diagnosticRevealLine;
  }

  set snapshotDiagnosticRevealLine(value: number) {
    this.snapshotStore.diagnosticRevealLine = value;
  }

  get snapshotDiagnosticRevealColumn(): number {
    return this.snapshotStore.diagnosticRevealColumn;
  }

  set snapshotDiagnosticRevealColumn(value: number) {
    this.snapshotStore.diagnosticRevealColumn = value;
  }

  get snapshotDiagnosticRevealRequest(): number {
    return this.snapshotStore.diagnosticRevealRequest;
  }

  set snapshotDiagnosticRevealRequest(value: number) {
    this.snapshotStore.diagnosticRevealRequest = value;
  }

  get snapshotCompareOpen(): boolean {
    return this.snapshotStore.compareOpen;
  }

  set snapshotCompareOpen(value: boolean) {
    this.snapshotStore.compareOpen = value;
  }

  get snapshotCurrentContent(): string {
    return this.snapshotStore.currentContent;
  }

  set snapshotCurrentContent(value: string) {
    this.snapshotStore.currentContent = value;
  }

  get snapshotCurrentMissing(): boolean {
    return this.snapshotStore.currentMissing;
  }

  set snapshotCurrentMissing(value: boolean) {
    this.snapshotStore.currentMissing = value;
  }

  get snapshotComparison(): LineComparison {
    return this.snapshotStore.comparison;
  }

  set snapshotComparison(value: LineComparison) {
    this.snapshotStore.comparison = value;
  }

  get autoSaveEnabled(): boolean {
    return this.projectSettingsStore.current.autoSaveEnabled;
  }

  set autoSaveEnabled(value: boolean) {
    this.projectSettingsStore.current.autoSaveEnabled = value;
  }

  get formatOnSaveEnabled(): boolean {
    return this.projectSettingsStore.current.formatOnSaveEnabled;
  }

  set formatOnSaveEnabled(value: boolean) {
    this.projectSettingsStore.current.formatOnSaveEnabled = value;
  }

  get pythonExecutable(): string {
    return this.projectSettingsStore.current.pythonCommand;
  }

  set pythonExecutable(value: string) {
    this.projectSettingsStore.current.pythonCommand = value;
  }

  get cppExecutable(): string {
    return this.projectSettingsStore.current.cppCommand;
  }

  set cppExecutable(value: string) {
    this.projectSettingsStore.current.cppCommand = value;
  }

  get pythonFormatterCommand(): string {
    return this.projectSettingsStore.current.pythonFormatterCommand;
  }

  set pythonFormatterCommand(value: string) {
    this.projectSettingsStore.current.pythonFormatterCommand = value;
  }

  get profileArgs(): string {
    return this.projectSettingsStore.current.profileArgs;
  }

  set profileArgs(value: string) {
    this.projectSettingsStore.current.profileArgs = value;
  }

  get cppProgramArgs(): string {
    return this.projectSettingsStore.current.cppProgramArgs;
  }

  set cppProgramArgs(value: string) {
    this.projectSettingsStore.current.cppProgramArgs = value;
  }

  get homeMode(): boolean {
    return this.isDesktop && !this.workspace;
  }

  get fileQuery(): string {
    return this.explorerStore.fileQuery;
  }

  set fileQuery(value: string) {
    this.explorerStore.fileQuery = value;
  }

  get explorerTreeEntries(): ExplorerTreeEntry[] {
    return this.explorerStore.entries;
  }

  get quickOpenVisible(): boolean {
    return this.explorerStore.quickOpenVisible;
  }

  get quickOpenQuery(): string {
    return this.explorerStore.quickOpenQuery;
  }

  set quickOpenQuery(value: string) {
    this.explorerStore.quickOpenQuery = value;
  }

  get quickOpenIndex(): number {
    return this.explorerStore.quickOpenIndex;
  }

  set quickOpenIndex(value: number) {
    this.explorerStore.quickOpenIndex = value;
  }

  get gitStatus(): GitStatus | null {
    return this.gitStore.status;
  }

  set gitStatus(value: GitStatus | null) {
    this.gitStore.status = value;
  }

  get gitBranches(): string[] {
    return this.gitStore.branches;
  }

  set gitBranches(value: string[]) {
    this.gitStore.branches = value;
  }

  get gitStagedSummary(): GitStagedSummary {
    return this.gitStore.stagedSummary;
  }

  set gitStagedSummary(value: GitStagedSummary) {
    this.gitStore.stagedSummary = value;
  }

  get selectedBranch(): string {
    return this.gitStore.selectedBranch;
  }

  set selectedBranch(value: string) {
    this.gitStore.selectedBranch = value;
  }

  get gitNotice(): string {
    return this.gitStore.notice;
  }

  set gitNotice(value: string) {
    this.gitStore.notice = value;
  }

  get gitComparison(): GitComparison | null {
    return this.gitStore.comparison;
  }

  set gitComparison(value: GitComparison | null) {
    this.gitStore.comparison = value;
  }

  get gitComparisonLeftLines(): number[] {
    return this.gitStore.comparisonLeftLines;
  }

  set gitComparisonLeftLines(value: number[]) {
    this.gitStore.comparisonLeftLines = value;
  }

  get gitComparisonRightLines(): number[] {
    return this.gitStore.comparisonRightLines;
  }

  set gitComparisonRightLines(value: number[]) {
    this.gitStore.comparisonRightLines = value;
  }

  get gitComparisonAdded(): number {
    return this.gitStore.comparisonAdded;
  }

  set gitComparisonAdded(value: number) {
    this.gitStore.comparisonAdded = value;
  }

  get gitComparisonRemoved(): number {
    return this.gitStore.comparisonRemoved;
  }

  set gitComparisonRemoved(value: number) {
    this.gitStore.comparisonRemoved = value;
  }

  get gitHunks(): LineDiffHunk[] {
    return this.gitStore.hunks;
  }

  set gitHunks(value: LineDiffHunk[]) {
    this.gitStore.hunks = value;
  }

  get pendingDiscardHunkId(): number | null {
    return this.gitStore.pendingDiscardHunkId;
  }

  set pendingDiscardHunkId(value: number | null) {
    this.gitStore.pendingDiscardHunkId = value;
  }

  get gitHistoryDetail(): GitCommitDetail | null {
    return this.gitStore.historyDetail;
  }

  set gitHistoryDetail(value: GitCommitDetail | null) {
    this.gitStore.historyDetail = value;
  }

  get gitHistory(): GitCommitSummary[] {
    return this.gitStore.history;
  }

  set gitHistory(value: GitCommitSummary[]) {
    this.gitStore.history = value;
  }

  get gitHistoryQuery(): string {
    return this.gitStore.historyQuery;
  }

  set gitHistoryQuery(value: string) {
    this.gitStore.historyQuery = value;
  }

  get reviewSnapshotDraft(): string {
    return this.gitStore.reviewSnapshotDraft;
  }

  set reviewSnapshotDraft(value: string) {
    this.gitStore.reviewSnapshotDraft = value;
  }

  get selectedReviewRunResultId(): string {
    return this.gitStore.selectedReviewRunResultId;
  }

  set selectedReviewRunResultId(value: string) {
    this.gitStore.selectedReviewRunResultId = value;
  }

  get selectedCommitRunResultId(): string {
    return this.gitStore.selectedCommitRunResultId;
  }

  set selectedCommitRunResultId(value: string) {
    this.gitStore.selectedCommitRunResultId = value;
  }

  get commitMessage(): string {
    return this.gitStore.commitMessage;
  }

  set commitMessage(value: string) {
    this.gitStore.commitMessage = value;
  }

  get branchName(): string {
    return this.gitStore.branchName;
  }

  set branchName(value: string) {
    this.gitStore.branchName = value;
  }

  get gitBusy(): boolean {
    return this.gitStore.busy;
  }

  set gitBusy(value: boolean) {
    this.gitStore.busy = value;
  }

  get gitCompareBusy(): boolean {
    return this.gitStore.compareBusy;
  }

  set gitCompareBusy(value: boolean) {
    this.gitStore.compareBusy = value;
  }

  get gitSnapshotBusy(): boolean {
    return this.gitStore.snapshotBusy;
  }

  set gitSnapshotBusy(value: boolean) {
    this.gitStore.snapshotBusy = value;
  }

  get commitReviewOpen(): boolean {
    return this.gitStore.commitReviewOpen;
  }

  set commitReviewOpen(value: boolean) {
    this.gitStore.commitReviewOpen = value;
  }

  get runDiagnostics(): EditorDiagnostic[] {
    return this.runnerStore.diagnostics;
  }

  set runDiagnostics(value: EditorDiagnostic[]) {
    this.runnerStore.diagnostics = value;
  }

  get recentRunResults(): RunResult[] {
    return this.runnerStore.recentResults;
  }

  set recentRunResults(value: RunResult[]) {
    this.runnerStore.recentResults = value;
  }

  get pendingRunProfile(): RunProfile | null {
    return this.runnerStore.pendingProfile;
  }

  set pendingRunProfile(value: RunProfile | null) {
    this.runnerStore.pendingProfile = value;
  }

  get pendingRunDirtyPath(): string {
    return this.runnerStore.pendingDirtyPath;
  }

  set pendingRunDirtyPath(value: string) {
    this.runnerStore.pendingDirtyPath = value;
  }

  get runBusy(): boolean {
    return this.runnerStore.busy;
  }

  set runBusy(value: boolean) {
    this.runnerStore.busy = value;
  }

  get lspDiagnostics(): EditorDiagnostic[] {
    return this.languageStore.lspDiagnostics;
  }

  set lspDiagnostics(value: EditorDiagnostic[]) {
    this.languageStore.lspDiagnostics = value;
  }

  get spellDiagnostics(): EditorDiagnostic[] {
    return this.languageStore.spellDiagnostics;
  }

  set spellDiagnostics(value: EditorDiagnostic[]) {
    this.languageStore.spellDiagnostics = value;
  }

  get lspDiagnosticsEnabled(): boolean {
    return this.languageStore.lspDiagnosticsEnabled;
  }

  set lspDiagnosticsEnabled(value: boolean) {
    this.languageStore.lspDiagnosticsEnabled = value;
  }

  get autocompleteEnabled(): boolean {
    return this.languageStore.autocompleteEnabled;
  }

  set autocompleteEnabled(value: boolean) {
    this.languageStore.autocompleteEnabled = value;
  }

  get spellCheckEnabled(): boolean {
    return this.languageStore.spellCheckEnabled;
  }

  set spellCheckEnabled(value: boolean) {
    this.languageStore.spellCheckEnabled = value;
  }

  get languageWorkspaceStatus(): LanguageWorkspaceStatus | null {
    return this.languageStore.workspaceStatus;
  }

  set languageWorkspaceStatus(value: LanguageWorkspaceStatus | null) {
    this.languageStore.workspaceStatus = value;
  }

  get visibleIdeFiles(): IdeFile[] {
    return this.homeMode ? [this.homeReadmeFile] : this.ideFiles;
  }

  get activeIdeFile(): IdeFile {
    if (this.homeMode) {
      return this.homeReadmeFile;
    }
    return this.ideFiles.find((file) => file.path === this.activeIdePath) ?? this.ideFiles[0];
  }

  get activeEditorText(): string {
    return this.activeIdeFile.lines.join('\n');
  }

  get allDiagnostics(): EditorDiagnostic[] {
    return this.languageStore.allDiagnostics(this.runDiagnostics);
  }

  get activeDiagnostics(): EditorDiagnostic[] {
    return this.allDiagnostics.filter((diagnostic) => diagnostic.path === this.activeIdeFile.path);
  }

  get activeSnapshotFile(): { path: string; content: string } {
    return this.snapshotStore.activeFile;
  }

  get snapshotLanguage(): EditorLanguage {
    return this.snapshotStore.language;
  }

  get snapshotDiffSummary(): string {
    return this.snapshotStore.diffSummary;
  }

  get snapshotRunTranscript(): string {
    return this.snapshotRunResult ? this.runTranscriptLines(this.snapshotRunResult).join('\n') : '';
  }

  get activeSnapshotDiagnostics(): EditorDiagnostic[] {
    return this.snapshotRunResult?.diagnostics.filter(
      (diagnostic) => this.canRevealSnapshotDiagnostic(diagnostic)
        && this.normalizedPath(diagnostic.path) === this.normalizedPath(this.activeSnapshotFile.path),
    ) ?? [];
  }

  get gitComparisonFileState(): GitFileState | undefined {
    return this.gitComparison
      ? this.findGitFileState(this.gitComparison.path)
      : undefined;
  }

  get gitComparisonSummary(): string {
    if (!this.gitComparison) {
      return '';
    }
    return `${this.gitComparison.mode.toUpperCase()} · +${this.gitComparisonAdded} / -${this.gitComparisonRemoved} · ${this.gitComparison.leftLabel} TO ${this.gitComparison.rightLabel}`;
  }

  get isGitHistoryComparison(): boolean {
    return this.gitComparison?.mode === 'commit';
  }

  get gitHunkActionsEnabled(): boolean {
    return Boolean(
      this.gitComparison
        && !this.isGitHistoryComparison
        && (this.gitComparison.mode === 'staged' || this.gitComparison.mode === 'unstaged')
        && this.gitComparison.leftExists
        && this.gitComparison.rightExists
        && !this.gitComparison.originalPath,
    );
  }

  get gitHunkAvailableModes(): GitPatchMode[] {
    if (!this.gitHunkActionsEnabled || !this.gitComparison) {
      return [];
    }
    return this.gitComparison.mode === 'unstaged' ? ['stage', 'discard'] : ['unstage'];
  }

  gitHunkRange(start: number, lines: string[]): string {
    if (lines.length === 0) {
      return `L${Math.max(1, start - 1)}`;
    }
    if (lines.length === 1) {
      return `L${start}`;
    }
    return `L${start}-${start + lines.length - 1}`;
  }

  gitHunkSummary(hunk: LineDiffHunk): string {
    const leftLabel = this.gitComparison?.leftLabel ?? 'LEFT';
    const rightLabel = this.gitComparison?.rightLabel ?? 'RIGHT';
    return `${leftLabel} ${this.gitHunkRange(hunk.snapshotStart, hunk.snapshotLines)} · ${rightLabel} ${this.gitHunkRange(hunk.currentStart, hunk.currentLines)}`;
  }

  hunkActionLabel(mode: GitPatchMode): string {
    if (mode === 'stage') return 'Stage Hunk';
    if (mode === 'unstage') return 'Unstage Hunk';
    return 'Discard Hunk';
  }

  get reviewableCommitFileCount(): number {
    return this.gitHistoryDetail?.files.filter((file) => file.status !== 'D').length ?? 0;
  }

  get selectedReviewRunResult(): RunResult | undefined {
    return this.recentRunResults.find((result) => result.id === this.selectedReviewRunResultId);
  }

  get selectedCommitRunResult(): RunResult | undefined {
    return this.recentRunResults.find((result) => result.id === this.selectedCommitRunResultId);
  }

  runEvidenceLabel(result: RunResult): string {
    return `${result.entryFile} · EXIT ${result.exitCode} · ${result.elapsedMs} MS`;
  }

  get activeBufferRunEvidence(): RunResult | undefined {
    const activePath = this.normalizedPath(this.activeIdeFile.path);
    return this.recentRunResults.find((result) => result.inputs?.some(
      (input) => this.normalizedPath(input.path) === activePath
        && input.content === this.activeEditorText,
    ));
  }

  canRevealSnapshotDiagnostic(diagnostic: EditorDiagnostic): boolean {
    const snapshotFile = this.snapshotFileForDiagnostic(diagnostic);
    const runInput = this.snapshotRunResult?.inputs?.find(
      (input) => this.normalizedPath(input.path) === this.normalizedPath(diagnostic.path),
    );
    return Boolean(snapshotFile && runInput && snapshotFile.content === runInput.content);
  }

  snapshotDiagnosticAction(diagnostic: EditorDiagnostic): string {
    if (!this.snapshotFileForDiagnostic(diagnostic)) {
      return 'Not in set';
    }
    return this.canRevealSnapshotDiagnostic(diagnostic) ? 'Open line' : 'Source differs';
  }

  snapshotHunkRange(start: number, lines: string[]): string {
    if (lines.length === 0) {
      return `L${Math.max(1, start)} EMPTY`;
    }
    return lines.length === 1 ? `L${start}` : `L${start}-${start + lines.length - 1}`;
  }

  snapshotHunkSummary(hunk: LineDiffHunk): string {
    return `SNAPSHOT ${this.snapshotHunkRange(hunk.snapshotStart, hunk.snapshotLines)} · CURRENT ${this.snapshotHunkRange(hunk.currentStart, hunk.currentLines)}`;
  }

  get gitComparisonHasUnsavedBuffer(): boolean {
    const file = this.gitComparison && this.findWorkspaceBuffer(this.gitComparison.path);
    return Boolean(file?.workspaceFile && file.status !== 'saved');
  }

  get canViewStagedComparison(): boolean {
    const index = this.gitComparisonFileState?.index;
    return Boolean(index && index !== ' ' && index !== '?');
  }

  get canViewUnstagedComparison(): boolean {
    const workingTree = this.gitComparisonFileState?.workingTree;
    return Boolean(workingTree && workingTree !== ' ');
  }

  get canOpenGitComparisonBuffer(): boolean {
    return Boolean(this.gitComparison && this.findWorkspaceBuffer(this.gitComparison.path));
  }

  get stagedGitFiles(): GitFileState[] {
    return this.gitStore.stagedFiles;
  }

  get unstagedGitFiles(): GitFileState[] {
    return this.gitStore.unstagedFiles;
  }

  get canReviewCommit(): boolean {
    return this.stagedGitFiles.length > 0 && Boolean(this.commitMessage.trim());
  }

  get canDeleteSelectedBranch(): boolean {
    return Boolean(this.selectedBranch && this.gitStatus && this.selectedBranch !== this.gitStatus.branch);
  }

  get filteredGitHistory(): GitCommitSummary[] {
    return this.gitStore.filteredHistory;
  }

  get filteredJournalEntries(): JournalEntry[] {
    return this.journalStore.filteredEntries;
  }

  journalEntryCount(kind: JournalKindFilter): number {
    return this.journalStore.count(kind);
  }

  get cppSourceCandidates(): IdeFile[] {
    return this.ideFiles.filter((file) => /\.(cpp|cc|cxx)$/i.test(file.path));
  }

  get filteredIdeFiles(): IdeFile[] {
    const query = this.fileQuery.trim().toLowerCase();
    const files = this.visibleIdeFiles;
    return query
      ? files.filter((file) =>
          file.name.toLowerCase().includes(query) || file.path.toLowerCase().includes(query))
      : files;
  }

  get explorerRootName(): string {
    if (this.homeMode) {
      return 'NO FOLDER';
    }
    return (this.workspace?.name || 'atelier-ide').toUpperCase();
  }

  private rebuildExplorerTree(): void {
    this.explorerStore.rebuild(this.visibleIdeFiles);
  }

  private scheduleExplorerTreeRebuild(): void {
    if (this.explorerTreeRebuildQueued) {
      return;
    }
    this.explorerTreeRebuildQueued = true;
    queueMicrotask(() => {
      this.explorerTreeRebuildQueued = false;
      this.rebuildExplorerTree();
      this.renderDesktopState();
    });
  }

  get quickOpenResults(): IdeFile[] {
    return this.explorerStore.quickOpenResults(this.visibleIdeFiles, this.activeIdePath);
  }

  get editedFileCount(): number {
    if (this.homeMode) {
      return 0;
    }
    return this.ideFiles.filter((file) => file.status !== 'saved').length;
  }

  get canSaveAll(): boolean {
    return this.isDesktop && this.dirtyWorkspaceFiles().length > 0;
  }

  get recoveryBufferCount(): number {
    return this.recoveryBuffers.length;
  }

  get activeSaveLabel(): string {
    if (this.activeIdeFile.missingOnDisk) {
      return 'Deleted on disk · unsaved';
    }
    if (this.activeIdeFile.status === 'edited') {
      return 'Edited · unsaved';
    }

    if (this.activeIdeFile.status === 'new') {
      return 'New file';
    }

    return `Saved · ${this.lastSavedAt}`;
  }

  get conflictDiffSummary(): string {
    if (!this.fileConflict) {
      return '';
    }
    if (this.fileConflict.deleted) {
      return 'CURRENT FILE MISSING ON DISK';
    }
    return `${this.conflictComparison.hunks.length} HUNKS · +${this.conflictComparison.added} / -${this.conflictComparison.removed} · DISK TO BUFFER`;
  }

  get environmentSummary(): string {
    if (this.environmentChecks.length === 0) {
      return 'NOT CHECKED';
    }
    const ready = this.environmentChecks.filter((check) => check.available).length;
    return `${ready}/${this.environmentChecks.length} READY`;
  }

  get hasMemoizedFib(): boolean {
    const source = this.ideFiles.find((file) => file.name === 'fib.py')?.lines.join('\n') ?? '';
    return /@cache|memo\s*=|cache\s*\[/.test(source);
  }

  get hasLargeValueTest(): boolean {
    const tests = this.ideFiles.find((file) => file.name === 'tests.py')?.lines.join('\n') ?? '';
    return tests.includes('test_large_value');
  }

  get activeComplexity(): string {
    if (this.activeIdeFile.name === 'fib.py') {
      return this.hasMemoizedFib ? 'O(n)' : 'O(2ⁿ)';
    }

    return this.activeIdeFile.name === 'tests.py'
      ? `${this.hasLargeValueTest ? '4' : '3'} Checks`
      : '7 Lines';
  }

  get activeSpeed(): string {
    if (this.activeIdeFile.name === 'fib.py') {
      return this.hasMemoizedFib ? '0.0002s' : '2.1s';
    }

    return this.activeIdeFile.name === 'tests.py' ? '0.08s' : 'Preview';
  }

  get assistantActionLabel(): string {
    if (this.activeIdeFile.name === 'fib.py') {
      return this.hasMemoizedFib ? 'Explain Memo' : 'Apply Memo Patch';
    }

    if (this.activeIdeFile.name === 'tests.py') {
      return this.activeEditorText.includes('test_large_value')
        ? 'Run Tests'
        : 'Add Large Test';
    }

    return 'Review Buffer';
  }

  get assistantMessage(): string {
    if (this.activeIdeFile.name === 'fib.py') {
      return this.hasMemoizedFib
        ? '你的版本已经不是爆栈路线了。下一步可手写一个 dict 版, 看清楚 cache 的形状。'
        : '现在还是重复递归。应用 patch 后再 Run, 就能看到调用次数的差距。';
    }

    if (this.activeIdeFile.name === 'tests.py') {
      return '测试文件适合补一条大输入用例, 这样 memo 的性能改善才会被看见。';
    }

    if (this.activeIdeFile.name === 'notes.md') {
      return '这份解释已经很清楚。可以补一句：key 是输入, value 是算过的答案。';
    }

    return '这是一个新 buffer。先写一个小目标, 然后运行或分享给同伴一起看。';
  }

  get canDeleteActiveFile(): boolean {
    return !this.activeIdeFile.builtIn;
  }

  get activeFileStatusLabel(): string {
    if (this.homeMode) {
      return 'readonly';
    }
    if (this.activeIdeFile.missingOnDisk) {
      return 'missing';
    }
    return this.activeIdeFile.status === 'saved' ? 'saved' : this.activeIdeFile.status;
  }

  get activeProblemCount(): number {
    return this.filteredDiagnosticsBySource(this.allDiagnostics)
      .filter((diagnostic) => diagnostic.path === this.activeIdeFile.path).length;
  }

  get problemSummary(): string {
    const diagnostics = this.filteredDiagnosticsBySource(this.allDiagnostics);
    const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length;
    const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length;
    if (errors === 0 && warnings === 0) {
      return '0 problems';
    }
    return `${errors} errors · ${warnings} warnings`;
  }

  get editorStatusSummary(): string {
    const base = `${this.activeFileStatusLabel} · ${this.activeIdeFile.lines.length} lines · Ln ${this.editorCursorLine}, Col ${this.editorCursorColumn} · ${this.activeLanguageStatusLabel}`;
    if (this.activeIdeFile.lang === 'python') {
      return `python · ${base} · ${this.pythonRunProfileSummary}`;
    }
    if (this.activeIdeFile.lang !== 'cpp') {
      return `${this.activeIdeFile.lang} · ${base}`;
    }
    return `cpp · ${base} · ${this.cppRunProfileSummary}`;
  }

  get pythonRunProfileSummary(): string {
    const args = this.profileArgs.trim() || 'no program args';
    return `entry ${this.activeIdeFile.path} · ${this.pythonExecutable} · ${args}`;
  }

  get cppRunProfileSummary(): string {
    const available = new Set(this.cppSourceCandidates.map((file) => file.path));
    const selected = this.cppSelectedSources.filter((path) => available.has(path));
    const sourceCount = this.activeIdeFile.lang === 'cpp' && !selected.includes(this.activeIdeFile.path)
      ? selected.length + 1
      : selected.length;
    const compilerArgs = this.profileArgs.trim() || 'no compiler args';
    const programArgs = this.cppProgramArgs.trim() || 'no program args';
    return `entry ${this.activeIdeFile.path} · sources ${sourceCount} · ${compilerArgs} · ${programArgs}`;
  }

  get runStatusProfile(): RunProfile | null {
    return this.pendingRunProfile ?? this.activeRunProfilePreview;
  }

  get runStatusProfileLabel(): string {
    const profile = this.runStatusProfile;
    if (!profile) {
      return 'No runnable file';
    }
    return `${profile.name} · ${profile.language.toUpperCase()}`;
  }

  get runStatusEntryLabel(): string {
    return this.runStatusProfile?.entryFile ?? this.activeIdeFile.path;
  }

  get runStatusToolchainLabel(): string {
    const profile = this.runStatusProfile;
    if (!profile) {
      return 'No toolchain';
    }
    if (!this.isDesktop) {
      return 'Browser preview runner';
    }
    if (!this.workspace?.trusted) {
      return 'Trusted workspace required';
    }
    return profile.language === 'cpp'
      ? `Compiler ${profile.command}`
      : `Interpreter ${profile.command}`;
  }

  get runStatusArgsLabel(): string {
    const profile = this.runStatusProfile;
    if (!profile) {
      return 'No args';
    }
    if (profile.language === 'cpp') {
      const compilerArgs = profile.args?.join(' ') || 'no compiler args';
      const programArgs = profile.programArgs?.join(' ') || 'no program args';
      return `sources ${profile.sourceFiles?.length ?? 1} · ${compilerArgs} · ${programArgs}`;
    }
    return profile.args?.join(' ') || 'no program args';
  }

  get runStatusDirtyLabel(): string {
    const profile = this.runStatusProfile;
    if (!profile) {
      return 'No disk inputs';
    }
    if (this.pendingRunProfile && this.pendingRunDirtyPath) {
      return `Save required · ${this.pendingRunDirtyPath}`;
    }
    const dirtyInput = this.dirtyRunInputForProfile(profile);
    if (dirtyInput) {
      return `Dirty input · ${dirtyInput.path}`;
    }
    if (!this.isDesktop || !this.workspace) {
      return 'Draft buffer run';
    }
    return 'Disk inputs clean';
  }

  get runStatusEvidenceLabel(): string {
    const latest = this.recentRunResults[0];
    if (latest) {
      return `${latest.entryFile} · EXIT ${latest.exitCode} · ${latest.elapsedMs} ms`;
    }
    return this.isDesktop ? 'No run evidence yet' : `${this.lastRunTarget} · ${this.lastRunSummary}`;
  }

  get filteredRunDiagnostics(): EditorDiagnostic[] {
    const diagnostics = this.filteredDiagnosticsBySource(this.allDiagnostics);
    if (this.problemFilter === 'active') {
      return diagnostics.filter((diagnostic) => diagnostic.path === this.activeIdeFile.path);
    }
    return diagnostics;
  }

  get problemLines(): string[] {
    if (this.isDesktop && this.allDiagnostics.length > 0) {
      return this.allDiagnostics.map((diagnostic) =>
        `${diagnostic.source ?? 'run'} ${diagnostic.severity} L${diagnostic.line} · ${diagnostic.message}`);
    }

    if (this.activeIdeFile.name === 'notes.md') {
      return ['NO PROBLEMS · MARKDOWN PREVIEW READY'];
    }

    if (this.activeIdeFile.name === 'tests.py') {
      return this.activeEditorText.includes('test_large_value')
        ? ['NO PROBLEMS · LARGE VALUE TEST ADDED']
        : ['INFO · TEST COVERAGE IS LIMITED TO SMALL VALUES'];
    }

    if (this.activeIdeFile.name !== 'fib.py') {
      return ['INFO · NEW BUFFER READY TO RUN'];
    }

    if (!this.activeEditorText.includes('def fib')) {
      return ['ERROR L01 · FUNCTION fib IS NOT DEFINED'];
    }

    if (!this.hasMemoizedFib) {
      return ['WARNING L03 · EXPONENTIAL RECURSION DETECTED', 'HINT · APPLY MEMO PATCH'];
    }

    return ['NO PROBLEMS · CACHED RECURSION VERIFIED'];
  }

  get activeLanguageStatusLabel(): string {
    if (!this.isDesktop || !this.workspace?.trusted) {
      return 'LSP off';
    }
    if (this.activeIdeFile.lang === 'text') {
      return this.spellCheckEnabled ? 'spell ready' : 'spell off';
    }
    const status = this.languageStatusFor(this.activeIdeFile.lang);
    if (!status) {
      return 'LSP idle';
    }
    return `${status.label} ${status.state}`;
  }

  isTrustedWorkspaceFile(file: IdeFile): boolean {
    return Boolean(this.isDesktop && this.workspace?.trusted && file.workspaceFile && !file.missingOnDisk);
  }

  private filteredDiagnosticsBySource(diagnostics: EditorDiagnostic[]): EditorDiagnostic[] {
    return this.languageStore.filteredBySource(diagnostics, this.problemSourceFilter);
  }

  private languageStatusFor(language: EditorLanguage): LanguageServiceStatus | undefined {
    return this.languageStore.statusFor(language);
  }

  get outputLines(): string[] {
    if (this.isDesktop && this.desktopOutput.length > 0) {
      return this.desktopOutput;
    }

    return [
      `ACTIVE BUFFER · ${this.activeIdeFile.name}`,
      `STATE · ${this.activeSaveLabel}`,
      `COMPLEXITY · ${this.activeComplexity}`,
      `LATEST · ${this.lastRunSummary}`,
    ];
  }

  get activeChannel(): ChannelItem {
    return this.channels.find((channel) => channel.id === this.activeChannelId) ?? this.channels[0];
  }

  get contextChannel(): ChannelItem | undefined {
    return this.channels.find((channel) => channel.id === this.channelMenuChannelId);
  }

  get editorLineHeightPx(): number {
    const ratio = this.editorDensity === 'compact' ? 1.54 : 1.68;
    return Math.round(this.editorFontSizePx * ratio);
  }

  get editorVerticalPaddingPx(): number {
    return this.editorDensity === 'compact' ? 8 : 12;
  }

  get editorFontFamily(): string {
    return editorFontPreset(this.editorFontId).family;
  }

  get editorThemeVariables(): Record<string, string> {
    return editorThemePreset(this.editorThemeId).variables;
  }

  get editorLayoutKey(): string {
    return `${this.editorDensity}:${this.editorFontSizePx}:${this.editorLineHeightPx}:${this.editorVerticalPaddingPx}`;
  }

  focusScreen(screen: ScreenId): void {
    this.focusedScreen = screen;
  }

  clearFocus(): void {
    this.focusedScreen = null;
  }

  @HostListener('window:beforeunload', ['$event'])
  handleBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.isDesktop || !this.workspace?.trusted || this.dirtyWorkspaceFiles().length === 0) {
      return;
    }

    this.flushDirtyRecoveryBuffersSync();
    event.preventDefault();
    event.returnValue = 'Codeyo has unsaved workspace buffers.';
  }

  @HostListener('document:click')
  closeChannelMenu(): void {
    if (this.channelMenuOpen) {
      this.channelMenuOpen = false;
      this.channelMenuNotice = '';
      this.channelDeleteArmed = false;
    }
    this.filesActionsMenuOpen = false;
  }

  @HostListener('window:keydown.escape')
  closeChannelMenuFromEscape(): void {
    this.closeChannelMenu();
  }

  @HostListener('window:mousemove', ['$event'])
  resizeRailFromMouseMove(event: MouseEvent): void {
    if (!this.resizingRail) {
      return;
    }
    event.preventDefault();
    this.updateRailWidthFromPointer(event.clientX);
  }

  @HostListener('window:mouseup')
  finishRailResize(): void {
    if (!this.resizingRail) {
      return;
    }
    this.resizingRail = null;
    this.railResizeBounds = null;
    this.settingsStore.workspaceRailWidth = this.workspaceRailWidth;
    this.settingsStore.explorerRailWidth = this.explorerRailWidth;
    this.settingsStore.saveRailWidths();
  }

  @HostListener('window:blur')
  cancelRailResize(): void {
    this.finishRailResize();
  }

  openIde(): void {
    this.activeChannelId = 'ide';
    this.activeChannelView = 'ide';
    this.activeRightPanel = 'files';
  }

  setChannelView(view: ChannelView): void {
    if (view === 'ide') {
      this.activeChannelId = 'ide';
    } else if (this.activeChannelId === 'ide') {
      this.activeChannelId = this.firstThreadChannelId();
    }
    this.activeChannelView = view;
    this.activeRightPanel = view === 'ide' ? 'files' : 'contributors';
  }

  selectChannel(channelId: string): void {
    this.activateChannel(channelId);
  }

  openChannelMenu(event: MouseEvent, channelId: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.channelMenuChannelId = channelId;
    this.channelDraftName = '';
    this.channelDeleteArmed = false;
    this.channelMenuNotice = '';
    this.channelMenuOpen = true;
    const menuWidth = 236;
    const menuHeight = 196;
    const viewportWidth = typeof window === 'undefined' ? 1440 : window.innerWidth;
    const viewportHeight = typeof window === 'undefined' ? 900 : window.innerHeight;
    this.channelMenuX = Math.max(8, Math.min(event.clientX, viewportWidth - menuWidth - 8));
    this.channelMenuY = Math.max(8, Math.min(event.clientY, viewportHeight - menuHeight - 8));
  }

  openChannelSectionMenu(event: MouseEvent): void {
    this.openChannelMenu(event, this.firstThreadChannelId());
  }

  startRailResize(event: MouseEvent, target: RailResizeTarget): void {
    event.preventDefault();
    event.stopPropagation();
    const layout = (event.currentTarget as HTMLElement | null)?.closest('.channels-layout');
    const rect = layout?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    this.resizingRail = target;
    this.railResizeBounds = {
      left: rect.left,
      right: rect.right,
      width: rect.width,
    };
    this.updateRailWidthFromPointer(event.clientX);
  }

  updateChannelDraftName(event: Event): void {
    this.channelDraftName = (event.target as HTMLInputElement).value;
    this.channelDeleteArmed = false;
  }

  createChannelFromMenu(): void {
    const name = this.normalizeChannelName(this.channelDraftName);
    if (!name) {
      this.channelMenuNotice = 'NAME REQUIRED';
      return;
    }
    const channel: ChannelItem = {
      id: this.uniqueChannelId(name),
      index: '',
      name,
      topic: 'user channel',
    };
    const contextIndex = this.channels.findIndex((candidate) => candidate.id === this.channelMenuChannelId);
    const insertAt = contextIndex >= 0 ? contextIndex + 1 : this.channels.length;
    this.channels.splice(insertAt, 0, channel);
    this.renumberChannels();
    this.saveChannels();
    this.channelMenuChannelId = channel.id;
    this.channelDraftName = '';
    this.channelMenuNotice = `CREATED · ${channel.name}`;
    this.channelDeleteArmed = false;
    this.selectChannel(channel.id);
  }

  deleteContextChannel(): void {
    const channel = this.contextChannel;
    if (!channel || channel.id === 'ide') {
      this.channelMenuNotice = 'WORKSPACE NODE CANNOT BE DELETED';
      return;
    }
    if (!this.channelDeleteArmed) {
      this.channelDeleteArmed = true;
      this.channelMenuNotice = `CONFIRM DELETE · ${channel.name}`;
      return;
    }
    const deletedId = channel.id;
    this.channels = this.channels.filter((candidate) => candidate.id !== deletedId);
    this.renumberChannels();
    this.saveChannels();
    if (this.activeChannelId === deletedId) {
      this.selectChannel(this.firstThreadChannelId());
    }
    this.closeChannelMenu();
  }

  private activateChannel(channelId: string): void {
    const nextId = this.channels.some((channel) => channel.id === channelId)
      ? channelId
      : this.firstThreadChannelId();
    this.activeChannelId = nextId;
    this.activeChannelView = nextId === 'ide' ? 'ide' : 'thread';
    this.activeRightPanel = nextId === 'ide' ? 'files' : 'contributors';
  }

  private firstThreadChannelId(): string {
    return this.channels.find((channel) => channel.id !== 'ide')?.id ?? 'ide';
  }

  private normalizeChannelName(value: string): string {
    return value.trim().replace(/\s+/g, ' ').slice(0, 24);
  }

  private uniqueChannelId(name: string): string {
    const base = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'channel';
    let candidate = base;
    let suffix = 2;
    while (this.channels.some((channel) => channel.id === candidate)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  private renumberChannels(): void {
    this.channels.forEach((channel, index) => {
      channel.index = String(index + 1).padStart(2, '0');
    });
  }

  private loadStoredChannels(): void {
    if (typeof localStorage === 'undefined') {
      return;
    }
    try {
      const stored = localStorage.getItem(this.channelStorageKey);
      if (!stored) {
        return;
      }
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) {
        return;
      }
      const ideChannel = this.channels.find((channel) => channel.id === 'ide') ?? {
        id: 'ide',
        index: '01',
        name: 'IDE Workspace',
        topic: 'local buffers',
      };
      const restored = parsed
        .filter((channel): channel is StoredChannelItem =>
          Boolean(channel && typeof channel === 'object')
          && typeof channel.id === 'string'
          && channel.id !== 'ide'
          && typeof channel.name === 'string')
        .map((channel) => ({
          id: channel.id.slice(0, 48),
          index: '',
          name: this.normalizeChannelName(channel.name) || 'Channel',
          topic: typeof channel.topic === 'string' ? channel.topic.slice(0, 80) : 'user channel',
          unread: typeof channel.unread === 'number' ? Math.max(0, Math.min(99, Math.floor(channel.unread))) : undefined,
          mention: channel.mention === true || undefined,
          marker: channel.marker === true || undefined,
        }));
      this.channels = [ideChannel, ...restored];
      this.renumberChannels();
    } catch {
      // Channel settings are convenience state; the workspace stays usable if storage is unavailable.
    }
  }

  private saveChannels(): void {
    if (typeof localStorage === 'undefined') {
      return;
    }
    try {
      localStorage.setItem(this.channelStorageKey, JSON.stringify(this.channels));
    } catch {
      // Ignore storage quota or privacy-mode failures.
    }
  }

  private updateRailWidthFromPointer(clientX: number): void {
    if (!this.resizingRail || !this.railResizeBounds) {
      return;
    }
    if (this.resizingRail === 'workspace') {
      this.workspaceRailWidth = this.settingsStore.setRailWidth(
        'workspace',
        clientX - this.railResizeBounds.left,
        this.railResizeBounds.width,
      );
      return;
    }
    this.explorerRailWidth = this.settingsStore.setRailWidth(
      'explorer',
      this.railResizeBounds.right - clientX,
      this.railResizeBounds.width,
    );
  }

  private clampRailWidth(
    target: RailResizeTarget,
    value: number,
    layoutWidth = Number.POSITIVE_INFINITY,
  ): number {
    this.settingsStore.workspaceRailWidth = this.workspaceRailWidth;
    this.settingsStore.explorerRailWidth = this.explorerRailWidth;
    return this.settingsStore.clampRailWidth(target, value, layoutWidth);
  }

  private clampEditorFontSize(value: number): number {
    return this.settingsStore.clampEditorFontSize(value);
  }

  setRightPanel(panel: RightPanel): void {
    this.activeRightPanel = panel;
    this.filesActionsMenuOpen = false;
  }

  toggleFilesActionsMenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.filesActionsMenuOpen = !this.filesActionsMenuOpen;
  }

  runFilesAction(action: FilesAction): void {
    this.filesActionsMenuOpen = false;
    switch (action) {
      case 'open-folder':
        void this.openDesktopWorkspace();
        return;
      case 'resume-workspace':
        void this.resumeRecentWorkspace();
        return;
      case 'trust-workspace':
        void this.trustDesktopWorkspace();
        return;
      case 'new-file':
        this.startNewFile();
        return;
      case 'review':
        this.requestPeerReview();
        return;
      case 'duplicate':
        this.duplicateActiveFile();
        return;
      case 'rename':
        this.renameActiveFile();
        return;
      case 'delete':
        void this.deleteActiveFile();
        return;
      case 'copy-path':
        this.copyActiveFilePath();
        return;
      case 'reveal-active-file':
        this.revealActiveFile();
        return;
      case 'assist':
        this.showAssistantPanel();
        return;
    }
  }

  selectIdeFile(path: string): void {
    this.clearGitComparison();
    if (this.renamingFilePath && this.renamingFilePath !== path) {
      this.cancelRename();
    }
    this.activeIdePath = path;
    this.activeChannelId = 'ide';
    this.activeChannelView = 'ide';
    this.activeRightPanel = 'files';
    if (this.isDesktop && this.workspace && this.activeIdeFile.workspaceFile) {
      if (this.activeIdeFile.status === 'saved') {
        void this.loadDesktopDocument(path);
      }
      this.ensureCppSourceSelection();
    }
  }

  updateFileQuery(event: Event): void {
    this.explorerStore.setQuery((event.target as HTMLInputElement).value, this.visibleIdeFiles);
  }

  clearFileQuery(): void {
    this.explorerStore.clearQuery(this.visibleIdeFiles);
  }

  openQuickOpen(): void {
    this.explorerStore.openQuickOpen(this.visibleIdeFiles, this.activeIdePath);
    this.openIde();
  }

  closeQuickOpen(): void {
    this.explorerStore.closeQuickOpen();
  }

  updateQuickOpenQuery(event: Event): void {
    this.explorerStore.updateQuickOpenQuery((event.target as HTMLInputElement).value);
  }

  moveQuickOpen(delta: number): void {
    this.explorerStore.moveQuickOpen(delta, this.visibleIdeFiles, this.activeIdePath);
  }

  selectQuickOpen(file = this.quickOpenResults[this.quickOpenIndex]): void {
    if (!file) {
      return;
    }
    this.closeQuickOpen();
    this.selectIdeFile(file.path);
  }

  quickOpenHint(file: IdeFile): string {
    const disk = file.missingOnDisk ? ' · MISSING' : '';
    return `${file.lang.toUpperCase()} · ${file.status.toUpperCase()}${disk}`;
  }

  toggleAssistantPanel(): void {
    this.assistantPanelOpen = !this.assistantPanelOpen;
  }

  showAssistantPanel(): void {
    this.assistantPanelOpen = true;
  }

  openTerminalFromMenu(): void {
    if (!this.isDesktop) {
      this.openConsolePanel('terminal');
      return;
    }
    if (!this.workspace) {
      this.workspaceNotice = 'OPEN A FOLDER BEFORE STARTING TERMINAL.';
      this.setRightPanel('settings');
      this.renderDesktopState();
      return;
    }
    if (!this.workspace.trusted) {
      this.terminalRequestedAfterTrust = true;
      this.workspaceTrustPromptOpen = true;
      this.workspaceNotice = 'TRUST WORKSPACE TO START TERMINAL.';
      this.renderDesktopState();
      return;
    }
    this.openConsolePanel('terminal');
  }

  openConsolePanel(panel: ConsolePanel): void {
    this.terminalPaneOpen = true;
    this.activeConsolePanel = panel;
  }

  keepWorkspaceReadOnly(): void {
    this.terminalRequestedAfterTrust = false;
    this.workspaceTrustPromptOpen = false;
    this.workspaceNotice = this.workspace
      ? `${this.workspace.name} · READ ONLY · TRUST FROM SETTINGS WHEN NEEDED`
      : 'NO WORKSPACE OPEN.';
    this.renderDesktopState();
  }

  async trustWorkspaceFromPrompt(): Promise<void> {
    await this.trustDesktopWorkspace();
  }

  updateActiveFile(content: string): void {
    if (this.homeMode) {
      return;
    }
    const file = this.activeIdeFile;
    file.lines = content.split('\n');
    this.runnerStore.clearDiagnosticsForPath(file.path);
    if (this.conflictCompareOpen) {
      this.refreshConflictComparison();
    }

    if (file.status === 'saved') {
      file.status = 'edited';
    }
    if (this.isDesktop && this.workspace?.trusted && file.workspaceFile) {
      this.scheduleRecoveryBuffer(file.path, content);
      this.scheduleAutoSave(file.path, content);
      this.scheduleLanguageDocumentSync(file);
    }
  }

  saveCurrentFile(): void {
    if (this.homeMode) {
      this.workspaceNotice = 'OPEN A FOLDER BEFORE SAVING WORKSPACE FILES.';
      this.renderDesktopState();
      return;
    }
    if (this.isDesktop && this.workspace) {
      void this.saveDesktopDocument();
      return;
    }
    const timestamp = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });

    this.activeIdeFile.status = 'saved';
    this.lastSavedAt = timestamp;
    this.runOutput = [
      `$ save ${this.activeIdeFile.name}`,
      `${this.activeIdeFile.path} written to workspace`,
      `saved at ${timestamp}`,
    ];
    this.lastRunTarget = this.activeIdeFile.name;
    this.activeConsolePanel = 'terminal';
  }

  @HostListener('window:keydown', ['$event'])
  handleEditorShortcut(event: KeyboardEvent): void {
    const primary = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();

    if (primary && key === 'p') {
      event.preventDefault();
      if (this.quickOpenVisible) {
        this.closeQuickOpen();
      } else {
        this.openQuickOpen();
      }
      return;
    }

    if (primary && key === 'f') {
      event.preventDefault();
      this.openEditorSearch();
      return;
    }

    if (primary && key === 'g') {
      event.preventDefault();
      this.openGoToLine();
      return;
    }

    if (primary && key === '/') {
      event.preventDefault();
      this.toggleShortcutPanel();
      return;
    }

    if (this.quickOpenVisible) {
      if (key === 'escape') {
        event.preventDefault();
        this.closeQuickOpen();
        return;
      }
      if (key === 'arrowdown') {
        event.preventDefault();
        this.moveQuickOpen(1);
        return;
      }
      if (key === 'arrowup') {
        event.preventDefault();
        this.moveQuickOpen(-1);
        return;
      }
      if (key === 'enter') {
        event.preventDefault();
        this.selectQuickOpen();
        return;
      }
    }

    if (this.goToLineOpen && key === 'escape') {
      event.preventDefault();
      this.closeGoToLine();
      return;
    }

    if (this.renameSymbolOpen && key === 'escape') {
      event.preventDefault();
      this.closeRenameSymbol();
      return;
    }

    if (this.codeActionMenuOpen && key === 'escape') {
      event.preventDefault();
      this.closeCodeActions();
      return;
    }

    if (this.shortcutPanelOpen && key === 'escape') {
      event.preventDefault();
      this.shortcutPanelOpen = false;
      return;
    }

    if (this.activeChannelView !== 'ide' || !primary || key !== 's') {
      return;
    }
    event.preventDefault();
    if (event.shiftKey && this.isDesktop) {
      void this.saveAllFiles();
      return;
    }
    this.saveCurrentFile();
  }

  async saveAllFiles(): Promise<void> {
    if (!this.workspace?.trusted || !window.codeyo) {
      this.workspaceNotice = 'TRUST WORKSPACE BEFORE WRITING SOURCE FILES.';
      this.renderDesktopState();
      return;
    }
    const dirtyFiles = this.dirtyWorkspaceFiles();
    let saved = 0;
    for (const file of dirtyFiles) {
      let result: FileWriteResult;
      try {
        result = await window.codeyo.files.write(this.workspace.id, {
          path: file.path,
          content: file.lines.join('\n'),
          diskVersion: file.diskVersion ?? '',
        });
      } catch (error) {
        this.activeIdePath = file.path;
        this.workspaceNotice = this.desktopError(error, `SAVE ALL FAILED · ${file.path}`);
        this.renderDesktopState();
        return;
      }
      if (result.conflict) {
        this.activeIdePath = file.path;
        this.fileConflict = {
          diskContent: result.diskContent ?? '',
          diskVersion: result.diskVersion,
          deleted: result.deleted,
        };
        this.workspaceNotice = `SAVE ALL PAUSED · EXTERNAL CHANGE CONFLICT · ${file.path}`;
        this.renderDesktopState();
        return;
      }
      file.diskVersion = result.diskVersion;
      file.status = 'saved';
      file.missingOnDisk = false;
      saved += 1;
    }
    this.lastSavedAt = this.currentTime();
    this.workspaceNotice = saved > 0
      ? `SAVED ${saved} BUFFERS · ${this.lastSavedAt}`
      : 'NO UNSAVED BUFFERS.';
    this.appendRecoveryRefreshWarning(await this.refreshFileWriteState());
    this.renderDesktopState();
  }

  applyMemoPatch(): void {
    this.activeIdePath = 'fib.py';
    this.activeIdeFile.lines = [
      'from functools import cache',
      '',
      '@cache',
      'def fib(n):',
      '    if n < 2:',
      '        return n',
      '    return fib(n - 1) + fib(n - 2)',
      '',
      'print("fib(40) =", fib(40))',
    ];
    this.activeIdeFile.status = 'edited';
    this.runOutput = [
      '$ apply patch review/memo',
      'inserted functools.cache decorator',
      'duplicate recursion now cached',
      'run again to compare speed',
    ];
    this.lastRunTarget = 'fib.py';
    this.activeConsolePanel = 'terminal';
    this.runShared = false;
    this.assistantNotice = 'Patch applied from the local review demo. Verify it with Run or Tests.';
  }

  setConsolePanel(panel: ConsolePanel): void {
    this.openConsolePanel(panel);
  }

  showAllProblems(): void {
    this.problemFilter = 'all';
    this.problemSourceFilter = 'all';
  }

  setProblemFilter(filter: 'all' | 'active'): void {
    this.problemFilter = filter;
  }

  setProblemSourceFilter(filter: 'all' | 'run' | 'lsp' | 'spell'): void {
    this.problemSourceFilter = this.problemSourceFilter === filter && filter !== 'all' ? 'all' : filter;
  }

  updateEditorCursor(position: { line: number; column: number }): void {
    this.editorCursorLine = position.line;
    this.editorCursorColumn = position.column;
  }

  openEditorSearch(): void {
    this.editorSearchRequest += 1;
  }

  goToDefinitionAtCursor(): void {
    this.editorDefinitionRequest += 1;
  }

  async openDefinition(position: EditorLanguagePosition): Promise<void> {
    if (!this.workspace?.trusted || !window.codeyo?.language || !this.isTrustedWorkspaceFile(this.activeIdeFile)) {
      this.workspaceNotice = 'TRUSTED WORKSPACE FILE REQUIRED FOR GO TO DEFINITION.';
      this.renderDesktopState();
      return;
    }
    try {
      const result = await window.codeyo.language.definition(
        this.workspace.id,
        this.languageRequestFor(this.activeIdeFile, position),
      );
      const location = result.locations[0];
      if (!result.available || !location) {
        this.workspaceNotice = `NO DEFINITION FOUND · ${this.activeIdeFile.path}`;
        this.renderDesktopState();
        return;
      }
      await this.openLanguageLocation(location);
    } catch (error) {
      this.workspaceNotice = this.desktopError(error, `GO TO DEFINITION FAILED · ${this.activeIdeFile.path}`);
      this.renderDesktopState();
    }
  }

  async formatActiveDocument(): Promise<void> {
    const file = this.activeIdeFile;
    if (this.homeMode || !this.workspace?.trusted || !window.codeyo?.language || !this.isTrustedWorkspaceFile(file)) {
      this.workspaceNotice = 'TRUSTED WORKSPACE FILE REQUIRED FOR FORMAT.';
      this.renderDesktopState();
      return;
    }
    let result: LanguageFormatResult;
    try {
      result = await window.codeyo.language.formatDocument(this.workspace.id, this.languageDocumentFor(file));
    } catch (error) {
      this.workspaceNotice = this.desktopError(error, `FORMAT FAILED · ${file.path}`);
      this.renderDesktopState();
      return;
    }
    if (!result.available) {
      this.workspaceNotice = `FORMAT UNAVAILABLE · ${this.formatUnavailableReason(result.reason)} · ${file.path}`;
      this.renderDesktopState();
      return;
    }
    const before = file.lines.join('\n');
    const after = result.edit ? applyTextEdits(before, result.edit.edits) : before;
    if (after === before) {
      this.workspaceNotice = `ALREADY FORMATTED · ${file.path}`;
      this.renderDesktopState();
      return;
    }
    this.updateActiveFile(after);
    this.workspaceNotice = `FORMATTED · ${file.path}`;
    this.renderDesktopState();
  }

  private formatUnavailableReason(reason?: string): string {
    switch (reason) {
      case 'missing-tool':
        return 'FORMATTER TOOL NOT FOUND';
      case 'python-formatter-unconfigured':
        return 'PYTHON FORMATTER NOT CONFIGURED';
      default:
        return (reason || 'UNSUPPORTED').toUpperCase();
    }
  }

  openRenameSymbol(): void {
    const file = this.activeIdeFile;
    if (this.homeMode || !this.workspace?.trusted || !window.codeyo?.language || !this.isTrustedWorkspaceFile(file)) {
      this.workspaceNotice = 'TRUSTED WORKSPACE FILE REQUIRED FOR RENAME.';
      this.renderDesktopState();
      return;
    }
    this.closeCodeActions();
    this.renameSymbolDraft = '';
    this.renameSymbolOpen = true;
  }

  updateRenameSymbolDraft(event: Event): void {
    this.renameSymbolDraft = (event.target as HTMLInputElement).value;
  }

  closeRenameSymbol(): void {
    this.renameSymbolOpen = false;
    this.renameSymbolDraft = '';
  }

  async submitRenameSymbol(): Promise<void> {
    const file = this.activeIdeFile;
    const newName = this.renameSymbolDraft.trim();
    if (!newName) {
      this.workspaceNotice = 'RENAME NEEDS A NEW NAME.';
      this.renderDesktopState();
      return;
    }
    if (!this.workspace?.trusted || !window.codeyo?.language || !this.isTrustedWorkspaceFile(file)) {
      this.workspaceNotice = 'TRUSTED WORKSPACE FILE REQUIRED FOR RENAME.';
      this.renderDesktopState();
      return;
    }
    const request = this.languageRequestFor(file, { line: this.editorCursorLine, column: this.editorCursorColumn });
    let result: LanguageRenameResult;
    try {
      result = await window.codeyo.language.renameSymbol(this.workspace.id, request, newName);
    } catch (error) {
      this.workspaceNotice = this.desktopError(error, `RENAME FAILED · ${file.path}`);
      this.renderDesktopState();
      return;
    }
    if (!result.available || !result.edit) {
      this.workspaceNotice = `RENAME UNAVAILABLE · ${this.languageActionReason(result.reason)} · ${file.path}`;
      this.renderDesktopState();
      return;
    }
    this.closeRenameSymbol();
    await this.applyLanguageWorkspaceEdit(result.edit, `RENAMED TO ${newName}`);
  }

  async requestCodeActions(): Promise<void> {
    const file = this.activeIdeFile;
    if (this.homeMode || !this.workspace?.trusted || !window.codeyo?.language || !this.isTrustedWorkspaceFile(file)) {
      this.workspaceNotice = 'TRUSTED WORKSPACE FILE REQUIRED FOR CODE ACTIONS.';
      this.renderDesktopState();
      return;
    }
    this.closeRenameSymbol();
    const request = this.languageRequestFor(file, { line: this.editorCursorLine, column: this.editorCursorColumn });
    let result: LanguageCodeActionResult;
    try {
      result = await window.codeyo.language.codeActions(this.workspace.id, request);
    } catch (error) {
      this.workspaceNotice = this.desktopError(error, `CODE ACTIONS FAILED · ${file.path}`);
      this.renderDesktopState();
      return;
    }
    if (!result.available) {
      this.workspaceNotice = `CODE ACTIONS UNAVAILABLE · ${this.languageActionReason(result.reason)} · ${file.path}`;
      this.renderDesktopState();
      return;
    }
    this.codeActionItems = result.actions;
    if (!this.codeActionItems.length) {
      this.codeActionMenuOpen = false;
      this.workspaceNotice = `NO CODE ACTIONS · ${file.path}:${this.editorCursorLine}`;
      this.renderDesktopState();
      return;
    }
    this.codeActionMenuOpen = true;
    this.renderDesktopState();
  }

  closeCodeActions(): void {
    this.codeActionMenuOpen = false;
    this.codeActionItems = [];
  }

  async applyCodeAction(action: LanguageCodeAction): Promise<void> {
    this.codeActionMenuOpen = false;
    if (!action?.edit) {
      this.workspaceNotice = 'CODE ACTION HAS NO APPLICABLE EDIT.';
      this.renderDesktopState();
      return;
    }
    await this.applyLanguageWorkspaceEdit(action.edit, `APPLIED · ${action.title}`);
  }

  private languageActionReason(reason?: string): string {
    switch (reason) {
      case 'missing-tool':
        return 'LANGUAGE TOOL NOT FOUND';
      case 'missing-new-name':
        return 'NEW NAME REQUIRED';
      case 'no-rename-edits':
        return 'NO RENAME LOCATIONS';
      default:
        return (reason || 'UNSUPPORTED').toUpperCase();
    }
  }

  // Applies a multi-file workspace edit to in-memory buffers and marks every
  // touched file dirty for the user to review and Save All. Nothing is written
  // to disk here; clean files are re-read so edits land on the same content the
  // language server computed them against, while dirty buffers keep their text.
  private async applyLanguageWorkspaceEdit(edit: LanguageWorkspaceEdit, label: string): Promise<void> {
    if (!this.workspace || !window.codeyo) {
      return;
    }
    const byPath = groupTextEditsByPath(edit.edits);
    let changedFiles = 0;
    let changedEdits = 0;
    const skipped: string[] = [];
    for (const [path, edits] of byPath) {
      const file = this.ideFiles.find((candidate) => candidate.path === path);
      if (!file || !file.workspaceFile) {
        skipped.push(path);
        continue;
      }
      let base: string;
      if (file.status === 'edited' || file.status === 'new') {
        base = file.lines.join('\n');
      } else {
        try {
          const document = await window.codeyo.files.read(this.workspace.id, path);
          base = document.content;
          file.diskVersion = document.diskVersion;
          file.lang = document.language;
          file.missingOnDisk = false;
        } catch (error) {
          this.workspaceNotice = this.desktopError(error, `${label} READ FAILED · ${path}`);
          this.renderDesktopState();
          return;
        }
      }
      const next = applyTextEdits(base, edits);
      if (next === base) {
        continue;
      }
      file.lines = next.split('\n');
      if (file.status === 'saved') {
        file.status = 'edited';
      }
      this.runnerStore.clearDiagnosticsForPath(file.path);
      if (this.workspace.trusted) {
        this.scheduleRecoveryBuffer(file.path, next);
        this.syncLanguageDocument(file, 'change');
      }
      changedFiles += 1;
      changedEdits += edits.length;
    }
    if (!changedFiles) {
      this.workspaceNotice = `${label} · NO CHANGES`;
      this.renderDesktopState();
      return;
    }
    if (this.conflictCompareOpen) {
      this.refreshConflictComparison();
    }
    const skippedNote = skipped.length ? ` · SKIPPED ${skipped.length} OUTSIDE WORKSPACE` : '';
    this.workspaceNotice = `${label} · ${changedEdits} EDITS IN ${changedFiles} FILES · REVIEW AND SAVE ALL${skippedNote}`;
    this.renderDesktopState();
  }

  openGoToLine(): void {
    if (this.homeMode) {
      return;
    }
    this.goToLineDraft = String(this.editorCursorLine || 1);
    this.goToLineOpen = true;
  }

  updateGoToLineDraft(event: Event): void {
    this.goToLineDraft = (event.target as HTMLInputElement).value;
  }

  closeGoToLine(): void {
    this.goToLineOpen = false;
    this.goToLineDraft = '';
  }

  submitGoToLine(): void {
    const requested = Number.parseInt(this.goToLineDraft, 10);
    if (!Number.isFinite(requested)) {
      this.workspaceNotice = 'GO TO LINE NEEDS A LINE NUMBER.';
      this.renderDesktopState();
      return;
    }
    const line = Math.min(Math.max(1, requested), Math.max(1, this.activeIdeFile.lines.length));
    this.diagnosticRevealLine = line;
    this.diagnosticRevealColumn = 1;
    this.diagnosticRevealRequest += 1;
    this.editorCursorLine = line;
    this.editorCursorColumn = 1;
    this.closeGoToLine();
  }

  toggleShortcutPanel(): void {
    this.shortcutPanelOpen = !this.shortcutPanelOpen;
  }

  confirmAction(request: ConfirmDialogRequest): Promise<boolean> {
    if (this.confirmDialogResolver) {
      this.confirmDialogResolver(false);
    }
    this.confirmDialog = request;
    this.renderDesktopState();
    return new Promise((resolve) => {
      this.confirmDialogResolver = resolve;
    });
  }

  confirmDialogAccept(): void {
    this.closeConfirmDialog(true);
  }

  confirmDialogCancel(): void {
    this.closeConfirmDialog(false);
  }

  private closeConfirmDialog(confirmed: boolean): void {
    const resolver = this.confirmDialogResolver;
    this.confirmDialogResolver = null;
    this.confirmDialog = null;
    resolver?.(confirmed);
    this.renderDesktopState();
  }

  setEditorDensity(density: EditorDensity): void {
    this.settingsStore.setEditorDensity(density);
    this.editorDensity = this.settingsStore.editorDensity;
  }

  updateEditorFontSize(event: Event): void {
    this.setEditorFontSize(Number((event.target as HTMLInputElement).value));
  }

  stepEditorFontSize(delta: number): void {
    this.setEditorFontSize(this.editorFontSizePx + delta);
  }

  resetEditorFontSize(): void {
    this.settingsStore.resetEditorFontSize();
    this.editorFontSizePx = this.settingsStore.editorFontSizePx;
  }

  setEditorFontSize(value: number): void {
    this.settingsStore.setEditorFontSize(value);
    this.editorFontSizePx = this.settingsStore.editorFontSizePx;
  }

  setEditorFont(id: EditorFontId): void {
    this.settingsStore.setEditorFont(id);
    this.editorFontId = this.settingsStore.editorFontId;
  }

  setEditorTheme(id: EditorThemeId): void {
    this.settingsStore.setEditorTheme(id);
    this.editorThemeId = this.settingsStore.editorThemeId;
  }

  toggleAutoSave(): void {
    this.setAutoSave(!this.autoSaveEnabled);
  }

  setAutoSave(enabled: boolean): void {
    this.projectSettingsStore.update(this.workspace, 'autoSaveEnabled', enabled);
    if (!this.autoSaveEnabled) {
      for (const timer of this.autoSaveTimers.values()) {
        clearTimeout(timer);
      }
      this.autoSaveTimers.clear();
    }
    this.workspaceNotice = this.autoSaveEnabled
      ? `AUTO-SAVE ENABLED · ${this.autoSaveDelayMs / 1000}s DEBOUNCE`
      : 'AUTO-SAVE DISABLED';
    this.writeWorkspaceBooleanSetting('auto-save', this.autoSaveEnabled);
    this.renderDesktopState();
  }

  setLspDiagnostics(enabled: boolean): void {
    this.lspDiagnosticsEnabled = enabled;
    this.projectSettingsStore.update(this.workspace, 'lspDiagnosticsEnabled', enabled);
    this.writeWorkspaceBooleanSetting('lsp-diagnostics', enabled);
    if (!enabled) {
      this.lspDiagnostics = [];
    } else {
      this.syncActiveLanguageDocument('change');
    }
    this.workspaceNotice = enabled ? 'LSP DIAGNOSTICS ENABLED' : 'LSP DIAGNOSTICS DISABLED';
    this.renderDesktopState();
  }

  setAutocomplete(enabled: boolean): void {
    this.autocompleteEnabled = enabled;
    this.projectSettingsStore.update(this.workspace, 'autocompleteEnabled', enabled);
    this.writeWorkspaceBooleanSetting('autocomplete', enabled);
    this.workspaceNotice = enabled ? 'AUTOCOMPLETE ENABLED' : 'AUTOCOMPLETE DISABLED';
    this.renderDesktopState();
  }

  setSpellCheck(enabled: boolean): void {
    this.spellCheckEnabled = enabled;
    this.projectSettingsStore.update(this.workspace, 'spellCheckEnabled', enabled);
    this.writeWorkspaceBooleanSetting('spell-check', enabled);
    if (!enabled) {
      this.spellDiagnostics = [];
    } else {
      this.syncActiveLanguageDocument('change');
    }
    this.workspaceNotice = enabled ? 'SPELL CHECK ENABLED' : 'SPELL CHECK DISABLED';
    this.renderDesktopState();
  }

  setFormatOnSave(enabled: boolean): void {
    this.projectSettingsStore.update(this.workspace, 'formatOnSaveEnabled', enabled);
    this.workspaceNotice = enabled
      ? 'FORMAT ON SAVE ENABLED · FORMATTER REQUIRED'
      : 'FORMAT ON SAVE DISABLED';
    this.renderDesktopState();
  }

  updatePythonFormatter(event: Event): void {
    this.projectSettingsStore.update(
      this.workspace,
      'pythonFormatterCommand',
      (event.target as HTMLInputElement).value,
    );
    this.workspaceNotice = this.pythonFormatterCommand
      ? `PYTHON FORMATTER · ${this.pythonFormatterCommand}`
      : 'PYTHON FORMATTER CLEARED';
    this.renderDesktopState();
  }

  async openDiagnostic(diagnostic: EditorDiagnostic): Promise<void> {
    const file = this.ideFiles.find((candidate) => candidate.path === diagnostic.path);
    if (!file) {
      this.workspaceNotice = `DIAGNOSTIC FILE NOT FOUND · ${diagnostic.path}`;
      this.renderDesktopState();
      return;
    }
    this.activeIdePath = file.path;
    this.activeChannelId = 'ide';
    this.activeChannelView = 'ide';
    this.activeRightPanel = 'files';
    if (this.isDesktop && this.workspace && file.workspaceFile && file.status === 'saved') {
      await this.loadDesktopDocument(file.path);
    }
    this.diagnosticRevealLine = diagnostic.line;
    this.diagnosticRevealColumn = diagnostic.column ?? 1;
    this.diagnosticRevealRequest += 1;
    this.activeConsolePanel = 'problems';
    this.renderDesktopState();
  }

  toggleWorkspace(): void {
    this.workspaceExpanded = !this.workspaceExpanded;
  }

  toggleSrc(): void {
    this.srcExpanded = !this.srcExpanded;
  }

  toggleExplorerFolder(folderPath: string): void {
    this.explorerStore.toggleFolder(folderPath, this.visibleIdeFiles);
    this.renderDesktopState();
  }

  startNewFile(): void {
    this.workspaceExpanded = true;
    this.explorerStore.clearQuery(this.visibleIdeFiles);
    this.creatingFile = true;
    this.newFileName = '';
    this.rebuildExplorerTree();
  }

  updateNewFileName(event: Event): void {
    this.newFileName = (event.target as HTMLInputElement).value;
  }

  cancelNewFile(): void {
    this.creatingFile = false;
    this.newFileName = '';
    this.rebuildExplorerTree();
  }

  updateRenameDraft(event: Event): void {
    this.renameDraft = (event.target as HTMLInputElement).value;
  }

  cancelRename(): void {
    this.renamingFilePath = '';
    this.renameDraft = '';
  }

  commitRename(): void {
    const previousPath = this.renamingFilePath || this.activeIdeFile.path;
    const nextPath = this.renameDraft.trim();
    if (!nextPath || nextPath === previousPath) {
      this.cancelRename();
      return;
    }
    if (this.ideFiles.some((file) => file.path === nextPath && file.path !== previousPath)) {
      this.workspaceNotice = `RENAME FAILED · ${nextPath} ALREADY EXISTS`;
      this.renderDesktopState();
      return;
    }
    if (this.isDesktop && this.workspace) {
      this.cancelRename();
      void this.renameDesktopFile(nextPath);
      return;
    }

    const file = this.ideFiles.find((candidate) => candidate.path === previousPath);
    if (!file) {
      this.cancelRename();
      return;
    }
    file.path = nextPath;
    file.name = nextPath.split(/[\\/]/).pop() || nextPath;
    file.lang = this.languageForPath(nextPath);
    this.activeIdePath = nextPath;
    this.cancelRename();
    this.rebuildExplorerTree();
    this.workspaceNotice = `RENAMED FILE · ${previousPath} -> ${nextPath}`;
  }

  createFile(): void {
    const requestedName = this.newFileName.trim() || 'solution.py';
    const name = this.ideFiles.some((file) => file.name === requestedName)
      ? `draft-${this.ideFiles.length + 1}.py`
      : requestedName;
    const lang = /\.(cpp|cc|cxx)$/i.test(name) ? 'cpp' : name.endsWith('.md') ? 'text' : 'python';
    if (this.isDesktop && this.workspace) {
      const content = lang === 'cpp'
        ? '#include <iostream>\n\nint main() {\n    std::cout << \"hello\" << std::endl;\n    return 0;\n}\n'
        : lang === 'python' ? 'def main():\n    pass\n\nmain()\n' : '# New note\n';
      void this.createDesktopFile(name, content);
      return;
    }

    this.ideFiles.push({
      name,
      path: name,
      lang,
      status: 'new',
      builtIn: false,
      lines:
        lang === 'text'
          ? ['# New note', '', 'Write your thought here.']
          : lang === 'cpp'
            ? ['#include <iostream>', '', 'int main() {', '    return 0;', '}']
            : ['def solve():', '    pass', '', 'print(solve())'],
    });
    this.rebuildExplorerTree();
    this.creatingFile = false;
    this.newFileName = '';
    this.explorerStore.clearQuery(this.visibleIdeFiles);
    this.selectIdeFile(name);
    this.runOutput = [`$ touch ${name}`, 'new buffer created', 'ready for collaboration'];
    this.activeConsolePanel = 'terminal';
  }

  duplicateActiveFile(): void {
    if (this.isDesktop && this.workspace) {
      const source = this.activeIdeFile;
      const dotIndex = source.name.lastIndexOf('.');
      const stem = dotIndex > 0 ? source.name.slice(0, dotIndex) : source.name;
      const ext = dotIndex > 0 ? source.name.slice(dotIndex) : '';
      void this.createDesktopFile(`${stem}-copy${ext}`, this.activeEditorText);
      return;
    }
    const source = this.activeIdeFile;
    const dotIndex = source.name.lastIndexOf('.');
    const stem = dotIndex > 0 ? source.name.slice(0, dotIndex) : source.name;
    const ext = dotIndex > 0 ? source.name.slice(dotIndex) : '';
    let name = `${stem}-copy${ext}`;
    let version = 2;

    while (this.ideFiles.some((file) => file.name === name)) {
      name = `${stem}-copy-${version}${ext}`;
      version += 1;
    }

    this.ideFiles.push({
      name,
      path: name,
      lang: source.lang,
      status: 'new',
      builtIn: false,
      lines: [...source.lines],
    });
    this.rebuildExplorerTree();
    this.selectIdeFile(name);
    this.runOutput = [`$ duplicate ${source.name}`, `created ${name}`, 'ready for editing'];
    this.activeConsolePanel = 'terminal';
  }

  async deleteActiveFile(): Promise<void> {
    if (!this.canDeleteActiveFile) {
      return;
    }

    if (this.isDesktop && this.workspace) {
      if (this.activeIdeFile.status !== 'saved' || this.activeIdeFile.missingOnDisk) {
        this.workspaceNotice = `SAVE OR RESOLVE BUFFER BEFORE DELETING · ${this.activeIdeFile.path}`;
        this.renderDesktopState();
        return;
      }
      if (await this.confirmAction({
        title: 'Delete file?',
        message: `Delete ${this.activeIdeFile.path} from this workspace?`,
        details: 'This cannot be undone.',
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        variant: 'danger',
      })) {
        void this.removeDesktopFile();
      }
      return;
    }
    const deleted = this.activeIdeFile.name;
    const index = this.ideFiles.findIndex((file) => file.path === this.activeIdePath);
    this.ideFiles.splice(index, 1);
    this.rebuildExplorerTree();
    this.activeIdePath = this.ideFiles[0].path;
    this.runOutput = [`$ delete ${deleted}`, 'buffer removed from workspace', `opened ${this.activeIdeFile.name}`];
    this.activeConsolePanel = 'terminal';
  }

  renameActiveFile(): void {
    if (this.isDesktop && (!this.workspace?.trusted || !window.codeyo)) {
      return;
    }
    if (this.isDesktop && this.activeIdeFile.status !== 'saved') {
      this.workspaceNotice = `SAVE BUFFER BEFORE RENAMING · ${this.activeIdeFile.path}`;
      this.renderDesktopState();
      return;
    }
    if (!this.canDeleteActiveFile) {
      return;
    }
    this.renamingFilePath = this.activeIdeFile.path;
    this.renameDraft = this.activeIdeFile.path;
    this.revealActiveFile(false);
  }

  copyActiveFilePath(): void {
    const filePath = this.activeIdeFile.path;
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (clipboard?.writeText) {
      void clipboard.writeText(filePath)
        .then(() => {
          this.workspaceNotice = `COPIED PATH · ${filePath}`;
          this.renderDesktopState();
        })
        .catch(() => {
          this.workspaceNotice = `PATH · ${filePath}`;
          this.renderDesktopState();
        });
      return;
    }
    this.workspaceNotice = `PATH · ${filePath}`;
    this.renderDesktopState();
  }

  revealActiveFile(showNotice = true): void {
    this.workspaceExpanded = true;
    this.explorerStore.expandParents([this.activeIdeFile]);
    this.rebuildExplorerTree();
    setTimeout(() => {
      const rows = Array.from(document.querySelectorAll<HTMLElement>('.tree-node.file[data-path]'));
      const row = rows.find((element) => element.getAttribute('data-path') === this.activeIdeFile.path);
      if (typeof row?.scrollIntoView === 'function') {
        row.scrollIntoView({ block: 'nearest' });
      }
    });
    if (showNotice) {
      this.workspaceNotice = `REVEALED FILE · ${this.activeIdeFile.path}`;
      this.renderDesktopState();
    }
  }

  clearTerminal(): void {
    this.runOutput = ['$ terminal cleared', 'ready >'];
    this.activeConsolePanel = 'terminal';
  }

  updateTerminalCommand(event: Event): void {
    this.terminalCommand = (event.target as HTMLInputElement).value;
  }

  executeTerminalCommand(): void {
    const command = this.terminalCommand.trim();
    if (!command) {
      return;
    }

    this.terminalCommand = '';
    this.activeConsolePanel = 'terminal';
    const normalized = command.toLowerCase();

    if (normalized === 'clear') {
      this.clearTerminal();
      return;
    }

    if (normalized === 'help') {
      this.runOutput = [
        '$ help',
        'python <file> · pytest · open <file> · save',
        'new <file> · review · share · clear',
      ];
      return;
    }

    if (normalized === 'pytest' || normalized === 'pytest tests.py') {
      this.selectIdeFile('tests.py');
      this.runTests();
      return;
    }

    if (normalized === 'save') {
      this.saveCurrentFile();
      return;
    }

    if (normalized === 'share') {
      this.shareRunToThread();
      return;
    }

    if (normalized === 'review') {
      this.requestPeerReview();
      return;
    }

    const openMatch = command.match(/^open\s+(.+)$/i);
    if (openMatch) {
      const file = this.findIdeFile(openMatch[1]);
      if (file) {
        this.selectIdeFile(file.path);
        this.runOutput = [`$ ${command}`, `opened ${file.name}`, `${file.lines.length} lines · ${file.status}`];
      } else {
        this.runOutput = [`$ ${command}`, 'file not found · try help'];
      }
      return;
    }

    const newMatch = command.match(/^new\s+(.+)$/i);
    if (newMatch) {
      this.newFileName = newMatch[1].trim();
      this.createFile();
      return;
    }

    const runMatch = command.match(/^python\s+(.+)$/i);
    if (runMatch) {
      const file = this.findIdeFile(runMatch[1]);
      if (file) {
        this.selectIdeFile(file.path);
        this.runCode();
      } else {
        this.runOutput = [`$ ${command}`, 'file not found · try open fib.py'];
      }
      return;
    }

    this.runOutput = [`$ ${command}`, 'command not found · enter help'];
  }

  runTests(): void {
    if (this.isDesktop && this.workspace) {
      const testFile = this.ideFiles.find((file) => file.name === 'tests.py');
      if (testFile) {
        void this.runDesktopProfile({
          id: 'python-tests',
          name: 'Python Tests',
          language: 'python',
          entryFile: testFile.path,
        });
      }
      return;
    }
    const timestamp = this.currentTime();
    this.activeConsolePanel = 'terminal';
    this.runShared = false;
    this.lastRunTarget = 'tests.py';

    if (this.hasMemoizedFib && this.hasLargeValueTest) {
      this.lastRunSummary = '4 checks passed · memo path verified';
      this.runOutput = [
        '$ pytest tests.py',
        '1 test passed · 4 assertions',
        'memo path verified · fib(40) fast',
        `done at ${timestamp}`,
      ];
      return;
    }

    if (this.hasMemoizedFib) {
      this.lastRunSummary = '3 checks passed · large input not covered';
      this.runOutput = [
        '$ pytest tests.py',
        '1 test passed · 3 assertions',
        'suggestion: add fib(40) to verify memo speed',
        'review: add fib(40) to cover the memo path',
      ];
      return;
    }

    this.lastRunSummary = '3 checks passed · performance warning';
    this.runOutput = [
      '$ pytest tests.py',
      '1 test passed · 3 assertions',
      'performance: fib(40) repeats work',
      'review: add memoization before submitting',
    ];
  }

  performAssistantAction(): void {
    this.assistantPanelOpen = true;

    if (this.activeIdeFile.name === 'fib.py') {
      if (!this.hasMemoizedFib) {
        this.applyMemoPatch();
        return;
      }

      this.activeConsolePanel = 'output';
      this.assistantNotice = 'Memo 将 n 作为 key 保存 fib(n)。fib(40) 只需首次计算 0 到 40。';
      return;
    }

    if (this.activeIdeFile.name === 'tests.py') {
      if (!this.hasLargeValueTest) {
        this.activeIdeFile.lines.push(
          '',
          'def test_large_value():',
          '    assert fib(40) == 102334155',
        );
        this.activeIdeFile.status = 'edited';
        this.runOutput = [
          '$ apply patch review/tests',
          'added test_large_value for fib(40)',
          'run tests to verify memo path',
        ];
        this.activeConsolePanel = 'terminal';
        this.assistantNotice = 'Large input test added. Run Tests now covers the memo path.';
        return;
      }

      this.runTests();
      return;
    }

    this.activeConsolePanel = 'problems';
    this.assistantNotice =
      this.activeIdeFile.name === 'notes.md'
        ? 'Review note: add one key/value sentence so memo maps clearly to a dictionary.'
        : 'Review note: implement solve(), then verify from the terminal.';
  }

  shareRunToThread(): void {
    if (this.isDesktop && this.workspace) {
      void this.shareDesktopRun();
      return;
    }
    const timestamp = this.currentTime();
    this.threadUpdates.unshift({
      file: this.lastRunTarget,
      result: this.lastRunSummary,
      time: timestamp,
      kind: 'run',
    });
    this.runShared = true;
    this.selectChannel('run-log');
  }

  requestPeerReview(): void {
    if (this.isDesktop && this.workspace) {
      void this.createDesktopReview();
      return;
    }
    const file = this.activeIdeFile;
    this.threadUpdates.unshift({
      file: file.path,
      result: `${file.lines.length} lines · ${this.activeSaveLabel}`,
      time: this.currentTime(),
      kind: 'review',
    });
    this.selectChannel('snapshots');
  }

  openSharedBuffer(path: string): void {
    if (this.ideFiles.some((file) => file.path === path)) {
      this.activeIdePath = path;
    }

    this.openIde();
  }

  runCode(): void {
    if (this.isDesktop && this.workspace) {
      void this.runDesktopFile();
      return;
    }
    const timestamp = this.currentTime();
    this.activeConsolePanel = 'terminal';
    this.runShared = false;

    if (this.activeIdeFile.name === 'notes.md') {
      this.lastRunTarget = 'notes.md';
      this.lastRunSummary = 'markdown preview refreshed';
      this.runOutput = [
        '$ preview notes.md',
        'rendered memo notes · 7 lines',
        'linked review note: memo glossary',
        `done at ${timestamp}`,
      ];
      return;
    }

    if (this.activeIdeFile.name === 'tests.py') {
      this.runTests();
      return;
    }

    if (this.activeIdeFile.name !== 'fib.py') {
      this.lastRunTarget = this.activeIdeFile.name;
      this.lastRunSummary = `${this.activeIdeFile.name} executed · draft buffer`;
      this.runOutput = [
        `$ python ${this.activeIdeFile.name}`,
        this.activeEditorText.includes('pass') ? 'solve() = None' : 'process exited successfully',
        'draft buffer executed · no tests attached',
        `done at ${timestamp}`,
      ];
      return;
    }

    this.lastRunTarget = 'fib.py';
    if (!this.activeEditorText.includes('def fib')) {
      this.lastRunSummary = 'failed · fib is not defined';
      this.runOutput = [
        '$ python fib.py',
        'NameError: fib is not defined',
        'review: keep def fib(n), then change the recursive body.',
        `failed at ${timestamp}`,
      ];
      return;
    }

    if (!this.hasMemoizedFib) {
      this.lastRunSummary = 'warning · repeated recursion detected';
      this.runOutput = [
        '$ python fib.py',
        'fib(40) = 102334155',
        'warning: repeated recursion detected · ~1.6e8 calls',
        'review: add memoization and rerun tests',
        `done at ${timestamp}`,
      ];
      return;
    }

    this.lastRunSummary = 'memo hits: 38 · done in 0.0002s';
    this.runOutput = [
      '$ python fib.py',
      'fib(40) = 102334155',
      'memo hits: 38 · cache size: 41',
      `done at ${timestamp}`,
    ];
  }

  cancelPendingRun(): void {
    this.runnerStore.clearPendingRun();
    this.workspaceNotice = 'RUN CANCELLED.';
    this.renderDesktopState();
  }

  async saveAndRunPending(): Promise<void> {
    const profile = this.pendingRunProfile;
    if (!profile) {
      return;
    }
    const runInputs = new Set([profile.entryFile, ...(profile.sourceFiles ?? [])]);
    const dirtyInputs = this.ideFiles.filter(
      (file) => runInputs.has(file.path) && file.workspaceFile && file.status !== 'saved',
    );
    for (const file of dirtyInputs) {
      await this.saveDesktopDocument(file.path);
      if (file.status !== 'saved') {
        this.workspaceNotice = `SAVE AND RUN PAUSED · ${file.path}`;
        this.renderDesktopState();
        return;
      }
    }
    this.runnerStore.clearPendingRun();
    await this.runDesktopProfile(profile);
  }

  private findIdeFile(name: string): IdeFile | undefined {
    const requested = name.trim().toLowerCase();
    return this.ideFiles.find((file) =>
      file.name.toLowerCase() === requested || file.path.toLowerCase() === requested);
  }

  private languageForPath(filePath: string): EditorLanguage {
    if (filePath.endsWith('.py')) {
      return 'python';
    }
    return /\.(cpp|cc|cxx|hpp|h)$/i.test(filePath) ? 'cpp' : 'text';
  }

  private setPythonExecutable(command: string): void {
    this.pythonExecutable = command;
    this.environmentChecks = [];
    this.projectSettingsStore.update(this.workspace, 'pythonCommand', command);
    this.writeWorkspaceStringSetting('python-command', command);
  }

  private setCppExecutable(command: string): void {
    this.cppExecutable = command;
    this.environmentChecks = [];
    this.projectSettingsStore.update(this.workspace, 'cppCommand', command);
    this.writeWorkspaceStringSetting('cpp-command', command);
  }

  private dirtyWorkspaceFiles(): IdeFile[] {
    return this.workspaceStore.dirtyWorkspaceFiles(this.ideFiles);
  }

  private scheduleRecoveryBuffer(filePath: string, content: string): void {
    if (!this.workspace?.trusted || !window.codeyo) {
      return;
    }
    const workspaceId = this.workspace.id;
    clearTimeout(this.recoveryTimers.get(filePath));
    this.recoveryTimers.set(filePath, setTimeout(() => {
      this.recoveryTimers.delete(filePath);
      void this.backupRecoveryBuffer(workspaceId, filePath, content);
    }, 450));
  }

  private async backupRecoveryBuffer(workspaceId: string, filePath: string, content: string): Promise<void> {
    try {
      await window.codeyo?.files.backupRecovery(workspaceId, filePath, content);
      if (this.workspace?.id === workspaceId) {
        await this.refreshRecoveries();
      }
    } catch (error) {
      if (this.workspace?.id === workspaceId) {
        this.workspaceNotice = this.desktopError(error, 'RECOVERY BACKUP FAILED');
        this.renderDesktopState();
      }
    }
  }

  private scheduleAutoSave(filePath: string, expectedContent: string): void {
    if (!this.autoSaveEnabled || !this.workspace?.trusted || !window.codeyo) {
      return;
    }
    clearTimeout(this.autoSaveTimers.get(filePath));
    this.autoSaveTimers.set(filePath, setTimeout(() => {
      this.autoSaveTimers.delete(filePath);
      void this.saveDesktopDocument(filePath, {
        expectedContent,
        reason: 'auto',
      });
    }, this.autoSaveDelayMs));
  }

  private clearWorkspaceTimers(): void {
    for (const timer of this.recoveryTimers.values()) {
      clearTimeout(timer);
    }
    this.recoveryTimers.clear();
    for (const timer of this.autoSaveTimers.values()) {
      clearTimeout(timer);
    }
    this.autoSaveTimers.clear();
    this.languageStore.clearChangeTimers();
  }

  private syncActiveLanguageDocument(action: 'open' | 'change'): void {
    this.syncLanguageDocument(this.activeIdeFile, action);
  }

  private syncLanguageDocument(file: IdeFile, action: 'open' | 'change'): void {
    if (!this.workspace?.trusted || !window.codeyo?.language || !this.isTrustedWorkspaceFile(file)) {
      return;
    }
    if (file.lang === 'text' && !this.spellCheckEnabled) {
      return;
    }
    const document = this.languageDocumentFor(file);
    const request = action === 'open'
      ? window.codeyo.language.openDocument(this.workspace.id, document)
      : window.codeyo.language.changeDocument(this.workspace.id, document);
    request.catch((error) => {
      this.workspaceNotice = this.desktopError(error, `LANGUAGE SERVICE UPDATE FAILED · ${file.path}`);
      this.renderDesktopState();
    });
  }

  private scheduleLanguageDocumentSync(file: IdeFile): void {
    if (!this.workspace?.trusted || !this.isTrustedWorkspaceFile(file)) {
      return;
    }
    this.languageStore.scheduleChange(file.path, () => {
      this.syncLanguageDocument(file, 'change');
    });
  }

  private languageDocumentFor(file: IdeFile) {
    const content = file.lines.join('\n');
    return {
      path: file.path,
      language: file.lang,
      content,
      version: this.languageStore.nextDocumentVersion(file.path),
      spellRanges: this.spellCheckEnabled ? extractSpellCheckRegions(content, file.lang) : [],
    };
  }

  private languageRequestFor(file: IdeFile, position: EditorLanguagePosition) {
    return {
      ...this.languageDocumentFor(file),
      line: position.line,
      column: position.column,
    };
  }

  private applyLanguageDiagnostics(event: { workspaceId: string; path: string; source: 'lsp' | 'spell'; diagnostics: EditorDiagnostic[] }): void {
    if (!this.workspace || !this.languageStore.applyDiagnostics(event, this.workspace.id)) {
      return;
    }
    this.renderDesktopState();
  }

  private applyLanguageStatus(event: LanguageServiceStatus & { workspaceId: string }): void {
    if (!this.workspace || !this.languageStore.applyStatus(event, this.workspace.id)) {
      return;
    }
    this.renderDesktopState();
  }

  private async refreshLanguageStatus(): Promise<void> {
    if (!this.workspace?.trusted || !window.codeyo?.language) {
      this.languageWorkspaceStatus = null;
      return;
    }
    try {
      this.languageWorkspaceStatus = await window.codeyo.language.status(this.workspace.id);
    } catch (error) {
      this.workspaceNotice = this.desktopError(error, 'LANGUAGE SERVICE STATUS FAILED');
    }
  }

  private async openLanguageLocation(location: LanguageDefinitionLocation): Promise<void> {
    const file = this.ideFiles.find((candidate) => candidate.path === location.path);
    if (!file) {
      this.workspaceNotice = `DEFINITION FILE NOT FOUND · ${location.path}`;
      this.renderDesktopState();
      return;
    }
    this.activeIdePath = file.path;
    this.activeChannelId = 'ide';
    this.activeChannelView = 'ide';
    this.activeRightPanel = 'files';
    if (file.workspaceFile && file.status === 'saved') {
      await this.loadDesktopDocument(file.path);
    }
    this.diagnosticRevealLine = location.line;
    this.diagnosticRevealColumn = location.column;
    this.diagnosticRevealRequest += 1;
    this.workspaceNotice = `DEFINITION · ${location.path}:${location.line}:${location.column}`;
    this.renderDesktopState();
  }

  private readWorkspaceBooleanSetting(
    workspace: WorkspaceHandle,
    key: string,
    fallback: boolean,
  ): boolean {
    try {
      const stored = localStorage.getItem(this.workspaceSettingKey(workspace, key));
      return stored === null ? fallback : stored === 'true';
    } catch {
      return fallback;
    }
  }

  private writeWorkspaceBooleanSetting(key: string, value: boolean): void {
    if (!this.workspace) {
      return;
    }
    try {
      localStorage.setItem(this.workspaceSettingKey(this.workspace, key), String(value));
    } catch {
      // Settings are convenience state; the editor stays usable if localStorage is unavailable.
    }
  }

  private readWorkspaceStringSetting(
    workspace: WorkspaceHandle,
    key: string,
    fallback: string,
  ): string {
    try {
      const stored = localStorage.getItem(this.workspaceSettingKey(workspace, key));
      if (!stored) {
        return fallback;
      }
      const value = stored.trim();
      if (!value || value.includes('\0') || /[\r\n]/.test(value)) {
        return fallback;
      }
      return value.slice(0, 512);
    } catch {
      return fallback;
    }
  }

  private writeWorkspaceStringSetting(key: string, value: string): void {
    if (!this.workspace) {
      return;
    }
    const safeValue = value.trim();
    if (!safeValue || safeValue.includes('\0') || /[\r\n]/.test(safeValue)) {
      return;
    }
    try {
      localStorage.setItem(this.workspaceSettingKey(this.workspace, key), safeValue.slice(0, 512));
    } catch {
      // Settings are convenience state; the editor stays usable if localStorage is unavailable.
    }
  }

  private workspaceSettingKey(workspace: WorkspaceHandle, key: string): string {
    return `codeyo:${workspace.rootPath}:${key}`;
  }

  private flushDirtyRecoveryBuffersSync(): void {
    if (!this.workspace?.trusted || !window.codeyo?.files.backupRecoverySync) {
      return;
    }
    this.clearWorkspaceTimers();
    for (const file of this.dirtyWorkspaceFiles()) {
      try {
        window.codeyo.files.backupRecoverySync(
          this.workspace.id,
          file.path,
          file.lines.join('\n'),
        );
      } catch {
        // The beforeunload prompt still protects the buffer if recovery flushing fails.
      }
    }
  }

  private currentTime(): string {
    return new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  async openDesktopWorkspace(): Promise<void> {
    if (!(await this.confirmWorkspaceChange())) {
      return;
    }
    try {
      const workspace = await window.codeyo?.workspace.open();
      if (workspace) {
        await this.activateDesktopWorkspace(workspace);
      }
    } catch (error) {
      this.workspaceNotice = this.desktopError(error, 'COULD NOT OPEN WORKSPACE');
      this.renderDesktopState();
    }
  }

  async resumeRecentWorkspace(): Promise<void> {
    if (!this.recentWorkspace || !window.codeyo) {
      return;
    }
    if (!(await this.confirmWorkspaceChange())) {
      return;
    }
    try {
      const workspace = await window.codeyo.workspace.resume(this.recentWorkspace.id);
      await this.activateDesktopWorkspace(workspace);
    } catch (error) {
      this.workspaceNotice = this.desktopError(error, 'RECENT WORKSPACE IS UNAVAILABLE');
      this.renderDesktopState();
    }
  }

  async trustDesktopWorkspace(): Promise<void> {
    if (!this.workspace || !window.codeyo) {
      return;
    }
    const openTerminalAfterTrust = this.terminalRequestedAfterTrust;
    try {
      const trustedWorkspace = await window.codeyo.workspace.trust(this.workspace.id);
      this.workspaceStore.trustActive(trustedWorkspace);
      this.workspaceTrustPromptOpen = false;
      this.terminalRequestedAfterTrust = false;
      const [, journalLoaded, recoveriesLoaded] = await Promise.all([
        this.refreshGit(),
        this.refreshJournal({ noticeOnFailure: false }),
        this.refreshRecoveries({ noticeOnFailure: false }),
      ]);
      this.appendWorkspaceSidecarWarning(journalLoaded, recoveriesLoaded, true);
      await this.refreshLanguageStatus();
      this.syncActiveLanguageDocument('open');
      if (openTerminalAfterTrust) {
        this.openConsolePanel('terminal');
      }
    } catch (error) {
      this.workspaceNotice = this.desktopError(error, 'COULD NOT TRUST WORKSPACE');
    }
    this.renderDesktopState();
  }

  async refreshGit(): Promise<boolean> {
    if (!this.workspace?.trusted || !window.codeyo) {
      return false;
    }
    try {
      const [status, branches, stagedSummary, history] = await Promise.all([
        window.codeyo.git.status(this.workspace.id),
        window.codeyo.git.branches(this.workspace.id),
        window.codeyo.git.stagedSummary(this.workspace.id),
        window.codeyo.git.history(this.workspace.id),
      ]);
      this.gitStatus = status;
      this.gitBranches = branches;
      this.gitStagedSummary = stagedSummary;
      this.gitHistory = history;
      if (this.stagedGitFiles.length === 0) {
        this.commitReviewOpen = false;
      }
      this.selectedBranch = branches.includes(this.selectedBranch)
        ? this.selectedBranch
        : status.branch;
      this.gitNotice = this.gitStatus.initial
        ? `${this.gitStatus.branch} · NO COMMITS · ${this.gitStatus.files.length} CHANGED`
        : `${this.gitStatus.branch} · ${this.gitStatus.files.length} CHANGED`;
      this.renderDesktopState();
      return true;
    } catch {
      this.gitStatus = null;
      this.gitBranches = [];
      this.gitStagedSummary = { files: [], additions: 0, deletions: 0 };
      this.gitHistory = [];
      this.selectedBranch = '';
      this.commitReviewOpen = false;
      this.clearGitComparison();
      this.gitNotice = 'NOT A GIT REPOSITORY OR GIT IS UNAVAILABLE.';
      this.renderDesktopState();
      return false;
    }
  }

  async gitAction(action: GitAction): Promise<void> {
    if (!this.workspace?.trusted || !window.codeyo || this.gitBusy) {
      return;
    }
    this.gitBusy = true;
    this.gitNotice = `RUNNING GIT ${action.type.toUpperCase()}...`;
    const compared = this.gitComparison && this.gitComparison.mode !== 'commit' && {
      path: this.gitComparison.path,
      mode: this.gitComparison.mode,
    };
    this.renderDesktopState();
    try {
      const result = await window.codeyo.git.action(this.workspace.id, action);
      this.desktopOutput = [`$ GIT ${action.type.toUpperCase()}`, result.stdout || result.stderr || 'DONE'];
      this.activeConsolePanel = 'output';
      this.commitReviewOpen = false;
      if (action.type === 'commit') {
        this.commitMessage = '';
        this.selectedCommitRunResultId = '';
      }
      await Promise.all([this.refreshGit(), this.refreshJournal()]);
      if (compared && this.findGitFileState(compared.path)) {
        const nextMode = compared.mode === 'staged' && !this.canViewStagedComparison
          ? (this.canViewUnstagedComparison ? 'unstaged' : 'all')
          : compared.mode === 'unstaged' && !this.canViewUnstagedComparison
            ? (this.canViewStagedComparison ? 'staged' : 'all')
            : compared.mode;
        await this.loadGitComparison(compared.path, nextMode);
      } else if (compared) {
        this.clearGitComparison();
      }
    } catch (error) {
      const message = this.desktopError(error, 'GIT ACTION FAILED');
      this.gitNotice = message;
      this.desktopOutput = [`$ GIT ${action.type.toUpperCase()}`, message];
      this.activeConsolePanel = 'output';
    } finally {
      this.gitBusy = false;
    }
    this.renderDesktopState();
  }

  async discardGitFile(filePath: string): Promise<void> {
    if (await this.confirmAction({
      title: 'Discard changes?',
      message: `Discard all working changes in ${filePath}?`,
      details: 'This cannot be undone.',
      confirmLabel: 'Discard',
      cancelLabel: 'Cancel',
      variant: 'danger',
    })) {
      void this.gitAction({ type: 'discard', path: filePath, confirmed: true });
    }
  }

  async applyGitHunk(hunkId: number, mode: GitPatchMode): Promise<void> {
    if (!this.workspace?.trusted || !window.codeyo || this.gitBusy || !this.gitComparison) {
      return;
    }
    if (!this.gitHunkActionsEnabled || !this.gitHunkAvailableModes.includes(mode)) {
      return;
    }
    const hunk = this.gitHunks.find((candidate) => candidate.id === hunkId);
    if (!hunk) {
      return;
    }
    if (mode === 'discard' && this.pendingDiscardHunkId !== hunkId) {
      this.pendingDiscardHunkId = hunkId;
      this.renderDesktopState();
      return;
    }
    this.gitBusy = true;
    this.pendingDiscardHunkId = null;
    this.gitNotice = `RUNNING GIT ${mode.toUpperCase()} HUNK ${hunkId}...`;
    const compared = {
      path: this.gitComparison.path,
      mode: this.gitComparison.mode as GitWorkspaceCompareMode,
    };
      this.renderDesktopState();
    try {
      const patch = this.buildGitHunkPatch(this.gitComparison, hunk);
      await window.codeyo.git.applyPatch(this.workspace.id, patch, mode, mode === 'discard');
      await Promise.all([this.refreshGit(), this.refreshJournal()]);
      if (this.findGitFileState(compared.path)) {
        const nextMode = compared.mode === 'staged' && !this.canViewStagedComparison
          ? (this.canViewUnstagedComparison ? 'unstaged' : 'all')
          : compared.mode === 'unstaged' && !this.canViewUnstagedComparison
            ? (this.canViewStagedComparison ? 'staged' : 'all')
            : compared.mode;
        await this.loadGitComparison(compared.path, nextMode);
      } else {
        this.clearGitComparison();
      }
      this.gitNotice = `${mode.toUpperCase()} HUNK ${hunkId} · DONE`;
    } catch (error) {
      this.gitNotice = this.desktopError(error, `GIT ${mode.toUpperCase()} HUNK FAILED`);
    } finally {
      this.gitBusy = false;
    }
    this.renderDesktopState();
  }

  cancelPendingHunkDiscard(): void {
    if (this.pendingDiscardHunkId === null) {
      return;
    }
    this.pendingDiscardHunkId = null;
    this.renderDesktopState();
  }

  private buildGitHunkPatch(comparison: GitComparison, hunk: LineDiffHunk): string {
    const filePath = comparison.path;
    const oldCount = hunk.snapshotLines.length;
    const newCount = hunk.currentLines.length;
    const oldStart = oldCount === 0 ? Math.max(0, hunk.snapshotStart - 1) : hunk.snapshotStart;
    const newStart = newCount === 0 ? Math.max(0, hunk.currentStart - 1) : hunk.currentStart;
    const body = [
      ...hunk.snapshotLines.map((line) => `-${line}`),
      ...hunk.currentLines.map((line) => `+${line}`),
    ];
    return [
      `diff --git a/${filePath} b/${filePath}`,
      `--- a/${filePath}`,
      `+++ b/${filePath}`,
      `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
      ...body,
      '',
    ].join('\n');
  }

  async showGitDiff(filePath: string, mode: GitWorkspaceCompareMode = 'all'): Promise<void> {
    await this.loadGitComparison(filePath, mode);
  }

  async setGitComparisonMode(mode: GitWorkspaceCompareMode): Promise<void> {
    if (!this.gitComparison || (mode === 'staged' && !this.canViewStagedComparison)
      || (mode === 'unstaged' && !this.canViewUnstagedComparison)) {
      return;
    }
    await this.loadGitComparison(this.gitComparison.path, mode);
  }

  closeGitComparison(): void {
    this.clearGitComparison();
    this.renderDesktopState();
  }

  openGitComparisonBuffer(): void {
    const path = this.gitComparison?.path;
    const buffer = path && this.findWorkspaceBuffer(path);
    if (buffer) {
      this.selectIdeFile(buffer.path);
    }
  }

  private async loadGitComparison(filePath: string, mode: GitWorkspaceCompareMode): Promise<void> {
    if (!this.workspace?.trusted || !window.codeyo) {
      return;
    }
    this.gitCompareBusy = true;
    this.assistantPanelOpen = false;
    this.activeChannelId = 'ide';
    this.activeChannelView = 'ide';
    this.activeRightPanel = 'git';
    this.gitHistoryDetail = null;
    try {
      const file = this.findGitFileState(filePath) ?? {
        index: ' ',
        workingTree: ' ',
        path: filePath,
      };
      this.gitComparison = await window.codeyo.git.compare(this.workspace.id, file, mode);
      const changes = this.computeLineComparison(
        this.gitComparison.leftContent,
        this.gitComparison.rightContent,
      );
      this.gitComparisonLeftLines = changes.leftLines;
      this.gitComparisonRightLines = changes.rightLines;
      this.gitComparisonAdded = changes.added;
      this.gitComparisonRemoved = changes.removed;
      this.gitHunks = changes.hunks;
      this.pendingDiscardHunkId = null;
      this.gitNotice = `COMPARING · ${filePath} · ${mode}`;
    } catch (error) {
      this.clearGitComparison();
      this.gitNotice = this.desktopError(error, 'GIT COMPARE FAILED');
    } finally {
      this.gitCompareBusy = false;
    }
    this.renderDesktopState();
  }

  journalCommitRevision(entry: JournalEntry): string | null {
    if (entry.kind !== 'git' ||
      (entry.metadata?.['action'] !== 'commit' && !entry.body.toUpperCase().startsWith('COMMIT'))) {
      return null;
    }
    const revision = entry.metadata?.['revision'];
    if (typeof revision === 'string' && /^[0-9a-f]{7,40}$/i.test(revision)) {
      return revision;
    }
    const output = entry.metadata?.['output'];
    return typeof output === 'string'
      ? output.match(/\[[^\]\s]+\s+([0-9a-f]{7,40})\]/i)?.[1] ?? null
      : null;
  }

  journalRunResultId(entry: JournalEntry): string | null {
    const runResultId = entry.metadata?.['runResultId'];
    return typeof runResultId === 'string' && runResultId.length > 0 ? runResultId : null;
  }

  async openJournalCommit(entry: JournalEntry): Promise<void> {
    if (!this.workspace?.trusted || !window.codeyo) {
      return;
    }
    const revision = this.journalCommitRevision(entry);
    if (!revision) {
      return;
    }
    await this.openGitCommitRevision(revision, this.journalRunResultId(entry) ?? '');
  }

  async openJournalRunEvidence(entry: JournalEntry): Promise<void> {
    const runResultId = this.journalRunResultId(entry);
    if (!runResultId) {
      return;
    }
    try {
      const result = await this.ensureRunEvidence(runResultId);
      if (!result) {
        this.workspaceNotice = `RUN EVIDENCE NOT FOUND · ${runResultId}`;
        this.renderDesktopState();
        return;
      }
      this.openRunEvidence(result);
    } catch (error) {
      this.workspaceNotice = this.desktopError(error, `RUN EVIDENCE UNAVAILABLE · ${runResultId}`);
      this.renderDesktopState();
    }
  }

  async openGitHistoryCommit(commit: GitCommitSummary): Promise<void> {
    await this.openGitCommitRevision(commit.revision);
  }

  updateGitHistoryQuery(event: Event): void {
    this.gitHistoryQuery = (event.target as HTMLInputElement).value;
  }

  updateReviewSnapshotDraft(event: Event): void {
    this.reviewSnapshotDraft = (event.target as HTMLTextAreaElement).value;
  }

  updateSelectedReviewRun(event: Event): void {
    this.selectedReviewRunResultId = (event.target as HTMLSelectElement).value;
  }

  updateSelectedCommitRun(event: Event): void {
    this.selectedCommitRunResultId = (event.target as HTMLSelectElement).value;
  }

  private async openGitCommitRevision(revision: string, runResultId = ''): Promise<void> {
    if (!this.workspace?.trusted || !window.codeyo) {
      return;
    }
    try {
      this.gitHistoryDetail = await window.codeyo.git.commitDetail(this.workspace.id, revision);
      this.reviewSnapshotDraft = '';
      this.selectedReviewRunResultId = '';
      if (runResultId) {
        const result = await this.ensureRunEvidence(runResultId);
        if (result) {
          this.selectedReviewRunResultId = result.id;
        }
      }
      const firstFile = this.gitHistoryDetail.files[0];
      if (!firstFile) {
        this.gitNotice = `COMMIT ${this.gitHistoryDetail.shortRevision} HAS NO FILE CHANGES.`;
        this.renderDesktopState();
        return;
      }
      await this.loadGitCommitComparison(firstFile);
    } catch (error) {
      this.clearGitComparison();
      this.gitNotice = this.desktopError(error, 'COULD NOT OPEN COMMIT HISTORY');
      this.renderDesktopState();
    }
  }

  async selectGitHistoryFile(file: GitCommitFile): Promise<void> {
    if (this.gitHistoryDetail) {
      await this.loadGitCommitComparison(file);
    }
  }

  async captureGitHistorySnapshot(scope: 'file' | 'commit' = 'file'): Promise<void> {
    if (!this.workspace?.trusted || !window.codeyo || !this.gitHistoryDetail ||
      !this.gitComparison || !this.isGitHistoryComparison || this.gitSnapshotBusy ||
      (scope === 'file' && !this.gitComparison.rightExists)) {
      return;
    }
    this.gitSnapshotBusy = true;
    try {
      const collected = scope === 'file'
        ? { files: [{ path: this.gitComparison.path, content: this.gitComparison.rightContent }], skipped: 0 }
        : await this.collectGitCommitSnapshotFiles();
      const { files, skipped } = collected;
      if (files.length === 0) {
        this.workspaceNotice = `COMMIT ${this.gitHistoryDetail.shortRevision} HAS NO FILE CONTENT TO SNAPSHOT${skipped > 0 ? ` · ${skipped} SKIPPED` : ''}.`;
        return;
      }
      const title = scope === 'commit'
        ? `REVIEW SET · COMMIT ${this.gitHistoryDetail.shortRevision} · ${files.length} FILES`
        : `REVIEW SNAPSHOT · COMMIT ${this.gitHistoryDetail.shortRevision} · ${this.gitComparison.path}`;
      const annotation = this.reviewSnapshotDraft.trim() || this.gitHistoryDetail.subject;
      const note = `${title} · ${annotation}`;
      await window.codeyo.journal.snapshot(
        this.workspace.id,
        files,
        note,
        this.selectedReviewRunResultId || undefined,
        this.gitHistoryDetail.revision,
      );
      const journalRefreshed = await this.refreshJournal({ noticeOnFailure: false });
      this.workspaceNotice = `SAVED ${scope === 'commit' ? 'REVIEW SET' : 'REVIEW SNAPSHOT'} · COMMIT ${this.gitHistoryDetail.shortRevision} · ${files.length} FILES${skipped > 0 ? ` · ${skipped} SKIPPED` : ''}${journalRefreshed ? '' : ' · JOURNAL REFRESH FAILED'}`;
      this.reviewSnapshotDraft = '';
      this.selectedReviewRunResultId = '';
      this.selectChannel('snapshots');
    } catch (error) {
      this.workspaceNotice = this.desktopError(error, 'COULD NOT SAVE REVIEW SNAPSHOT');
    } finally {
      this.gitSnapshotBusy = false;
      this.renderDesktopState();
    }
  }

  private async collectGitCommitSnapshotFiles(): Promise<{
    files: Array<{ path: string; content: string }>;
    skipped: number;
  }> {
    if (!this.workspace || !window.codeyo || !this.gitHistoryDetail || !this.gitComparison) {
      return { files: [], skipped: 0 };
    }
    const comparisons = await Promise.all(
      this.gitHistoryDetail.files
        .filter((file) => file.status !== 'D')
        .map(async (file) => {
          try {
            return file.path === this.gitComparison?.path
              ? this.gitComparison
              : await window.codeyo!.git.compareCommit(this.workspace!.id, this.gitHistoryDetail!.revision, file);
          } catch {
            return null;
          }
        }),
    );
    const files: Array<{ path: string; content: string }> = [];
    let skipped = 0;
    for (const comparison of comparisons) {
      if (!comparison?.rightExists) {
        skipped += 1;
        continue;
      }
      files.push({ path: comparison.path, content: comparison.rightContent });
    }
    return { files, skipped };
  }

  private async loadGitCommitComparison(file: GitCommitFile): Promise<void> {
    if (!this.workspace?.trusted || !window.codeyo || !this.gitHistoryDetail) {
      return;
    }
    this.gitCompareBusy = true;
    this.assistantPanelOpen = false;
    this.activeChannelId = 'ide';
    this.activeChannelView = 'ide';
    this.activeRightPanel = 'git';
    try {
      this.gitComparison = await window.codeyo.git.compareCommit(
        this.workspace.id,
        this.gitHistoryDetail.revision,
        file,
      );
      const changes = this.computeLineComparison(
        this.gitComparison.leftContent,
        this.gitComparison.rightContent,
      );
      this.gitComparisonLeftLines = changes.leftLines;
      this.gitComparisonRightLines = changes.rightLines;
      this.gitComparisonAdded = changes.added;
      this.gitComparisonRemoved = changes.removed;
      this.gitHunks = changes.hunks;
      this.pendingDiscardHunkId = null;
      this.gitNotice = `COMMIT HISTORY · ${this.gitHistoryDetail.shortRevision} · ${this.gitHistoryDetail.subject}`;
    } catch (error) {
      this.clearGitComparison();
      this.gitNotice = this.desktopError(error, 'COMMIT COMPARE FAILED');
    } finally {
      this.gitCompareBusy = false;
    }
    this.renderDesktopState();
  }

  updateCommitMessage(event: Event): void {
    this.commitMessage = (event.target as HTMLInputElement).value;
    this.commitReviewOpen = false;
  }

  reviewCommit(): void {
    if (!this.canReviewCommit) {
      this.gitNotice = this.stagedGitFiles.length === 0
        ? 'STAGE AT LEAST ONE CHANGE BEFORE COMMITTING.'
        : 'ENTER A COMMIT MESSAGE BEFORE REVIEW.';
      this.renderDesktopState();
      return;
    }
    this.commitReviewOpen = true;
    this.gitNotice = `READY TO COMMIT · ${this.stagedGitFiles.length} STAGED FILES`;
    this.renderDesktopState();
  }

  commitReviewedChanges(): void {
    if (this.commitReviewOpen && this.canReviewCommit) {
      const action: GitAction = { type: 'commit', message: this.commitMessage.trim() };
      if (this.selectedCommitRunResultId) {
        action.runResultId = this.selectedCommitRunResultId;
      }
      void this.gitAction(action);
    }
  }

  cancelCommitReview(): void {
    this.commitReviewOpen = false;
    this.renderDesktopState();
  }

  updateBranchName(event: Event): void {
    this.branchName = (event.target as HTMLInputElement).value;
  }

  updateSelectedBranch(event: Event): void {
    this.selectedBranch = (event.target as HTMLSelectElement).value;
  }

  async switchBranch(): Promise<void> {
    if (this.selectedBranch && this.selectedBranch !== this.gitStatus?.branch) {
      if (this.blockGitOperationWithUnsavedBuffers('SWITCH BRANCH')) {
        return;
      }
      if ((this.stagedGitFiles.length > 0 || this.unstagedGitFiles.length > 0) &&
        !(await this.confirmAction({
          title: 'Switch branch?',
          message: `Switch to ${this.selectedBranch} with local Git changes?`,
          details: 'Git may carry or reject those changes.',
          confirmLabel: 'Switch',
          cancelLabel: 'Cancel',
          variant: 'warning',
        }))) {
        return;
      }
      void this.gitAction({ type: 'switch-branch', name: this.selectedBranch });
    }
  }

  async deleteSelectedBranch(): Promise<void> {
    if (!this.canDeleteSelectedBranch) {
      return;
    }
    if (await this.confirmAction({
      title: 'Delete branch?',
      message: `Delete local branch ${this.selectedBranch}?`,
      details: 'This cannot be undone.',
      confirmLabel: 'Delete Branch',
      cancelLabel: 'Cancel',
      variant: 'danger',
    })) {
      void this.gitAction({ type: 'delete-branch', name: this.selectedBranch, confirmed: true });
    }
  }

  createBranch(): void {
    if (this.branchName.trim()) {
      void this.gitAction({ type: 'create-branch', name: this.branchName.trim() });
      this.branchName = '';
    }
  }

  async pullRemote(): Promise<void> {
    if (!this.gitStatus) {
      return;
    }
    if (this.blockGitOperationWithUnsavedBuffers('PULL')) {
      return;
    }
    if ((this.stagedGitFiles.length > 0 || this.unstagedGitFiles.length > 0) &&
      !(await this.confirmAction({
        title: 'Pull with local changes?',
        message: 'Pull with local changes in this workspace?',
        details: 'Git may require conflict resolution.',
        confirmLabel: 'Pull',
        cancelLabel: 'Cancel',
        variant: 'warning',
      }))) {
      return;
    }
    void this.gitAction({ type: 'pull' });
  }

  pushRemote(): void {
    if (!this.gitStatus) {
      return;
    }
    if (this.gitStatus.ahead <= 0) {
      this.gitNotice = 'NO LOCAL COMMITS TO PUSH.';
      this.renderDesktopState();
      return;
    }
    void this.gitAction({ type: 'push' });
  }

  private blockGitOperationWithUnsavedBuffers(operation: string): boolean {
    const dirtyFiles = this.dirtyWorkspaceFiles();
    if (dirtyFiles.length === 0) {
      return false;
    }
    const message = `${operation} BLOCKED · SAVE OR RESOLVE ${dirtyFiles.length} UNSAVED BUFFER${dirtyFiles.length === 1 ? '' : 'S'} FIRST.`;
    this.gitNotice = message;
    this.workspaceNotice = message;
    this.activeRightPanel = 'git';
    this.renderDesktopState();
    return true;
  }

  updateProfileCommand(event: Event): void {
    if (this.activeIdeFile.lang === 'cpp') {
      this.setCppExecutable((event.target as HTMLInputElement).value);
    } else {
      this.setPythonExecutable((event.target as HTMLInputElement).value);
    }
  }

  updatePythonExecutable(event: Event): void {
    this.setPythonExecutable((event.target as HTMLInputElement).value);
  }

  updateCppExecutable(event: Event): void {
    this.setCppExecutable((event.target as HTMLInputElement).value);
  }

  updateProfileArgs(event: Event): void {
    this.projectSettingsStore.update(this.workspace, 'profileArgs', (event.target as HTMLInputElement).value);
  }

  updateCppProgramArgs(event: Event): void {
    this.projectSettingsStore.update(this.workspace, 'cppProgramArgs', (event.target as HTMLInputElement).value);
  }

  isCppSourceSelected(filePath: string): boolean {
    return this.cppSelectedSources.includes(filePath);
  }

  toggleCppSource(filePath: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    if (checked && !this.cppSelectedSources.includes(filePath)) {
      this.cppSelectedSources = [...this.cppSelectedSources, filePath];
    } else if (!checked && filePath !== this.activeIdeFile.path) {
      this.cppSelectedSources = this.cppSelectedSources.filter((path) => path !== filePath);
    }
  }

  async saveRunProfile(): Promise<void> {
    if (!this.workspace?.trusted || !window.codeyo || (this.activeIdeFile.lang !== 'python' && this.activeIdeFile.lang !== 'cpp')) {
      return;
    }
    const profile: RunProfile = {
      id: `${this.activeIdeFile.lang}-current`,
      name: `Run ${this.activeIdeFile.lang.toUpperCase()} Current File`,
      language: this.activeIdeFile.lang,
      command: this.activeIdeFile.lang === 'cpp' ? this.cppExecutable : this.pythonExecutable,
      entryFile: this.activeIdeFile.path,
      sourceFiles: this.activeIdeFile.lang === 'cpp' ? this.selectedCppSources() : undefined,
      args: this.profileArgs.trim() ? this.profileArgs.trim().split(/\s+/) : undefined,
      programArgs: this.activeIdeFile.lang === 'cpp' && this.cppProgramArgs.trim()
        ? this.cppProgramArgs.trim().split(/\s+/) : undefined,
    };
    try {
      const saved = await window.codeyo.runner.saveProfile(this.workspace.id, profile);
      this.applyRunProfile(saved);
      this.workspaceNotice = `SAVED RUN PROFILE · ${saved.name}`;
    } catch (error) {
      this.workspaceNotice = this.desktopError(error, 'RUN PROFILE SAVE FAILED', this.activeIdeFile.lang);
    }
    this.renderDesktopState();
  }

  async checkEnvironment(): Promise<void> {
    if (!this.workspace?.trusted || !window.codeyo || this.environmentBusy) {
      return;
    }
    const tools: ToolCheckRequest[] = [
      { id: 'python', label: 'Python', command: this.pythonExecutable },
      { id: 'cpp', label: 'C++ Compiler', command: this.cppExecutable },
      { id: 'git', label: 'Git', command: 'git' },
    ];
    this.environmentBusy = true;
    this.workspaceNotice = 'CHECKING LOCAL TOOLCHAIN...';
    this.renderDesktopState();
    try {
      this.environmentChecks = await window.codeyo.environment.checkTools(this.workspace.id, tools);
      this.workspaceNotice = `ENVIRONMENT CHECK · ${this.environmentSummary}`;
    } catch (error) {
      const retained = this.environmentChecks.length > 0 ? ` · RETAINED ${this.environmentSummary}` : '';
      this.workspaceNotice = `${this.desktopError(error, 'ENVIRONMENT CHECK FAILED')}${retained}`;
    } finally {
      this.environmentBusy = false;
      this.renderDesktopState();
    }
  }

  updateJournalDraft(event: Event): void {
    this.journalDraft = (event.target as HTMLTextAreaElement).value;
  }

  updateJournalQuery(event: Event): void {
    this.journalQuery = (event.target as HTMLInputElement).value;
  }

  setJournalKindFilter(kind: JournalKindFilter): void {
    this.journalKindFilter = kind;
  }

  async addJournalNote(): Promise<void> {
    if (!this.workspace || !window.codeyo || !this.journalDraft.trim()) {
      return;
    }
    if (!this.workspace.trusted) {
      this.workspaceNotice = 'TRUST WORKSPACE BEFORE WRITING JOURNAL NOTES.';
      this.renderDesktopState();
      return;
    }
    const result = await this.writeJournalEntry('note', this.journalDraft.trim());
    if (result.status === 'write-failed') {
      this.workspaceNotice = result.detail ?? 'JOURNAL WRITE FAILED';
      this.renderDesktopState();
      return;
    }
    this.journalDraft = '';
    this.workspaceNotice = `JOURNAL NOTE SAVED${this.journalWriteSuffix(result)}`;
    this.renderDesktopState();
  }

  openConflictCompare(): void {
    if (!this.fileConflict || this.fileConflict.deleted) {
      return;
    }
    this.conflictCompareOpen = true;
    this.refreshConflictComparison();
    this.renderDesktopState();
  }

  closeConflictCompare(): void {
    this.conflictCompareOpen = false;
    this.renderDesktopState();
  }

  recoveryAgeLabel(buffer: RecoveryBuffer): string {
    const timestamp = Date.parse(buffer.updatedAt);
    if (!Number.isFinite(timestamp)) {
      return 'RECOVERY COPY';
    }
    const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
    if (minutes < 1) {
      return 'JUST NOW';
    }
    if (minutes < 60) {
      return `${minutes} MIN AGO`;
    }
    const hours = Math.round(minutes / 60);
    return hours < 24 ? `${hours} HR AGO` : new Date(timestamp).toLocaleDateString();
  }

  async restoreRecovery(buffer: RecoveryBuffer): Promise<void> {
    if (!this.workspace?.trusted || !window.codeyo) {
      return;
    }
    let file = this.ideFiles.find((candidate) => candidate.path === buffer.filePath);
    if (!file) {
      file = {
        name: buffer.filePath.split(/[\\/]/).pop() || buffer.filePath,
        path: buffer.filePath,
        lang: this.languageForPath(buffer.filePath),
        status: 'edited',
        lines: [],
        workspaceFile: true,
        missingOnDisk: true,
      };
      this.ideFiles.push(file);
      this.rebuildExplorerTree();
    }
    file.lines = buffer.content.split('\n');
    file.status = 'edited';
    this.activeIdePath = file.path;
    this.activeChannelId = 'ide';
    this.activeChannelView = 'ide';
    this.activeRightPanel = 'files';
    this.clearGitComparison();
    this.workspaceNotice = `RESTORED RECOVERY BUFFER · ${buffer.filePath} · SAVE TO WRITE`;
    this.renderDesktopState();
  }

  async discardRecovery(buffer: RecoveryBuffer): Promise<void> {
    if (!this.workspace?.trusted || !window.codeyo) {
      return;
    }
    if (!(await this.confirmAction({
      title: 'Discard recovery?',
      message: `Discard recovery buffer for ${buffer.filePath}?`,
      details: 'This cannot be undone.',
      confirmLabel: 'Discard',
      cancelLabel: 'Cancel',
      variant: 'danger',
    }))) {
      return;
    }
    try {
      await window.codeyo.files.clearRecovery(this.workspace.id, buffer.filePath);
      const recoveriesLoaded = await this.refreshRecoveries({ noticeOnFailure: false });
      this.workspaceNotice = `DISCARDED RECOVERY BUFFER · ${buffer.filePath}${recoveriesLoaded ? '' : ' · RECOVERY REFRESH FAILED'}`;
    } catch (error) {
      this.workspaceNotice = this.desktopError(error, `COULD NOT DISCARD RECOVERY BUFFER · ${buffer.filePath}`);
    }
    this.renderDesktopState();
  }

  async migrateStorage(mode: StorageMode): Promise<void> {
    if (!this.workspace?.trusted || !window.codeyo || this.workspace.storageMode === mode) {
      return;
    }
    let addToGitignore = false;
    if (mode === 'workspace-codeyo') {
      if (!(await this.confirmAction({
        title: 'Enable portable storage?',
        message: 'Write portable journal data to .codeyo/ in this workspace?',
        details: 'This creates local Codeyo metadata inside the trusted workspace.',
        confirmLabel: 'Write .codeyo/',
        cancelLabel: 'Cancel',
        variant: 'warning',
      }))) {
        return;
      }
      addToGitignore = await this.confirmAction({
        title: 'Update .gitignore?',
        message: 'Add .codeyo/ to this project .gitignore?',
        details: 'Recommended for private local journal, recovery, and run evidence files.',
        confirmLabel: 'Add to .gitignore',
        cancelLabel: 'Skip',
        variant: 'default',
      });
    }
    this.storageBusy = true;
    try {
      const result = await window.codeyo.settings.storageMode(this.workspace.id, mode, addToGitignore);
      this.workspace = { ...this.workspace, storageMode: result.storageMode };
      const [, journalLoaded, recoveriesLoaded] = await Promise.all([
        this.refreshGit(),
        this.refreshJournal({ noticeOnFailure: false }),
        this.refreshRecoveries({ noticeOnFailure: false }),
      ]);
      this.workspaceNotice = result.imported
        ? `STORAGE MIGRATED · ${mode} · PORTABLE RECORDS IMPORTED`
        : `STORAGE MIGRATED · ${mode}`;
      this.appendStorageMigrationWarning(journalLoaded, recoveriesLoaded);
    } catch (error) {
      this.workspaceNotice = this.desktopError(error, 'STORAGE MIGRATION FAILED');
    } finally {
      this.storageBusy = false;
    }
    this.renderDesktopState();
  }

  async resolveConflict(useDisk: boolean): Promise<void> {
    if (!this.fileConflict) {
      return;
    }
    const filePath = this.activeIdeFile.path;
    if (useDisk && this.fileConflict.deleted) {
      this.fileConflict = null;
      this.conflictCompareOpen = false;
      const discarded = this.ideFiles.findIndex((file) => file.path === filePath);
      if (discarded >= 0) {
        this.ideFiles.splice(discarded, 1);
      }
      await this.refreshDesktopFileIndex(true);
      const next = this.ideFiles.find((file) => file.workspaceFile) ?? this.ideFiles[0];
      if (next) {
        this.activeIdePath = next.path;
        if (next.workspaceFile && next.status === 'saved') {
          await this.loadDesktopDocument(this.activeIdePath);
        }
      }
      this.workspaceNotice = `DISCARDED DELETED BUFFER · ${filePath}`;
      this.renderDesktopState();
      return;
    }
    if (useDisk) {
      this.activeIdeFile.lines = this.fileConflict.diskContent.split('\n');
      this.activeIdeFile.diskVersion = this.fileConflict.diskVersion;
      this.activeIdeFile.status = 'saved';
      this.activeIdeFile.missingOnDisk = false;
      this.runnerStore.clearDiagnosticsForPath(filePath);
    } else {
      this.activeIdeFile.diskVersion = this.fileConflict.diskVersion;
      this.activeIdeFile.missingOnDisk = Boolean(this.fileConflict.deleted);
    }
    this.fileConflict = null;
    this.conflictCompareOpen = false;
    this.workspaceNotice = useDisk
      ? `LOADED DISK VERSION · ${filePath}`
      : `KEEPING UNSAVED BUFFER · ${filePath} · SAVE TO WRITE`;
    this.renderDesktopState();
  }

  private async loadRecentWorkspaceHint(): Promise<void> {
    try {
      const recent = await window.codeyo?.workspace.recent();
      if (recent && recent.length > 0) {
        this.workspaceStore.setRecentWorkspace(recent[0]);
        this.renderDesktopState();
      }
    } catch {
      this.workspaceStore.setRecentWorkspace(null);
    }
  }

  private async activateDesktopWorkspace(workspace: WorkspaceHandle): Promise<void> {
    this.clearWorkspaceTimers();
    this.workspaceStore.activate(workspace);
    this.projectSettingsStore.load(workspace);
    this.migrateLegacyProjectSettings(workspace);
    this.terminalPaneOpen = false;
    this.terminalRequestedAfterTrust = false;
    this.lspDiagnosticsEnabled = this.projectSettingsStore.current.lspDiagnosticsEnabled;
    this.autocompleteEnabled = this.projectSettingsStore.current.autocompleteEnabled;
    this.spellCheckEnabled = this.projectSettingsStore.current.spellCheckEnabled;
    this.explorerStore.clearExpanded();
    this.desktopOutput = [];
    this.runTaskTranscript = [];
    this.runTaskSequence = 0;
    this.runnerStore.resetWorkspaceState();
    this.languageStore.resetWorkspaceState();
    this.recoveryBuffers = [];
    this.environmentChecks = [];
    this.gitStore.resetWorkspaceState();
    this.workspaceTrustPromptOpen = !workspace.trusted;
    await this.loadDesktopFiles();
    await this.refreshLanguageStatus();
    this.syncActiveLanguageDocument('open');
    this.renderDesktopState();
  }

  private migrateLegacyProjectSettings(workspace: WorkspaceHandle): void {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(this.projectSettingsStore.storageKey(workspace))) {
      return;
    }
    const legacyAutoSave = this.readWorkspaceBooleanSetting(workspace, 'auto-save', this.projectSettingsStore.current.autoSaveEnabled);
    const legacyLsp = this.readWorkspaceBooleanSetting(workspace, 'lsp-diagnostics', this.projectSettingsStore.current.lspDiagnosticsEnabled);
    const legacyAutocomplete = this.readWorkspaceBooleanSetting(workspace, 'autocomplete', this.projectSettingsStore.current.autocompleteEnabled);
    const legacySpell = this.readWorkspaceBooleanSetting(workspace, 'spell-check', this.projectSettingsStore.current.spellCheckEnabled);
    const legacyPython = this.readWorkspaceStringSetting(workspace, 'python-command', this.projectSettingsStore.current.pythonCommand);
    const legacyCpp = this.readWorkspaceStringSetting(workspace, 'cpp-command', this.projectSettingsStore.current.cppCommand);
    this.projectSettingsStore.current = {
      ...this.projectSettingsStore.current,
      autoSaveEnabled: legacyAutoSave,
      lspDiagnosticsEnabled: legacyLsp,
      autocompleteEnabled: legacyAutocomplete,
      spellCheckEnabled: legacySpell,
      pythonCommand: legacyPython,
      cppCommand: legacyCpp,
    };
    this.projectSettingsStore.save(workspace);
  }

  private async confirmWorkspaceChange(): Promise<boolean> {
    if (!this.workspace || !this.canSaveAll) {
      return true;
    }
    this.flushDirtyRecoveryBuffersSync();
    return this.confirmAction({
      title: 'Switch workspace?',
      message: 'This workspace has unsaved buffers. Switch workspaces without saving them?',
      details: 'Recovery copies will be kept.',
      confirmLabel: 'Switch',
      cancelLabel: 'Stay',
      variant: 'warning',
    });
  }

  private async refreshDesktopFileIndex(preserveBuffers: boolean): Promise<void> {
    if (!this.workspace || !window.codeyo) {
      return;
    }
    const files = await window.codeyo.files.list(this.workspace.id);
    const previous = new Map(this.ideFiles
      .filter((file) => file.workspaceFile)
      .map((file) => [file.path, file]));
    const next: IdeFile[] = files.map((file) => {
      const cached = previous.get(file.path);
      if (preserveBuffers && cached && (cached.status !== 'saved' || cached.path === this.activeIdePath)) {
        return { ...cached, name: file.name, lang: file.language, missingOnDisk: false };
      }
      return {
        name: file.name,
        path: file.path,
        lang: file.language,
        status: file.status,
        lines: [],
        workspaceFile: true,
      } satisfies IdeFile;
    });
    this.explorerStore.expandParents(next);
    if (preserveBuffers) {
      for (const cached of previous.values()) {
        const missing = !files.some((file) => file.path === cached.path);
        if (missing && cached.status !== 'saved') {
          next.push({ ...cached, missingOnDisk: true });
        }
      }
    }
    if (next.length === 0) {
      next.push({
        name: 'start-here.txt',
        path: '@start-here',
        lang: 'text',
        status: 'saved',
        builtIn: true,
        lines: ['This workspace has no editable source files.', '', 'Use + FILE to create your first buffer.'],
      });
    }
    this.ideFiles.splice(0, this.ideFiles.length, ...next);
    this.rebuildExplorerTree();
  }

  private async handleWorkspaceFileChange(change: WorkspaceFileChange): Promise<void> {
    if (!this.workspace || !window.codeyo || change.workspaceId !== this.workspace.id) {
      return;
    }
    const active = this.ideFiles.find((file) => file.path === this.activeIdePath);
    const affectsActive = !change.directory && active?.workspaceFile && change.path === active.path;
    if (affectsActive && active) {
      if (!change.exists) {
        if (active.status !== 'saved') {
          active.missingOnDisk = true;
          this.fileConflict = { diskContent: '', diskVersion: '', deleted: true };
          this.conflictCompareOpen = false;
          this.workspaceNotice = `DELETED ON DISK · KEEP OR DISCARD UNSAVED BUFFER · ${active.path}`;
        } else {
          this.workspaceNotice = `REMOVED ON DISK · ${active.path}`;
        }
      } else {
        try {
          const document = await window.codeyo.files.read(this.workspace.id, active.path);
          if (document.content === this.activeEditorText) {
            active.diskVersion = document.diskVersion;
            active.missingOnDisk = false;
          } else if (active.status !== 'saved') {
            this.fileConflict = { diskContent: document.content, diskVersion: document.diskVersion };
            this.refreshConflictComparison();
            this.workspaceNotice = `EXTERNAL CHANGE CONFLICT · ${active.path}`;
          } else {
            active.lines = document.content.split('\n');
            active.diskVersion = document.diskVersion;
            active.status = 'saved';
            active.missingOnDisk = false;
            this.runnerStore.clearDiagnosticsForPath(active.path);
            this.workspaceNotice = `RELOADED EXTERNAL CHANGE · ${active.path}`;
          }
        } catch (error) {
          this.fileConflict = null;
          this.conflictCompareOpen = false;
          this.workspaceNotice = this.desktopError(error, `EXTERNAL CHANGE READ FAILED · ${active.path}`);
        }
      }
    }
    try {
      await this.refreshDesktopFileIndex(true);
    } catch (error) {
      this.workspaceNotice = this.desktopError(error, 'WORKSPACE FILE INDEX REFRESH FAILED');
      this.renderDesktopState();
      return;
    }
    if (!this.ideFiles.some((file) => file.path === this.activeIdePath)) {
      this.activeIdePath = this.ideFiles[0].path;
      if (this.activeIdeFile.workspaceFile) {
        await this.loadDesktopDocument(this.activeIdePath);
      }
    }
    if (this.workspace.trusted) {
      await this.refreshGit();
    }
    this.renderDesktopState();
  }

  private async loadDesktopFiles(): Promise<void> {
    if (!this.workspace || !window.codeyo) {
      return;
    }
    await this.refreshDesktopFileIndex(false);
    if (!this.ideFiles.some((file) => file.workspaceFile)) {
      this.workspaceNotice = `${this.workspace.name} · NO EDITABLE SOURCE FILES FOUND`;
      this.activeIdePath = this.ideFiles[0].path;
      this.renderDesktopState();
      return;
    }
    this.activeIdePath = this.ideFiles.find((file) => file.workspaceFile)!.path;
    await this.loadDesktopDocument(this.activeIdePath);
    this.ensureCppSourceSelection();
    if (this.workspace.trusted) {
      const [, journalLoaded, recoveriesLoaded, runnerState] = await Promise.all([
        this.refreshGit(),
        this.refreshJournal({ noticeOnFailure: false }),
        this.refreshRecoveries({ noticeOnFailure: false }),
        this.loadRunnerWorkspaceState(),
      ]);
      this.appendWorkspaceSidecarWarning(
        journalLoaded,
        recoveriesLoaded,
        runnerState.profilesLoaded && runnerState.historyLoaded,
      );
    }
    this.renderDesktopState();
  }

  private async loadDesktopDocument(filePath: string): Promise<void> {
    if (!this.workspace || !window.codeyo) {
      return;
    }
    const document = await window.codeyo.files.read(this.workspace.id, filePath);
    const active = this.ideFiles.find((file) => file.path === filePath);
    if (!active) {
      return;
    }
    active.lines = document.content.split('\n');
    active.lang = document.language;
    active.diskVersion = document.diskVersion;
    active.status = 'saved';
    active.missingOnDisk = false;
    if (this.workspace.trusted) {
      try {
        const recovery = await window.codeyo.files.recovery(this.workspace.id, filePath);
        if (recovery && recovery.content !== document.content) {
          active.lines = recovery.content.split('\n');
          active.status = 'edited';
          this.workspaceNotice = `RECOVERED UNSAVED BUFFER · ${filePath}`;
        }
      } catch (error) {
        this.workspaceNotice = this.desktopError(error, `RECOVERY UNAVAILABLE · ${filePath}`);
      }
    }
    this.syncLanguageDocument(active, 'open');
    this.renderDesktopState();
  }

  private async saveDesktopDocument(
    filePath = this.activeIdeFile.path,
    options: { expectedContent?: string; reason?: 'manual' | 'auto' } = {},
  ): Promise<void> {
    const file = this.ideFiles.find((candidate) => candidate.path === filePath);
    if (!this.workspace?.trusted || !window.codeyo || !file?.workspaceFile) {
      this.workspaceNotice = 'TRUST WORKSPACE BEFORE WRITING SOURCE FILES.';
      this.renderDesktopState();
      return;
    }
    if (options.reason !== 'auto' && this.formatOnSaveEnabled && window.codeyo.language) {
      try {
        const formatResult = await window.codeyo.language.formatDocument(
          this.workspace.id,
          this.languageDocumentFor(file),
        );
        if (formatResult.available && formatResult.edit?.edits.length) {
          const before = file.lines.join('\n');
          const after = applyTextEdits(before, formatResult.edit.edits);
          if (after !== before) {
            file.lines = after.split('\n');
          }
        }
      } catch {
        // Format-on-save is best-effort; fall through to saving the current buffer.
      }
    }
    const content = file.lines.join('\n');
    if (options.expectedContent !== undefined && options.expectedContent !== content) {
      return;
    }
    let result: FileWriteResult;
    try {
      result = await window.codeyo.files.write(this.workspace.id, {
        path: file.path,
        content,
        diskVersion: file.diskVersion ?? '',
      });
    } catch (error) {
      this.activeIdePath = file.path;
      this.workspaceNotice = this.desktopError(
        error,
        `${options.reason === 'auto' ? 'AUTO-SAVE' : 'SAVE'} FAILED · ${file.path}`,
      );
      this.renderDesktopState();
      return;
    }
    if (result.conflict) {
      this.activeIdePath = file.path;
      this.fileConflict = {
        diskContent: result.diskContent ?? '',
        diskVersion: result.diskVersion,
        deleted: result.deleted,
      };
      this.refreshConflictComparison();
      this.workspaceNotice = result.deleted
        ? `${options.reason === 'auto' ? 'AUTO-SAVE' : 'SAVE'} PAUSED · FILE DELETED ON DISK · ${file.path}`
        : `${options.reason === 'auto' ? 'AUTO-SAVE' : 'SAVE'} PAUSED · EXTERNAL CHANGE CONFLICT · ${file.path}`;
      this.renderDesktopState();
      return;
    }
    file.diskVersion = result.diskVersion;
    file.status = 'saved';
    file.missingOnDisk = false;
    this.lastSavedAt = this.currentTime();
    this.workspaceNotice = `${options.reason === 'auto' ? 'AUTO-SAVED' : 'SAVED'} · ${file.path} · ${this.lastSavedAt}`;
    this.appendRecoveryRefreshWarning(await this.refreshFileWriteState());
    this.renderDesktopState();
  }

  private async createDesktopFile(filePath: string, content: string): Promise<void> {
    if (!this.workspace?.trusted || !window.codeyo) {
      this.workspaceNotice = 'TRUST WORKSPACE BEFORE CREATING FILES.';
      return;
    }
    try {
      await window.codeyo.files.create(this.workspace.id, filePath, content);
      this.creatingFile = false;
      this.newFileName = '';
      this.explorerStore.clearQuery(this.visibleIdeFiles);
      await this.loadDesktopFiles();
      this.selectIdeFile(filePath);
      this.workspaceNotice = `CREATED FILE · ${filePath}`;
    } catch (error) {
      this.workspaceNotice = this.desktopError(error, 'COULD NOT CREATE FILE');
    }
    this.renderDesktopState();
  }

  private async removeDesktopFile(): Promise<void> {
    if (!this.workspace?.trusted || !window.codeyo) {
      return;
    }
    const filePath = this.activeIdeFile.path;
    try {
      await window.codeyo.files.remove(this.workspace.id, filePath, true);
      await this.loadDesktopFiles();
      await Promise.all([this.refreshGit(), this.refreshRecoveries()]);
      this.workspaceNotice = `DELETED FILE · ${filePath}`;
    } catch (error) {
      this.workspaceNotice = this.desktopError(error, 'COULD NOT DELETE FILE');
    }
    this.renderDesktopState();
  }

  private async renameDesktopFile(nextPath: string): Promise<void> {
    if (!this.workspace?.trusted || !window.codeyo) {
      return;
    }
    const previousPath = this.activeIdeFile.path;
    try {
      await window.codeyo.files.rename(this.workspace.id, previousPath, nextPath);
      await this.loadDesktopFiles();
      this.selectIdeFile(nextPath);
      await Promise.all([this.refreshGit(), this.refreshRecoveries()]);
      this.workspaceNotice = `RENAMED FILE · ${previousPath} -> ${nextPath}`;
    } catch (error) {
      this.workspaceNotice = this.desktopError(error, 'COULD NOT RENAME FILE');
    }
    this.renderDesktopState();
  }

  private async runDesktopFile(): Promise<void> {
    const file = this.activeIdeFile;
    if (file.lang !== 'python' && file.lang !== 'cpp') {
      this.desktopOutput = ['NO RUN PROFILE · SELECT A PYTHON OR C++ FILE'];
      this.activeConsolePanel = 'output';
      this.renderDesktopState();
      return;
    }
    const profile = this.runProfileForFile(file);
    if (!profile) {
      return;
    }
    await this.runDesktopProfile(profile);
  }

  private ensureCppSourceSelection(): void {
    if (this.activeIdeFile.lang !== 'cpp') {
      return;
    }
    const available = new Set(this.cppSourceCandidates.map((file) => file.path));
    this.cppSelectedSources = this.cppSelectedSources.filter((path) => available.has(path));
    if (!this.cppSelectedSources.includes(this.activeIdeFile.path)) {
      this.cppSelectedSources = [this.activeIdeFile.path, ...this.cppSelectedSources];
    }
  }

  private selectedCppSources(): string[] {
    this.ensureCppSourceSelection();
    return this.cppSourceSelectionPreview(this.activeIdeFile.path);
  }

  private get activeRunProfilePreview(): RunProfile | null {
    return this.runProfileForFile(this.activeIdeFile);
  }

  private runProfileForFile(file: IdeFile): RunProfile | null {
    if (file.lang !== 'python' && file.lang !== 'cpp') {
      return null;
    }
    const profile: RunProfile = {
      id: `${file.lang}-current`,
      name: `Run ${file.name}`,
      language: file.lang,
      command: file.lang === 'cpp' ? this.cppExecutable : this.pythonExecutable,
      entryFile: file.path,
      args: this.splitProfileArgs(this.profileArgs),
    };
    if (file.lang === 'cpp') {
      profile.sourceFiles = this.cppSourceSelectionPreview(file.path);
      profile.programArgs = this.splitProfileArgs(this.cppProgramArgs);
    }
    return profile;
  }

  private splitProfileArgs(value: string): string[] | undefined {
    const trimmed = value.trim();
    return trimmed ? trimmed.split(/\s+/) : undefined;
  }

  private cppSourceSelectionPreview(entryPath: string): string[] {
    const available = new Set(this.cppSourceCandidates.map((file) => file.path));
    const selected = this.cppSelectedSources.filter((path) => available.has(path));
    return selected.includes(entryPath) ? [...selected] : [entryPath, ...selected];
  }

  private dirtyRunInputForProfile(profile: RunProfile): IdeFile | undefined {
    const runInputs = new Set([profile.entryFile, ...(profile.sourceFiles ?? [])]);
    return this.ideFiles.find(
      (file) => runInputs.has(file.path) && file.workspaceFile && file.status !== 'saved',
    );
  }

  private async runDesktopProfile(profile: RunProfile): Promise<void> {
    if (!this.workspace?.trusted || !window.codeyo) {
      this.workspaceNotice = 'TRUST WORKSPACE BEFORE RUNNING CODE.';
      this.renderDesktopState();
      return;
    }
    if (this.runBusy) {
      return;
    }
    this.terminalPaneOpen = true;
    const dirtyInput = this.dirtyRunInputForProfile(profile);
    if (dirtyInput) {
      this.runnerStore.setPendingRun(profile, dirtyInput.path);
      this.desktopOutput = [
        `$ RUN ${profile.name}`,
        `UNSAVED BUFFER · ${dirtyInput.path}`,
        'Choose Save and Run to write pending inputs, or cancel this run.',
      ];
      this.workspaceNotice = `UNSAVED BUFFER · SAVE BEFORE RUNNING · ${dirtyInput.path}`;
      this.activeConsolePanel = 'output';
      this.renderDesktopState();
      return;
    }
    this.runnerStore.clearPendingRun();
    this.runBusy = true;
    this.workspaceNotice = `RUNNING · ${profile.name}`;
    this.renderDesktopState();
    try {
      const result = await window.codeyo.runner.run(this.workspace.id, profile);
      this.runnerStore.rememberResult(result);
      this.desktopOutput = this.runTranscriptLines(result);
      this.runTaskTranscript = [...this.desktopOutput];
      this.runTaskSequence += 1;
      this.lastRunTarget = profile.entryFile;
      this.lastRunSummary = `EXIT ${result.exitCode} · ${result.elapsedMs} MS`;
      const runNotice = result.exitCode === 0
        ? `RUN COMPLETE · ${profile.entryFile} · ${this.lastRunSummary}`
        : `RUN FAILED · ${profile.entryFile} · EXIT ${result.exitCode}`;
      this.activeConsolePanel = result.diagnostics.length > 0 ? 'problems' : 'terminal';
      const journalResult = await this.writeJournalEntry(
        'run',
        `${profile.name} · ${this.lastRunSummary}`,
        {
          runResultId: result.id,
          entryFile: result.entryFile,
          exitCode: result.exitCode,
          elapsedMs: result.elapsedMs,
          diagnostics: result.diagnostics.length,
        },
      );
      this.workspaceNotice = `${runNotice}${this.journalWriteSuffix(journalResult)}`;
    } catch (error) {
      const message = this.desktopError(error, 'RUN FAILED', profile.language);
      this.runDiagnostics = [];
      this.desktopOutput = [`$ ${profile.name}`, message];
      this.runTaskTranscript = [...this.desktopOutput];
      this.runTaskSequence += 1;
      this.lastRunTarget = profile.entryFile;
      this.lastRunSummary = message;
      this.activeConsolePanel = 'output';
      const journalResult = await this.writeJournalEntry(
        'run',
        `${profile.name} · ${message}`,
        { failed: true },
      );
      this.workspaceNotice = `${message}${this.journalWriteSuffix(journalResult)}`;
    } finally {
      this.runBusy = false;
      this.renderDesktopState();
    }
  }

  private desktopError(error: unknown, fallback: string, language?: 'python' | 'cpp'): string {
    const message = error instanceof Error ? error.message : String(error || fallback);
    if (/ENOENT|not found/i.test(message) && language === 'cpp') {
      return 'COMPILER NOT FOUND · INSTALL LLVM OR SET THE CLANG++ PATH.';
    }
    if (/ENOENT|not found/i.test(message) && language === 'python') {
      return 'PYTHON NOT FOUND · CONFIGURE A VALID INTERPRETER PATH.';
    }
    return `${fallback} · ${message}`.toUpperCase();
  }

  private computeLineComparison(leftContent: string, rightContent: string): LineComparison {
    const left = leftContent ? leftContent.replace(/\n$/, '').split('\n') : [];
    const right = rightContent ? rightContent.replace(/\n$/, '').split('\n') : [];
    if (left.length * right.length > 500000) {
      let prefix = 0;
      while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) {
        prefix += 1;
      }
      let suffix = 0;
      while (
        suffix < left.length - prefix
        && suffix < right.length - prefix
        && left[left.length - suffix - 1] === right[right.length - suffix - 1]
      ) {
        suffix += 1;
      }
      const leftLines = Array.from(
        { length: left.length - prefix - suffix },
        (_value, index) => prefix + index + 1,
      );
      const rightLines = Array.from(
        { length: right.length - prefix - suffix },
        (_value, index) => prefix + index + 1,
      );
      return {
        added: rightLines.length,
        removed: leftLines.length,
        leftLines,
        rightLines,
        hunks: leftLines.length || rightLines.length ? [{
          id: 1,
          snapshotStart: prefix + 1,
          currentStart: prefix + 1,
          snapshotLines: left.slice(prefix, left.length - suffix),
          currentLines: right.slice(prefix, right.length - suffix),
        }] : [],
      };
    }
    const common = Array.from(
      { length: left.length + 1 },
      () => new Uint32Array(right.length + 1),
    );
    for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
      for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
        common[leftIndex][rightIndex] = left[leftIndex] === right[rightIndex]
          ? common[leftIndex + 1][rightIndex + 1] + 1
          : Math.max(common[leftIndex + 1][rightIndex], common[leftIndex][rightIndex + 1]);
      }
    }
    const leftLines: number[] = [];
    const rightLines: number[] = [];
    const hunks: LineDiffHunk[] = [];
    let leftIndex = 0;
    let rightIndex = 0;
    let hunk: LineDiffHunk | undefined;
    const startHunk = (): LineDiffHunk => {
      hunk ??= {
        id: hunks.length + 1,
        snapshotStart: leftIndex + 1,
        currentStart: rightIndex + 1,
        snapshotLines: [],
        currentLines: [],
      };
      return hunk;
    };
    const finishHunk = (): void => {
      if (hunk) {
        hunks.push(hunk);
        hunk = undefined;
      }
    };
    while (leftIndex < left.length && rightIndex < right.length) {
      if (left[leftIndex] === right[rightIndex]) {
        finishHunk();
        leftIndex += 1;
        rightIndex += 1;
      } else if (common[leftIndex + 1][rightIndex] >= common[leftIndex][rightIndex + 1]) {
        leftLines.push(leftIndex + 1);
        startHunk().snapshotLines.push(left[leftIndex]);
        leftIndex += 1;
      } else {
        rightLines.push(rightIndex + 1);
        startHunk().currentLines.push(right[rightIndex]);
        rightIndex += 1;
      }
    }
    while (leftIndex < left.length) {
      leftLines.push(leftIndex + 1);
      startHunk().snapshotLines.push(left[leftIndex]);
      leftIndex += 1;
    }
    while (rightIndex < right.length) {
      rightLines.push(rightIndex + 1);
      startHunk().currentLines.push(right[rightIndex]);
      rightIndex += 1;
    }
    finishHunk();
    return {
      added: rightLines.length,
      removed: leftLines.length,
      leftLines,
      rightLines,
      hunks,
    };
  }

  private findWorkspaceBuffer(filePath: string): IdeFile | undefined {
    const normalized = this.normalizedPath(filePath);
    return this.ideFiles.find((file) => this.normalizedPath(file.path) === normalized);
  }

  private findGitFileState(filePath: string): GitFileState | undefined {
    const normalized = this.normalizedPath(filePath);
    return this.gitStatus?.files.find((file) => this.normalizedPath(file.path) === normalized);
  }

  private clearGitComparison(): void {
    this.gitStore.clearComparison();
    this.reviewSnapshotDraft = '';
    this.selectedReviewRunResultId = '';
    this.selectedCommitRunResultId = '';
  }

  private async refreshJournal(options: { noticeOnFailure?: boolean } = {}): Promise<boolean> {
    if (!this.workspace || !window.codeyo) {
      return false;
    }
    try {
      this.journalEntries = await window.codeyo.journal.list(this.workspace.id);
      this.renderDesktopState();
      return true;
    } catch (error) {
      if (options.noticeOnFailure ?? true) {
        this.workspaceNotice = this.desktopError(error, 'COULD NOT REFRESH JOURNAL');
        this.renderDesktopState();
      }
      return false;
    }
  }

  private async writeJournalEntry(
    kind: JournalEntry['kind'],
    body: string,
    metadata?: Record<string, unknown>,
  ): Promise<JournalWriteResult> {
    if (!this.workspace || !window.codeyo) {
      return { status: 'skipped' };
    }
    try {
      await window.codeyo.journal.add(this.workspace.id, kind, body, metadata);
    } catch (error) {
      return { status: 'write-failed', detail: this.desktopError(error, 'JOURNAL WRITE FAILED') };
    }
    const refreshed = await this.refreshJournal({ noticeOnFailure: false });
    return { status: refreshed ? 'saved' : 'refresh-failed' };
  }

  private journalWriteSuffix(result: JournalWriteResult): string {
    if (result.status === 'refresh-failed') {
      return ' · JOURNAL REFRESH FAILED';
    }
    if (result.status === 'write-failed') {
      return ` · ${result.detail ?? 'JOURNAL WRITE FAILED'}`;
    }
    return '';
  }

  private async refreshRecoveries(options: { noticeOnFailure?: boolean } = {}): Promise<boolean> {
    if (!this.workspace?.trusted || !window.codeyo) {
      this.recoveryBuffers = [];
      return false;
    }
    try {
      this.recoveryBuffers = await window.codeyo.files.listRecovery(this.workspace.id);
      this.renderDesktopState();
      return true;
    } catch (error) {
      this.recoveryBuffers = [];
      if (options.noticeOnFailure ?? true) {
        this.workspaceNotice = this.desktopError(error, 'COULD NOT REFRESH RECOVERY BUFFERS');
        this.renderDesktopState();
      }
      return false;
    }
  }

  private async refreshFileWriteState(): Promise<boolean> {
    const [, recoveriesRefreshed] = await Promise.all([
      this.refreshGit(),
      this.refreshRecoveries({ noticeOnFailure: false }),
    ]);
    return recoveriesRefreshed;
  }

  private async loadRunnerWorkspaceState(): Promise<{ profilesLoaded: boolean; historyLoaded: boolean }> {
    if (!this.workspace || !window.codeyo) {
      return { profilesLoaded: false, historyLoaded: false };
    }
    const [profilesResult, historyResult] = await Promise.allSettled([
      window.codeyo.runner.profiles(this.workspace.id),
      window.codeyo.runner.history(this.workspace.id),
    ]);
    if (profilesResult.status === 'fulfilled') {
      this.applyRunProfiles(profilesResult.value);
    }
    if (historyResult.status === 'fulfilled') {
      this.recentRunResults = historyResult.value;
    }
    return {
      profilesLoaded: profilesResult.status === 'fulfilled',
      historyLoaded: historyResult.status === 'fulfilled',
    };
  }

  private applyRunProfiles(profiles: RunProfile[]): void {
    for (const profile of profiles) {
      this.applyRunProfile(profile);
    }
  }

  private applyRunProfile(profile: RunProfile): void {
    if (profile.language === 'python') {
      if (profile.command) {
        this.projectSettingsStore.update(this.workspace, 'pythonCommand', profile.command);
        this.writeWorkspaceStringSetting('python-command', profile.command);
      }
      if (this.activeIdeFile.lang === 'python') {
        this.projectSettingsStore.update(this.workspace, 'profileArgs', profile.args?.join(' ') ?? '');
      }
      return;
    }
    if (profile.command) {
      this.projectSettingsStore.update(this.workspace, 'cppCommand', profile.command);
      this.writeWorkspaceStringSetting('cpp-command', profile.command);
    }
    if (this.activeIdeFile.lang === 'cpp') {
      this.projectSettingsStore.update(this.workspace, 'profileArgs', profile.args?.join(' ') ?? '');
    }
    this.projectSettingsStore.update(this.workspace, 'cppProgramArgs', profile.programArgs?.join(' ') ?? '');
    if (profile.sourceFiles?.length) {
      this.cppSelectedSources = profile.sourceFiles.filter((path) =>
        this.cppSourceCandidates.some((file) => file.path === path));
      this.ensureCppSourceSelection();
    }
  }

  private appendWorkspaceSidecarWarning(
    journalLoaded: boolean,
    recoveriesLoaded: boolean,
    runnerLoaded: boolean,
  ): void {
    const unavailable = [
      ...(journalLoaded ? [] : ['JOURNAL']),
      ...(recoveriesLoaded ? [] : ['RECOVERY']),
      ...(runnerLoaded ? [] : ['RUNNER STATE']),
    ];
    if (unavailable.length > 0) {
      this.workspaceNotice = `${this.workspaceNotice} · ${unavailable.join(', ')} UNAVAILABLE`;
    }
  }

  private appendStorageMigrationWarning(journalLoaded: boolean, recoveriesLoaded: boolean): void {
    const failed = [
      ...(journalLoaded ? [] : ['JOURNAL']),
      ...(recoveriesLoaded ? [] : ['RECOVERY']),
    ];
    if (failed.length > 0) {
      this.workspaceNotice = `${this.workspaceNotice} · ${failed.join(', ')} REFRESH FAILED`;
    }
  }

  private appendRecoveryRefreshWarning(recoveriesLoaded: boolean): void {
    if (!recoveriesLoaded) {
      this.workspaceNotice = `${this.workspaceNotice} · RECOVERY REFRESH FAILED`;
    }
  }

  private async ensureRunEvidence(runResultId: string): Promise<RunResult | null> {
    const existing = this.recentRunResults.find((result) => result.id === runResultId);
    if (existing) {
      return existing;
    }
    if (!this.workspace || !window.codeyo) {
      return null;
    }
    const result = await window.codeyo.runner.getResult(this.workspace.id, runResultId);
    if (!result) {
      return null;
    }
    this.runnerStore.rememberEvidence(result);
    return result;
  }

  private openRunEvidence(result: RunResult): void {
    this.runDiagnostics = result.diagnostics;
    this.desktopOutput = this.runTranscriptLines(result);
    this.runTaskTranscript = [...this.desktopOutput];
    this.runTaskSequence += 1;
    this.lastRunTarget = result.entryFile;
    this.lastRunSummary = `EXIT ${result.exitCode} · ${result.elapsedMs} MS`;
    this.workspaceNotice = `RUN EVIDENCE OPENED · ${result.entryFile} · ${this.lastRunSummary}`;
    this.activeChannelId = 'ide';
    this.activeChannelView = 'ide';
    this.activeRightPanel = 'files';
    this.activeConsolePanel = result.diagnostics.length > 0 ? 'problems' : 'output';
    this.renderDesktopState();
  }

  private refreshConflictComparison(): void {
    this.conflictComparison = this.fileConflict && !this.fileConflict.deleted
      ? this.computeLineComparison(this.fileConflict.diskContent, this.activeEditorText)
      : {
          added: 0,
          removed: 0,
          leftLines: [],
          rightLines: [],
          hunks: [],
        };
  }

  private async createDesktopReview(): Promise<void> {
    if (!this.workspace?.trusted || !window.codeyo) {
      this.workspaceNotice = 'TRUST WORKSPACE BEFORE CREATING A SNAPSHOT.';
      return;
    }
    try {
      const note = `REVIEW SNAPSHOT · ${this.activeIdeFile.path} · ${this.activeSaveLabel}`;
      const runEvidence = this.activeBufferRunEvidence;
      await window.codeyo.journal.snapshot(
        this.workspace.id,
        [{ path: this.activeIdeFile.path, content: this.activeEditorText }],
        note,
        runEvidence?.id,
      );
      const journalRefreshed = await this.refreshJournal({ noticeOnFailure: false });
      this.workspaceNotice = runEvidence
        ? `REVIEW SNAPSHOT + RUN EVIDENCE · ${this.activeIdeFile.path}`
        : `REVIEW SNAPSHOT SAVED · ${this.activeIdeFile.path}`;
      if (!journalRefreshed) {
        this.workspaceNotice += ' · JOURNAL REFRESH FAILED';
      }
      this.selectChannel('snapshots');
    } catch (error) {
      this.workspaceNotice = this.desktopError(error, 'COULD NOT SAVE REVIEW SNAPSHOT');
    } finally {
      this.renderDesktopState();
    }
  }

  private async shareDesktopRun(): Promise<void> {
    if (!this.workspace || !window.codeyo) {
      return;
    }
    const result = await this.writeJournalEntry(
      'run',
      `SHARED RUN · ${this.lastRunTarget} · ${this.lastRunSummary}`,
    );
    if (result.status === 'write-failed') {
      this.workspaceNotice = result.detail ?? 'JOURNAL WRITE FAILED';
      this.renderDesktopState();
      return;
    }
    this.workspaceNotice = `SHARED RUN SAVED${this.journalWriteSuffix(result)}`;
    this.selectChannel('run-log');
    this.renderDesktopState();
  }

  async openSnapshot(snapshotId: string): Promise<void> {
    if (!this.workspace || !window.codeyo) {
      return;
    }
    try {
      const snapshot = await window.codeyo.journal.getSnapshot(this.workspace.id, snapshotId);
      if (!snapshot) {
        this.closeSnapshot();
        this.workspaceNotice = `SNAPSHOT NOT FOUND · ${snapshotId}`;
        return;
      }
      let runEvidence: RunResult | null = null;
      if (snapshot.runResultId) {
        try {
          runEvidence = await window.codeyo.runner.getResult(this.workspace.id, snapshot.runResultId);
          if (!runEvidence) {
            this.workspaceNotice = `RUN EVIDENCE NOT FOUND · ${snapshot.runResultId}`;
          }
        } catch (error) {
          this.workspaceNotice = this.desktopError(error, `RUN EVIDENCE UNAVAILABLE · ${snapshot.runResultId}`);
        }
      }
      this.snapshotStore.open(snapshot, runEvidence);
      this.selectChannel('snapshots');
      await this.loadSnapshotCurrentContent();
    } catch (error) {
      this.closeSnapshot();
      this.workspaceNotice = this.desktopError(error, 'COULD NOT OPEN REVIEW SNAPSHOT');
    } finally {
      this.renderDesktopState();
    }
  }

  async selectSnapshotFile(filePath: string): Promise<void> {
    if (!this.snapshotStore.selectFile(filePath)) {
      return;
    }
    await this.loadSnapshotCurrentContent();
    this.renderDesktopState();
  }

  toggleSnapshotEvidence(): void {
    this.snapshotStore.toggleEvidence();
    this.renderDesktopState();
  }

  async openSnapshotDiagnostic(diagnostic: EditorDiagnostic): Promise<void> {
    const file = this.snapshotFileForDiagnostic(diagnostic);
    if (!file || !this.canRevealSnapshotDiagnostic(diagnostic)) {
      this.workspaceNotice = `DIAGNOSTIC SOURCE DOES NOT MATCH SNAPSHOT · ${diagnostic.path}`;
      this.renderDesktopState();
      return;
    }
    this.snapshotStore.selectFile(file.path);
    this.snapshotStore.revealDiagnostic(diagnostic);
    await this.loadSnapshotCurrentContent();
    this.renderDesktopState();
  }

  replaySnapshotRunInTerminal(): void {
    if (!this.snapshotRunResult) {
      return;
    }
    const result = this.snapshotRunResult;
    this.desktopOutput = this.runTranscriptLines(result);
    this.runTaskTranscript = [...this.desktopOutput];
    this.runTaskSequence += 1;
    this.runDiagnostics = result.diagnostics;
    this.lastRunTarget = result.entryFile;
    this.lastRunSummary = `EXIT ${result.exitCode} · ${result.elapsedMs} MS`;
    this.workspaceNotice = `CAPTURED RUN OPENED · ${result.entryFile} · ${this.lastRunSummary}`;
    this.closeSnapshot();
    this.activeChannelId = 'ide';
    this.activeChannelView = 'ide';
    this.activeRightPanel = 'files';
    this.activeConsolePanel = 'terminal';
    this.renderDesktopState();
  }

  closeSnapshot(): void {
    this.snapshotStore.close();
  }

  toggleSnapshotCompare(): void {
    this.snapshotCompareOpen = !this.snapshotCompareOpen;
  }

  restoreSnapshotHunk(hunkId: number): void {
    const file = this.activeSnapshotFile.path ? this.activeSnapshotFile : undefined;
    const target = file && this.findWorkspaceBuffer(file.path);
    if (!file || !target?.workspaceFile || target.missingOnDisk) {
      this.workspaceNotice = 'CURRENT FILE IS MISSING · FORK OR RESTORE THE FULL SNAPSHOT.';
      this.renderDesktopState();
      return;
    }
    const currentContent = target.lines.join('\n');
    const comparison = this.computeLineComparison(file.content, currentContent);
    const hunk = comparison.hunks.find((candidate) => candidate.id === hunkId);
    if (!hunk) {
      this.workspaceNotice = `HUNK ${hunkId} IS ALREADY RESOLVED.`;
      this.loadSnapshotComparison();
      this.renderDesktopState();
      return;
    }
    target.lines.splice(hunk.currentStart - 1, hunk.currentLines.length, ...hunk.snapshotLines);
    target.status = 'edited';
    this.fileConflict = null;
    this.snapshotCurrentContent = target.lines.join('\n');
    this.snapshotCurrentMissing = false;
    this.loadSnapshotComparison();
    if (this.workspace?.trusted) {
      void this.backupRecoveryBuffer(this.workspace.id, target.path, this.snapshotCurrentContent);
    }
    this.workspaceNotice = `RESTORED HUNK ${hunkId} TO UNSAVED BUFFER · ${target.path}`;
    this.renderDesktopState();
  }

  restoreSnapshotToBuffer(): void {
    const file = this.activeSnapshotFile.path ? this.activeSnapshotFile : undefined;
    const target = file && this.ideFiles.find((buffer) => buffer.path === file.path);
    if (!file || !target?.workspaceFile) {
      this.workspaceNotice = 'ORIGINAL FILE IS MISSING · FORK THE SNAPSHOT TO RESTORE IT.';
      this.renderDesktopState();
      return;
    }
    this.activeIdePath = target.path;
    target.lines = file.content.split('\n');
    target.status = 'edited';
    this.fileConflict = null;
    if (this.workspace?.trusted) {
      void this.backupRecoveryBuffer(this.workspace.id, target.path, file.content);
    }
    this.workspaceNotice = `RESTORED TO UNSAVED BUFFER · ${target.path} · SAVE TO WRITE`;
    this.snapshotPreview = null;
    this.snapshotActivePath = '';
    this.snapshotRunResult = null;
    this.snapshotEvidenceOpen = false;
    this.snapshotCompareOpen = false;
    this.activeChannelId = 'ide';
    this.activeChannelView = 'ide';
    this.activeRightPanel = 'files';
    this.renderDesktopState();
  }

  forkSnapshot(): void {
    const file = this.activeSnapshotFile.path ? this.activeSnapshotFile : undefined;
    if (!file) {
      return;
    }
    const suffix = file.path.lastIndexOf('.');
    const name = suffix > 0
      ? `${file.path.slice(0, suffix)}-review${file.path.slice(suffix)}`
      : `${file.path}-review`;
    void this.createDesktopFile(name, file.content);
    this.snapshotPreview = null;
    this.snapshotActivePath = '';
    this.snapshotRunResult = null;
    this.snapshotEvidenceOpen = false;
    this.activeChannelId = 'ide';
    this.activeChannelView = 'ide';
  }

  private async loadSnapshotCurrentContent(): Promise<void> {
    this.snapshotCurrentContent = '';
    this.snapshotCurrentMissing = false;
    this.loadSnapshotComparison();
    const filePath = this.activeSnapshotFile.path;
    if (!filePath || !this.workspace || !window.codeyo) {
      return;
    }
    const openBuffer = this.findWorkspaceBuffer(filePath);
    if (openBuffer?.lines.length) {
      this.snapshotCurrentContent = openBuffer.lines.join('\n');
      this.snapshotCurrentMissing = Boolean(openBuffer.missingOnDisk);
      this.loadSnapshotComparison();
      return;
    }
    try {
      const current = await window.codeyo.files.read(this.workspace.id, filePath);
      this.snapshotCurrentContent = current.content;
    } catch {
      this.snapshotCurrentMissing = true;
    }
    this.loadSnapshotComparison();
  }

  private loadSnapshotComparison(): void {
    this.snapshotComparison = this.computeLineComparison(
      this.activeSnapshotFile.content,
      this.snapshotCurrentContent,
    );
  }

  private runTranscriptLines(result: RunResult): string[] {
    return [
      `$ ${result.profileName}`,
      ...(result.stdout ? result.stdout.trimEnd().split('\n') : []),
      ...(result.stderr ? result.stderr.trimEnd().split('\n') : []),
      `EXIT ${result.exitCode} · ${result.elapsedMs} MS`,
    ];
  }

  private normalizedPath(filePath: string): string {
    return filePath.replace(/\\/g, '/');
  }

  private snapshotFileForDiagnostic(diagnostic: EditorDiagnostic): { path: string; content: string } | undefined {
    const diagnosticPath = this.normalizedPath(diagnostic.path);
    return this.snapshotPreview?.files.find(
      (file) => this.normalizedPath(file.path) === diagnosticPath,
    );
  }

  private renderDesktopState(): void {
    this.changeDetector.markForCheck();
  }
}
