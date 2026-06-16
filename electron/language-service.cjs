const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { spawn: defaultSpawn } = require('node:child_process');
const nativeFs = require('node:fs');
const {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} = require('vscode-jsonrpc/node');
const protocol = require('vscode-languageserver-protocol');
const { URI } = require('vscode-uri');

const lspLanguages = new Set(['python', 'cpp']);
const spellLanguages = new Set(['python', 'cpp', 'text']);
const maxSpellRegions = 120;
const maxSpellRegionTextBytes = 80 * 1024;
const maxTotalSpellTextBytes = 300 * 1024;
const lspRequestTimeoutMs = 8000;

class LanguageServiceManager {
  constructor(options = {}) {
    this.spawn = options.spawn || defaultSpawn;
    this.pathApi = options.pathApi || path;
    this.fsApi = options.fsApi || nativeFs;
    this.processApi = options.processApi || process;
    this.emitDiagnostics = options.emitDiagnostics || (() => undefined);
    this.emitStatus = options.emitStatus || (() => undefined);
    this.clients = new Map();
    this.spellModulePromise = null;
  }

  status(workspace) {
    return {
      workspaceId: workspace.id,
      services: [
        this.serviceStatus(workspace, 'python'),
        this.serviceStatus(workspace, 'cpp'),
        {
          language: 'spell',
          state: 'ready',
          label: 'Spell check ready',
        },
      ],
    };
  }

  async openDocument(workspace, document) {
    const safe = sanitizeLanguageDocument(document);
    await this.notifyDocumentOpen(workspace, safe);
    await this.checkSpelling(workspace, safe);
    return { opened: true };
  }

  async changeDocument(workspace, document) {
    const safe = sanitizeLanguageDocument(document);
    await this.notifyDocumentChange(workspace, safe);
    await this.checkSpelling(workspace, safe);
    return { changed: true };
  }

  async closeDocument(workspace, document) {
    const safe = sanitizeLanguageDocument(document);
    const client = this.clients.get(this.clientKey(workspace.id, safe.language));
    const uri = this.documentUri(workspace, safe.path);
    if (client?.openDocuments.has(uri)) {
      client.connection.sendNotification(protocol.DidCloseTextDocumentNotification.type, {
        textDocument: { uri },
      });
      client.openDocuments.delete(uri);
    }
    this.emitDiagnostics({
      workspaceId: workspace.id,
      path: safe.path,
      source: 'lsp',
      diagnostics: [],
    });
    this.emitDiagnostics({
      workspaceId: workspace.id,
      path: safe.path,
      source: 'spell',
      diagnostics: [],
    });
    return { closed: true };
  }

  async completion(workspace, request) {
    const safe = sanitizeLanguageRequest(request);
    const client = await this.ensureClient(workspace, safe.language);
    if (!client) {
      return { available: false, reason: 'missing-tool', items: [] };
    }
    await this.ensureDocumentSynced(workspace, client, safe);
    const result = await withTimeout(client.connection.sendRequest(protocol.CompletionRequest.type, {
      textDocument: { uri: this.documentUri(workspace, safe.path) },
      position: lspPosition(safe.line, safe.column),
      context: { triggerKind: 1 },
    }), lspRequestTimeoutMs, 'Completion timed out');
    return {
      available: true,
      items: normalizeCompletionResult(result),
    };
  }

  async hover(workspace, request) {
    const safe = sanitizeLanguageRequest(request);
    const client = await this.ensureClient(workspace, safe.language);
    if (!client) {
      return { available: false, contents: '' };
    }
    await this.ensureDocumentSynced(workspace, client, safe);
    const result = await withTimeout(client.connection.sendRequest(protocol.HoverRequest.type, {
      textDocument: { uri: this.documentUri(workspace, safe.path) },
      position: lspPosition(safe.line, safe.column),
    }), lspRequestTimeoutMs, 'Hover timed out');
    return normalizeHoverResult(result);
  }

