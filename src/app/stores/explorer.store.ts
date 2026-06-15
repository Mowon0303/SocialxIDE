import { Injectable } from '@angular/core';
import {
  ExplorerTreeEntry,
  ExplorerTreeNode,
  IdeFile,
} from '../ide-types';

@Injectable({ providedIn: 'root' })
export class ExplorerStore {
  fileQuery = '';
  entries: ExplorerTreeEntry[] = [];
  quickOpenVisible = false;
  quickOpenQuery = '';
  quickOpenIndex = 0;
  readonly expandedDirs = new Set<string>();

  rebuild(files: IdeFile[]): void {
    const query = this.fileQuery.trim().toLowerCase();
    if (query) {
      this.entries = files
        .filter((file) => file.name.toLowerCase().includes(query) || file.path.toLowerCase().includes(query))
        .map((file) => ({
          id: `file:${file.path}`,
          name: file.path,
          path: file.path,
          kind: 'file',
          depth: 1,
          file,
        }));
      return;
    }

    const root: ExplorerTreeNode = {
      name: '',
      path: '',
      kind: 'folder',
      children: new Map<string, ExplorerTreeNode>(),
    };
    for (const file of files) {
      this.addFile(root, file);
    }
    this.entries = this.flattenChildren(root.children, 1);
  }

  setQuery(query: string, files: IdeFile[]): void {
    this.fileQuery = query;
    this.rebuild(files);
  }

  clearQuery(files: IdeFile[]): void {
    this.setQuery('', files);
  }

  toggleFolder(folderPath: string, files: IdeFile[]): void {
    if (this.expandedDirs.has(folderPath)) {
      this.expandedDirs.delete(folderPath);
    } else {
      this.expandedDirs.add(folderPath);
    }
    this.rebuild(files);
  }

  expandParents(files: IdeFile[]): void {
    for (const file of files) {
      const parts = file.path.split(/[\\/]/).filter(Boolean);
      parts.pop();
      let current = '';
      for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        this.expandedDirs.add(current);
      }
    }
  }

  clearExpanded(): void {
    this.expandedDirs.clear();
  }

  openQuickOpen(files: IdeFile[], activePath: string): void {
    this.quickOpenVisible = true;
    this.quickOpenQuery = '';
    this.quickOpenIndex = Math.max(
      0,
      this.quickOpenResults(files, activePath).findIndex((file) => file.path === activePath),
    );
  }

  closeQuickOpen(): void {
    this.quickOpenVisible = false;
    this.quickOpenQuery = '';
    this.quickOpenIndex = 0;
  }

  updateQuickOpenQuery(query: string): void {
    this.quickOpenQuery = query;
    this.quickOpenIndex = 0;
  }

  moveQuickOpen(delta: number, files: IdeFile[], activePath: string): void {
    const results = this.quickOpenResults(files, activePath);
    if (results.length === 0) {
      this.quickOpenIndex = 0;
      return;
    }
    this.quickOpenIndex = (this.quickOpenIndex + delta + results.length) % results.length;
  }

  quickOpenResults(files: IdeFile[], activePath: string): IdeFile[] {
    const query = this.quickOpenQuery.trim().toLowerCase();
    const ranked = files
      .map((file) => ({
        file,
        score: query ? this.quickOpenScore(file, query) : this.quickOpenDefaultScore(file, activePath),
      }))
      .filter((result) => Number.isFinite(result.score))
      .sort((left, right) => left.score - right.score || left.file.path.localeCompare(right.file.path));

    return ranked.slice(0, 12).map((result) => result.file);
  }

  private quickOpenDefaultScore(file: IdeFile, activePath: string): number {
    const state = file.path === activePath ? 0 : file.status !== 'saved' ? 1 : 2;
    return state + file.path.length / 1000;
  }

  private addFile(root: ExplorerTreeNode, file: IdeFile): void {
    const parts = file.path.split(/[\\/]/).filter(Boolean);
    const fileName = parts.pop() || file.name;
    let current = root;
    let currentPath = '';
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      let folder = current.children.get(part);
      if (!folder) {
        folder = {
          name: part,
          path: currentPath,
          kind: 'folder',
          children: new Map<string, ExplorerTreeNode>(),
        };
        current.children.set(part, folder);
      }
      current = folder;
    }
    current.children.set(fileName, {
      name: fileName,
      path: file.path,
      kind: 'file',
      children: new Map<string, ExplorerTreeNode>(),
      file,
    });
  }

  private flattenChildren(
    children: Map<string, ExplorerTreeNode>,
    depth: number,
  ): ExplorerTreeEntry[] {
    const entries = [...children.values()].sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === 'folder' ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
    return entries.flatMap((node) => {
      if (node.kind === 'file') {
        return [{
          id: `file:${node.path}`,
          name: node.name,
          path: node.path,
          kind: 'file',
          depth,
          file: node.file,
        }];
      }
      const expanded = this.expandedDirs.has(node.path);
      return [
        {
          id: `folder:${node.path}`,
          name: node.name,
          path: node.path,
          kind: 'folder',
          depth,
          expanded,
        },
        ...(expanded ? this.flattenChildren(node.children, depth + 1) : []),
      ];
    });
  }

  private quickOpenScore(file: IdeFile, query: string): number {
    const terms = query.split(/\s+/).filter(Boolean);
    if (terms.length > 1) {
      return terms.reduce((total, term) => {
        if (!Number.isFinite(total)) {
          return total;
        }
        const score = this.quickOpenScore(file, term);
        return Number.isFinite(score) ? total + score : Number.POSITIVE_INFINITY;
      }, 0);
    }

    const pathScore = this.quickOpenTextScore(file.path.toLowerCase(), query);
    const nameScore = this.quickOpenTextScore(file.name.toLowerCase(), query);
    return Math.min(pathScore, nameScore + 0.5);
  }

  private quickOpenTextScore(text: string, query: string): number {
    if (text === query) {
      return 0;
    }
    if (text.startsWith(query)) {
      return 2 + text.length / 1000;
    }
    const index = text.indexOf(query);
    if (index >= 0) {
      return 8 + index / 100 + text.length / 1000;
    }

    let cursor = 0;
    let gaps = 0;
    for (const char of query) {
      const next = text.indexOf(char, cursor);
      if (next === -1) {
        return Number.POSITIVE_INFINITY;
      }
      gaps += next - cursor;
      cursor = next + 1;
    }
    return 16 + gaps / 10 + text.length / 1000;
  }
}
