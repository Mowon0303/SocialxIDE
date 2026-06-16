# Codeyo

Codeyo is a local-first desktop IDE built with Angular, Electron, CodeMirror, xterm, node-pty, and electron-builder.

## v0.1 Scope

Codeyo v0.1 is a personal Desktop Social IDE. It is intentionally local-first and single-user: no accounts, cloud sync, real DM, realtime collaboration, model AI, debugger, CMake, extension marketplace, or remote development.

The local editor includes Python and C++ language assistance. Python uses bundled Pyright. C++ uses a system `clangd` when available and reports a missing-tool state when it is not on `PATH`. Spell check covers Markdown plus comments and strings in code. Editor font, font size, density, and theme are local appearance settings.

Unsaved desktop buffers block quit by default. Codeyo writes recovery copies before showing the quit prompt and only tears down terminal sessions and workspace watchers after quit is actually committed.
Portable `.codeyo/` journal export is bounded to Codeyo's import size limit; older history is trimmed before writing a payload that the app could not import later.
Portable `.codeyo/` storage refuses symlinked storage directories so journal import/export cannot be redirected outside the trusted workspace.
When portable data is imported into another workspace, colliding journal, snapshot, and run evidence IDs are remapped instead of overwriting records that belong to a different workspace.
Review snapshots and attached run evidence are resolved only inside their owning workspace, including at the storage layer.
Workspace explorer preview is globally bounded for file count, directory count, and depth before trust-sensitive actions are enabled.

The v0.1 daily-use loop is:

1. Open a trusted local project.
2. Edit files with CodeMirror tabs and safe save/recovery behavior.
3. Run Python or C++ profiles and inspect diagnostics.
4. Use a real terminal backed by node-pty.
5. Review Git status/diff, stage or unstage files and hunks, commit, pull, and push.
6. Keep Activity Journal entries and review snapshots tied to code, run evidence, and Git context.

## Development

Run the Angular app in a browser:

```bash
npm start
```

Browser development mode is a renderer preview. It does not provide the full Electron desktop API, so real terminal, trusted workspace file operations, LSP process management, runner behavior, Git actions, and recovery persistence must be verified in Electron.

Run Electron against the current desktop build:

```bash
npm run desktop:build
npm run desktop:dev
```

Rebuild native terminal bindings when Electron or Node dependencies change:

```bash
npm run desktop:rebuild
```

## Verification

Run the production web build and unit tests:

```bash
npm run build
npm test -- --watch=false
```

Run the Electron syntax checks:

```bash
node --check electron/main.cjs
node --check electron/preload.cjs
node --check electron/storage.cjs
node --check electron/app-lifecycle-policy.cjs
node --check electron/path-policy.cjs
node --check electron/cpp-run-policy.cjs
node --check electron/dogfood-checklist.cjs
node --check electron/dogfood-status.cjs
node --check electron/file-content-policy.cjs
node --check electron/file-operations.cjs
node --check electron/file-write-policy.cjs
node --check electron/git-action-policy.cjs
node --check electron/git-discard-policy.cjs
node --check electron/gitignore-policy.cjs
node --check electron/git-output-policy.cjs
node --check electron/generate-icons.cjs
node --check electron/journal-metadata-policy.cjs
node --check electron/language-service.cjs
node --check electron/notarization-policy.cjs
node --check electron/portable-storage-policy.cjs
node --check electron/verify-mac-release.cjs
node --check electron/check-notarization-evidence.cjs
node --check electron/check-notarization-env.cjs
node --check electron/ipc-trust-policy.cjs
node --check electron/release-artifact-policy.cjs
node --check electron/release-freshness-policy.cjs
node --check electron/release-manifest-policy.cjs
node --check electron/runner-input-policy.cjs
node --check electron/runner-output-policy.cjs
node --check electron/runner-temp-policy.cjs
node --check electron/test-backend.cjs
node --check electron/test-release-evidence.cjs
node --check electron/security-policy.cjs
node --check electron/smoke-local-project.cjs
node --check electron/smoke-packaged-app.cjs
node --check electron/terminal-policy.cjs
node --check electron/tool-command-policy.cjs
node --check electron/validate-dogfood-log.cjs
node --check electron/verify-release-manifest.cjs
node --check electron/verify-v0.1.cjs
node --check electron/verify-win-release.cjs
node --check electron/windows-installer-policy.cjs
node --check electron/workspace-file-listing.cjs
node --check electron/workspace-list-policy.cjs
node --check electron/workspace-path-policy.cjs
node --check electron/workspace-watch-policy.cjs
node --check electron/write-dogfood-log-template.cjs
node --check electron/write-release-readiness.cjs
node --check electron/write-release-manifest.cjs
```

