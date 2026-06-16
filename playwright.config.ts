import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  // Retry on CI to absorb the occasional timing flake when launching the real
  // Electron app on a headless runner; locally a failure is a failure.
  retries: process.env.CI ? 2 : 0,
  reporter: [['list']],
});
