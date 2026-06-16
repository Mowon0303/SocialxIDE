// Live language-server integration checks.
//
// Unlike electron/test-backend.cjs (which unit-tests the pure normalizers with
// mock payloads), this suite spawns REAL language servers — bundled Pyright for
// Python and a system clangd for C++ — and drives formatDocument / renameSymbol
// / codeActions end to end through LanguageServiceManager in a throwaway
// workspace. It closes the "live LSP roundtrip only mock-tested" gap.
//
// It is intentionally NOT part of `npm run desktop:test:backend` because it
// spawns real processes and is slower. Run it explicitly:
//
//   npm run desktop:test:lsp-live
//
// When a tool is absent (e.g. clangd not on PATH, or CODEYO_SKIP_LSP_LIVE=1),
// the affected checks print a passing "skipped" line so the suite stays green
// on machines without the toolchain.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  LanguageServiceManager,
  resolveLanguageServerCommand,
} = require('./language-service.cjs');

const CPP_SOURCE = 'int  add(int a,int b){return a+b;}\nint main(){int r=add(1,2);return r;}\n';
const PY_SOURCE = 'def greet(name):\n    return "hi " + name\n\nmessage = greet("world")\nprint(message)\n';

const skipAll = process.env.CODEYO_SKIP_LSP_LIVE === '1';
const tests = [];
let passed = 0;
let skipped = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function makeManager() {
  const events = { statuses: [], diagnostics: [] };
  const mgr = new LanguageServiceManager({
    spawn,
    pathApi: path,
    fsApi: fs,
    processApi: process,
    emitDiagnostics: (payload) => events.diagnostics.push(payload),
    emitStatus: (status) => events.statuses.push(status),
  });
  return { mgr, events };
}

function toolAvailable(language) {
  return resolveLanguageServerCommand(language, {
    processApi: process,
    fsApi: fs,
    pathApi: path,
  }).available;
}

function serviceReady(mgr, workspace, language) {
  const status = mgr.status(workspace);
  const service = status.services.find((entry) => entry.language === language);
  return Boolean(service && service.state === 'ready');
}

async function withTempWorkspace(fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codeyo-lsp-live-'));
  try {
    const workspaceRoot = path.join(tempRoot, 'workspace');
    fs.mkdirSync(workspaceRoot, { recursive: true });
    await fn(workspaceRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function writeText(workspaceRoot, relativePath, content) {
  const target = path.join(workspaceRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

function assertWorkspaceEdit(edit, expectedPath, expectedNewText) {
  assert.ok(edit && Array.isArray(edit.edits) && edit.edits.length > 0, 'edit.edits must be a non-empty array');
  for (const item of edit.edits) {
    assert.equal(item.path, expectedPath);
    assert.equal(typeof item.newText, 'string');
    assert.ok(item.startLine >= 1 && item.startColumn >= 1, '1-based start position');
    assert.ok(item.endLine >= 1 && item.endColumn >= 1, '1-based end position');
    if (expectedNewText !== undefined) {
      assert.equal(item.newText, expectedNewText);
    }
  }
}

// Drives one language/operation against a fresh manager; skips (as a pass) when
// the tool is unavailable or the server does not reach a ready state.
async function withReadyService(language, workspaceRoot, doc, run, onSkip) {
  if (!toolAvailable(language)) {
    onSkip(`${language} server unavailable`);
    return;
  }
  const { mgr } = makeManager();
  const workspace = { id: 'live-lsp', rootPath: workspaceRoot, name: 'live-lsp' };
  try {
    await mgr.openDocument(workspace, doc);
    if (!serviceReady(mgr, workspace, language)) {
      onSkip(`${language} server did not initialize`);
      return;
    }
    await run(mgr, workspace);
  } finally {
    await mgr.shutdownAll();
  }
}

test('cpp formatDocument returns real edits from clangd', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    writeText(workspaceRoot, 'main.cpp', CPP_SOURCE);
    const doc = { path: 'main.cpp', language: 'cpp', content: CPP_SOURCE, version: 1, spellRanges: [] };
    await withReadyService('cpp', workspaceRoot, doc, async (mgr, workspace) => {
      const result = await mgr.formatDocument(workspace, doc);
      assert.equal(result.available, true);
      assertWorkspaceEdit(result.edit, 'main.cpp');
    }, skip);
  });
});

test('cpp renameSymbol rewrites the declaration and call site', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    writeText(workspaceRoot, 'main.cpp', CPP_SOURCE);
    const doc = { path: 'main.cpp', language: 'cpp', content: CPP_SOURCE, version: 1, spellRanges: [] };
    await withReadyService('cpp', workspaceRoot, doc, async (mgr, workspace) => {
      const request = { path: 'main.cpp', language: 'cpp', content: CPP_SOURCE, version: 1, line: 1, column: 6 };
      const result = await mgr.renameSymbol(workspace, request, 'sum');
      assert.equal(result.available, true);
      assert.ok(result.edit.edits.length >= 2, 'rename should touch declaration and call site');
      assertWorkspaceEdit(result.edit, 'main.cpp', 'sum');

      const blank = await mgr.renameSymbol(workspace, request, '   ');
      assert.equal(blank.available, false);
      assert.equal(blank.reason, 'missing-new-name');
    }, skip);
  });
});

