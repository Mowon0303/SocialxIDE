import {
  EditorLanguage,
  JournalEntry,
} from './desktop-api';

export type ScreenId = 'channels' | 'command';
export type ChannelView = 'thread' | 'ide';
export type RightPanel = 'contributors' | 'files' | 'git' | 'settings';
export type ConsolePanel = 'terminal' | 'problems' | 'output';
export type EditorDensity = 'compact' | 'comfortable';
export type RailResizeTarget = 'workspace' | 'explorer';
export type FilesAction =
  | 'open-folder'
  | 'resume-workspace'
  | 'trust-workspace'
  | 'new-file'
  | 'review'
  | 'duplicate'
  | 'rename'
  | 'delete'
  | 'copy-path'
  | 'reveal-active-file'
  | 'assist';
export type JournalKindFilter = 'all' | JournalEntry['kind'];
export type JournalWriteStatus = 'saved' | 'refresh-failed' | 'write-failed' | 'skipped';

export interface JournalWriteResult {
  status: JournalWriteStatus;
  detail?: string;
}

export interface IdeFile {
  name: string;
  path: string;
  lang: EditorLanguage;
  status: 'saved' | 'edited' | 'new';
  lines: string[];
  builtIn?: boolean;
  diskVersion?: string;
  workspaceFile?: boolean;
  missingOnDisk?: boolean;
}

export type FileWriteResult = {
  conflict: boolean;
  diskVersion: string;
  diskContent?: string;
  deleted?: boolean;
};

export interface ExplorerTreeNode {
  name: string;
  path: string;
  kind: 'folder' | 'file';
  children: Map<string, ExplorerTreeNode>;
  file?: IdeFile;
}

export interface ExplorerTreeEntry {
  id: string;
  name: string;
  path: string;
  kind: 'folder' | 'file';
  depth: number;
  expanded?: boolean;
  file?: IdeFile;
}

export interface ThreadUpdate {
  file: string;
  result: string;
  time: string;
  kind: 'run' | 'review';
}

export interface ChannelItem {
  id: string;
  index: string;
  name: string;
  topic: string;
  unread?: number;
  mention?: boolean;
  marker?: boolean;
}

export interface StoredChannelItem {
  id: string;
  name: string;
  topic?: unknown;
  unread?: unknown;
  mention?: unknown;
  marker?: unknown;
}

export interface StoredRailWidths {
  workspace?: unknown;
  explorer?: unknown;
}

export interface LineComparison {
  added: number;
  removed: number;
  leftLines: number[];
  rightLines: number[];
  hunks: LineDiffHunk[];
}

export interface LineDiffHunk {
  id: number;
  snapshotStart: number;
  currentStart: number;
  snapshotLines: string[];
  currentLines: string[];
}
