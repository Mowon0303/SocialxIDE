import { Injectable } from '@angular/core';
import {
  GitCommitDetail,
  GitCommitSummary,
  GitComparison,
  GitFileState,
  GitStagedSummary,
  GitStatus,
} from '../desktop-api';
import { LineDiffHunk } from '../ide-types';

@Injectable({ providedIn: 'root' })
export class GitStore {
  status: GitStatus | null = null;
  branches: string[] = [];
  stagedSummary: GitStagedSummary = { files: [], additions: 0, deletions: 0 };
  selectedBranch = '';
  notice = 'OPEN AND TRUST A WORKSPACE TO INSPECT GIT.';
  comparison: GitComparison | null = null;
  comparisonLeftLines: number[] = [];
  comparisonRightLines: number[] = [];
  comparisonAdded = 0;
  comparisonRemoved = 0;
  hunks: LineDiffHunk[] = [];
  pendingDiscardHunkId: number | null = null;
  historyDetail: GitCommitDetail | null = null;
  history: GitCommitSummary[] = [];
  historyQuery = '';
  reviewSnapshotDraft = '';
  selectedReviewRunResultId = '';
  selectedCommitRunResultId = '';
  commitMessage = '';
  branchName = '';
  busy = false;
  compareBusy = false;
  snapshotBusy = false;
  commitReviewOpen = false;

  get stagedFiles(): GitFileState[] {
    return this.status?.files.filter((file) => file.index !== ' ' && file.index !== '?') ?? [];
  }

  get unstagedFiles(): GitFileState[] {
    return this.status?.files.filter((file) => file.workingTree !== ' ') ?? [];
  }

  get filteredHistory(): GitCommitSummary[] {
    const query = this.historyQuery.trim().toLowerCase();
    if (!query) {
      return this.history;
    }
    return this.history.filter((commit) =>
      [commit.shortRevision, commit.revision, commit.subject, commit.author]
        .some((value) => value.toLowerCase().includes(query)));
  }

  clearComparison(): void {
    this.comparison = null;
    this.comparisonLeftLines = [];
    this.comparisonRightLines = [];
    this.comparisonAdded = 0;
    this.comparisonRemoved = 0;
    this.hunks = [];
    this.pendingDiscardHunkId = null;
    this.historyDetail = null;
  }

  resetWorkspaceState(): void {
    this.status = null;
    this.branches = [];
    this.stagedSummary = { files: [], additions: 0, deletions: 0 };
    this.selectedBranch = '';
    this.selectedReviewRunResultId = '';
    this.selectedCommitRunResultId = '';
    this.commitMessage = '';
    this.branchName = '';
    this.reviewSnapshotDraft = '';
    this.history = [];
    this.historyQuery = '';
    this.busy = false;
    this.compareBusy = false;
    this.snapshotBusy = false;
    this.commitReviewOpen = false;
    this.clearComparison();
  }
}
