const fs = require('node:fs');
const path = require('node:path');

function windowsInstallerInstallArgs(installDir) {
  if (typeof installDir !== 'string' || !installDir.trim()) {
    throw new Error('Windows installer target directory is required');
  }
  return ['/S', `/D=${installDir}`];
}

function windowsUninstallerArgs() {
  return ['/S'];
}

function findWindowsUninstaller(installDir) {
  if (!installDir || !fs.existsSync(installDir) || !fs.statSync(installDir).isDirectory()) {
    return '';
  }
  const candidates = fs.readdirSync(installDir)
    .filter((name) => /^uninstall.*\.exe$/i.test(name))
    .map((name) => path.join(installDir, name))
    .filter((candidate) => fs.statSync(candidate).isFile())
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
  return candidates[0] || '';
}

module.exports = {
  findWindowsUninstaller,
  windowsInstallerInstallArgs,
  windowsUninstallerArgs,
};