  async definition(workspace, request) {
    const safe = sanitizeLanguageRequest(request);
    const client = await this.ensureClient(workspace, safe.language);
    if (!client) {
      return { available: false, locations: [] };
    }
    await this.ensureDocumentSynced(workspace, client, safe);
    const result = await withTimeout(client.connection.sendRequest(protocol.DefinitionRequest.type, {
      textDocument: { uri: this.documentUri(workspace, safe.path) },
      position: lspPosition(safe.line, safe.column),
    }), lspRequestTimeoutMs, 'Definition timed out');
    return {
      available: true,
      locations: normalizeDefinitionResult(result, workspace.rootPath, this.pathApi),
    };
  }

  async renameSymbol(workspace, request, newName) {
    const safe = sanitizeLanguageRequest(request);
    const client = await this.ensureClient(workspace, safe.language);
    if (!client) {
      return { available: false, reason: 'missing-tool' };
    }
    const safeName = sanitizeRenameName(newName);
    if (!safeName) {
      return { available: false, reason: 'missing-new-name' };
    }
    await this.ensureDocumentSynced(workspace, client, safe);
    const result = await withTimeout(client.connection.sendRequest(protocol.RenameRequest.type, {
      textDocument: { uri: this.documentUri(workspace, safe.path) },
      position: lspPosition(safe.line, safe.column),
      newName: safeName,
    }), lspRequestTimeoutMs, 'Rename timed out');
    const edits = normalizeWorkspaceEdit(result, workspace.rootPath, this.pathApi);
    if (!edits.length) {
      return { available: false, reason: 'no-rename-edits' };
    }
    return { available: true, edit: { edits } };
  }

  async codeActions(workspace, request) {
    const safe = sanitizeLanguageRequest(request);
    const client = await this.ensureClient(workspace, safe.language);
    if (!client) {
      return { available: false, reason: 'missing-tool', actions: [] };
    }
    await this.ensureDocumentSynced(workspace, client, safe);
    const position = lspPosition(safe.line, safe.column);
    const result = await withTimeout(client.connection.sendRequest(protocol.CodeActionRequest.type, {
      textDocument: { uri: this.documentUri(workspace, safe.path) },
      range: { start: position, end: position },
      context: { diagnostics: [], triggerKind: 1 },
    }), lspRequestTimeoutMs, 'Code actions timed out');
    return { available: true, actions: normalizeCodeActions(result, workspace.rootPath, this.pathApi) };
  }

  async formatDocument(workspace, document) {
    const safe = sanitizeLanguageDocument(document);
    if (safe.language === 'python') {
      return { available: false, reason: 'python-formatter-unconfigured' };
    }
    const client = await this.ensureClient(workspace, safe.language);
    if (!client) {
      return { available: false, reason: 'missing-tool' };
    }
    await this.ensureDocumentSynced(workspace, client, safe);
    const result = await withTimeout(client.connection.sendRequest(protocol.DocumentFormattingRequest.type, {
      textDocument: { uri: this.documentUri(workspace, safe.path) },
      options: { tabSize: 2, insertSpaces: true },
    }), lspRequestTimeoutMs, 'Formatting timed out');
    return { available: true, edit: { edits: normalizeTextEdits(result, safe.path) } };
  }

  async checkSpelling(workspace, document) {
    const safe = sanitizeLanguageDocument(document);
    if (!spellLanguages.has(safe.language)) {
      this.emitDiagnostics({
        workspaceId: workspace.id,
        path: safe.path,
        source: 'spell',
        diagnostics: [],
      });
      return { diagnostics: [] };
    }
    const ranges = sanitizeSpellRanges(safe.spellRanges);
    if (!ranges.length) {
      this.emitDiagnostics({
        workspaceId: workspace.id,
        path: safe.path,
        source: 'spell',
        diagnostics: [],
      });
      return { diagnostics: [] };
    }
    const diagnostics = await this.spellDiagnostics(workspace, safe.path, ranges);
    this.emitDiagnostics({
      workspaceId: workspace.id,
      path: safe.path,
      source: 'spell',
      diagnostics,
    });
    return { diagnostics };
  }

  async shutdownWorkspace(workspaceId) {
    const prefix = `${workspaceId}:`;
    for (const [key, client] of this.clients.entries()) {
      if (key.startsWith(prefix)) {
        await stopClient(client);
        this.clients.delete(key);
      }
    }
  }

