# RELEASE-BLOCKERS.md — Codeyo v0.1.0

> **Status as of 2026-06-16.** All local automation is green: `npm run desktop:verify:v0.1` last passed (83.2s) against current code, rebuilding `release/Codeyo-0.1.0-arm64.dmg` (132 MB), the darwin-arm64 manifest, the verification receipt, and the v0.1 readiness report. `publicReleaseReady` is **false** and stays false until the three external blockers below all pass.
>
> Readiness currently reports:
> - `macos-notarization` → **pending_external**
> - `windows-install-e2e` → **pending_external**
> - `real-project-dogfood` → **pending_external**
>
> These three cannot be cleared by an agent on this macOS machine — each needs an input only the owner can supply (Apple credentials, a Windows x64 machine, real sustained usage).

## At a glance

| Blocker | Owner action (the one thing you do) | Already prepared for you |
| --- | --- | --- |
| **macOS notarization** | Provide one Apple credential set, then run the notarized verify on this Mac. | DMG built + ad-hoc signed; preflight, staple, and evidence checks wired. Gate auto-flips to `pass`. |
| **Windows x64 E2E** | Run the 7-step build+verify workflow on a real Windows machine. | All Windows scripts validated; NSIS config set. Cannot run on macOS. |
| **Real-project dogfood** | Use the app 2+ days on a real project, then fill + validate the log. | Template regenerated and bound to the current v0.1.0 manifest. |

**Recommended order:** start **dogfood today** (longest wall-clock), do **notarization** next on this Mac when you have Apple credentials, and run **Windows E2E** whenever you reach Windows hardware (independent of the others).

All commands below assume you run them from the repository root: `/Users/zuge/Mywork/atelier-ide` (except the Windows runbook, which runs on a separate Windows machine).

---

## 1. macOS Notarization (public DMG distribution)

**Blocker:** macOS notarization for the Codeyo v0.1 DMG public distribution.
**Only this Mac can do it** — but only *you* can supply the Apple credentials.

### What it needs from you
Apple Developer Program membership, your Team ID, and **one** of:
1. An App Store Connect API key, **or**
2. An app-specific password with your Apple ID, **or**
3. A `notarytool` keychain profile already configured on this machine.

### Prerequisites
- Apple Developer Program membership enrolled.
- This macOS machine with `/usr/bin/xcrun` and `/usr/libexec/PlistBuddy` (standard with Xcode).
- `release/Codeyo-0.1.0-arm64.dmg` already built — **done** (`npm run desktop:dist:mac`).

### Steps

**Choose one credential set** and export it.

Option 1 — App Store Connect API key (all three required):
```bash
export APPLE_API_KEY='<your-api-key-contents-as-string>'
export APPLE_API_KEY_ID='<API-Key-ID>'
export APPLE_API_ISSUER='<Issuer-ID>'
```

Option 2 — Apple ID + app-specific password + team ID (all three required):
```bash
export APPLE_ID='<your-apple-id@example.com>'
export APPLE_APP_SPECIFIC_PASSWORD='<16-char-app-specific-password>'
export APPLE_TEAM_ID='<10-char-team-id>'
```

Option 3 — Pre-configured notarytool keychain profile (both required):
```bash
export APPLE_KEYCHAIN='<keychain-profile-name>'
export APPLE_KEYCHAIN_PROFILE='<notarytool-profile-name>'
```

Verify credentials are set (all vars from your chosen option must be non-empty):
```bash
node electron/check-notarization-env.cjs
```

Enable the notarization requirement and build + notarize + staple in one step:
```bash
CODEYO_REQUIRE_NOTARIZATION=1 npm run desktop:verify:v0.1
```

Verify the stapled DMG contains a valid notarization ticket:
```bash
npm run desktop:check:notarization-evidence
```

Confirm readiness and watch `macos-notarization` become `pass`:
```bash
npm run desktop:release:readiness
```

### Acceptance criteria
- `CODEYO_REQUIRE_NOTARIZATION=1 npm run desktop:verify:v0.1` completes without error (credential preflight + build + notarize + staple + evidence).
- `npm run desktop:check:notarization-evidence` exits 0 and logs `xcrun stapler validate passed`.
- `npm run desktop:release:readiness` shows `macos-notarization` = `pass` and `credentialDetail` names your credential set.
- `release/Codeyo-0.1.0-arm64.dmg` has a valid stapled ticket (`xcrun stapler validate` passes).

