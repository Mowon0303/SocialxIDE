# Verifying the IDE language actions (Format / Rename / Code Actions)

Two layers of verification cover the live LSP features. Run the automated one
first; use the manual checklist for the UI/UX paths it cannot exercise.

## 1. Automated live-server integration test

```bash
npm run desktop:test:lsp-live
```

This spawns the real bundled **Pyright** (Python) and a system **clangd** (C++)
in a throwaway workspace and drives `formatDocument` / `renameSymbol` /
`codeActions` end to end through `LanguageServiceManager`. It asserts:

- C++ `formatDocument` returns real edits from clangd.
- C++ `renameSymbol` rewrites the declaration and call site (`>= 2` edits).
- C++ `codeActions` returns `available: true` with an actions array (clangd
  often yields **no** edit-bearing actions for a clean snippet — that is
  expected; the suite asserts shape, not count).
- Python `renameSymbol` via Pyright rewrites every reference.
- Python `formatDocument` is intentionally `python-formatter-unconfigured`.
- An unsupported language returns `missing-tool` without throwing.

When a tool is missing (`clangd` not on `PATH`, Pyright unresolvable, or
`CODEYO_SKIP_LSP_LIVE=1`) the affected checks print a passing `skipped` line so
the suite stays green. It is **not** part of `desktop:test:backend` because it
spawns real processes; run it explicitly (and add it as a separate CI job with
clangd installed if you want it gated there).

## 2. Manual Electron UI checklist

```bash
npm run desktop:dev
```

Open a real folder, click **Trust**. The three buttons are in the editor
toolbar: **Format** → `formatActiveDocument()`, **Rename** → `openRenameSymbol()`,
**Actions** → `requestCodeActions()`. All outcomes surface in the bottom status
bar (`workspaceNotice`). Rename/Actions edits land as **dirty in-memory
buffers** — nothing is written to disk until you **Save All**.

### Preconditions
- [ ] Trusted workspace; status shows Pyright and clangd ready (not missing-tool).
- [ ] Create `main.cpp` (`int  add(int a,int b){return a+b;}`) and a `main.py`
      with a `def greet(name): ...` used below.

### C++ format
- [ ] On `main.cpp`, click **Format** → buffer reflows, notice `FORMATTED · main.cpp`, tab shows dirty.
- [ ] Click **Format** again → notice `ALREADY FORMATTED · main.cpp`, no change.

### C++ rename
- [ ] Cursor on `add`, **Rename** → type `sum`, submit → declaration and call become `sum`, notice `RENAMED TO sum`, files dirty.
- [ ] **Rename** with an empty name → notice `RENAME NEEDS A NEW NAME.`, popover stays.

### C++ code actions
- [ ] Cursor on a plain identifier, **Actions**. clangd commonly returns no
      edit-bearing actions here → expect notice `NO CODE ACTIONS · main.cpp:<line>`
      and no popover (graceful, not a hang). If a position yields actions, the
      popover lists them; clicking one applies it with notice `APPLIED · <title>`.

### Python rename
- [ ] Cursor on `greet`, **Rename** → `welcome` → def and call rewritten, notice `RENAMED TO welcome`, dirty buffers.

### Python format (intentional gap)
- [ ] On `main.py`, **Format** → notice `FORMAT UNAVAILABLE · PYTHON FORMATTER NOT CONFIGURED · main.py`, no change.

### Guard rails
- [ ] In an untrusted / home-mode workspace, each button shows its
      `TRUSTED WORKSPACE FILE REQUIRED FOR …` notice and does nothing.
- [ ] With clangd absent, **Format** on a `.cpp` shows
      `FORMAT UNAVAILABLE · FORMATTER TOOL NOT FOUND` rather than crashing.

### Persistence
- [ ] After a successful Rename/Format, **Save All** → edits persist to disk and
      the Git panel shows the diff (confirms the dirty → Save All flow).
