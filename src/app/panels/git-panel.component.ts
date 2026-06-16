import { Component, EventEmitter, Input, Output } from '@angular/core';
import {
  GitAction,
  GitCommitSummary,
  GitComparison,
  GitFileState,
  GitStagedSummary,
  GitStatus,
  GitWorkspaceCompareMode,
  RunResult,
  WorkspaceHandle,
} from '../desktop-api';
import { EmptyStateComponent } from './empty-state.component';

@Component({
  selector: 'codeyo-git-panel',
  standalone: true,
  imports: [EmptyStateComponent],
  templateUrl: './git-panel.component.html',
})
export class GitPanelComponent {
  @Input() workspace: WorkspaceHandle | null = null;
  @Input() gitNotice = '';
  @Input() gitStatus: GitStatus | null = null;
  @Input() gitBranches: string[] = [];
  @Input() selectedBranch = '';
  @Input() gitBusy = false;
  @Input() gitCompareBusy = false;
  @Input() canDeleteSelectedBranch = false;
  @Input() stagedGitFiles: GitFileState[] = [];
  @Input() unstagedGitFiles: GitFileState[] = [];
  @Input() gitStagedSummary: GitStagedSummary = { files: [], additions: 0, deletions: 0 };
  @Input() gitComparison: GitComparison | null = null;
  @Input() commitMessage = '';
  @Input() recentRunResults: RunResult[] = [];
  @Input() selectedCommitRunResultId = '';
  @Input() canReviewCommit = false;
  @Input() commitReviewOpen = false;
  @Input() branchName = '';
  @Input() gitHistoryQuery = '';
  @Input() filteredGitHistory: GitCommitSummary[] = [];
  @Input() gitHistory: GitCommitSummary[] = [];
  @Input() gitHistoryDetailRevision = '';

  @Output() readonly updateSelectedBranch = new EventEmitter<Event>();
  @Output() readonly switchBranch = new EventEmitter<void>();
  @Output() readonly deleteSelectedBranch = new EventEmitter<void>();
  @Output() readonly showGitDiff = new EventEmitter<{ path: string; mode: GitWorkspaceCompareMode }>();
  @Output() readonly gitAction = new EventEmitter<GitAction>();
  @Output() readonly discardGitFile = new EventEmitter<string>();
  @Output() readonly updateCommitMessage = new EventEmitter<Event>();
  @Output() readonly updateSelectedCommitRun = new EventEmitter<Event>();
  @Output() readonly reviewCommit = new EventEmitter<void>();
  @Output() readonly cancelCommitReview = new EventEmitter<void>();
  @Output() readonly commitReviewedChanges = new EventEmitter<void>();
  @Output() readonly updateBranchName = new EventEmitter<Event>();
  @Output() readonly createBranch = new EventEmitter<void>();
  @Output() readonly pullRemote = new EventEmitter<void>();
  @Output() readonly pushRemote = new EventEmitter<void>();
  @Output() readonly updateGitHistoryQuery = new EventEmitter<Event>();
  @Output() readonly openGitHistoryCommit = new EventEmitter<GitCommitSummary>();

  runEvidenceLabel(result: RunResult): string {
    return `${result.entryFile} · EXIT ${result.exitCode} · ${result.elapsedMs} MS`;
  }
}