### Verify
```bash
npm run desktop:check:notarization-evidence
xcrun stapler validate release/Codeyo-0.1.0-arm64.dmg
python3 -c "import json;print([b['status'] for b in json.load(open('release/Codeyo-0.1.0-v0.1-readiness.json'))['blockers'] if b['id']=='macos-notarization'])"
```

### Gotchas
- `APPLE_API_KEY` (full `.p8` content / multiline base64) and `APPLE_API_KEY_ID` (just the key ID) are distinct.
- `APPLE_APP_SPECIFIC_PASSWORD` is **not** your account password — generate it at https://appleid.apple.com → Security → App-specific passwords.
- `APPLE_TEAM_ID` is a 10-character identifier (e.g. `ABCD1E2F3G`), not your Team Name.
- Without `CODEYO_REQUIRE_NOTARIZATION=1`, the build skips preflight and notarization, defaulting to an ad-hoc signature (valid for local use only).
- Notarization via electron-builder's `@electron/notarize` needs network access and can take 1–15 minutes after upload to Apple.
- `xcrun stapler validate` runs only on macOS; it fails with `Stapling Failed` / `Request data was malformed` if the ticket is absent or invalid.
- electron-builder reads credentials directly from env vars at build time — no `.env` support unless you source it first.

---

## 2. Windows x64 install/uninstall E2E

**Blocker:** clear the Windows x64 install-E2E verification for Codeyo v0.1.0 by running the full Windows build + package + verify workflow on a real Windows x64 machine.
**This Mac cannot do it** — `node-pty` needs the Windows MSVC toolchain, and `electron/verify-win-release.cjs` hard-exits unless `process.platform === 'win32'`.

### What it needs from you
A real Windows x64 machine with Node.js 20+ and npm 10.9.4+. macOS cannot cross-verify Windows artifacts.

### Prerequisites
- Windows x64 machine, Windows 10 or later.
- Node.js 20+ and npm 10.9.4+.
- Build tools for native modules (Visual Studio Build Tools or equivalent C++ toolchain).
- Git installed.
- Clone of the repository at commit `v0.1.0` (the `main` tip) or later.
- `npm ci` completed in the clone.

### Steps (run on the Windows machine)

Clone the repository:
```bash
git clone https://github.com/Mowon0303/SocialxIDE.git && cd SocialxIDE
```

Install exact dependencies from the lockfile:
```bash
npm ci
```

Rebuild native modules for Electron on Windows (`node-pty` must build for Windows):
```bash
npm run desktop:rebuild
```

Build the Angular frontend:
```bash
npm run desktop:build
```

Prepare desktop assets (icons, config) for Windows packaging:
```bash
npm run desktop:prepare
```

Build and package the NSIS Windows installer:
```bash
npm run desktop:dist:win
```

Run the full Windows x64 release verification (must be on Windows):
```bash
npm run desktop:verify:win
```

### Acceptance criteria
- `npm run desktop:dist:win` produces `release/win-unpacked` and `release/Codeyo-0.1.0-x64.exe` (NSIS installer, ~130 MB+).
- `release/win-unpacked/Codeyo.exe` exists (>1 MB).
- `release/win-unpacked/resources/app.asar` exists (>1 MB).
- `release/win-unpacked/resources/app.asar.unpacked/node_modules/node-pty/build/Release/pty.node` exists (>1 KB).
- `npm run desktop:verify:win` completes without errors and produces `release/Codeyo-0.1.0-win32-x64.verification.json`.
- verify:win launches `win-unpacked/Codeyo.exe` with the `CODEYO_STARTUP_SMOKE` env vars and sees `CODEYO_STARTUP_SMOKE_OK` in stdout.
- verify:win silently installs (`/S /D=<tempdir>`), launches the installed `Codeyo.exe`, confirms startup, then silently uninstalls (`/S`) and confirms removal.
- The receipt records all 5 checks: (1) win-unpacked starts, (2) NSIS silent install, (3) installed app starts, (4) NSIS silent uninstall, (5) full install/uninstall/removal passed.

