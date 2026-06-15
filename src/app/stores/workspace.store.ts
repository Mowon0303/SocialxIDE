import { Injectable } from '@angular/core';
import {
  RecoveryBuffer,
  WorkspaceHandle,
} from '../desktop-api';
import {
  FileWriteResult,
  IdeFile,
  LineComparison,
} from '../ide-types';

export interface FileConflictState {
  diskContent: string;
  diskVersion: string;
  deleted?: boolean;
}

@Injectable({ providedIn: 'root' })
export class WorkspaceStore {
  workspace: WorkspaceHandle | null = null;
  recentWorkspace: WorkspaceHandle | null = null;
  notice = 'OPEN A LOCAL FOLDER TO BEGIN YOUR DESKTOP WORKSPACE.';
  recoveryBuffers: RecoveryBuffer[] = [];
  fileConflict: FileConflictState | null = null;
  conflictCompareOpen = false;
  conflictComparison: LineComparison = emptyLineComparison();

  activate(workspace: WorkspaceHandle): void {
    this.workspace = workspace;
    this.recentWorkspace = workspace;
    this.notice = workspace.trusted
      ? `${workspace.name} · TRUSTED LOCAL WORKSPACE`
      : `${workspace.name} · READ ONLY UNTIL TRUSTED`;
    this.recoveryBuffers = [];
    this.clearConflict();
  }

  setRecentWorkspace(workspace: WorkspaceHandle | null): void {
    this.recentWorkspace = workspace;
    if (workspace) {
      this.notice = `RECENT · ${workspace.name} · OPEN FOLDER TO RESUME`;
    }
  }

  trustActive(workspace: WorkspaceHandle): void {
    this.workspace = workspace;
    this.recentWorkspace = workspace;
    this.notice = `${workspace.name} · TRUSTED · EXECUTION ENABLED`;
  }

  setRecoveries(buffers: RecoveryBuffer[]): void {
    this.recoveryBuffers = buffers;
  }

  clearRecoveries(): void {
    this.recoveryBuffers = [];
  }

  setConflict(result: FileWriteResult): void {
    this.fileConflict = {
      diskContent: result.diskContent ?? '',
      diskVersion: result.diskVersion,
      deleted: result.deleted,
    };
  }

  clearConflict(): void {
    this.fileConflict = null;
    this.conflictCompareOpen = false;
    this.conflictComparison = emptyLineComparison();
  }

  dirtyWorkspaceFiles(files: IdeFile[]): IdeFile[] {
    return files.filter((file) => file.workspaceFile && file.status !== 'saved');
  }

  reset(): void {
    this.workspace = null;
    this.recentWorkspace = null;
    this.notice = 'OPEN A LOCAL FOLDER TO BEGIN YOUR DESKTOP WORKSPACE.';
    this.recoveryBuffers = [];
    this.clearConflict();
  }
}

function emptyLineComparison(): LineComparison {
  return {
    added: 0,
    removed: 0,
    leftLines: [],
    rightLines: [],
    hunks: [],
  };
}
