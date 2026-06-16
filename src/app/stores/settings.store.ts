import { Injectable } from '@angular/core';
import {
  defaultEditorFontId,
  defaultEditorThemeId,
  editorFontPreset,
  editorThemePreset,
  EditorFontId,
  EditorThemeId,
} from '../editor-appearance';
import {
  EditorDensity,
  RailResizeTarget,
  StoredRailWidths,
} from '../ide-types';

@Injectable({ providedIn: 'root' })
export class SettingsStore {
  readonly editorFontSizeMin = 12;
  readonly editorFontSizeMax = 18;
  readonly editorFontSizeDefault = 13;
  readonly railMinWidths: Record<RailResizeTarget, number> = {
    workspace: 156,
    explorer: 168,
  };
  readonly railMaxWidths: Record<RailResizeTarget, number> = {
    workspace: 380,
    explorer: 360,
  };
  readonly railCenterMinWidth = 420;

  editorDensity: EditorDensity = 'compact';
  editorFontSizePx = this.editorFontSizeDefault;
  editorFontId: EditorFontId = defaultEditorFontId;
  editorThemeId: EditorThemeId = defaultEditorThemeId;
  workspaceRailWidth = 212;
  explorerRailWidth = 206;

  private readonly editorDensityStorageKey = 'codeyo.editor-density.v1';
  private readonly editorFontSizeStorageKey = 'codeyo.editor-font-size.v1';
  private readonly editorFontStorageKey = 'codeyo.editor-font-family.v1';
  private readonly editorThemeStorageKey = 'codeyo.editor-theme.v1';
  private readonly railWidthStorageKey = 'codeyo.rail-widths.v1';

  load(): void {
    this.loadEditorDensity();
    this.loadEditorFontSize();
    this.loadEditorFont();
    this.loadEditorTheme();
    this.loadRailWidths();
  }

  setEditorDensity(density: EditorDensity): void {
    this.editorDensity = density;
    this.saveEditorDensity();
  }

  setEditorFontSize(value: number): void {
    this.editorFontSizePx = this.clampEditorFontSize(value);
    this.saveEditorFontSize();
  }

  resetEditorFontSize(): void {
    this.setEditorFontSize(this.editorFontSizeDefault);
  }

  setEditorFont(id: EditorFontId): void {
    this.editorFontId = editorFontPreset(id).id;
    this.saveEditorFont();
  }

  setEditorTheme(id: EditorThemeId): void {
    this.editorThemeId = editorThemePreset(id).id;
    this.saveEditorTheme();
  }

  setRailWidth(
    target: RailResizeTarget,
    value: number,
    layoutWidth = Number.POSITIVE_INFINITY,
  ): number {
    const nextWidth = this.clampRailWidth(target, value, layoutWidth);
    if (target === 'workspace') {
      this.workspaceRailWidth = nextWidth;
    } else {
      this.explorerRailWidth = nextWidth;
    }
    return nextWidth;
  }

  saveRailWidths(): void {
    if (typeof localStorage === 'undefined') {
      return;
    }
    try {
      localStorage.setItem(this.railWidthStorageKey, JSON.stringify({
        workspace: this.workspaceRailWidth,
        explorer: this.explorerRailWidth,
      }));
    } catch {
      // Ignore storage quota or privacy-mode failures.
    }
  }

  clampEditorFontSize(value: number): number {
    if (!Number.isFinite(value)) {
      return this.editorFontSizeDefault;
    }
    const rounded = Math.round(value * 2) / 2;
    return Math.min(Math.max(rounded, this.editorFontSizeMin), this.editorFontSizeMax);
  }

  clampRailWidth(
    target: RailResizeTarget,
    value: number,
    layoutWidth = Number.POSITIVE_INFINITY,
  ): number {
    const minWidth = this.railMinWidths[target];
    const hardMaxWidth = this.railMaxWidths[target];
    const otherRailWidth = target === 'workspace' ? this.explorerRailWidth : this.workspaceRailWidth;
    const layoutMaxWidth = Number.isFinite(layoutWidth)
      ? Math.max(minWidth, layoutWidth - otherRailWidth - this.railCenterMinWidth)
      : hardMaxWidth;
    const maxWidth = Math.max(minWidth, Math.min(hardMaxWidth, layoutMaxWidth));
    return Math.round(Math.min(Math.max(value, minWidth), maxWidth));
  }

  private loadEditorDensity(): void {
    if (typeof localStorage === 'undefined') {
      return;
    }
    try {
      const stored = localStorage.getItem(this.editorDensityStorageKey);
      if (stored === 'compact' || stored === 'comfortable') {
        this.editorDensity = stored;
      }
    } catch {
      // Density is presentation state; keep the default if storage is unavailable.
    }
  }

  private saveEditorDensity(): void {
    if (typeof localStorage === 'undefined') {
      return;
    }
    try {
      localStorage.setItem(this.editorDensityStorageKey, this.editorDensity);
    } catch {
      // Ignore storage quota or privacy-mode failures.
    }
  }

  private loadEditorFontSize(): void {
    if (typeof localStorage === 'undefined') {
      return;
    }
    try {
      const stored = localStorage.getItem(this.editorFontSizeStorageKey);
      if (!stored) {
        return;
      }
      this.editorFontSizePx = this.clampEditorFontSize(Number(stored));
    } catch {
      // Font size is presentation state; keep the default if storage is unavailable.
    }
  }

  private saveEditorFontSize(): void {
    if (typeof localStorage === 'undefined') {
      return;
    }
    try {
      localStorage.setItem(this.editorFontSizeStorageKey, String(this.editorFontSizePx));
    } catch {
      // Ignore storage quota or privacy-mode failures.
    }
  }

  private loadEditorFont(): void {
    if (typeof localStorage === 'undefined') {
      return;
    }
    try {
      this.editorFontId = editorFontPreset(localStorage.getItem(this.editorFontStorageKey)).id;
    } catch {
      // Font family is presentation state; keep the default if storage is unavailable.
    }
  }

  private saveEditorFont(): void {
    if (typeof localStorage === 'undefined') {
      return;
    }
    try {
      localStorage.setItem(this.editorFontStorageKey, this.editorFontId);
    } catch {
      // Ignore storage quota or privacy-mode failures.
    }
  }

  private loadEditorTheme(): void {
    if (typeof localStorage === 'undefined') {
      return;
    }
    try {
      this.editorThemeId = editorThemePreset(localStorage.getItem(this.editorThemeStorageKey)).id;
    } catch {
      // Theme is presentation state; keep the default if storage is unavailable.
    }
  }

  private saveEditorTheme(): void {
    if (typeof localStorage === 'undefined') {
      return;
    }
    try {
      localStorage.setItem(this.editorThemeStorageKey, this.editorThemeId);
    } catch {
      // Ignore storage quota or privacy-mode failures.
    }
  }

  private loadRailWidths(): void {
    if (typeof localStorage === 'undefined') {
      return;
    }
    try {
      const stored = localStorage.getItem(this.railWidthStorageKey);
      if (!stored) {
        return;
      }
      const parsed = JSON.parse(stored) as StoredRailWidths;
      if (typeof parsed?.workspace === 'number') {
        this.workspaceRailWidth = this.clampRailWidth('workspace', parsed.workspace);
      }
      if (typeof parsed?.explorer === 'number') {
        this.explorerRailWidth = this.clampRailWidth('explorer', parsed.explorer);
      }
    } catch {
      // Rail widths are presentation state; keep defaults if storage is unavailable.
    }
  }
}