### Verify (on Windows)
```bash
ls -lh release/win-unpacked/Codeyo.exe | grep -v '^total'
ls -lh release/win-unpacked/resources/app.asar | grep -v '^total'
ls -lh 'release/win-unpacked/resources/app.asar.unpacked/node_modules/node-pty/build/Release/pty.node' | grep -v '^total'
ls -lh release/Codeyo-*.exe | head -1
test -f release/Codeyo-0.1.0-win32-x64.verification.json && echo 'Verification receipt exists'
grep -q 'NSIS installer installs, installed app starts, and uninstaller removes executable' release/Codeyo-0.1.0-win32-x64.verification.json && echo 'Core E2E check passed'
```

### Gotchas
- `verify-win-release.cjs` enforces Windows-only execution (`if (process.platform !== 'win32') fail(...)`). It is not cross-compilable.
- `node-pty` is a native C++ module compiled per platform; `desktop:rebuild` builds it against the local Windows MSVC toolchain. macOS prebuilt binaries will not work.
- The NSIS installer uses the `win/nsis` config in `package.json` (`oneClick=false`, `perMachine=false`, `allowToChangeInstallationDirectory=true`). The uninstaller is auto-generated by NSIS during the build.
- verify:win creates temp dirs and installs silently via `spawnSync`. Ensure antivirus does not quarantine the installer or block the smoke-test launches.
- `CODEYO_STARTUP_SMOKE` / `CODEYO_STARTUP_SMOKE_DEEP` trigger smoke-test mode; the app must print `CODEYO_STARTUP_SMOKE_OK` to stdout or verification fails.
- Artifacts are version-locked to `0.1.0`; a version bump changes the receipt path and artifact references.
- After uninstall, verify:win checks the installed executable no longer exists; an incomplete uninstaller fails this step.
- Temp dirs are cleaned with `fs.rmSync(..., { recursive: true, force: true })`. Do not interrupt the script mid-run or cleanup may not occur.

---

## 3. Real-project dogfood (sustained 2+ day use)

**Blocker:** complete sustained real-project dogfood testing to clear the v0.1 readiness blocker.
**Only you can do it** — the readiness gate requires lived, concrete evidence that cannot be fabricated (the validator rejects placeholder text).

### What it needs from you
2+ days of actual real-project usage of the packaged Codeyo app, exercising all 10 v0.1 smoke-test checklist items with concrete evidence.

### Prerequisites
- Packaged app (`npm run desktop:verify:v0.1` passed → `release/Codeyo-0.1.0-arm64.dmg`) — **done**.
- macOS ARM64 system.
- A real local project with Python, C++, Git history, and nested files.
- Availability over 2+ distinct calendar days, ≥120 minutes total.

### Steps

> The template `release/Codeyo-0.1.0-dogfood-template.json` is already regenerated with `--force` and bound to the current v0.1.0 manifest (artifactSha256 `4aec687e...`). Regenerate only if you rebuild the DMG.

Regenerate the template bound to the current release manifest (optional — already done):
```bash
npm run desktop:dogfood:template -- --force
```

Verify the binding (artifactSha256 / manifestSha256 from the v0.1.0 manifest):
```bash
cat release/Codeyo-0.1.0-dogfood-template.json | jq '.releaseArtifact | {artifactSha256, manifestSha256, version, platform, arch}'
```

Open the template to edit:
```bash
open release/Codeyo-0.1.0-dogfood-template.json
```

Then fill it in (no command — edit the JSON):
- **Project metadata:** `project.name` and `project.path` (or path alone) are required.
- **Timestamps:** `startedAt` and `completedAt` as ISO date-times (e.g. `2026-06-16T09:00:00Z`); `completedAt` after `startedAt`.
- **Sessions:** at least 2 entries spanning **2+ distinct calendar days**, ≥120 minutes total; each needs `date` (YYYY-MM-DD), positive `durationMinutes`, and an 8+ char `summary`.
- **Checklist (all 10):** set each `status` to `pass` and add **24+ char concrete evidence** that is not a placeholder word (`ok`, `pass`, `done`, `verified`, `works`, `na`, `none`, `todo`, `tbd`, `pending`, `yes`, `no`, `same as above`, `see above`). The 10 ids are: `install-launch`, `trusted-nested-project`, `edit-save-reopen`, `file-create-rename-delete`, `python-diagnostics`, `cpp-profile`, `terminal-tabs`, `git-workflow`, `snapshot-review`, `restart-persistence`.
- **Blockers (optional):** any entry's `status` must be `closed` / `resolved` / `accepted`, otherwise validation fails.

