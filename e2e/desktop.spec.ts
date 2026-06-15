import { expect, test } from '@playwright/test';
import { _electron as electron, ElectronApplication, Page } from 'playwright';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const repoRoot = process.cwd();
const execFileAsync = promisify(execFile);

test.describe('Codeyo Electron desktop smoke', () => {
  let app: ElectronApplication;
  let page: Page;
  let tempRoot: string;
  let workspaceRoot: string;

  test.beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codeyo-e2e-'));
    workspaceRoot = path.join(tempRoot, 'workspace');
    const userDataRoot = path.join(tempRoot, 'user-data');
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'main.py'),
      'print("codeyo e2e python")\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'main.cpp'),
      '#include <iostream>\nint main() { std::cout << "codeyo e2e cpp\\n"; }\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'broken.py'),
      'def explode():\n    raise RuntimeError("codeyo problem e2e")\n\nexplode()\n',
      'utf8',
    );
    await fs.writeFile(path.join(workspaceRoot, 'README.md'), '# Codeyo E2E\n', 'utf8');
    await git(['init']);
    await git(['config', 'user.email', 'codeyo-e2e@example.invalid']);
    await git(['config', 'user.name', 'Codeyo E2E']);
    await git(['add', '--', 'src/main.py', 'src/main.cpp', 'src/broken.py', 'README.md']);
    await git(['commit', '-m', 'Initial e2e baseline']);

    app = await electron.launch({
      args: ['.'],
      cwd: repoRoot,
      env: {
        ...process.env,
        CODEYO_E2E: '1',
        CODEYO_E2E_TRUST: '1',
        CODEYO_E2E_WORKSPACE: workspaceRoot,
        CODEYO_USER_DATA_DIR: userDataRoot,
      },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
  });

  test.afterEach(async () => {
    await app?.close();
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('opens a trusted workspace, exercises editor/run/problems/terminal/git/snapshot flows', async () => {
    await expect(page.locator('.studio-shell')).toBeVisible();
    await page.getByTestId('app-open-folder').click();

    await expect(page.getByRole('button', { name: /main\.py/i }).first()).toBeVisible();
    await page.getByRole('button', { name: /main\.py/i }).first().click();
    await expect(page.locator('.editor-ruler')).toContainText('src/main.py');

    const editor = page.locator('.cm-content').first();
    await editor.click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
    await page.keyboard.insertText('\nprint("saved from e2e")');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+S' : 'Control+S');
    await expect.poll(async () => fs.readFile(path.join(workspaceRoot, 'src', 'main.py'), 'utf8'))
      .toContain('saved from e2e');
    await expect(page.locator('.editor-ruler')).toContainText(/saved/i);

    await page.getByRole('button', { name: /^Search$/i }).click();
    await expect(page.locator('.cm-search')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: /Go Line/i }).click();
    await page.getByLabel(/Line number/i).fill('1');
    await page.getByRole('button', { name: /^Go$/i }).click();
    await expect(page.locator('.editor-ruler')).toContainText(/LN 1/i);

    await page.getByTestId('app-run-current').click();
    await expect(page.getByRole('button', { name: /Task · src\/main\.py EXIT 0/i }))
      .toBeVisible({ timeout: 20_000 });
    await page.getByTestId('terminal-task-tab').click();
    await expect.poll(async () => page.locator('.xterm-rows').last().textContent())
      .toContain('codeyo e2e python');
    await expect.poll(async () => page.locator('.xterm-rows').last().textContent())
      .toContain('saved from e2e');

    await page.getByRole('button', { name: /main\.cpp/i }).first().click();
    await expect(page.locator('.editor-ruler')).toContainText('src/main.cpp');
    await page.getByTestId('app-run-current').click();
    await expect(page.getByRole('button', { name: /Task · src\/main\.cpp EXIT 0/i }))
      .toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: /Task · src\/main\.cpp EXIT 0/i }).click();
    await expect.poll(async () => page.locator('.xterm-rows').last().textContent())
      .toContain('codeyo e2e cpp');

    await page.getByTestId('terminal-shell-tab').click();
    await page.getByTestId('terminal-host').click();
    await page.keyboard.type('echo CODEYO_TERMINAL_E2E');
    await page.keyboard.press('Enter');
    await expect.poll(async () => page.locator('.xterm-rows').last().textContent(), { timeout: 15_000 })
      .toContain('CODEYO_TERMINAL_E2E');

    await page.getByTestId('right-tab-git').click();
    await expect(page.getByTestId('git-panel')).toBeVisible();
    await expect(page.getByTestId('git-unstaged-file-src/main.py')).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('git-unstaged-compare-src/main.py').click();
    await expect(page.getByTestId('git-compare-workbench')).toBeVisible();
    await expect(page.getByTestId('git-compare-summary')).toContainText(/\+1/);
    await expect(page.getByTestId('git-compare-workbench')).toContainText('saved from e2e');

    await page.locator('[data-testid^="git-history-row-"]').first().click();
    await expect(page.getByTestId('git-compare-workbench')).toContainText('Initial e2e baseline');
    await expect(page.getByTestId('git-save-review-snapshot-file')).toBeVisible();
    await page.getByTestId('git-save-review-snapshot-file').click();

    await expect(page.getByTestId('channel-snapshots')).toHaveClass(/active/);
    const openSnapshotButton = page.locator('[data-testid^="journal-open-snapshot-"]').first();
    await expect(openSnapshotButton).toBeVisible({ timeout: 15_000 });
    await openSnapshotButton.click();
    await expect(page.getByTestId('snapshot-preview')).toBeVisible();
    await expect(page.getByTestId('snapshot-preview')).toContainText('Initial e2e baseline');
    await expect(page.getByTestId('snapshot-active-path')).toContainText(/[A-Za-z0-9]/);

    await page.getByTestId('channel-ide').click();
    await page.getByRole('button', { name: /broken\.py/i }).first().click();
    await expect(page.locator('.editor-ruler')).toContainText('src/broken.py');
    await page.getByTestId('app-run-current').click();
    await expect(page.getByTestId('console-tab-problems')).toHaveClass(/active/, { timeout: 20_000 });
    const problemItem = page.locator('[data-testid^="problem-item-src/broken.py-"]').first();
    await expect(problemItem).toBeVisible();
    await expect(problemItem).toContainText('RuntimeError');
    await problemItem.click();
    await expect(page.locator('.editor-ruler')).toContainText('src/broken.py');
    await expect(page.locator('.editor-ruler')).toContainText(/LN (2|4)/i);
  });

  async function git(args: string[]): Promise<void> {
    await execFileAsync('git', args, { cwd: workspaceRoot });
  }
});