  async shutdownAll() {
    for (const client of this.clients.values()) {
      await stopClient(client);
    }
    this.clients.clear();
  }

  serviceStatus(workspace, language) {
    const key = this.clientKey(workspace.id, language);
    const existing = this.clients.get(key);
    if (existing) {
      return {
        language,
        state: existing.state,
        label: existing.label,
        message: existing.message,
      };
    }
    const command = resolveLanguageServerCommand(language, {
      processApi: this.processApi,
      fsApi: this.fsApi,
      pathApi: this.pathApi,
    });
    if (!command.available) {
      return {
        language,
        state: 'missing-tool',
        label: command.label,
        message: command.message,
      };
    }
    return {
      language,
      state: 'idle',
      label: command.label,
    };
  }

  clientKey(workspaceId, language) {
    return `${workspaceId}:${language}`;
  }

  async ensureClient(workspace, language) {
    if (!lspLanguages.has(language)) {
      return null;
    }
    const key = this.clientKey(workspace.id, language);
    const existing = this.clients.get(key);
    if (existing) {
      await existing.ready.catch(() => undefined);
      return existing.state === 'ready' ? existing : null;
    }
    const command = resolveLanguageServerCommand(language, {
      processApi: this.processApi,
      fsApi: this.fsApi,
      pathApi: this.pathApi,
    });
    if (!command.available) {
      this.emitServiceStatus(workspace.id, {
        language,
        state: 'missing-tool',
        label: command.label,
        message: command.message,
      });
      return null;
    }
    const client = this.createClient(workspace, language, command);
    this.clients.set(key, client);
    await client.ready.catch(() => undefined);
    return client.state === 'ready' ? client : null;
  }

  createClient(workspace, language, command) {
    const child = this.spawn(command.command, command.args, {
      cwd: workspace.rootPath,
      env: this.processApi.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const connection = createMessageConnection(
      new StreamMessageReader(child.stdout),
      new StreamMessageWriter(child.stdin),
    );
    const client = {
      language,
      label: command.label,
      state: 'starting',
      message: '',
      process: child,
      connection,
      openDocuments: new Set(),
      versions: new Map(),
      ready: Promise.resolve(),
    };
    this.emitServiceStatus(workspace.id, {
      language,
      state: 'starting',
      label: command.label,
    });
    connection.onNotification(protocol.PublishDiagnosticsNotification.type, (payload) => {
      const relativePath = relativePathFromUri(payload.uri, workspace.rootPath, this.pathApi);
      if (!relativePath) {
        return;
      }
      this.emitDiagnostics({
        workspaceId: workspace.id,
        path: relativePath,
        source: 'lsp',
        diagnostics: normalizeLspDiagnostics(payload.diagnostics || [], relativePath),
      });
    });
    connection.onError((error) => {
      client.state = 'error';
      client.message = error?.message || `${command.label} connection failed`;
      this.emitServiceStatus(workspace.id, client);
    });
    connection.onClose(() => {
      if (client.state !== 'stopped') {
        client.state = 'error';
        client.message = `${command.label} exited`;
        this.emitServiceStatus(workspace.id, client);
      }
    });
    child.stderr?.on('data', (chunk) => {
      const text = String(chunk || '').trim();
      if (text && client.state !== 'ready') {
        client.message = text.slice(0, 300);
      }
    });
    child.on('error', (error) => {
      client.state = error?.code === 'ENOENT' ? 'missing-tool' : 'error';
      client.message = error?.message || `${command.label} launch failed`;
      this.emitServiceStatus(workspace.id, client);
    });
    connection.listen();
    client.ready = this.initializeClient(workspace, client, command);
    return client;
  }

  async initializeClient(workspace, client, command) {
    try {
      await withTimeout(client.connection.sendRequest(protocol.InitializeRequest.type, {
        processId: this.processApi.pid,
        rootUri: URI.file(workspace.rootPath).toString(),
        workspaceFolders: [{
          uri: URI.file(workspace.rootPath).toString(),
          name: workspace.name,
        }],
        capabilities: {
          textDocument: {
            synchronization: {
              didSave: true,
              dynamicRegistration: false,
            },
            completion: {
              completionItem: {
                documentationFormat: ['markdown', 'plaintext'],
                snippetSupport: false,
              },
            },
            hover: {
              contentFormat: ['markdown', 'plaintext'],
            },
            definition: {},
            publishDiagnostics: {
              relatedInformation: false,
            },
          },
        },
      }), lspRequestTimeoutMs, `${command.label} initialization timed out`);
      client.connection.sendNotification(protocol.InitializedNotification.type, {});
      client.state = 'ready';
      client.message = '';
      this.emitServiceStatus(workspace.id, client);
    } catch (error) {
      client.state = 'error';
      client.message = error?.message || `${command.label} initialization failed`;
      this.emitServiceStatus(workspace.id, client);
    }
  }

  async notifyDocumentOpen(workspace, document) {
    const client = await this.ensureClient(workspace, document.language);
    if (!client) {
      return;
    }
    const uri = this.documentUri(workspace, document.path);
    client.connection.sendNotification(protocol.DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri,
        languageId: lspLanguageId(document.language),
        version: document.version,
        text: document.content,
      },
    });
    client.openDocuments.add(uri);
    client.versions.set(uri, document.version);
  }