Validate the completed log against the current manifest binding:
```bash
npm run desktop:dogfood:validate -- release/Codeyo-0.1.0-dogfood-template.json
```

If validation passes, feed the log to readiness:
```bash
export CODEYO_DOGFOOD_LOG=release/Codeyo-0.1.0-dogfood-template.json
```

Regenerate the v0.1 readiness report with dogfood evidence:
```bash
npm run desktop:release:readiness
```

### Acceptance criteria
- `schema` is exactly `codeyo-dogfood-v1`.
- `codeyoVersion` matches `package.json` (`0.1.0`).
- `project.name` or `project.path` populated.
- `startedAt`/`completedAt` valid ISO date-times, `completedAt` after `startedAt`.
- `sessions` has ≥2 entries across ≥2 distinct calendar days.
- Total `durationMinutes` ≥ 120.
- All 10 checklist ids present, each `status='pass'`.
- Each checklist item has ≥24-char non-placeholder evidence.
- `releaseArtifact` matches the current v0.1.0 manifest on all required fields (productName, appId, version, platform, arch, artifactLabel, artifactPath, artifactBytes, artifactSha256, manifestPath, manifestSha256, verificationReceiptPath, verificationReceiptBytes, verificationReceiptSha256, and the verification array).
- `blockers` (if present) only contains `closed`/`resolved`/`accepted` entries.
- `validate-dogfood-log.cjs` reports `ok: true` with no errors.

### Verify
```bash
npm run desktop:dogfood:validate -- release/Codeyo-0.1.0-dogfood-template.json
npm run desktop:dogfood:status -- release/Codeyo-0.1.0-dogfood-template.json
echo $CODEYO_DOGFOOD_LOG && test -f $CODEYO_DOGFOOD_LOG
npm run desktop:release:readiness
```

### Gotchas
- Regenerate the template **after** `desktop:verify:v0.1` so `releaseArtifact` carries fresh SHAs — do not use a stale template.
- Evidence must be concrete and personal: *"Tested Python diagnostics, clicked navigate-to-definition error, confirmed jump to line 42 in mymodule.py"* is valid; *"verified"* is not.
- Validation strictly matches artifact SHA256, manifest SHA256, and verification-receipt SHA256 against the current platform manifest — any mismatch fails (the log binds to one specific build).
- Each `session.durationMinutes` must be > 0; zero/negative fails and does not count toward 120.
- Sessions must cover ≥2 **distinct** calendar days; two same-date sessions fail even past 120 minutes.
- All 10 checklist ids must be present in the same shape as in `dogfood-checklist.cjs`; a missing/misspelled id fails.
- Both `startedAt` and `completedAt` are required ISO strings; `completedAt` must be after `startedAt`.
- If `CODEYO_DOGFOOD_LOG` is set, `desktop:release:readiness` uses that path instead of the default.
- Readiness marks dogfood `pass` only when `validate-dogfood-log.cjs` returns `ok:true`; otherwise it lists the specific failures.

---

## What an agent on this macOS machine cannot do

- **Notarize** — needs your Apple Developer membership and a private credential set, plus network calls to Apple under your account. These are your secrets.
- **Run the Windows E2E** — this host is darwin/arm64; `node-pty` needs the Windows MSVC toolchain and `verify-win-release.cjs` hard-fails off-Windows. No cross-compile path exists.
- **Generate dogfood evidence** — the gate demands ≥120 minutes across 2+ real calendar days with 24+ char concrete, non-placeholder evidence for all 10 items. This is lived usage; the validator rejects fabricated/placeholder text.
- **Flip `publicReleaseReady` to true** — it stays false until all three external gates pass, each depending on inputs only you can provide.

