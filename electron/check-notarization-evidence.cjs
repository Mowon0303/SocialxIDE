const fs = require('node:fs');
const path = require('node:path');
const { stapledNotarizationEvidence } = require('./notarization-policy.cjs');

const rootDir = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const dmgPath = path.join(rootDir, 'release', `Codeyo-${packageJson.version}-arm64.dmg`);

const result = stapledNotarizationEvidence(dmgPath);
if (!result.ok) {
  console.error(`macOS notarization evidence is not ready: ${result.detail}`);
  process.exit(1);
}

console.log(`macOS notarization evidence verified for ${path.relative(rootDir, dmgPath)}.`);
console.log(`- ${result.detail}`);
