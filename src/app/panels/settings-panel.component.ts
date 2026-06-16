import { Component, EventEmitter, Input, Output } from '@angular/core';
import {
  LanguageServiceStatus,
  StorageMode,
  ToolCheckResult,
  WorkspaceHandle,
} from '../desktop-api';
import {
  EditorFontId,
  EditorFontPreset,
  EditorThemeId,
  EditorThemePreset,
} from '../editor-appearance';
import { EditorDensity } from '../ide-types';
import { EmptyStateComponent } from './empty-state.component';

@Component({
  selector: 'codeyo-settings-panel',
  standalone: true,
  imports: [EmptyStateComponent],
  templateUrl: './settings-panel.component.html',
  styleUrl: './settings-panel.component.css',
})
export class SettingsPanelComponent {
  @Input() workspace: WorkspaceHandle | null = null;
  @Input() editorDensity: EditorDensity = 'compact';
  @Input() editorFontSizeMin = 12;
  @Input() editorFontSizeMax = 18;
  @Input() editorFontSizePx = 13;
  @Input() editorLineHeightPx = 21;
  @Input() editorFontPresets: EditorFontPreset[] = [];
  @Input() editorThemePresets: EditorThemePreset[] = [];
  @Input() editorFontId: EditorFontId = 'jetbrains-mono';
  @Input() editorThemeId: EditorThemeId = 'codeyo-editorial';
  @Input() pythonExecutable = 'python3';
  @Input() cppExecutable = 'clang++';
  @Input() environmentSummary = '';
  @Input() environmentBusy = false;
  @Input() environmentChecks: ToolCheckResult[] = [];
  @Input() languageServices: LanguageServiceStatus[] = [];
  @Input() editedFileCount = 0;
  @Input() recoveryBufferCount = 0;
  @Input() journalEntryCount = 0;
  @Input() autoSaveEnabled = false;
  @Input() lspDiagnosticsEnabled = true;
  @Input() autocompleteEnabled = true;
  @Input() spellCheckEnabled = true;
  @Input() formatOnSaveEnabled = false;
  @Input() pythonFormatterCommand = '';
  @Input() canSaveAll = false;

  @Output() readonly openWorkspace = new EventEmitter<void>();
  @Output() readonly trustWorkspace = new EventEmitter<void>();
  @Output() readonly setEditorDensity = new EventEmitter<EditorDensity>();
  @Output() readonly stepEditorFontSize = new EventEmitter<number>();
  @Output() readonly updateEditorFontSize = new EventEmitter<Event>();
  @Output() readonly resetEditorFontSize = new EventEmitter<void>();
  @Output() readonly setEditorFont = new EventEmitter<EditorFontId>();
  @Output() readonly setEditorTheme = new EventEmitter<EditorThemeId>();
  @Output() readonly migrateStorage = new EventEmitter<StorageMode>();
  @Output() readonly updatePythonExecutable = new EventEmitter<Event>();
  @Output() readonly updateCppExecutable = new EventEmitter<Event>();
  @Output() readonly checkEnvironment = new EventEmitter<void>();
  @Output() readonly setAutoSave = new EventEmitter<boolean>();
  @Output() readonly setLspDiagnostics = new EventEmitter<boolean>();
  @Output() readonly setAutocomplete = new EventEmitter<boolean>();
  @Output() readonly setSpellCheck = new EventEmitter<boolean>();
  @Output() readonly setFormatOnSave = new EventEmitter<boolean>();
  @Output() readonly updatePythonFormatter = new EventEmitter<Event>();
  @Output() readonly saveAll = new EventEmitter<void>();
  @Output() readonly openRecovery = new EventEmitter<void>();

  get editorFontSizeProgress(): string {
    const min = this.editorFontSizeMin;
    const max = this.editorFontSizeMax;
    if (max <= min) {
      return '100%';
    }
    const clamped = Math.min(Math.max(this.editorFontSizePx, min), max);
    const progress = ((clamped - min) / (max - min)) * 100;
    return `${Math.round(progress * 100) / 100}%`;
  }

  toolCheckStatus(check: ToolCheckResult): string {
    return check.available ? 'Available' : 'Missing';
  }

  get unavailableLanguageServices(): LanguageServiceStatus[] {
    return this.languageServices.filter((service) =>
      service.state === 'missing-tool' || service.state === 'error' || service.state === 'stopped');
  }

  languageServiceTitle(service: LanguageServiceStatus): string {
    if (service.state === 'missing-tool') {
      return `${service.label} missing`;
    }
    if (service.state === 'error') {
      return `${service.label} error`;
    }
    return `${service.label} unavailable`;
  }

  languageServiceMessage(service: LanguageServiceStatus): string {
    return service.message || `${service.label} is ${service.state}.`;
  }

  updateEditorFontSelection(event: Event): void {
    this.setEditorFont.emit((event.target as HTMLSelectElement).value as EditorFontId);
  }

  updateEditorThemeSelection(event: Event): void {
    this.setEditorTheme.emit((event.target as HTMLSelectElement).value as EditorThemeId);
  }

  get activeTheme(): EditorThemePreset | undefined {
    return this.editorThemePresets.find((theme) => theme.id === this.editorThemeId);
  }
}
