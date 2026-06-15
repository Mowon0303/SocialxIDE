import { describe, expect, it } from 'vitest';
import { JournalEntry } from '../desktop-api';
import { JournalStore } from './journal.store';

function entry(overrides: Partial<JournalEntry>): JournalEntry {
  return {
    id: overrides.id ?? 'entry-1',
    workspaceId: overrides.workspaceId ?? 'workspace-1',
    kind: overrides.kind ?? 'note',
    body: overrides.body ?? 'Body',
    createdAt: overrides.createdAt ?? '2026-06-15T00:00:00.000Z',
    snapshotId: overrides.snapshotId,
    metadata: overrides.metadata ?? {},
  };
}

describe('JournalStore', () => {
  it('filters entries by kind and text query', () => {
    const store = new JournalStore();
    store.setEntries([
      entry({ id: 'note-1', kind: 'note', body: 'Architecture note' }),
      entry({ id: 'run-1', kind: 'run', body: 'Run failed' }),
      entry({ id: 'review-1', kind: 'review', body: 'Snapshot ready', snapshotId: 'snap-1' }),
    ]);

    store.kindFilter = 'run';
    expect(store.filteredEntries.map((item) => item.id)).toEqual(['run-1']);

    store.kindFilter = 'all';
    store.query = 'snap';
    expect(store.filteredEntries.map((item) => item.id)).toEqual(['review-1']);
  });

  it('counts entries and resets workspace state', () => {
    const store = new JournalStore();
    store.entries = [
      entry({ id: 'note-1', kind: 'note' }),
      entry({ id: 'run-1', kind: 'run' }),
    ];
    store.draft = 'draft';
    store.query = 'run';
    store.kindFilter = 'run';

    expect(store.count('all')).toBe(2);
    expect(store.count('run')).toBe(1);

    store.resetWorkspaceState();
    expect(store.entries).toEqual([]);
    expect(store.draft).toBe('');
    expect(store.query).toBe('');
    expect(store.kindFilter).toBe('all');
  });
});