Regenerate desktop icons:

```bash
npm run desktop:icons
```

Run the Electron backend boundary checks:

```bash
npm run desktop:test:backend
```

Run only the release evidence policy checks:

```bash
npm run desktop:test:release-evidence
```

Run the live language-server integration checks. This spawns the real bundled Pyright and a system `clangd` in a throwaway workspace and drives format, rename, and code actions end to end. It is not part of `desktop:test:backend` because it starts real servers; missing tools are skipped as passing lines. See `electron/VERIFY-IDE-ACTIONS.md` for this plus the manual Electron UI checklist:

```bash
npm run desktop:test:lsp-live
```

Run a local real-project smoke test. It creates a temporary project, runs Python, C++, node-pty, Git hunk stage/unstage/discard, branch/commit/push/pull against a local bare remote, and verifies `.codeyo` portable storage:

```bash
npm run desktop:smoke:local
```

Use `CODEYO_SMOKE_PYTHON=/path/to/python` or `CODEYO_SMOKE_CXX=/path/to/clang++` when the default commands are not correct.

After packaging, run the packaged app startup smoke test:

```bash
npm run desktop:smoke:app
```

It launches the packaged app with isolated user data, waits for the renderer to load, runs a main-process deep smoke covering workspace files, portable storage, Python runner, Git, and node-pty, then exits automatically.

Run the full v0.1 verification gate:

```bash
npm run desktop:verify:v0.1
```

On macOS this runs syntax checks, backend checks, local smoke, unit tests, production build, DMG build, packaged app startup smoke, and mounted-DMG release verification. Set `CODEYO_REQUIRE_NOTARIZATION=1` to require notarization credential preflight before packaging and stapled DMG validation after packaging.

After a full verification gate, Codeyo writes and verifies a machine-readable release manifest under `release/Codeyo-<version>-<platform>-<arch>.manifest.json` with artifact sizes and SHA256 checksums. It also writes `release/Codeyo-<version>-v0.1-readiness.json`, which separates local automation pass/fail state from external release blockers such as macOS notarization, Windows x64 machine testing, and sustained real-project dogfood. The readiness report embeds the current release artifact binding, including artifact path, artifact SHA256, manifest path, manifest SHA256, and verification entries. It also blocks local readiness when release source inputs are newer than the manifest, which means the full v0.1 gate must be rerun after code or packaging changes. Do not hand-edit release readiness or manifest files; regenerate them through the full gate.

## Desktop Packaging

The desktop packaging scripts assume Angular assets already exist and then make the built `index.html` Electron-relative.

macOS ARM:

```bash
npm run desktop:build
npm run desktop:dist:mac
npm run desktop:verify:mac
```

Before public macOS distribution, verify notarization credentials are present:

```bash
npm run desktop:check:notarization
```

After building a public distribution DMG, verify the stapled notarization ticket:

```bash
npm run desktop:check:notarization-evidence
```

Windows x64:

```bash
npm run desktop:build
npm run desktop:dist:win
npm run desktop:verify:win
```

Run the Windows packaging scripts on a Windows x64 machine. Codeyo includes `node-pty`, so Windows packages require a local Windows Electron rebuild rather than a macOS cross-build. `npm run desktop:verify:win` checks the NSIS installer, `win-unpacked/Codeyo.exe`, asar resources, node-pty native module, launches the unpacked app with isolated user data, silently installs the NSIS package into a temporary directory, launches the installed app, and silently uninstalls it.

