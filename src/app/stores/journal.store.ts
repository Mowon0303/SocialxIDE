import { Injectable } from '@angular/core';
import { JournalEntry } from '../desktop-api';
import { JournalKindFilter } from '../ide-types';

@Injectable({ providedIn: 'root' })
export class JournalStore {
  entries: JournalEntry[] = [];
  draft = '';
  query = '';
  kindFilter: JournalKindFilter = 'all';

  get filteredEntries(): JournalEntry[] {
    const query = this.query.trim().toLowerCase();
    return this.entries.filter((entry) => {
      const matchesKind = this.kindFilter === 'all' || entry.kind === this.kindFilter;
      const matchesQuery = !query || [
        entry.kind,
        entry.body,
        entry.snapshotId ?? '',
        entry.createdAt,
      ].some((value) => String(value).toLowerCase().includes(query));
      return matchesKind && matchesQuery;
    });
  }

  count(kind: JournalKindFilter): number {
    return kind === 'all'
      ? this.entries.length
      : this.entries.filter((entry) => entry.kind === kind).length;
  }

  setEntries(entries: JournalEntry[]): void {
    this.entries = entries;
  }

  clearDraft(): void {
    this.draft = '';
  }

  resetWorkspaceState(): void {
    this.entries = [];
    this.draft = '';
    this.query = '';
    this.kindFilter = 'all';
  }
}