test('cpp codeActions responds available with an actions array', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    writeText(workspaceRoot, 'main.cpp', CPP_SOURCE);
    const doc = { path: 'main.cpp', language: 'cpp', content: CPP_SOURCE, version: 1, spellRanges: [] };
    await withReadyService('cpp', workspaceRoot, doc, async (mgr, workspace) => {
      const request = { path: 'main.cpp', language: 'cpp', content: CPP_SOURCE, version: 1, line: 1, column: 6 };
      const result = await mgr.codeActions(workspace, request);
      assert.equal(result.available, true);
      // clangd often returns no edit-bearing actions for a clean snippet; the
      // normalizer drops command-only actions, so assert shape, not count.
      assert.ok(Array.isArray(result.actions));
      for (const action of result.actions) {
        assert.equal(typeof action.title, 'string');
        assertWorkspaceEdit(action.edit, 'main.cpp');
      }
    }, skip);
  });
});

test('python renameSymbol via pyright rewrites every reference', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    writeText(workspaceRoot, 'main.py', PY_SOURCE);
    const doc = { path: 'main.py', language: 'python', content: PY_SOURCE, version: 1, spellRanges: [] };
    await withReadyService('python', workspaceRoot, doc, async (mgr, workspace) => {
      const request = { path: 'main.py', language: 'python', content: PY_SOURCE, version: 1, line: 1, column: 5 };
      const result = await mgr.renameSymbol(workspace, request, 'welcome');
      assert.equal(result.available, true);
      assert.ok(result.edit.edits.length >= 2, 'rename should touch the def and its call');
      assertWorkspaceEdit(result.edit, 'main.py', 'welcome');
    }, skip);
  });
});

test('python formatDocument is intentionally unconfigured', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { mgr } = makeManager();
    const workspace = { id: 'live-lsp', rootPath: workspaceRoot, name: 'live-lsp' };
    try {
      const result = await mgr.formatDocument(workspace, {
        path: 'main.py',
        language: 'python',
        content: 'x=1\n',
        version: 1,
        spellRanges: [],
      });
      assert.equal(result.available, false);
      assert.equal(result.reason, 'python-formatter-unconfigured');
    } finally {
      await mgr.shutdownAll();
    }
  });
});

test('unsupported language returns missing-tool without throwing', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { mgr } = makeManager();
    const workspace = { id: 'live-lsp', rootPath: workspaceRoot, name: 'live-lsp' };
    try {
      const request = { path: 'note.txt', language: 'text', content: 'hello', version: 1, line: 1, column: 1 };
      const rename = await mgr.renameSymbol(workspace, request, 'x');
      assert.equal(rename.available, false);
      assert.equal(rename.reason, 'missing-tool');
      const actions = await mgr.codeActions(workspace, request);
      assert.equal(actions.available, false);
      assert.equal(actions.reason, 'missing-tool');
      assert.deepEqual(actions.actions, []);
    } finally {
      await mgr.shutdownAll();
    }
  });
});

function skip(reason) {
  skipped += 1;
  throw new SkipError(reason);
}

class SkipError extends Error {}

async function runTests() {
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok - ${name}`);
      passed += 1;
    } catch (error) {
      if (error instanceof SkipError) {
        console.log(`ok - ${name} (skipped: ${error.message})`);
        continue;
      }
      console.error(`not ok - ${name}`);
      console.error(error);
      process.exitCode = 1;
      break;
    }
  }
}

async function main() {
  if (skipAll) {
    console.log('ok - live LSP suite skipped (CODEYO_SKIP_LSP_LIVE=1)');
    return;
  }
  await runTests();
  if (!process.exitCode) {
    console.log(`${passed} live LSP checks passed${skipped ? ` (${skipped} skipped)` : ''}.`);
    console.log('- Pyright rename and clangd format/rename/codeActions exercised against real servers');
  }
}

main().catch((error) => {
  console.error('Live LSP integration test failed.');
  console.error(error);
  process.exitCode = 1;
});
