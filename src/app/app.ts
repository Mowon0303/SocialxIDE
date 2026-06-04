import {
  ChangeDetectorRef,
  Component,
  HostListener,
  OnDestroy,
  OnInit,
  ViewEncapsulation,
} from '@angular/core';
import { CodeEditorComponent } from './code-editor.component';
import { DesktopTerminalComponent } from './desktop-terminal.component';
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

type ScreenId = 'channels' | 'dm' | 'command' | 'components';
type ChannelView = 'thread' | 'ide';
type RightPanel = 'contributors' | 'files' | 'git' | 'settings';
type ConsolePanel = 'terminal' | 'problems' | 'output';
type JournalKindFilter = 'all' | JournalEntry['kind'];
type JournalWriteStatus = 'saved' | 'refresh-failed' | 'write-failed' | 'skipped';

interface JournalWriteResult {
  status: JournalWriteStatus;
  detail?: string;
}

interface IdeFile {
  name: string;
  path: string;
  lang: EditorLanguage;
  status: 'saved' | 'edited' | 'new';
  lines: string[];
  builtIn?: boolean;
  diskVersion?: string;
  workspaceFile?: boolean;
  missingOnDisk?: boolean;
}

type FileWriteResult = {
  conflict: boolean;
  diskVersion: string;
  diskContent?: string;
  deleted?: boolean;
};

interface ExplorerTreeNode {
  name: string;
  path: string;
  kind: 'folder' | 'file';
  children: Map<string, ExplorerTreeNode>;
  file?: IdeFile;
}

interface ExplorerTreeEntry {
  id: string;
  name: string;
  path: string;
  kind: 'folder' | 'file';
  depth: number;
  expanded?: boolean;
  file?: IdeFile;
}

interface ThreadUpdate {
  file: string;
  result: string;
  time: string;
  kind: 'run' | 'review';
}

interface ChannelItem {
  id: string;
  index: string;
  name: string;
  topic: string;
  unread?: number;
  mention?: boolean;
  marker?: boolean;
}

interface DmThread {
  id: string;
  initials: string;
  name: string;
  preview: string;
  time: string;
  title: string;
  subtitle: string;
  messages: {
    author: string;
    time: string;
    body: string;
    mine?: boolean;
    quote?: string;
    ps?: string;
  }[];
}

interface LineComparison {
  added: number;
  removed: number;
  leftLines: number[];
  rightLines: number[];
  hunks: LineDiffHunk[];
}

interface LineDiffHunk {
  id: number;
  snapshotStart: number;
  currentStart: number;
  snapshotLines: string[];
  currentLines: string[];
}

