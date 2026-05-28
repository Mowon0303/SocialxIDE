const {
  missingNotarizationCredentials,
  notarizationCredentialSet,
} = require('./notarization-policy.cjs');

const satisfied = notarizationCredentialSet();

if (satisfied) {
  console.log(`macOS notarization credentials detected: ${satisfied.name}.`);
  process.exit(0);
}

console.error('macOS notarization credentials are not configured.');
console.error('Configure one complete credential set before public distribution:');
for (const set of missingNotarizationCredentials()) {
  const missing = set.missing;
  console.error(`- ${set.name}: missing ${missing.join(', ')}`);
}
process.exit(1);
