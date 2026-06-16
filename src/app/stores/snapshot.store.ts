import { Injectable } from '@angular/core';
import {
  EditorDiagnostic,
  EditorLanguage,
  ReviewSnapshot,
  RunResult,
} from '../desktop-api';
import { LineComparison } from '../ide-types';

@Injectable({ providedIn: 'root' })
export class SnapshotStore {
  preview: ReviewSnapshot | null = null;
  activePath = '';
  runResult: RunResult | null = null;
  evidenceOpen = false;
  diagnosticRevealLine = 0;
  diagnosticRevealColumn = 1;
  diagnosticRevealRequest = 0;
  compareOpen = false;
  currentContent = '';
  currentMissing = false;
  comparison: LineComparison = emptyLineComparison();

  get activeFile(): { path: string; content: string } {
    return this.preview?.files.find((file) => file.path === this.activePath)
      ?? this.preview?.files[0]
      ?? { path: '', content: '' };
  }

  get language(): EditorLanguage {
    return this.languageForPath(this.activeFile.path);
  }

  get diffSummary(): string {
    return this.currentMissing
      ? 'CURRENT FILE MISSING · SNAPSHOT CAN BE RESTORED OR FORKED'
      : `${this.comparison.hunks.length} HUNKS · +${this.comparison.added} / -${this.comparison.removed} · SNAPSHOT TO CURRENT`;
  }

  get runTranscript(): string {
    if (!this.runResult) {
      return '';
    }
    return [
      `$ ${this.runResult.profileName}`,
      ...(this.runResult.stdout ? this.runResult.stdout.trimEnd().split('\n') : []),
      ...(this.runResult.stderr ? this.runResult.stderr.trimEnd().split('\n') : []),
      `EXIT ${this.runResult.exitCode} · ${this.runResult.elapsedMs} MS`,
    ].join('\n');
  }

  get activeDiagnostics(): EditorDiagnostic[] {
    return this.runResult?.diagnostics.filter(
      (diagnostic) => diagnostic.path === this.activeFile.path,
    ) ?? [];
  }

  open(snapshot: ReviewSnapshot, runResult: RunResult | null): void {
    this.preview = snapshot;
    this.activePath = snapshot.files[0]?.path ?? '';
    this.runResult = runResult;
    this.evidenceOpen = false;
    this.diagnosticRevealLine = 0;
    this.diagnosticRevealColumn = 1;
    this.diagnosticRevealRequest = 0;
    this.compareOpen = false;
    this.currentContent = '';
    this.currentMissing = false;
    this.comparison = emptyLineComparison();
  }

  selectFile(filePath: string): boolean {
    if (!this.preview?.files.some((file) => file.path === filePath)) {
      return false;
    }
    this.activePath = filePath;
    this.compareOpen = false;
    return true;
  }

  toggleEvidence(): void {
    this.evidenceOpen = !this.evidenceOpen;
  }

  revealDiagnostic(diagnostic: EditorDiagnostic): void {
    this.diagnosticRevealLine = diagnostic.line;
    this.diagnosticRevealColumn = diagnostic.column ?? 1;
    this.diagnosticRevealRequest += 1;
  }

  close(): void {
    this.preview = null;
    this.activePath = '';
    this.runResult = null;
    this.evidenceOpen = false;
    this.diagnosticRevealLine = 0;
    this.diagnosticRevealColumn = 1;
    this.diagnosticRevealRequest = 0;
    this.compareOpen = false;
    this.currentContent = '';
    this.currentMissing = false;
    this.comparison = emptyLineComparison();
  }

  private languageForPath(filePath: string): EditorLanguage {
    if (filePath.endsWith('.py')) {
      return 'python';
    }
    if (/\.(cpp|cc|cxx|hpp|h|hh)$/.test(filePath)) {
      return 'cpp';
    }
    return 'text';
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
