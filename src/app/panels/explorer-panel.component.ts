import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { RecoveryBuffer, RunResult, WorkspaceHandle } from '../desktop-api';
import {
  ExplorerTreeEntry,
  FilesAction,
  IdeFile,
} from '../ide-types';
import { EmptyStateComponent } from './empty-state.component';

@Component({
  selector: 'codeyo-explorer-panel',
  standalone: true,
  imports: [EmptyStateComponent],
  templateUrl: './explorer-panel.component.html',
  styleUrl: './explorer-panel.component.css',
})
export class ExplorerPanelComponent {
  @Input() isDesktop = false;
  @Input() workspace: WorkspaceHandle | null = null;
  @Input() recentWorkspace: WorkspaceHandle | null = null;
  @Input() homeMode = false;
  @Input() filesActionsMenuOpen = false;
  @Input() workspaceExpanded = true;
  @Input() explorerRootName = 'NO FOLDER';
  @Input() explorerTreeEntries: ExplorerTreeEntry[] = [];
  @Input() creatingFile = false;
  @Input() newFileName = '';
  @Input() recoveryBufferCount = 0;
  @Input() recoveryBuffers: RecoveryBuffer[] = [];
  @Input() activeIdeFile!: IdeFile;
  @Input() activeBufferRunEvidence?: RunResult;
  @Input() canDeleteActiveFile = false;
  @Input() assistantPanelOpen = false;
  @Input() renamingFilePath = '';
  @Input() renameDraft = '';
  contextMenuOpen = false;
  contextMenuX = 0;
  contextMenuY = 0;

  @Output() readonly toggleActionsMenu = new EventEmitter<MouseEvent>();
  @Output() readonly closeActionsMenu = new EventEmitter<void>();
  @Output() readonly runAction = new EventEmitter<FilesAction>();
  @Output() readonly toggleWorkspace = new EventEmitter<void>();
  @Output() readonly toggleFolder = new EventEmitter<string>();
  @Output() readonly selectFile = new EventEmitter<string>();
  @Output() readonly clearFilter = new EventEmitter<void>();
  @Output() readonly createFile = new EventEmitter<void>();
  @Output() readonly updateNewFileName = new EventEmitter<Event>();
  @Output() readonly cancelNewFile = new EventEmitter<void>();
  @Output() readonly updateRenameDraft = new EventEmitter<Event>();
  @Output() readonly commitRename = new EventEmitter<void>();
  @Output() readonly cancelRename = new EventEmitter<void>();
  @Output() readonly restoreRecovery = new EventEmitter<RecoveryBuffer>();
  @Output() readonly discardRecovery = new EventEmitter<RecoveryBuffer>();

  @HostListener('document:click')
  closeContextMenu(): void {
    this.contextMenuOpen = false;
  }

  @HostListener('window:keydown.escape')
  closeContextMenuFromEscape(): void {
    this.closeContextMenu();
  }

  openExplorerContextMenu(event: MouseEvent): void {
    if (this.homeMode) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.closeActionsMenu.emit();
    this.contextMenuOpen = true;
    const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth;
    const viewportHeight = typeof window === 'undefined' ? 768 : window.innerHeight;
    this.contextMenuX = Math.max(8, Math.min(event.clientX, viewportWidth - 210));
    this.contextMenuY = Math.max(8, Math.min(event.clientY, viewportHeight - 280));
  }

  openFileContextMenu(event: MouseEvent, filePath: string): void {
    this.selectFile.emit(filePath);
    this.openExplorerContextMenu(event);
  }

  triggerAction(action: FilesAction): void {
    this.contextMenuOpen = false;
    this.runAction.emit(action);
  }

  explorerFileIcon(file: IdeFile): string {
    if (/\.tsx?$/i.test(file.name)) {
      return 'TS';
    }
    if (/\.cjs$|\.mjs$|\.jsx?$/.test(file.name)) {
      return 'JS';
    }
    if (/\.css$/i.test(file.name)) {
      return '#';
    }
    if (/\.html$/i.test(file.name)) {
      return '<>';
    }
    if (/\.md$/i.test(file.name)) {
      return 'MD';
    }
    if (/\.py$/i.test(file.name)) {
      return 'PY';
    }
    if (file.lang === 'cpp') {
      return 'C++';
    }
    return 'TXT';
  }

  explorerFileStatus(file: IdeFile): string {
    if (file.missingOnDisk) {
      return '!';
    }
    if (file.status === 'saved') {
      return '';
    }
    return file.status === 'new' ? 'U' : 'M';
  }

  explorerFileIconClass(file: IdeFile): string {
    if (/\.html$/i.test(file.name)) {
      return 'html';
    }
    if (/\.css$/i.test(file.name)) {
      return 'css';
    }
    if (/\.md$/i.test(file.name)) {
      return 'markdown';
    }
    if (/\.py$/i.test(file.name)) {
      return 'python';
    }
    if (file.lang === 'cpp') {
      return 'cpp';
    }
    return 'script';
  }

  treeNodePadding(depth: number): number {
    return 7 + depth * 13;
  }
}