  async notifyDocumentChange(workspace, document) {
    const client = await this.ensureClient(workspace, document.language);
    if (!client) {
      return;
    }
    const uri = this.documentUri(workspace, document.path);
    if (!client.openDocuments.has(uri)) {
      await this.notifyDocumentOpen(workspace, document);
      return;
    }
    client.connection.sendNotification(protocol.DidChangeTextDocumentNotification.type, {
      textDocument: {
        uri,
        version: document.version,
      },
      contentChanges: [{ text: document.content }],
    });
    client.versions.set(uri, document.version);
  }

  async ensureDocumentSynced(workspace, client, request) {
    const uri = this.documentUri(workspace, request.path);
    if (client.openDocuments.has(uri) && client.versions.get(uri) === request.version) {
      return;
    }
    if (!request.content) {
      return;
    }
    await this.notifyDocumentChange(workspace, {
      path: request.path,
      language: request.language,
      content: request.content,
      version: request.version,
      spellRanges: [],
    });
  }

  documentUri(workspace, filePath) {
    const absolutePath = this.pathApi.join(workspace.rootPath, filePath);
    return URI.file(absolutePath).toString();
  }

  emitServiceStatus(workspaceId, status) {
    this.emitStatus({
      workspaceId,
      language: status.language,
      state: status.state,
      label: status.label,
      message: status.message || '',
    });
  }

  async spellDiagnostics(workspace, filePath, regions) {
    const cspell = await this.loadSpellModule();
    const diagnostics = [];
    for (const region of regions) {
      const result = await cspell.spellCheckDocument(
        {
          uri: pathToFileURL(this.pathApi.join(workspace.rootPath, filePath)).toString(),
          text: region.text,
        },
        {
          generateSuggestions: true,
          noConfigSearch: true,
        },
        {
          language: 'en',
          ignoreWords: ['Codeyo', 'Pyright', 'clangd', 'stdout', 'stderr', 'stdin', 'argv', 'argc'],
          suggestionsTimeout: 500,
          suggestionNumChanges: 3,
        },
      );
      for (const issue of result.issues || []) {
        const start = positionInRegion(region, issue.offset || 0);
        const end = positionInRegion(region, (issue.offset || 0) + String(issue.text || '').length);
        diagnostics.push({
          path: filePath,
          line: start.line,
          column: start.column,
          endLine: end.line,
          endColumn: end.column,
          severity: 'warning',
          source: 'spell',
          code: 'spell',
          message: `Possible typo: "${issue.text}"`,
          suggestions: Array.isArray(issue.suggestions) ? issue.suggestions.slice(0, 3) : [],
        });
      }
    }
    return diagnostics;
  }

  async loadSpellModule() {
    if (!this.spellModulePromise) {
      this.spellModulePromise = import('cspell-lib');
    }
    return this.spellModulePromise;
  }
}