@Component({
  selector: 'app-root',
  imports: [CodeEditorComponent, DesktopTerminalComponent],
  templateUrl: './app.html',
  styleUrls: ['./app.css', './git-panel.css'],
  encapsulation: ViewEncapsulation.None,
})
export class App implements OnInit, OnDestroy {
  readonly isDesktop = typeof window !== 'undefined' && Boolean(window.codeyo);
  focusedScreen: ScreenId | null = 'channels';
  activeChannelView: ChannelView = 'ide';
  activeChannelId = 'homework';
  activeDmId = 'plum';
  activeRightPanel: RightPanel = 'files';
  activeConsolePanel: ConsolePanel = 'terminal';
  activeIdePath = 'fib.py';
  assistantPanelOpen = true;
  assistantNotice = 'Assist slot is paused for v0.1. Use run output, diagnostics, Git, and journal entries for review.';
  lastSavedAt = '14:24';
  workspaceExpanded = true;
  srcExpanded = true;
  fileQuery = '';
  explorerTreeEntries: ExplorerTreeEntry[] = [];
  quickOpenVisible = false;
  quickOpenQuery = '';
  quickOpenIndex = 0;
  readonly expandedExplorerDirs = new Set<string>();
  private explorerTreeRebuildQueued = false;
  creatingFile = false;
  newFileName = '';
  terminalCommand = '';
  runShared = false;
  lastRunTarget = 'fib.py';
  lastRunSummary = 'memo hits: 38 · cache size: 41';
  threadUpdates: ThreadUpdate[] = [];
  workspace: WorkspaceHandle | null = null;
  recentWorkspace: WorkspaceHandle | null = null;
  workspaceNotice = 'OPEN A LOCAL FOLDER TO BEGIN YOUR DESKTOP WORKSPACE.';
  desktopOutput: string[] = [];
  runTaskTranscript: string[] = [];
  runTaskSequence = 0;
  runDiagnostics: EditorDiagnostic[] = [];
  recentRunResults: RunResult[] = [];
  recoveryBuffers: RecoveryBuffer[] = [];
  diagnosticRevealLine = 0;
  diagnosticRevealColumn = 1;
  diagnosticRevealRequest = 0;
  journalEntries: JournalEntry[] = [];
  journalDraft = '';
  journalQuery = '';
  journalKindFilter: JournalKindFilter = 'all';
  gitStatus: GitStatus | null = null;
  gitBranches: string[] = [];
  gitStagedSummary: GitStagedSummary = { files: [], additions: 0, deletions: 0 };
  selectedBranch = '';
  gitNotice = 'OPEN AND TRUST A WORKSPACE TO INSPECT GIT.';
  gitComparison: GitComparison | null = null;
  gitComparisonLeftLines: number[] = [];
  gitComparisonRightLines: number[] = [];
  gitComparisonAdded = 0;
  gitComparisonRemoved = 0;
  gitHunks: LineDiffHunk[] = [];
  pendingDiscardHunkId: number | null = null;
  gitHistoryDetail: GitCommitDetail | null = null;
  gitHistory: GitCommitSummary[] = [];
  gitHistoryQuery = '';
  reviewSnapshotDraft = '';
  selectedReviewRunResultId = '';
  selectedCommitRunResultId = '';
  commitMessage = '';
  branchName = '';
  pythonExecutable = 'python3';
  cppExecutable = 'clang++';
  profileArgs = '';
  cppProgramArgs = '';
  cppSelectedSources: string[] = [];
  environmentChecks: ToolCheckResult[] = [];
  fileConflict: { diskContent: string; diskVersion: string; deleted?: boolean } | null = null;
  conflictCompareOpen = false;
  conflictComparison: LineComparison = {
    added: 0,
    removed: 0,
    leftLines: [],
    rightLines: [],
    hunks: [],
  };
  snapshotPreview: ReviewSnapshot | null = null;
  snapshotActivePath = '';
  snapshotRunResult: RunResult | null = null;
  snapshotEvidenceOpen = false;
  snapshotDiagnosticRevealLine = 0;
  snapshotDiagnosticRevealColumn = 1;
  snapshotDiagnosticRevealRequest = 0;
  snapshotCompareOpen = false;
  snapshotCurrentContent = '';
  snapshotCurrentMissing = false;
  snapshotComparison: LineComparison = {
    added: 0,
    removed: 0,
    leftLines: [],
    rightLines: [],
    hunks: [],
  };
  storageBusy = false;
  runBusy = false;
  gitBusy = false;
  gitCompareBusy = false;
  gitSnapshotBusy = false;
  environmentBusy = false;
  commitReviewOpen = false;
  autoSaveEnabled = false;
  readonly autoSaveDelayMs = 1400;
  private readonly recoveryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly autoSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private removeFileChangeListener?: () => void;
  runOutput = [
    '$ python fib.py',
    'fib(40) = 102334155',
    'memo hits: 38 · cache size: 41',
    'done in 0.0002s',
  ];

  readonly channels: ChannelItem[] = [
    { id: 'homework', index: '01', name: 'Workspace', topic: 'local buffers · fib.py' },
    { id: 'chat', index: '02', name: 'Run Logs', topic: 'terminal output · diagnostics', unread: 12 },
    { id: 'intro', index: '03', name: 'Journal', topic: 'notes · decisions · handoff', unread: 1, mention: true },
    { id: 'resources', index: '04', name: 'Snapshots', topic: 'review sets · run evidence' },
    { id: 'bugs', index: '05', name: 'Problems', topic: 'debug desk · blockers', marker: true },
  ];

