const expectedPlatform = process.argv[2];

const labels = {
  darwin: 'macOS',
  win32: 'Windows',
};

if (!expectedPlatform || !labels[expectedPlatform]) {
  console.error('Usage: node electron/check-package-platform.cjs <darwin|win32>');
  process.exit(2);
}

if (process.platform !== expectedPlatform) {
  console.error(
    `Codeyo ${labels[expectedPlatform]} packages must be built on ${labels[expectedPlatform]}. `
    + 'node-pty native modules require a local Electron rebuild and cannot be cross-compiled safely.',
  );
  process.exit(1);
}
