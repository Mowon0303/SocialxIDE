const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const notarizationCredentialSets = [
  {
    name: 'App Store Connect API key',
    variables: ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'],
  },
  {
    name: 'Apple ID app-specific password',
    variables: ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'],
  },
  {
    name: 'notarytool keychain profile',
    variables: ['APPLE_KEYCHAIN', 'APPLE_KEYCHAIN_PROFILE'],
  },
];

function notarizationCredentialSet(env = process.env) {
  return notarizationCredentialSets.find((set) => set.variables.every((key) => Boolean(env[key])));
}

function missingNotarizationCredentials(env = process.env) {
  return notarizationCredentialSets.map((set) => ({
    name: set.name,
    missing: set.variables.filter((key) => !env[key]),
  }));
}

function stapledNotarizationEvidence(artifactPath, {
  platform = process.platform,
  spawn = spawnSync,
} = {}) {
  if (platform !== 'darwin') {
    return {
      ok: false,
      status: 'pending_external',
      detail: 'run notarization evidence validation on macOS',
    };
  }
  if (!artifactPath || !fs.existsSync(artifactPath) || !fs.statSync(artifactPath).isFile()) {
    return {
      ok: false,
      status: 'blocked',
      detail: `notarization artifact is missing: ${artifactPath}`,
    };
  }

  const result = spawn('xcrun', ['stapler', 'validate', artifactPath], {
    encoding: 'utf8',
    timeout: 20000,
  });
  if (result.error) {
    return {
      ok: false,
      status: 'blocked',
      detail: `xcrun stapler validate failed to launch: ${result.error.message}`,
    };
  }
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    return {
      ok: false,
      status: 'blocked',
      detail: detail || `xcrun stapler validate exited with ${result.status ?? result.signal}`,
    };
  }
  return {
    ok: true,
    status: 'pass',
    detail: 'xcrun stapler validate passed',
  };
}

module.exports = {
  missingNotarizationCredentials,
  notarizationCredentialSet,
  notarizationCredentialSets,
  stapledNotarizationEvidence,
};
