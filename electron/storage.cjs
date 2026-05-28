const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { portableEditableRelativePath } = require('./path-policy.cjs');
const { sanitizeToolCommand } = require('./tool-command-policy.cjs');
const {
  boundPortablePayload,
  maxPortablePayloadBytes,
  preparePortableStorageDirectory,
  resolvePortableJournalReadPath,
  writePortableJournalAtomically,
} = require('./portable-storage-policy.cjs');

const maxPortableFileBytes = 5 * 1024 * 1024;
const maxPortableOutputBytes = 512 * 1024;
const maxPortableJournalEntries = 500;
const maxPortableSnapshots = 100;
const maxPortableRunResults = 40;
const maxPortableRunProfiles = 40;
const maxPortableRecoveryBuffers = 100;
const maxJournalBodyChars = 4000;
const maxMetadataBytes = 16 * 1024;

class CodeyoStore {
  constructor(userDataPath) {
    fs.mkdirSync(userDataPath, { recursive: true });
    this.db = new DatabaseSync(path.join(userDataPath, 'codeyo.sqlite'));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        root_path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        trusted INTEGER NOT NULL DEFAULT 0,
        storage_mode TEXT NOT NULL DEFAULT 'app-db',
        opened_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS recovery_buffers (
        workspace_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        content TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, file_path)
      );
      CREATE TABLE IF NOT EXISTS journal_entries (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        snapshot_id TEXT,
        metadata TEXT
      );
      CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        note TEXT NOT NULL,
        files_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        source_revision TEXT,
        run_result_id TEXT
      );
      CREATE TABLE IF NOT EXISTS run_profiles (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        profile_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS run_results (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  openWorkspace(rootPath) {
    const found = this.db.prepare('SELECT * FROM workspaces WHERE root_path = ?').get(rootPath);
    const now = new Date().toISOString();
    if (found) {
      this.db.prepare('UPDATE workspaces SET opened_at = ? WHERE id = ?').run(now, found.id);
      if (found.storage_mode === 'workspace-codeyo') {
        this.importPortable(found.id);
      }
      return this.toWorkspace({ ...found, opened_at: now });
    }
    const workspace = {
      id: crypto.randomUUID(),
      root_path: rootPath,
      name: path.basename(rootPath),
      trusted: 0,
      storage_mode: 'app-db',
      opened_at: now,
    };
    this.db.prepare(`
      INSERT INTO workspaces (id, root_path, name, trusted, storage_mode, opened_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      workspace.id,
      workspace.root_path,
      workspace.name,
      workspace.trusted,
      workspace.storage_mode,
      workspace.opened_at,
    );
    return this.toWorkspace(workspace);
  }

  getWorkspace(id) {
    const row = this.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id);
    return row ? this.toWorkspace(row) : undefined;
  }

  listRecentWorkspaces() {
    return this.db.prepare('SELECT * FROM workspaces ORDER BY opened_at DESC LIMIT 8')
      .all()
      .map((row) => this.toWorkspace(row));
  }

  trustWorkspace(id) {
    this.db.prepare('UPDATE workspaces SET trusted = 1 WHERE id = ?').run(id);
    const workspace = this.getWorkspace(id);
    if (workspace?.storageMode === 'workspace-codeyo') {
      this.importPortable(id);
    }
    return this.getWorkspace(id);
  }

  putRecovery(workspaceId, filePath, content) {
    const now = new Date().toISOString();
    const safeBuffer = requireRecoveryBuffer(filePath, content, now);
    this.db.prepare(`
      INSERT INTO recovery_buffers (workspace_id, file_path, content, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(workspace_id, file_path)
      DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
    `).run(workspaceId, safeBuffer.filePath, safeBuffer.content, safeBuffer.updatedAt);
    this.syncPortable(workspaceId);
  }

  getRecovery(workspaceId, filePath) {
    const safePath = requireRecoveryPath(filePath);
    const row = this.db.prepare(`
      SELECT file_path AS filePath, content, updated_at AS updatedAt FROM recovery_buffers
      WHERE workspace_id = ? AND file_path = ?
    `).get(workspaceId, safePath);
    const buffer = sanitizeRecoveryBuffer(row);
    return buffer ? { content: buffer.content, updatedAt: buffer.updatedAt } : undefined;
  }

  listRecovery(workspaceId) {
    return this.db.prepare(`
      SELECT file_path AS filePath, content, updated_at AS updatedAt FROM recovery_buffers
      WHERE workspace_id = ? ORDER BY updated_at DESC
    `).all(workspaceId)
      .map((buffer) => sanitizeRecoveryBuffer(buffer))
      .filter(Boolean);
  }

  clearRecovery(workspaceId, filePath) {
    const safePath = requireRecoveryPath(filePath);
    this.db.prepare('DELETE FROM recovery_buffers WHERE workspace_id = ? AND file_path = ?')
      .run(workspaceId, safePath);
    this.syncPortable(workspaceId);
    return { cleared: true };
  }

  moveRecovery(workspaceId, filePath, nextPath) {
    const safePath = requireRecoveryPath(filePath);
    const safeNextPath = requireRecoveryPath(nextPath);
    const existing = this.getRecovery(workspaceId, safePath);
    if (!existing) {
      return { moved: false };
    }
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM recovery_buffers WHERE workspace_id = ? AND file_path = ?')
        .run(workspaceId, safeNextPath);
      this.db.prepare(`
        UPDATE recovery_buffers
        SET file_path = ?, updated_at = ?
        WHERE workspace_id = ? AND file_path = ?
      `).run(safeNextPath, new Date().toISOString(), workspaceId, safePath);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    this.syncPortable(workspaceId);
    return { moved: true };
  }

  addJournal(workspaceId, kind, body, snapshotId = null, metadata = {}) {
    const entry = requireJournalEntry(workspaceId, kind, body, snapshotId, metadata);
    if (entry.snapshotId && this.recordWorkspaceId('snapshots', entry.snapshotId) !== workspaceId) {
      throw new Error('Journal snapshot does not belong to this workspace');
    }
    this.db.prepare(`
      INSERT INTO journal_entries (id, workspace_id, kind, body, created_at, snapshot_id, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.id,
      workspaceId,
      entry.kind,
      entry.body,
      entry.createdAt,
      entry.snapshotId,
      JSON.stringify(entry.metadata),
    );
    this.syncPortable(workspaceId);
    return entry;
  }

  listJournal(workspaceId) {
    return this.db.prepare(`
      SELECT id, workspace_id AS workspaceId, kind, body, created_at AS createdAt,
             snapshot_id AS snapshotId, metadata
      FROM journal_entries WHERE workspace_id = ? ORDER BY created_at DESC
    `).all(workspaceId)
      .map((row) => sanitizeJournalEntry(workspaceId, row))
      .filter(Boolean);
  }

  createSnapshot(workspaceId, files, note, runResultId, sourceRevision) {
    const snapshot = requireSnapshot(workspaceId, files, note, runResultId, sourceRevision);
    if (snapshot.runResultId && this.recordWorkspaceId('run_results', snapshot.runResultId) !== workspaceId) {
      throw new Error('Snapshot run evidence does not belong to this workspace');
    }
    this.db.prepare(`
      INSERT INTO snapshots (id, workspace_id, note, files_json, created_at, source_revision, run_result_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      snapshot.id,
      workspaceId,
      snapshot.note,
      JSON.stringify(snapshot.files),
      snapshot.createdAt,
      snapshot.sourceRevision || null,
      snapshot.runResultId,
    );
    this.syncPortable(workspaceId);
    return snapshot;
  }

  saveRunResult(workspaceId, result) {
    const record = sanitizeRunResult({ ...result, id: crypto.randomUUID() });
    if (!record) {
      throw new Error('Run result is not valid');
    }
    this.db.prepare(`
      INSERT INTO run_results (id, workspace_id, result_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run(record.id, workspaceId, JSON.stringify(record), record.startedAt);
    this.syncPortable(workspaceId);
    return record;
  }

  listRunResults(workspaceId) {
    return this.db.prepare(`
      SELECT result_json AS resultJson FROM run_results
      WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 12
    `).all(workspaceId)
      .map((row) => sanitizeRunResult(parseJson(row.resultJson, null)))
      .filter(Boolean);
  }

  getRunResult(workspaceId, runResultId) {
    const row = this.db.prepare(`
      SELECT result_json AS resultJson FROM run_results
      WHERE workspace_id = ? AND id = ?
    `).get(workspaceId, runResultId);
    return row ? sanitizeRunResult(parseJson(row.resultJson, null)) || undefined : undefined;
  }

  listProfiles(workspaceId) {
    return this.db.prepare('SELECT profile_json FROM run_profiles WHERE workspace_id = ?')
      .all(workspaceId)
      .map((row) => parseJson(row.profile_json, null))
      .map((profile) => sanitizeRunProfile(profile))
      .filter(Boolean);
  }

  saveProfile(workspaceId, profile) {
    const safeProfile = sanitizeRunProfile(profile);
    if (!safeProfile) {
      throw new Error('Run profile is not valid');
    }
    const recordId = `${workspaceId}:${safeProfile.id}`;
    this.db.prepare('DELETE FROM run_profiles WHERE id = ? AND workspace_id = ?').run(recordId, workspaceId);
    this.db.prepare(`
      INSERT INTO run_profiles (id, workspace_id, profile_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE
      SET profile_json = excluded.profile_json, updated_at = excluded.updated_at
    `).run(recordId, workspaceId, JSON.stringify(safeProfile), new Date().toISOString());
    this.syncPortable(workspaceId);
    return safeProfile;
  }

  getSnapshot(workspaceId, id) {
    const row = this.db.prepare(`
      SELECT id, workspace_id AS workspaceId, note, files_json AS filesJson,
             created_at AS createdAt, source_revision AS sourceRevision,
             run_result_id AS runResultId FROM snapshots WHERE workspace_id = ? AND id = ?
    `).get(workspaceId, id);
    return row ? sanitizeStoredSnapshot(row) || undefined : undefined;
  }

  setStorageMode(workspaceId, storageMode) {
    if (!['app-db', 'workspace-codeyo'].includes(storageMode)) {
      throw new Error('Unknown storage mode');
    }
    const workspace = this.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error('Workspace is not available');
    }
    if (storageMode === 'workspace-codeyo') {
      preparePortableStorageDirectory(fs, path, workspace.rootPath);
    }
    const imported = this.importPortable(workspaceId).imported;
    this.db.prepare('UPDATE workspaces SET storage_mode = ? WHERE id = ?').run(storageMode, workspaceId);
    if (storageMode === 'workspace-codeyo') {
      this.syncPortable(workspaceId);
    }
    return { storageMode, migrated: true, imported };
  }

  syncPortable(workspaceId) {
    const workspace = this.getWorkspace(workspaceId);
    if (!workspace || workspace.storageMode !== 'workspace-codeyo') {
      return;
    }
    const { directoryPath, journalPath } = preparePortableStorageDirectory(fs, path, workspace.rootPath);
    const payload = {
      version: 2,
      exportedAt: new Date().toISOString(),
      journal: this.listPortableJournal(workspaceId),
      snapshots: this.listPortableSnapshots(workspaceId),
      runResults: this.listPortableRunResults(workspaceId),
      runProfiles: this.listPortableProfiles(workspaceId),
      recoveryBuffers: this.listPortableRecovery(workspaceId),
    };
    const bounded = boundPortablePayload(payload, { maxBytes: maxPortablePayloadBytes });
    writePortableJournalAtomically(fs, path, directoryPath, journalPath, bounded.json);
  }

  importPortable(workspaceId) {
    const workspace = this.getWorkspace(workspaceId);
    if (!workspace) {
      return { imported: false };
    }
    const portablePath = resolvePortableJournalReadPath(fs, path, workspace.rootPath);
    if (!portablePath) {
      return { imported: false };
    }
    const stat = fs.statSync(portablePath);
    if (!stat.isFile() || stat.size > maxPortablePayloadBytes) {
      return { imported: false };
    }
    let payload;
    try {
      payload = JSON.parse(fs.readFileSync(portablePath, 'utf8'));
    } catch {
      return { imported: false };
    }
    if (!payload || typeof payload !== 'object') {
      return { imported: false };
    }

    const importContext = {
      runResultIds: new Map(),
      snapshotIds: new Map(),
    };
    this.db.exec('BEGIN');
    try {
      for (const result of asArray(payload.runResults).slice(0, maxPortableRunResults)) {
        const imported = this.importRunResult(workspaceId, result);
        if (imported) {
          importContext.runResultIds.set(imported.sourceId, imported.id);
        }
      }
      for (const profile of asArray(payload.runProfiles).slice(0, maxPortableRunProfiles)) {
        this.importRunProfile(workspaceId, profile);
      }
      for (const snapshot of asArray(payload.snapshots).slice(0, maxPortableSnapshots)) {
        const imported = this.importSnapshot(workspaceId, snapshot, importContext);
        if (imported) {
          importContext.snapshotIds.set(imported.sourceId, imported.id);
        }
      }
      for (const entry of asArray(payload.journal).slice(0, maxPortableJournalEntries)) {
        this.importJournalEntry(workspaceId, entry, importContext);
      }
      for (const buffer of asArray(payload.recoveryBuffers).slice(0, maxPortableRecoveryBuffers)) {
        this.importRecoveryBuffer(workspaceId, buffer);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return { imported: true };
  }

  listPortableSnapshots(workspaceId) {
    return this.db.prepare(`
      SELECT id, note, files_json AS filesJson, created_at AS createdAt,
             source_revision AS sourceRevision, run_result_id AS runResultId
      FROM snapshots WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ${maxPortableSnapshots}
    `).all(workspaceId)
      .map((row) => sanitizeStoredSnapshot({ ...row, workspaceId }))
      .filter(Boolean);
  }

  listPortableRunResults(workspaceId) {
    return this.db.prepare(`
      SELECT result_json AS resultJson FROM run_results
      WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ${maxPortableRunResults}
    `).all(workspaceId)
      .map((row) => sanitizeRunResult(parseJson(row.resultJson, null)))
      .filter(Boolean);
  }

  listPortableJournal(workspaceId) {
    return this.db.prepare(`
      SELECT id, kind, body, created_at AS createdAt, snapshot_id AS snapshotId, metadata
      FROM journal_entries WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ${maxPortableJournalEntries}
    `).all(workspaceId).map((row) => sanitizeJournalEntry(workspaceId, row)).filter(Boolean);
  }

  listPortableProfiles(workspaceId) {
    return this.listProfiles(workspaceId)
      .slice(0, maxPortableRunProfiles)
      .map((profile) => sanitizeRunProfile(profile))
      .filter(Boolean);
  }

  listPortableRecovery(workspaceId) {
    return this.listRecovery(workspaceId)
      .slice(0, maxPortableRecoveryBuffers)
      .map((buffer) => sanitizeRecoveryBuffer(buffer))
      .filter(Boolean);
  }

  importJournalEntry(workspaceId, entry, importContext = {}) {
    const safeEntry = sanitizeJournalEntry(workspaceId, entry);
    if (!safeEntry) {
      return;
    }
    const recordId = this.importScopedRecordId(workspaceId, 'journal_entries', safeEntry.id);
    const snapshotId = mappedImportId(importContext.snapshotIds, safeEntry.snapshotId);
    const safeSnapshotId = snapshotId && this.recordWorkspaceId('snapshots', snapshotId) === workspaceId
      ? snapshotId
      : null;
    this.db.prepare(`
      INSERT INTO journal_entries (id, workspace_id, kind, body, created_at, snapshot_id, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        workspace_id = excluded.workspace_id,
        kind = excluded.kind,
        body = excluded.body,
        created_at = excluded.created_at,
        snapshot_id = excluded.snapshot_id,
        metadata = excluded.metadata
    `).run(
      recordId,
      workspaceId,
      safeEntry.kind,
      safeEntry.body,
      safeEntry.createdAt,
      safeSnapshotId,
      JSON.stringify(safeEntry.metadata || {}),
    );
    return { sourceId: safeEntry.id, id: recordId };
  }

  importSnapshot(workspaceId, snapshot, importContext = {}) {
    const id = sanitizeRecordId(snapshot?.id);
    if (!snapshot || typeof snapshot !== 'object' || !id) {
      return;
    }
    const rawFiles = Array.isArray(snapshot.files)
      ? snapshot.files
      : typeof snapshot.files_json === 'string' ? parseJson(snapshot.files_json, []) : [];
    const files = sanitizePortableFiles(rawFiles, { allowEmpty: true });
    if (files.length === 0) {
      return;
    }
    const note = sanitizeText(snapshot.note, 'Imported snapshot', maxJournalBodyChars);
    const createdAt = sanitizeTimestamp(snapshot.createdAt ?? snapshot.created_at);
    const sourceRevision = sanitizeGitRevision(snapshot.sourceRevision ?? snapshot.source_revision);
    const runResultId = mappedImportId(
      importContext.runResultIds,
      sanitizeRecordId(snapshot.runResultId ?? snapshot.run_result_id),
    );
    const safeRunResultId = runResultId && this.recordWorkspaceId('run_results', runResultId) === workspaceId
      ? runResultId
      : null;
    const recordId = this.importScopedRecordId(workspaceId, 'snapshots', id);
    this.db.prepare(`
      INSERT INTO snapshots (id, workspace_id, note, files_json, created_at, source_revision, run_result_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        workspace_id = excluded.workspace_id,
        note = excluded.note,
        files_json = excluded.files_json,
        created_at = excluded.created_at,
        source_revision = excluded.source_revision,
        run_result_id = excluded.run_result_id
    `).run(recordId, workspaceId, note, JSON.stringify(files), createdAt, sourceRevision, safeRunResultId);
    return { sourceId: id, id: recordId };
  }

  importRunResult(workspaceId, result) {
    const record = sanitizeRunResult(result);
    if (!record) {
      return;
    }
    const recordId = this.importScopedRecordId(workspaceId, 'run_results', record.id);
    const storedRecord = { ...record, id: recordId };
    this.db.prepare(`
      INSERT INTO run_results (id, workspace_id, result_json, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        workspace_id = excluded.workspace_id,
        result_json = excluded.result_json,
        created_at = excluded.created_at
    `).run(recordId, workspaceId, JSON.stringify(storedRecord), storedRecord.startedAt);
    return { sourceId: record.id, id: recordId };
  }

  importScopedRecordId(workspaceId, table, requestedId) {
    const owner = this.recordWorkspaceId(table, requestedId);
    if (!owner || owner === workspaceId) {
      return requestedId;
    }
    const suffixRoot = crypto.createHash('sha256')
      .update(`${workspaceId}:${table}:${requestedId}`)
      .digest('hex')
      .slice(0, 12);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const suffix = attempt === 0 ? suffixRoot : `${suffixRoot}.${attempt}`;
      const baseLength = Math.max(1, 120 - suffix.length - 1);
      const candidate = `${requestedId.slice(0, baseLength)}:${suffix}`;
      const candidateOwner = this.recordWorkspaceId(table, candidate);
      if (!candidateOwner || candidateOwner === workspaceId) {
        return candidate;
      }
    }
    return crypto.randomUUID();
  }

  recordWorkspaceId(table, id) {
    if (!['journal_entries', 'snapshots', 'run_results'].includes(table)) {
      throw new Error('Portable import table is not valid');
    }
    const row = this.db.prepare(`SELECT workspace_id AS workspaceId FROM ${table} WHERE id = ?`).get(id);
    return row?.workspaceId;
  }

  importRunProfile(workspaceId, profile) {
    const safeProfile = sanitizeRunProfile(profile);
    if (!safeProfile) {
      return;
    }
    const recordId = `${workspaceId}:${safeProfile.id}`;
    this.db.prepare(`
      INSERT INTO run_profiles (id, workspace_id, profile_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE
      SET profile_json = excluded.profile_json, updated_at = excluded.updated_at
    `).run(recordId, workspaceId, JSON.stringify(safeProfile), new Date().toISOString());
  }

  importRecoveryBuffer(workspaceId, buffer) {
    const safeBuffer = sanitizeRecoveryBuffer(buffer);
    if (!safeBuffer) {
      return;
    }
    this.db.prepare(`
      INSERT INTO recovery_buffers (workspace_id, file_path, content, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(workspace_id, file_path)
      DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
    `).run(workspaceId, safeBuffer.filePath, safeBuffer.content, safeBuffer.updatedAt);
  }

  toWorkspace(row) {
    return {
      id: row.id,
      rootPath: row.root_path,
      name: row.name,
      trusted: Boolean(row.trusted),
      platform: process.platform,
      storageMode: row.storage_mode,
    };
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function requireJournalEntry(workspaceId, kind, body, snapshotId, metadata) {
  if (!['note', 'run', 'git', 'review'].includes(kind)) {
    throw new Error('Journal entry kind is not valid');
  }
  const safeBody = sanitizeText(body, '', maxJournalBodyChars);
  if (!safeBody) {
    throw new Error('Journal entry body is required');
  }
  const safeSnapshotId = snapshotId === undefined || snapshotId === null || snapshotId === ''
    ? null
    : sanitizeRecordId(snapshotId);
  if (snapshotId && !safeSnapshotId) {
    throw new Error('Journal snapshot id is not permitted');
  }
  return {
    id: crypto.randomUUID(),
    workspaceId,
    kind,
    body: safeBody,
    createdAt: new Date().toISOString(),
    snapshotId: safeSnapshotId,
    metadata: requireJournalMetadata(metadata),
  };
}

function requireJournalMetadata(metadata) {
  if (metadata === undefined || metadata === null) {
    return {};
  }
  const value = typeof metadata === 'string' ? parseJson(metadata, null) : metadata;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Journal metadata must be an object');
  }
  let json;
  try {
    json = JSON.stringify(value);
  } catch {
    throw new Error('Journal metadata must be JSON serializable');
  }
  if (Buffer.byteLength(json, 'utf8') > maxMetadataBytes) {
    throw new Error('Journal metadata is too large');
  }
  return parseJson(json, {});
}

function requireSnapshot(workspaceId, files, note, runResultId, sourceRevision) {
  const safeFiles = sanitizePortableFiles(files);
  if (safeFiles.length === 0) {
    throw new Error('Snapshot must include at least one editable file');
  }
  const safeNote = sanitizeText(note, '', maxJournalBodyChars);
  if (!safeNote) {
    throw new Error('Snapshot note is required');
  }
  const safeRunResultId = runResultId === undefined || runResultId === null || runResultId === ''
    ? null
    : sanitizeRecordId(runResultId);
  if (runResultId && !safeRunResultId) {
    throw new Error('Snapshot run result id is not permitted');
  }
  const safeSourceRevision = sourceRevision === undefined || sourceRevision === null || sourceRevision === ''
    ? null
    : sanitizeGitRevision(sourceRevision);
  if (sourceRevision && !safeSourceRevision) {
    throw new Error('Snapshot source revision is not permitted');
  }
  return {
    id: crypto.randomUUID(),
    workspaceId,
    files: safeFiles,
    note: safeNote,
    ...(safeSourceRevision ? { sourceRevision: safeSourceRevision } : {}),
    runResultId: safeRunResultId,
    createdAt: new Date().toISOString(),
  };
}

function sanitizeStoredSnapshot(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }
  const id = sanitizeRecordId(row.id);
  if (!id) {
    return null;
  }
  const rawFiles = Array.isArray(row.files)
    ? row.files
    : typeof row.filesJson === 'string' ? parseJson(row.filesJson, []) : [];
  const files = sanitizePortableFiles(rawFiles, { allowEmpty: true });
  if (files.length === 0) {
    return null;
  }
  const sourceRevision = sanitizeGitRevision(row.sourceRevision ?? row.source_revision);
  const runResultId = sanitizeRecordId(row.runResultId ?? row.run_result_id);
  return {
    id,
    workspaceId: row.workspaceId ?? row.workspace_id,
    note: sanitizeText(row.note, 'Imported snapshot', maxJournalBodyChars),
    files,
    createdAt: sanitizeTimestamp(row.createdAt ?? row.created_at),
    ...(sourceRevision ? { sourceRevision } : {}),
    ...(runResultId ? { runResultId } : {}),
  };
}

function sanitizeJournalEntry(workspaceId, entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const id = sanitizeRecordId(entry.id);
  const kind = ['note', 'run', 'git', 'review'].includes(entry.kind) ? entry.kind : 'note';
  const body = sanitizeText(entry.body, '', maxJournalBodyChars);
  if (!id || !body) {
    return null;
  }
  const snapshotId = sanitizeRecordId(entry.snapshotId ?? entry.snapshot_id);
  return {
    id,
    workspaceId,
    kind,
    body,
    createdAt: sanitizeTimestamp(entry.createdAt ?? entry.created_at),
    ...(snapshotId ? { snapshotId } : {}),
    metadata: sanitizeMetadata(entry.metadata),
  };
}

function sanitizeRunProfile(profile) {
  if (!profile || typeof profile !== 'object') {
    return null;
  }
  const id = sanitizeProfileId(profile.id);
  if (!id || !['python', 'cpp'].includes(profile.language)) {
    return null;
  }
  let entryFile;
  try {
    entryFile = portableEditableRelativePath(profile.entryFile);
  } catch {
    return null;
  }
  const sourceFiles = asArray(profile.sourceFiles)
    .slice(0, 32)
    .map((filePath) => {
      try {
        return portableEditableRelativePath(filePath);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const args = sanitizeArgs(profile.args);
  const programArgs = profile.language === 'cpp' ? sanitizeArgs(profile.programArgs) : undefined;
  const command = sanitizeCommand(profile.command);
  return {
    id,
    name: sanitizeText(profile.name, `Run ${profile.language.toUpperCase()} Current File`, 120),
    language: profile.language,
    ...(command ? { command } : {}),
    entryFile,
    ...(sourceFiles.length > 0 ? { sourceFiles: dedupeStrings(sourceFiles) } : {}),
    ...(args ? { args } : {}),
    ...(programArgs ? { programArgs } : {}),
  };
}

function sanitizeRecoveryBuffer(buffer) {
  if (!buffer || typeof buffer !== 'object') {
    return null;
  }
  let filePath;
  try {
    filePath = portableEditableRelativePath(buffer.filePath);
  } catch {
    return null;
  }
  if (typeof buffer.content !== 'string') {
    return null;
  }
  const content = buffer.content;
  if (Buffer.byteLength(content, 'utf8') > maxPortableFileBytes) {
    return null;
  }
  return {
    filePath,
    content,
    updatedAt: sanitizeTimestamp(buffer.updatedAt),
  };
}

function requireRecoveryBuffer(filePath, content, updatedAt) {
  const safeBuffer = sanitizeRecoveryBuffer({ filePath, content, updatedAt });
  if (!safeBuffer) {
    throw new Error('Recovery buffer is not valid');
  }
  return safeBuffer;
}

function requireRecoveryPath(filePath) {
  try {
    return portableEditableRelativePath(filePath);
  } catch {
    throw new Error('Recovery buffer path is not permitted');
  }
}

function mappedImportId(map, id) {
  if (!id) {
    return null;
  }
  return map instanceof Map ? map.get(id) || id : id;
}

function sanitizePortableFiles(files, options = {}) {
  const allowEmpty = Boolean(options.allowEmpty);
  if (!Array.isArray(files) || (!allowEmpty && files.length === 0)) {
    return [];
  }
  const seen = new Set();
  const safe = [];
  for (const file of files.slice(0, 100)) {
    if (!file || typeof file !== 'object' || typeof file.path !== 'string') {
      continue;
    }
    let filePath;
    try {
      filePath = portableEditableRelativePath(file.path);
    } catch {
      continue;
    }
    if (seen.has(filePath)) {
      continue;
    }
    if (typeof file.content !== 'string') {
      continue;
    }
    const content = file.content;
    if (Buffer.byteLength(content, 'utf8') > maxPortableFileBytes) {
      continue;
    }
    seen.add(filePath);
    safe.push({ path: filePath, content });
  }
  return safe;
}

function sanitizeRunResult(result) {
  if (!result || typeof result !== 'object') {
    return null;
  }
  const id = sanitizeRecordId(result.id);
  if (!id) {
    return null;
  }
  let entryFile;
  try {
    entryFile = portableEditableRelativePath(result.entryFile);
  } catch {
    return null;
  }
  const inputs = sanitizePortableFiles(result.inputs || [], { allowEmpty: true });
  const diagnostics = asArray(result.diagnostics).map((diagnostic) => {
    if (!diagnostic || typeof diagnostic !== 'object') {
      return null;
    }
    let diagnosticPath;
    try {
      diagnosticPath = portableEditableRelativePath(diagnostic.path);
    } catch {
      return null;
    }
    return {
      path: diagnosticPath,
      line: Math.max(1, Number(diagnostic.line) || 1),
      ...(Number(diagnostic.column) > 0 ? { column: Number(diagnostic.column) } : {}),
      severity: diagnostic.severity === 'warning' ? 'warning' : 'error',
      message: typeof diagnostic.message === 'string' ? diagnostic.message.slice(0, 1000) : 'Diagnostic',
    };
  }).filter(Boolean).slice(0, 200);
  return {
    id,
    profileId: sanitizeProfileId(result.profileId) || 'imported-profile',
    profileName: sanitizeText(result.profileName, 'Imported run', 120),
    entryFile,
    inputs,
    exitCode: Number.isFinite(Number(result.exitCode)) ? Number(result.exitCode) : 1,
    elapsedMs: Math.max(0, Number(result.elapsedMs) || 0),
    startedAt: sanitizeTimestamp(result.startedAt ?? result.createdAt),
    diagnostics,
    stdout: typeof result.stdout === 'string' ? truncateUtf8(result.stdout, maxPortableOutputBytes) : '',
    stderr: typeof result.stderr === 'string' ? truncateUtf8(result.stderr, maxPortableOutputBytes) : '',
  };
}

function sanitizeMetadata(metadata) {
  const value = typeof metadata === 'string'
    ? parseJson(metadata, {})
    : metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, 'utf8') > maxMetadataBytes) {
    return {};
  }
  return parseJson(json, {});
}

function sanitizeRecordId(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const id = value.trim();
  return /^[a-zA-Z0-9._:-]{1,120}$/.test(id) ? id : null;
}

function sanitizeProfileId(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const id = value.trim();
  return /^[a-zA-Z0-9._:-]{1,80}$/.test(id) ? id : null;
}

function sanitizeGitRevision(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const revision = value.trim();
  return /^[0-9a-f]{7,40}$/i.test(revision) ? revision : null;
}

function sanitizeTimestamp(value) {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  return new Date().toISOString();
}

function sanitizeText(value, fallback, maxLength) {
  const text = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  return text.replace(/\0/g, '').slice(0, maxLength);
}

function sanitizeCommand(value) {
  if (typeof value !== 'string') {
    return null;
  }
  try {
    return sanitizeToolCommand(value, '');
  } catch {
    return null;
  }
}

function sanitizeArgs(args) {
  const values = asArray(args).slice(0, 64).map((arg) => {
    if (typeof arg !== 'string') {
      return null;
    }
    const value = arg.trim();
    if (!value || value.includes('\0') || /[\r\n]/.test(value)) {
      return null;
    }
    return truncateUtf8(value, 512);
  }).filter(Boolean);
  return values.length > 0 ? values : undefined;
}

function dedupeStrings(values) {
  return [...new Set(values)];
}

function truncateUtf8(value, limit) {
  const text = String(value ?? '');
  if (Buffer.byteLength(text, 'utf8') <= limit) {
    return text;
  }
  const suffix = '\n[CODEYO PORTABLE DATA TRUNCATED]\n';
  const suffixBytes = Buffer.byteLength(suffix, 'utf8');
  return `${Buffer.from(text, 'utf8').subarray(0, Math.max(0, limit - suffixBytes)).toString('utf8')}${suffix}`;
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

module.exports = { CodeyoStore };