  readonly dmThreads: DmThread[] = [
    {
      id: 'plum',
      initials: 'PL',
      name: 'plum',
      preview: 'memo 是不是就像一个答案小本子?',
      time: '2m',
      title: 'Dear plum,',
      subtitle: '3 letters today · 47 letters all-time',
      messages: [
        {
          author: 'you',
          time: '今天 · 14:08',
          mine: true,
          body: '看了你贴的 fib - 那是个经典的“重复子问题”。每次 fib(n) 都会去算 fib(n-1) 和 fib(n-2), 而 fib(n-1) 又会再算 fib(n-2)... fib(n-3)...重复爆炸。',
          ps: '你可以把递归树画出来感受一下, n=5 都已经有 15 个节点了。',
        },
        {
          author: 'plum',
          time: '今天 · 14:11',
          body: '哦哦明白！所以 memo 就是把算过的存起来, 下次直接取?',
        },
        {
          author: 'you',
          time: '今天 · 14:12',
          mine: true,
          body: '就是这个。空间换时间 - 多用一个字典换来速度 1000 倍。',
          ps: '一句话总结：能记住的别再算。',
        },
        {
          author: 'plum',
          time: '今天 · 14:14',
          body: '谢谢救命之恩🍀 我去改了',
        },
      ],
    },
    {
      id: 'review',
      initials: 'RV',
      name: 'Review Notes',
      preview: 'Run evidence and snapshot notes are ready.',
      time: '14m',
      title: 'Dear review log,',
      subtitle: 'Local notes keep run results and explanations together.',
      messages: [
        {
          author: 'review log',
          time: '14:19',
          body: '把 fib 的解释保留成三步：先看重复子问题, 再加 cache, 最后用大输入验证。',
        },
        {
          author: 'you',
          time: '14:20',
          mine: true,
          body: '保持这个结构。等会儿把 run evidence 附到 review snapshot 里。',
        },
      ],
    },
    {
      id: 'jay',
      initials: 'JY',
      name: 'jay',
      preview: '库图发你了, 同关我们...',
      time: '1h',
      title: 'Dear jay,',
      subtitle: '递归树草图和频道置顶建议。',
      messages: [
        {
          author: 'jay',
          time: '14:09',
          body: '你看这张树图能不能放频道置顶? 左边展开, 右边 memo 后收束。',
        },
        {
          author: 'you',
          time: '14:12',
          mine: true,
          body: '可以, 先放到 Snapshots, 再在 Workspace 里引用。',
        },
      ],
    },
    {
      id: 'kiwi',
      initials: 'K',
      name: 'kiwi',
      preview: '直播结束！谢谢来听 ❤',
      time: '3h',
      title: 'Dear kiwi,',
      subtitle: '直播排期和 React 片段。',
      messages: [
        {
          author: 'kiwi',
          time: '今天 · 13:42',
          body: '直播结束！谢谢来听。我想把 memo 例子做成下次直播里的第一个片段。',
        },
        {
          author: 'you',
          time: '今天 · 13:47',
          mine: true,
          body: '可以, 我先把 IDE 里的 fib.py 保存成 review snapshot。',
        },
      ],
    },
    {
      id: 'nori',
      initials: 'N',
      name: 'nori',
      preview: '问包那个, 我重新写了',
      time: 'YD',
      title: 'Dear nori,',
      subtitle: '重写记录和包管理笔记。',
      messages: [
        {
          author: 'nori',
          time: '昨天 · 18:04',
          body: '问包那个, 我重新写了。现在 import 和 run profile 都清楚多了。',
        },
      ],
    },
    {
      id: 'mochi',
      initials: 'M',
      name: 'mochi',
      preview: '看到你的提交了, 干净',
      time: 'YD',
      title: 'Dear mochi,',
      subtitle: '关于干净提交和 review snapshot。',
      messages: [
        {
          author: 'mochi',
          time: '昨天 · 16:10',
          body: '看到你的提交了, 干净。那个 snapshot 对比特别适合给新人看。',
        },
      ],
    },
    {
      id: 'tofu',
      initials: 'T',
      name: 'tofu',
      preview: '《升鲸录》写好了 lol',
      time: '2D',
      title: 'Dear tofu,',
      subtitle: '频道小报和周末片段。',
      messages: [
        {
          author: 'tofu',
          time: '周二 · 21:30',
          body: '《升鲸录》写好了 lol。等你把 component sheet 也放进去。',
        },
      ],
    },
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

  constructor(private readonly changeDetector: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.rebuildExplorerTree();
    if (this.isDesktop) {
      this.removeFileChangeListener = window.codeyo?.files.onChanged((change) => {
        void this.handleWorkspaceFileChange(change);
      });
      void this.loadRecentWorkspaceHint();
    }
  }

  ngOnDestroy(): void {
    this.clearWorkspaceTimers();
    this.removeFileChangeListener?.();
  }

  get activeIdeFile(): IdeFile {
    return this.ideFiles.find((file) => file.path === this.activeIdePath) ?? this.ideFiles[0];
  }

  get activeEditorText(): string {
    return this.activeIdeFile.lines.join('\n');
  }

  get activeDiagnostics(): EditorDiagnostic[] {
    return this.runDiagnostics.filter((diagnostic) => diagnostic.path === this.activeIdeFile.path);
  }

  get activeSnapshotFile(): { path: string; content: string } {
    return this.snapshotPreview?.files.find((file) => file.path === this.snapshotActivePath)
      ?? this.snapshotPreview?.files[0]
      ?? { path: '', content: '' };
  }

  get snapshotLanguage(): EditorLanguage {
    const path = this.activeSnapshotFile.path;
    if (path.endsWith('.py')) {
      return 'python';
    }
    return /\.(cpp|cc|cxx|hpp|h)$/.test(path) ? 'cpp' : 'text';
  }

  get snapshotDiffSummary(): string {
    return this.snapshotCurrentMissing
      ? 'CURRENT FILE MISSING ON DISK'
      : `${this.snapshotComparison.hunks.length} HUNKS · +${this.snapshotComparison.added} / -${this.snapshotComparison.removed} · SNAPSHOT TO CURRENT`;
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
    return this.gitStatus?.files.filter((file) => file.index !== ' ' && file.index !== '?') ?? [];
  }

  get unstagedGitFiles(): GitFileState[] {
    return this.gitStatus?.files.filter((file) => file.workingTree !== ' ') ?? [];
  }

  get canReviewCommit(): boolean {
    return this.stagedGitFiles.length > 0 && Boolean(this.commitMessage.trim());
  }

  get canDeleteSelectedBranch(): boolean {
    return Boolean(this.selectedBranch && this.gitStatus && this.selectedBranch !== this.gitStatus.branch);
  }

  get filteredGitHistory(): GitCommitSummary[] {
    const query = this.gitHistoryQuery.trim().toLowerCase();
    if (!query) {
      return this.gitHistory;
    }
    return this.gitHistory.filter((commit) =>
      [commit.shortRevision, commit.revision, commit.subject, commit.author]
        .some((value) => value.toLowerCase().includes(query)));
  }

  get filteredJournalEntries(): JournalEntry[] {
    const query = this.journalQuery.trim().toLowerCase();
    return this.journalEntries.filter((entry) => {
      const kindMatches = this.journalKindFilter === 'all' || entry.kind === this.journalKindFilter;
      const queryMatches = !query || [
        entry.kind,
        entry.body,
        entry.snapshotId ?? '',
        JSON.stringify(entry.metadata ?? {}),
      ].some((value) => value.toLowerCase().includes(query));
      return kindMatches && queryMatches;
    });
  }

  journalEntryCount(kind: JournalKindFilter): number {
    return kind === 'all'
      ? this.journalEntries.length
      : this.journalEntries.filter((entry) => entry.kind === kind).length;
  }

  get cppSourceCandidates(): IdeFile[] {
    return this.ideFiles.filter((file) => /\.(cpp|cc|cxx)$/i.test(file.path));
  }

  get filteredIdeFiles(): IdeFile[] {
    const query = this.fileQuery.trim().toLowerCase();
    return query
      ? this.ideFiles.filter((file) =>
          file.name.toLowerCase().includes(query) || file.path.toLowerCase().includes(query))
      : this.ideFiles;
  }

  private rebuildExplorerTree(): void {
    const query = this.fileQuery.trim().toLowerCase();
    if (query) {
      this.explorerTreeEntries = this.filteredIdeFiles.map((file) => ({
        id: `file:${file.path}`,
        name: file.path,
        path: file.path,
        kind: 'file',
        depth: 1,
        file,
      }));
      return;
    }

    const root: ExplorerTreeNode = {
      name: '',
      path: '',
      kind: 'folder',
      children: new Map<string, ExplorerTreeNode>(),
    };
    for (const file of this.ideFiles) {
      this.addExplorerFile(root, file);
    }
    this.explorerTreeEntries = this.flattenExplorerChildren(root.children, 1);
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
    const query = this.quickOpenQuery.trim().toLowerCase();
    const ranked = this.ideFiles
      .map((file) => ({
        file,
        score: query ? this.quickOpenScore(file, query) : this.quickOpenDefaultScore(file),
      }))
      .filter((result) => Number.isFinite(result.score))
      .sort((a, b) => a.score - b.score || a.file.path.localeCompare(b.file.path));

    return ranked.slice(0, 12).map((result) => result.file);
  }

  get editedFileCount(): number {
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

  get problemLines(): string[] {
    if (this.isDesktop && this.runDiagnostics.length > 0) {
      return this.runDiagnostics.map((diagnostic) =>
        `${diagnostic.severity} L${diagnostic.line} · ${diagnostic.message}`);
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

  get activeDmThread(): DmThread {
    return this.dmThreads.find((thread) => thread.id === this.activeDmId) ?? this.dmThreads[0];
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

  openIde(): void {
    this.activeChannelView = 'ide';
    this.activeRightPanel = 'files';
  }

  setChannelView(view: ChannelView): void {
    this.activeChannelView = view;
    this.activeRightPanel = view === 'ide' ? 'files' : 'contributors';
  }

  selectChannel(channelId: string): void {
    this.activeChannelId = channelId;
    this.activeChannelView = 'thread';
    this.activeRightPanel = 'contributors';
  }

  openDm(threadId = this.activeDmId): void {
    this.activeDmId = threadId;
    this.focusScreen('dm');
  }

  selectDm(threadId: string): void {
    this.activeDmId = threadId;
  }

  setRightPanel(panel: RightPanel): void {
    this.activeRightPanel = panel;
  }

  selectIdeFile(path: string): void {
    this.clearGitComparison();
    this.activeIdePath = path;
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
    this.fileQuery = (event.target as HTMLInputElement).value;
    this.rebuildExplorerTree();
  }

  clearFileQuery(): void {
    this.fileQuery = '';
    this.rebuildExplorerTree();
  }

  openQuickOpen(): void {
    this.quickOpenVisible = true;
    this.quickOpenQuery = '';
    this.quickOpenIndex = Math.max(
      0,
      this.quickOpenResults.findIndex((file) => file.path === this.activeIdePath),
    );
    this.activeChannelView = 'ide';
    this.activeRightPanel = 'files';
  }

  closeQuickOpen(): void {
    this.quickOpenVisible = false;
    this.quickOpenQuery = '';
    this.quickOpenIndex = 0;
  }

  updateQuickOpenQuery(event: Event): void {
    this.quickOpenQuery = (event.target as HTMLInputElement).value;
    this.quickOpenIndex = 0;
  }

  moveQuickOpen(delta: number): void {
    const results = this.quickOpenResults;
    if (results.length === 0) {
      this.quickOpenIndex = 0;
      return;
    }
    this.quickOpenIndex = (this.quickOpenIndex + delta + results.length) % results.length;
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

  updateActiveFile(content: string): void {
    const file = this.activeIdeFile;
    file.lines = content.split('\n');
    this.runDiagnostics = this.runDiagnostics.filter(
      (diagnostic) => diagnostic.path !== file.path,
    );
    if (this.conflictCompareOpen) {
      this.refreshConflictComparison();
    }

    if (file.status === 'saved') {
      file.status = 'edited';
    }
    if (this.isDesktop && this.workspace?.trusted && file.workspaceFile) {
      this.scheduleRecoveryBuffer(file.path, content);
      this.scheduleAutoSave(file.path, content);
    }
  }

  saveCurrentFile(): void {
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
    this.activeConsolePanel = panel;
  }

  toggleAutoSave(): void {
    this.setAutoSave(!this.autoSaveEnabled);
  }

  setAutoSave(enabled: boolean): void {
    this.autoSaveEnabled = enabled;
    if (!this.autoSaveEnabled) {
      for (const timer of this.autoSaveTimers.values()) {
        clearTimeout(timer);
      }
      this.autoSaveTimers.clear();
    }
    this.writeWorkspaceBooleanSetting('auto-save', this.autoSaveEnabled);
    this.workspaceNotice = this.autoSaveEnabled
      ? `AUTO-SAVE ENABLED · ${this.autoSaveDelayMs / 1000}s DEBOUNCE`
      : 'AUTO-SAVE DISABLED';
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
    if (this.expandedExplorerDirs.has(folderPath)) {
      this.expandedExplorerDirs.delete(folderPath);
    } else {
      this.expandedExplorerDirs.add(folderPath);
    }
    this.scheduleExplorerTreeRebuild();
  }

  treeNodePadding(depth: number): number {
    return 7 + depth * 13;
  }

  startNewFile(): void {
    this.workspaceExpanded = true;
    this.fileQuery = '';
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
    this.fileQuery = '';
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

  deleteActiveFile(): void {
    if (!this.canDeleteActiveFile) {
      return;
    }

    if (this.isDesktop && this.workspace) {
      if (this.activeIdeFile.status !== 'saved' || this.activeIdeFile.missingOnDisk) {
        this.workspaceNotice = `SAVE OR RESOLVE BUFFER BEFORE DELETING · ${this.activeIdeFile.path}`;
        this.renderDesktopState();
        return;
      }
      if (window.confirm(`Delete ${this.activeIdeFile.path} from this workspace? This cannot be undone.`)) {
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
    if (!this.isDesktop || !this.workspace?.trusted || !window.codeyo) {
      return;
    }
    if (this.activeIdeFile.status !== 'saved') {
      this.workspaceNotice = `SAVE BUFFER BEFORE RENAMING · ${this.activeIdeFile.path}`;
      this.renderDesktopState();
      return;
    }
    const nextPath = window.prompt('Rename workspace file to:', this.activeIdeFile.path)?.trim();
    if (!nextPath || nextPath === this.activeIdeFile.path) {
      return;
    }
    void this.renameDesktopFile(nextPath);
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
    this.activeChannelView = 'thread';
    this.activeRightPanel = 'contributors';
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
    this.activeChannelView = 'thread';
    this.activeRightPanel = 'contributors';
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
    this.writeWorkspaceStringSetting('python-command', command);
  }

  private setCppExecutable(command: string): void {
    this.cppExecutable = command;
    this.environmentChecks = [];
    this.writeWorkspaceStringSetting('cpp-command', command);
  }

  private dirtyWorkspaceFiles(): IdeFile[] {
    return this.ideFiles.filter((file) => file.workspaceFile && file.status !== 'saved');
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

  private quickOpenDefaultScore(file: IdeFile): number {
    const state = file.path === this.activeIdePath ? 0 : file.status !== 'saved' ? 1 : 2;
    return state + file.path.length / 1000;
  }

  private addExplorerFile(root: ExplorerTreeNode, file: IdeFile): void {
    const parts = file.path.split(/[\\/]/).filter(Boolean);
    const fileName = parts.pop() || file.name;
    let current = root;
    let currentPath = '';
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      let folder = current.children.get(part);
      if (!folder) {
        folder = {
          name: part,
          path: currentPath,
          kind: 'folder',
          children: new Map<string, ExplorerTreeNode>(),
        };
        current.children.set(part, folder);
      }
      current = folder;
    }
    current.children.set(fileName, {
      name: fileName,
      path: file.path,
      kind: 'file',
      children: new Map<string, ExplorerTreeNode>(),
      file,
    });
  }

  private flattenExplorerChildren(
    children: Map<string, ExplorerTreeNode>,
    depth: number,
  ): ExplorerTreeEntry[] {
    const entries = [...children.values()].sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === 'folder' ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
    return entries.flatMap((node) => {
      if (node.kind === 'file') {
        return [{
          id: `file:${node.path}`,
          name: node.name,
          path: node.path,
          kind: 'file',
          depth,
          file: node.file,
        }];
      }
      const expanded = this.expandedExplorerDirs.has(node.path);
      return [
        {
          id: `folder:${node.path}`,
          name: node.name,
          path: node.path,
          kind: 'folder',
          depth,
          expanded,
        },
        ...(expanded ? this.flattenExplorerChildren(node.children, depth + 1) : []),
      ];
    });
  }

  private expandExplorerParents(files: IdeFile[]): void {
    for (const file of files) {
      const parts = file.path.split(/[\\/]/).filter(Boolean);
      parts.pop();
      let current = '';
      for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        this.expandedExplorerDirs.add(current);
      }
    }
  }

  private quickOpenScore(file: IdeFile, query: string): number {
    const terms = query.split(/\s+/).filter(Boolean);
    if (terms.length > 1) {
      return terms.reduce((total, term) => {
        if (!Number.isFinite(total)) {
          return total;
        }
        const score = this.quickOpenScore(file, term);
        return Number.isFinite(score) ? total + score : Number.POSITIVE_INFINITY;
      }, 0);
    }

    const pathScore = this.quickOpenTextScore(file.path.toLowerCase(), query);
    const nameScore = this.quickOpenTextScore(file.name.toLowerCase(), query);
    return Math.min(pathScore, nameScore + 0.5);
  }

  private quickOpenTextScore(text: string, query: string): number {
    if (text === query) {
      return 0;
    }
    if (text.startsWith(query)) {
      return 2 + text.length / 1000;
    }
    const index = text.indexOf(query);
    if (index >= 0) {
      return 8 + index / 100 + text.length / 1000;
    }

    let cursor = 0;
    let gaps = 0;
    for (const char of query) {
      const next = text.indexOf(char, cursor);
      if (next === -1) {
        return Number.POSITIVE_INFINITY;
      }
      gaps += Math.max(0, next - cursor);
      cursor = next + 1;
    }
    return 30 + gaps + text.length / 1000;
  }

  private currentTime(): string {
    return new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  async openDesktopWorkspace(): Promise<void> {
    if (!this.confirmWorkspaceChange()) {
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
    if (!this.confirmWorkspaceChange()) {
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
    try {
      this.workspace = await window.codeyo.workspace.trust(this.workspace.id);
      this.workspaceNotice = `${this.workspace.name} · TRUSTED · EXECUTION ENABLED`;
      const [, journalLoaded, recoveriesLoaded] = await Promise.all([
        this.refreshGit(),
        this.refreshJournal({ noticeOnFailure: false }),
        this.refreshRecoveries({ noticeOnFailure: false }),
      ]);
      this.appendWorkspaceSidecarWarning(journalLoaded, recoveriesLoaded, true);
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

  discardGitFile(filePath: string): void {
    if (window.confirm(`Discard all working changes in ${filePath}? This cannot be undone.`)) {
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
      this.activeChannelView = 'thread';
      this.activeRightPanel = 'contributors';
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

  switchBranch(): void {
    if (this.selectedBranch && this.selectedBranch !== this.gitStatus?.branch) {
      if (this.blockGitOperationWithUnsavedBuffers('SWITCH BRANCH')) {
        return;
      }
      if ((this.stagedGitFiles.length > 0 || this.unstagedGitFiles.length > 0) &&
        !window.confirm(`Switch to ${this.selectedBranch} with local Git changes? Git may carry or reject them.`)) {
        return;
      }
      void this.gitAction({ type: 'switch-branch', name: this.selectedBranch });
    }
  }

  deleteSelectedBranch(): void {
    if (!this.canDeleteSelectedBranch) {
      return;
    }
    if (window.confirm(`Delete local branch ${this.selectedBranch}? This cannot be undone.`)) {
      void this.gitAction({ type: 'delete-branch', name: this.selectedBranch, confirmed: true });
    }
  }

  createBranch(): void {
    if (this.branchName.trim()) {
      void this.gitAction({ type: 'create-branch', name: this.branchName.trim() });
      this.branchName = '';
    }
  }

  pullRemote(): void {
    if (!this.gitStatus) {
      return;
    }
    if (this.blockGitOperationWithUnsavedBuffers('PULL')) {
      return;
    }
    if ((this.stagedGitFiles.length > 0 || this.unstagedGitFiles.length > 0) &&
      !window.confirm('Pull with local changes in this workspace? Git may require conflict resolution.')) {
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
    this.profileArgs = (event.target as HTMLInputElement).value;
  }

  updateCppProgramArgs(event: Event): void {
    this.cppProgramArgs = (event.target as HTMLInputElement).value;
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

  toolCheckStatus(check: ToolCheckResult): string {
    return check.available ? 'Ready' : 'Missing';
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
    if (!window.confirm(`Discard recovery buffer for ${buffer.filePath}? This cannot be undone.`)) {
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
      if (!window.confirm('Write portable journal data to .codeyo/ in this workspace?')) {
        return;
      }
      addToGitignore = window.confirm('Add .codeyo/ to this project .gitignore?');
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
      this.runDiagnostics = this.runDiagnostics.filter(
        (diagnostic) => diagnostic.path !== filePath,
      );
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
        this.recentWorkspace = recent[0];
        this.workspaceNotice = `RECENT · ${recent[0].name} · OPEN FOLDER TO RESUME`;
        this.renderDesktopState();
      }
    } catch {
      this.recentWorkspace = null;
    }
  }

  private async activateDesktopWorkspace(workspace: WorkspaceHandle): Promise<void> {
    this.clearWorkspaceTimers();
    this.workspace = workspace;
    this.recentWorkspace = workspace;
    this.autoSaveEnabled = this.readWorkspaceBooleanSetting(workspace, 'auto-save', false);
    this.applyWorkspaceToolDefaults(workspace);
    this.expandedExplorerDirs.clear();
    this.desktopOutput = [];
    this.runTaskTranscript = [];
    this.runTaskSequence = 0;
    this.runDiagnostics = [];
    this.recentRunResults = [];
    this.recoveryBuffers = [];
    this.environmentChecks = [];
    this.selectedReviewRunResultId = '';
    this.clearGitComparison();
    this.fileConflict = null;
    this.conflictCompareOpen = false;
    this.workspaceNotice = workspace.trusted
      ? `${workspace.name} · TRUSTED LOCAL WORKSPACE`
      : `${workspace.name} · READ ONLY UNTIL TRUSTED`;
    await this.loadDesktopFiles();
    this.renderDesktopState();
  }

  private applyWorkspaceToolDefaults(workspace: WorkspaceHandle): void {
    const defaultPython = workspace.platform === 'win32' ? 'python' : 'python3';
    this.pythonExecutable = this.readWorkspaceStringSetting(workspace, 'python-command', defaultPython);
    this.cppExecutable = this.readWorkspaceStringSetting(workspace, 'cpp-command', 'clang++');
  }

  private confirmWorkspaceChange(): boolean {
    if (!this.workspace || !this.canSaveAll) {
      return true;
    }
    this.flushDirtyRecoveryBuffersSync();
    return window.confirm('This workspace has unsaved buffers. Switch workspaces without saving them? Recovery copies will be kept.');
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
    this.expandExplorerParents(next);
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
            this.runDiagnostics = this.runDiagnostics.filter(
              (diagnostic) => diagnostic.path !== active.path,
            );
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
      this.fileQuery = '';
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
    if (file.workspaceFile && file.status !== 'saved') {
      this.desktopOutput = [
        `$ RUN ${file.path}`,
        'UNSAVED BUFFER · RUN ABORTED',
        'SAVE OR SAVE ALL BEFORE RUNNING THE DISK FILE.',
      ];
      this.workspaceNotice = `UNSAVED BUFFER · SAVE BEFORE RUNNING · ${file.path}`;
      this.activeConsolePanel = 'output';
      this.renderDesktopState();
      return;
    }
    const profile: RunProfile = {
      id: `${file.lang}-current`,
      name: `Run ${file.name}`,
      language: file.lang,
      command: file.lang === 'cpp' ? this.cppExecutable : this.pythonExecutable,
      entryFile: file.path,
      sourceFiles: file.lang === 'cpp' ? this.selectedCppSources() : undefined,
      args: this.profileArgs.trim() ? this.profileArgs.trim().split(/\s+/) : undefined,
      programArgs: file.lang === 'cpp' && this.cppProgramArgs.trim()
        ? this.cppProgramArgs.trim().split(/\s+/) : undefined,
    };
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
    return [...this.cppSelectedSources];
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
    const runInputs = new Set([profile.entryFile, ...(profile.sourceFiles ?? [])]);
    const dirtyInput = this.ideFiles.find(
      (file) => runInputs.has(file.path) && file.workspaceFile && file.status !== 'saved',
    );
    if (dirtyInput) {
      this.desktopOutput = [
        `$ RUN ${profile.name}`,
        `UNSAVED INPUT · ${dirtyInput.path}`,
        'SAVE OR SAVE ALL BEFORE RUNNING THE DISK FILE.',
      ];
      this.workspaceNotice = `UNSAVED BUFFER · SAVE BEFORE RUNNING · ${dirtyInput.path}`;
      this.activeConsolePanel = 'output';
      this.renderDesktopState();
      return;
    }
    this.runBusy = true;
    this.workspaceNotice = `RUNNING · ${profile.name}`;
    this.renderDesktopState();
    try {
      const result = await window.codeyo.runner.run(this.workspace.id, profile);
      this.recentRunResults = [
        result,
        ...this.recentRunResults.filter((previous) => previous.id !== result.id),
      ].slice(0, 12);
      this.runDiagnostics = result.diagnostics;
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
    this.gitComparison = null;
    this.gitComparisonLeftLines = [];
    this.gitComparisonRightLines = [];
    this.gitComparisonAdded = 0;
    this.gitComparisonRemoved = 0;
    this.gitHunks = [];
    this.pendingDiscardHunkId = null;
    this.gitHistoryDetail = null;
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
        this.pythonExecutable = profile.command;
        this.writeWorkspaceStringSetting('python-command', profile.command);
      }
      if (this.activeIdeFile.lang === 'python') {
        this.profileArgs = profile.args?.join(' ') ?? '';
      }
      return;
    }
    if (profile.command) {
      this.cppExecutable = profile.command;
      this.writeWorkspaceStringSetting('cpp-command', profile.command);
    }
    if (this.activeIdeFile.lang === 'cpp') {
      this.profileArgs = profile.args?.join(' ') ?? '';
    }
    this.cppProgramArgs = profile.programArgs?.join(' ') ?? '';
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
    this.recentRunResults = [
      result,
      ...this.recentRunResults.filter((previous) => previous.id !== result.id),
    ].slice(0, 12);
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
      this.activeChannelView = 'thread';
      this.activeRightPanel = 'contributors';
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
    this.activeChannelView = 'thread';
    this.activeRightPanel = 'contributors';
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
      this.snapshotPreview = snapshot;
      this.snapshotActivePath = snapshot.files[0]?.path ?? '';
      this.snapshotRunResult = null;
      if (snapshot.runResultId) {
        try {
          this.snapshotRunResult = await window.codeyo.runner.getResult(this.workspace.id, snapshot.runResultId);
          if (!this.snapshotRunResult) {
            this.workspaceNotice = `RUN EVIDENCE NOT FOUND · ${snapshot.runResultId}`;
          }
        } catch (error) {
          this.workspaceNotice = this.desktopError(error, `RUN EVIDENCE UNAVAILABLE · ${snapshot.runResultId}`);
        }
      }
      this.snapshotEvidenceOpen = false;
      this.snapshotDiagnosticRevealLine = 0;
      this.snapshotDiagnosticRevealColumn = 1;
      this.snapshotDiagnosticRevealRequest = 0;
      this.snapshotCompareOpen = false;
      await this.loadSnapshotCurrentContent();
    } catch (error) {
      this.closeSnapshot();
      this.workspaceNotice = this.desktopError(error, 'COULD NOT OPEN REVIEW SNAPSHOT');
    } finally {
      this.renderDesktopState();
    }
  }

  async selectSnapshotFile(filePath: string): Promise<void> {
    if (!this.snapshotPreview?.files.some((file) => file.path === filePath)) {
      return;
    }
    this.snapshotActivePath = filePath;
    await this.loadSnapshotCurrentContent();
    this.renderDesktopState();
  }

  toggleSnapshotEvidence(): void {
    this.snapshotEvidenceOpen = !this.snapshotEvidenceOpen;
    this.renderDesktopState();
  }

  async openSnapshotDiagnostic(diagnostic: EditorDiagnostic): Promise<void> {
    const file = this.snapshotFileForDiagnostic(diagnostic);
    if (!file || !this.canRevealSnapshotDiagnostic(diagnostic)) {
      this.workspaceNotice = `DIAGNOSTIC SOURCE DOES NOT MATCH SNAPSHOT · ${diagnostic.path}`;
      this.renderDesktopState();
      return;
    }
    this.snapshotActivePath = file.path;
    this.snapshotDiagnosticRevealLine = diagnostic.line;
    this.snapshotDiagnosticRevealColumn = diagnostic.column ?? 1;
    this.snapshotDiagnosticRevealRequest += 1;
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
    this.activeChannelView = 'ide';
    this.activeRightPanel = 'files';
    this.activeConsolePanel = 'terminal';
    this.renderDesktopState();
  }

  closeSnapshot(): void {
    this.snapshotPreview = null;
    this.snapshotActivePath = '';
    this.snapshotRunResult = null;
    this.snapshotEvidenceOpen = false;
    this.snapshotDiagnosticRevealLine = 0;
    this.snapshotDiagnosticRevealRequest = 0;
    this.snapshotCompareOpen = false;
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
