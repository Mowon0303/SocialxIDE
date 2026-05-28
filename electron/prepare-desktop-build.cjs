const fs = require('node:fs');
const path = require('node:path');

const indexPath = path.join(__dirname, '..', 'dist', 'atelier-ide', 'browser', 'index.html');
const content = fs.readFileSync(indexPath, 'utf8');
const baseHrefPattern = /<base\s+href=["'][^"']*["']\s*>/;

if (!baseHrefPattern.test(content)) {
  throw new Error('Desktop build could not locate the Angular base href.');
}

const desktopIndex = content.replace(baseHrefPattern, '<base href="./">');
fs.writeFileSync(indexPath, desktopIndex, 'utf8');
console.log('Prepared Electron-relative desktop asset paths.');
