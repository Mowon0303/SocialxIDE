import { Injectable } from '@angular/core';
import { WorkspaceHandle } from '../desktop-api';

export interface ProjectSettings {
  autoSaveEnabled: boolean;
  lspDiagnosticsEnabled: boolean;
  autocompleteEnabled: boolean;
  spellCheckEnabled: boolean;
  formatOnSaveEnabled: boolean;
  pythonCommand: string;
  cppCommand: string;
  profileArgs: string;
  cppProgramArgs: string;
  pythonFormatterCommand: string;
}

@Injectable({ providedIn: 'root' })
export class ProjectSettingsStore {
  readonly defaults: ProjectSettings = {
    autoSaveEnabled: false,
    lspDiagnosticsEnabled: true,
    autocompleteEnabled: true,
    spellCheckEnabled: true,
    formatOnSaveEnabled: false,
    pythonCommand: 'python3',
    cppCommand: 'clang++',
    profileArgs: '',
    cppProgramArgs: '',
    pythonFormatterCommand: '',
  };

  current: ProjectSettings = { ...this.defaults };

  load(workspace: WorkspaceHandle | null): void {
    const defaults = this.defaultsFor(workspace);
    this.current = { ...defaults };
    if (!workspace || typeof localStorage === 'undefined') {
      return;
    }
    try {
      const stored = localStorage.getItem(this.storageKey(workspace));
      if (!stored) {
        return;
      }
      this.current = this.sanitize(JSON.parse(stored), defaults);
    } catch {
      this.current = { ...defaults };
    }
  }

  save(workspace: WorkspaceHandle | null): void {
    if (!workspace || typeof localStorage === 'undefined') {
      return;
    }
    try {
      localStorage.setItem(this.storageKey(workspace), JSON.stringify(this.current));
    } catch {
      // Ignore storage quota or privacy-mode failures.
    }
  }

  update<K extends keyof ProjectSettings>(
    workspace: WorkspaceHandle | null,
    key: K,
    value: ProjectSettings[K],
  ): void {
    this.current = this.sanitize({ ...this.current, [key]: value }, this.defaultsFor(workspace));
    this.save(workspace);
  }

  storageKey(workspace: WorkspaceHandle): string {
    return `codeyo.project-settings.v1.${workspace.id || workspace.rootPath}`;
  }

  defaultsFor(workspace: WorkspaceHandle | null): ProjectSettings {
    return {
      ...this.defaults,
      pythonCommand: workspace?.platform === 'win32' ? 'python' : 'python3',
    };
  }

  private sanitize(value: unknown, defaults: ProjectSettings): ProjectSettings {
    const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    return {
      autoSaveEnabled: this.booleanValue(record['autoSaveEnabled'], defaults.autoSaveEnabled),
      lspDiagnosticsEnabled: this.booleanValue(record['lspDiagnosticsEnabled'], defaults.lspDiagnosticsEnabled),
      autocompleteEnabled: this.booleanValue(record['autocompleteEnabled'], defaults.autocompleteEnabled),
      spellCheckEnabled: this.booleanValue(record['spellCheckEnabled'], defaults.spellCheckEnabled),
      formatOnSaveEnabled: this.booleanValue(record['formatOnSaveEnabled'], defaults.formatOnSaveEnabled),
      pythonCommand: this.commandValue(record['pythonCommand'], defaults.pythonCommand),
      cppCommand: this.commandValue(record['cppCommand'], defaults.cppCommand),
      profileArgs: this.textValue(record['profileArgs'], 1000),
      cppProgramArgs: this.textValue(record['cppProgramArgs'], 1000),
      pythonFormatterCommand: this.commandValue(record['pythonFormatterCommand'], defaults.pythonFormatterCommand),
    };
  }

  private booleanValue(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
  }

  private commandValue(value: unknown, fallback: string): string {
    const text = this.textValue(value, 240);
    const command = text.trim();
    if (!command || command.includes('\0') || /[\r\n]/.test(command)) {
      return fallback;
    }
    return command;
  }

  private textValue(value: unknown, limit: number): string {
    return typeof value === 'string' ? value.slice(0, limit) : '';
  }
}