function resolveLanguageServerCommand(language, options = {}) {
  const fsApi = options.fsApi || nativeFs;
  const pathApi = options.pathApi || path;
  const processApi = options.processApi || process;
  if (language === 'python') {
    try {
      return {
        available: true,
        language,
        label: 'Pyright',
        command: processApi.execPath,
        args: [require.resolve('pyright/langserver.index.js'), '--stdio'],
      };
    } catch (error) {
      return {
        available: false,
        language,
        label: 'Pyright',
        message: error?.message || 'Pyright is not installed',
      };
    }
  }
  if (language === 'cpp') {
    const command = 'clangd';
    if (!executableOnPath(command, { fsApi, pathApi, processApi })) {
      return {
        available: false,
        language,
        label: 'clangd',
        message: 'clangd is not available on PATH',
      };
    }
    return {
      available: true,
      language,
      label: 'clangd',
      command,
      args: ['--background-index=false'],
    };
  }
  return {
    available: false,
    language,
    label: 'Unsupported',
    message: `No language server for ${language}`,
  };
}

function executableOnPath(command, options = {}) {
  const fsApi = options.fsApi || nativeFs;
  const pathApi = options.pathApi || path;
  const processApi = options.processApi || process;
  if (command.includes('/') || command.includes('\\')) {
    return isExecutable(fsApi, command);
  }
  const paths = String(processApi.env?.PATH || '').split(pathApi.delimiter).filter(Boolean);
  const candidates = processApi.platform === 'win32'
    ? [command, `${command}.exe`, `${command}.cmd`, `${command}.bat`]
    : [command];
  return paths.some((directory) => candidates.some((candidate) => (
    isExecutable(fsApi, pathApi.join(directory, candidate))
  )));
}

