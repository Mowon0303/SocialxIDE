import { Injectable } from '@angular/core';
import {
  EditorDiagnostic,
  RunProfile,
  RunResult,
} from '../desktop-api';

@Injectable({ providedIn: 'root' })
export class RunnerStore {
  diagnostics: EditorDiagnostic[] = [];
  recentResults: RunResult[] = [];
  pendingProfile: RunProfile | null = null;
  pendingDirtyPath = '';
  busy = false;

  setPendingRun(profile: RunProfile, dirtyPath: string): void {
    this.pendingProfile = profile;
    this.pendingDirtyPath = dirtyPath;
  }

  clearPendingRun(): void {
    this.pendingProfile = null;
    this.pendingDirtyPath = '';
  }

  rememberResult(result: RunResult): void {
    this.recentResults = [
      result,
      ...this.recentResults.filter((previous) => previous.id !== result.id),
    ].slice(0, 12);
    this.diagnostics = result.diagnostics;
  }

  rememberEvidence(result: RunResult): void {
    this.recentResults = [
      result,
      ...this.recentResults.filter((previous) => previous.id !== result.id),
    ].slice(0, 12);
  }

  clearDiagnosticsForPath(path: string): void {
    this.diagnostics = this.diagnostics.filter((diagnostic) => diagnostic.path !== path);
  }

  resetWorkspaceState(): void {
    this.diagnostics = [];
    this.recentResults = [];
    this.clearPendingRun();
    this.busy = false;
  }
}