Useful unpacked package checks:

```bash
npm run desktop:pack:mac
npm run desktop:pack:win
```

macOS artifacts are written to `release/Codeyo-<version>-arm64.dmg` and `release/mac-arm64/Codeyo.app`. Windows artifacts are written under `release/` when built on a Windows machine or a cross-build host with electron-builder's Windows toolchain available.
Release manifests are written under `release/Codeyo-<version>-<platform>-<arch>.manifest.json`. Platform verification receipts are written under `release/Codeyo-<version>-<platform>-<arch>.verification.json` by `npm run desktop:verify:mac` or `npm run desktop:verify:win`, and the manifest records the receipt SHA256. For Windows handoff, keep the Windows installer, `win-unpacked/`, Windows manifest, and Windows verification receipt together.

Write the v0.1 readiness report without rebuilding artifacts:

```bash
npm run desktop:release:readiness
```

Set `CODEYO_REQUIRE_RELEASE_READY=1` to make pending external blockers fail the readiness command. Set `CODEYO_DOGFOOD_LOG=/path/to/log.json` after sustained real-project use.

Create a structured dogfood evidence template:

```bash
npm run desktop:dogfood:template
```

Inspect dogfood progress while the evidence log is still incomplete:

```bash
npm run desktop:dogfood:status -- release/Codeyo-0.1.0-dogfood-template.json
```

The status output includes the artifact, manifest, and verification receipt bindings, then lists the remaining sessions, checklist evidence, and blocker fields still needed before readiness can accept the log.

Validate a completed dogfood evidence log:

```bash
npm run desktop:dogfood:validate -- release/Codeyo-0.1.0-dogfood-template.json
```

Successful validation prints the completed log path and the artifact, manifest, and verification receipt bindings accepted for that dogfood run.
The readiness check accepts `CODEYO_DOGFOOD_LOG` only when the JSON log matches `codeyo-dogfood-v1`, targets the current Codeyo version, covers at least two distinct days and 120 minutes, marks every v0.1 smoke-test item as `pass`, includes concrete non-placeholder evidence for each item, and has no unresolved blockers.
Generate the template after `npm run desktop:verify:v0.1` so `releaseArtifact` is prefilled from the current release manifest. Readiness rejects dogfood evidence when its artifact SHA, manifest SHA, or verification entries do not match the current platform release manifest.

## v0.1 Release Smoke Test

Before calling a build usable as v0.1, complete this flow on a real local project:

1. Install and launch the macOS ARM DMG.
2. Open a trusted project with nested files.
3. Edit, save, Save All, close, reopen, and confirm no edits are lost.
4. Create, rename, and delete a test file with confirmation.
5. Run a Python file and navigate any diagnostic to CodeMirror.
6. Run a C++ profile, including one multi-source profile when available.
7. Open terminal tabs, rename one, resize the window, close a tab, and confirm the process lifecycle is clear.
8. Review Git status, compare unstaged and staged changes, stage or unstage a hunk, discard only after confirmation, commit, pull, and push.
9. Create a review snapshot with run evidence, reopen it from the Activity Journal, compare it with current files, restore one hunk, and fork one snapshot.
10. Restart Codeyo and confirm recent workspace, recovery buffers, settings, terminal state, journal entries, and snapshots behave as expected.

Windows x64 uses the same smoke test after building on a Windows machine. Until that machine-level test is complete, Windows should be treated as preview.

## v0.1 Release Notes

- macOS ARM packaging is verified locally with a signed DMG, app bundle signature check, ATS inspection, node-pty native module inspection, mounted DMG content check, and mounted app startup smoke test.
- macOS notarization credentials are not present in local development by default. A public distribution build should pass `npm run desktop:verify:v0.1` with `CODEYO_REQUIRE_NOTARIZATION=1`, which checks credentials before packaging and validates the stapled DMG after packaging.
- Windows x64 packaging and verification scripts are configured but must be built and smoke-tested on a Windows x64 machine because node-pty requires native Electron bindings for that platform.
- Release artifacts under `release/` are local build outputs and should not be committed.
