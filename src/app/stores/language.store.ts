import { Injectable } from '@angular/core';
import {
  EditorDiagnostic,
  EditorLanguage,
  LanguageDiagnosticsEvent,
  LanguageServiceStatus,
  LanguageWorkspaceStatus,
} from '../desktop-api';

export type ProblemSourceFilter = 'all' | 'run' | 'lsp' | 'spell';

@Injectable({ providedIn: 'root' })
export class LanguageStore {
  lspDiagnostics: EditorDiagnostic[] = [];
  spellDiagnostics: EditorDiagnostic[] = [];
  lspDiagnosticsEnabled = true;
  autocompleteEnabled = true;
  spellCheckEnabled = true;
  workspaceStatus: LanguageWorkspaceStatus | null = null;

  private readonly changeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly documentVersions = new Map<string, number>();

  allDiagnostics(runDiagnostics: EditorDiagnostic[]): EditorDiagnostic[] {
    const normalizedRunDiagnostics = runDiagnostics.map((diagnostic) => ({
      ...diagnostic,
      source: diagnostic.source ?? 'run',
    } satisfies EditorDiagnostic));
    return [
      ...normalizedRunDiagnostics,
      ...(this.lspDiagnosticsEnabled ? this.lspDiagnostics : []),
      ...(this.spellCheckEnabled ? this.spellDiagnostics : []),
    ];
  }

  filteredBySource(
    diagnostics: EditorDiagnostic[],
    source: ProblemSourceFilter,
  ): EditorDiagnostic[] {
    if (source === 'all') {
      return diagnostics;
    }
    return diagnostics.filter((diagnostic) => (diagnostic.source ?? 'run') === source);
  }

  statusFor(language: EditorLanguage): LanguageServiceStatus | undefined {
    return this.workspaceStatus?.services.find((service) => service.language === language);
  }

  applyDiagnostics(event: LanguageDiagnosticsEvent, activeWorkspaceId: string): boolean {
    if (event.workspaceId !== activeWorkspaceId) {
      return false;
    }
    const nextDiagnostics = event.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      source: event.source,
      path: diagnostic.path || event.path,
    } satisfies EditorDiagnostic));
    if (event.source === 'lsp') {
      this.lspDiagnostics = [
        ...this.lspDiagnostics.filter((diagnostic) => diagnostic.path !== event.path),
        ...nextDiagnostics,
      ];
    } else {
      this.spellDiagnostics = [
        ...this.spellDiagnostics.filter((diagnostic) => diagnostic.path !== event.path),
        ...nextDiagnostics,
      ];
    }
    return true;
  }

  applyStatus(event: LanguageServiceStatus & { workspaceId: string }, activeWorkspaceId: string): boolean {
    if (event.workspaceId !== activeWorkspaceId) {
      return false;
    }
    const current = this.workspaceStatus ?? { workspaceId: event.workspaceId, services: [] };
    const services = [
      ...current.services.filter((service) => service.language !== event.language),
      {
        language: event.language,
        state: event.state,
        label: event.label,
        message: event.message,
      },
    ];
    this.workspaceStatus = { workspaceId: event.workspaceId, services };
    return true;
  }

  nextDocumentVersion(path: string): number {
    const version = (this.documentVersions.get(path) ?? 0) + 1;
    this.documentVersions.set(path, version);
    return version;
  }

  scheduleChange(path: string, callback: () => void, delayMs = 350): void {
    const previous = this.changeTimers.get(path);
    if (previous) {
      clearTimeout(previous);
    }
    this.changeTimers.set(path, setTimeout(() => {
      this.changeTimers.delete(path);
      callback();
    }, delayMs));
  }

  clearChangeTimers(): void {
    for (const timer of this.changeTimers.values()) {
      clearTimeout(timer);
    }
    this.changeTimers.clear();
  }

  resetWorkspaceState(): void {
    this.lspDiagnostics = [];
    this.spellDiagnostics = [];
    this.workspaceStatus = null;
    this.documentVersions.clear();
    this.clearChangeTimers();
  }
}