function isExecutable(fsApi, filePath) {
  try {
    fsApi.accessSync(filePath, nativeFs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function sanitizeLanguageDocument(document) {
  const pathValue = sanitizeRelativePath(document?.path);
  const language = sanitizeLanguage(document?.language);
  const content = String(document?.content ?? '');
  const version = Number.isFinite(Number(document?.version)) ? Math.max(1, Math.floor(Number(document.version))) : 1;
  return {
    path: pathValue,
    language,
    content,
    version,
    spellRanges: Array.isArray(document?.spellRanges) ? document.spellRanges : [],
  };
}

function sanitizeLanguageRequest(request) {
  return {
    path: sanitizeRelativePath(request?.path),
    language: sanitizeLanguage(request?.language),
    content: typeof request?.content === 'string' ? request.content : '',
    version: Number.isFinite(Number(request?.version)) ? Math.max(1, Math.floor(Number(request.version))) : 1,
    line: Number.isFinite(Number(request?.line)) ? Math.max(1, Math.floor(Number(request.line))) : 1,
    column: Number.isFinite(Number(request?.column)) ? Math.max(1, Math.floor(Number(request.column))) : 1,
  };
}

function sanitizeRelativePath(filePath) {
  const value = String(filePath || '').replaceAll('\\', '/');
  if (!value || value.startsWith('/') || value.includes('\0') || value.split('/').includes('..')) {
    throw new Error('Language request path is outside workspace');
  }
  return value;
}

function sanitizeLanguage(language) {
  return lspLanguages.has(language) || spellLanguages.has(language) ? language : 'text';
}

function sanitizeSpellRanges(ranges) {
  let totalBytes = 0;
  const safe = [];
  for (const range of ranges.slice(0, maxSpellRegions)) {
    const text = String(range?.text ?? '');
    const bytes = Buffer.byteLength(text, 'utf8');
    if (!text.trim() || bytes > maxSpellRegionTextBytes || totalBytes + bytes > maxTotalSpellTextBytes) {
      continue;
    }
    safe.push({
      startLine: positiveInt(range?.startLine, 1),
      startColumn: positiveInt(range?.startColumn, 1),
      endLine: positiveInt(range?.endLine, 1),
      endColumn: positiveInt(range?.endColumn, 1),
      text,
    });
    totalBytes += bytes;
  }
  return safe;
}

function positiveInt(value, fallback) {
  return Number.isFinite(Number(value)) ? Math.max(1, Math.floor(Number(value))) : fallback;
}

function lspLanguageId(language) {
  if (language === 'cpp') {
    return 'cpp';
  }
  if (language === 'python') {
    return 'python';
  }
  return 'plaintext';
}

function lspPosition(line, column) {
  return {
    line: Math.max(0, line - 1),
    character: Math.max(0, column - 1),
  };
}

function normalizeCompletionResult(result) {
  const items = Array.isArray(result) ? result : (Array.isArray(result?.items) ? result.items : []);
  return items.slice(0, 80).map((item) => ({
    label: String(item.label || ''),
    detail: typeof item.detail === 'string' ? item.detail : '',
    info: markdownToPlainText(item.documentation),
    kind: completionKindName(item.kind),
    apply: typeof item.insertText === 'string' ? item.insertText : undefined,
  })).filter((item) => item.label);
}

function completionKindName(kind) {
  const names = {
    2: 'method',
    3: 'function',
    4: 'constructor',
    5: 'field',
    6: 'variable',
    7: 'class',
    8: 'interface',
    9: 'module',
    10: 'property',
    12: 'value',
    13: 'enum',
    14: 'keyword',
    15: 'snippet',
    17: 'file',
    21: 'constant',
  };
  return names[kind] || 'text';
}

function normalizeHoverResult(result) {
  const contents = markdownToPlainText(result?.contents);
  if (!contents) {
    return { available: false, contents: '' };
  }
  const range = result?.range ? fromLspRange(result.range) : undefined;
  return {
    available: true,
    contents,
    range,
  };
}

function normalizeDefinitionResult(result, rootPath, pathApi) {
  const locations = Array.isArray(result) ? result : (result ? [result] : []);
  return locations.map((location) => {
    const uri = location.targetUri || location.uri;
    const range = location.targetSelectionRange || location.range;
    const relativePath = relativePathFromUri(uri, rootPath, pathApi);
    if (!relativePath || !range) {
      return null;
    }
    const mappedRange = fromLspRange(range);
    return {
      path: relativePath,
      line: mappedRange.startLine,
      column: mappedRange.startColumn,
      endLine: mappedRange.endLine,
      endColumn: mappedRange.endColumn,
    };
  }).filter(Boolean);
}

function normalizeLspDiagnostics(diagnostics, filePath) {
  return diagnostics.map((diagnostic) => {
    const range = fromLspRange(diagnostic.range);
    return {
      path: filePath,
      line: range.startLine,
      column: range.startColumn,
      endLine: range.endLine,
      endColumn: range.endColumn,
      severity: diagnostic.severity === 1 ? 'error' : 'warning',
      source: 'lsp',
      code: diagnostic.code === undefined ? undefined : String(diagnostic.code),
      message: String(diagnostic.message || 'Language server diagnostic'),
    };
  });
}

function fromLspRange(range) {
  return {
    startLine: positiveInt((range?.start?.line ?? 0) + 1, 1),
    startColumn: positiveInt((range?.start?.character ?? 0) + 1, 1),
    endLine: positiveInt((range?.end?.line ?? 0) + 1, 1),
    endColumn: positiveInt((range?.end?.character ?? 0) + 1, 1),
  };
}

function normalizeTextEdits(result, relativePath) {
  const list = Array.isArray(result) ? result : [];
  return list.map((edit) => {
    if (!edit || !edit.range) {
      return null;
    }
    const range = fromLspRange(edit.range);
    return {
      path: relativePath,
      startLine: range.startLine,
      startColumn: range.startColumn,
      endLine: range.endLine,
      endColumn: range.endColumn,
      newText: typeof edit.newText === 'string' ? edit.newText : '',
    };
  }).filter(Boolean);
}

// Flattens an LSP WorkspaceEdit (either `changes` map or `documentChanges`
// array) into path-tagged 1-based edits, dropping any URI that does not resolve
// to a relative path inside the trusted workspace. File create/rename/delete
// resource operations are intentionally ignored.
function normalizeWorkspaceEdit(workspaceEdit, rootPath, pathApi) {
  if (!workspaceEdit || typeof workspaceEdit !== 'object') {
    return [];
  }
  const edits = [];
  const pushEdits = (uri, textEdits) => {
    const relativePath = relativePathFromUri(uri, rootPath, pathApi);
    if (!relativePath || !Array.isArray(textEdits)) {
      return;
    }
    for (const textEdit of textEdits) {
      if (!textEdit || !textEdit.range) {
        continue;
      }
      const range = fromLspRange(textEdit.range);
      edits.push({
        path: relativePath,
        startLine: range.startLine,
        startColumn: range.startColumn,
        endLine: range.endLine,
        endColumn: range.endColumn,
        newText: typeof textEdit.newText === 'string' ? textEdit.newText : '',
      });
    }
  };
  if (workspaceEdit.changes && typeof workspaceEdit.changes === 'object') {
    for (const [uri, textEdits] of Object.entries(workspaceEdit.changes)) {
      pushEdits(uri, textEdits);
    }
  }
  if (Array.isArray(workspaceEdit.documentChanges)) {
    for (const change of workspaceEdit.documentChanges) {
      if (change && change.textDocument && Array.isArray(change.edits)) {
        pushEdits(change.textDocument.uri, change.edits);
      }
    }
  }
  return edits;
}

// Keeps only code actions that carry an applicable workspace edit; command-only
// actions are dropped because Codeyo never executes arbitrary server commands.
function normalizeCodeActions(result, rootPath, pathApi) {
  const list = Array.isArray(result) ? result : [];
  const actions = [];
  for (const item of list) {
    if (!item || typeof item !== 'object' || !item.edit) {
      continue;
    }
    const edits = normalizeWorkspaceEdit(item.edit, rootPath, pathApi);
    if (!edits.length) {
      continue;
    }
    actions.push({
      title: String(item.title || 'Code action'),
      kind: typeof item.kind === 'string' ? item.kind : undefined,
      edit: { edits },
    });
  }
  return actions.slice(0, 40);
}

function sanitizeRenameName(newName) {
  const value = String(newName ?? '').trim();
  if (!value || value.length > 200 || /[\r\n\0]/.test(value)) {
    return '';
  }
  return value;
}

function markdownToPlainText(value) {
  if (!value) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(markdownToPlainText).filter(Boolean).join('\n\n');
  }
  if (typeof value.value === 'string') {
    return value.value;
  }
  return '';
}

function relativePathFromUri(uri, rootPath, pathApi = path) {
  if (!uri || !String(uri).startsWith('file:')) {
    return '';
  }
  try {
    const absolutePath = fileURLToPath(uri);
    const relative = pathApi.relative(rootPath, absolutePath);
    if (!relative || relative.startsWith('..') || pathApi.isAbsolute(relative)) {
      return '';
    }
    return relative.split(pathApi.sep).join('/');
  } catch {
    return '';
  }
}

function positionInRegion(region, offset) {
  const text = region.text.slice(0, Math.max(0, offset));
  const lines = text.split('\n');
  const lineDelta = lines.length - 1;
  const columnDelta = lines[lines.length - 1].length;
  return {
    line: region.startLine + lineDelta,
    column: lineDelta === 0 ? region.startColumn + columnDelta : columnDelta + 1,
  };
}

async function stopClient(client) {
  client.state = 'stopped';
  try {
    await client.connection.sendRequest(protocol.ShutdownRequest.type);
    client.connection.sendNotification(protocol.ExitNotification.type);
  } catch {
    // The process may already be gone.
  }
  try {
    client.connection.dispose();
  } catch {
    // Ignore disposal failures during shutdown.
  }
  try {
    client.process.kill();
  } catch {
    // Ignore stale process handles.
  }
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

module.exports = {
  LanguageServiceManager,
  executableOnPath,
  lspPosition,
  normalizeCodeActions,
  normalizeCompletionResult,
  normalizeDefinitionResult,
  normalizeHoverResult,
  normalizeLspDiagnostics,
  normalizeTextEdits,
  normalizeWorkspaceEdit,
  positionInRegion,
  relativePathFromUri,
  resolveLanguageServerCommand,
  sanitizeSpellRanges,
};
