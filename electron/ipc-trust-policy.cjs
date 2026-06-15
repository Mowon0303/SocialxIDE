const preTrustAllowedChannels = Object.freeze([
  'workspace:open',
  'workspace:recent',
  'workspace:resume',
  'workspace:trust',
  'files:list',
  'files:read',
  'runner:profiles',
  'runner:history',
  'runner:get-result',
  'journal:list',
  'journal:get-snapshot',
]);

const trustedWorkspaceRequiredChannels = Object.freeze([
  'files:write',
  'files:create',
  'files:rename',
  'files:remove',
  'files:backup-recovery',
  'files:backup-recovery-sync',
  'files:recovery',
  'files:list-recovery',
  'files:clear-recovery',
  'terminal:list',
  'terminal:create',
  'terminal:rename',
  'terminal:write',
  'terminal:resize',
  'terminal:kill',
  'runner:run',
  'runner:save-profile',
  'language:status',
  'language:open-document',
  'language:change-document',
  'language:close-document',
  'language:completion',
  'language:hover',
  'language:definition',
  'language:rename-symbol',
  'language:code-actions',
  'language:format-document',
  'git:status',
  'git:branches',
  'git:staged-summary',
  'git:diff',
  'git:compare',
  'git:history',
  'git:commit-detail',
  'git:compare-commit',
  'git:apply-patch',
  'git:action',
  'journal:add',
  'journal:snapshot',
  'settings:storage-mode',
  'environment:check-tools',
]);

const rendererSubscribedChannels = Object.freeze([
  'files:changed',
  'menu:open-terminal',
  'terminal:data',
  'terminal:exit',
  'language:diagnostics',
  'language:status-changed',
]);

const destructiveFileChannels = new Set([
  'files:write',
  'files:create',
  'files:rename',
  'files:remove',
  'files:backup-recovery',
  'files:backup-recovery-sync',
  'files:recovery',
  'files:list-recovery',
  'files:clear-recovery',
]);

const dangerousExactChannels = new Set([
  ...destructiveFileChannels,
  'runner:run',
  'runner:save-profile',
  'language:open-document',
  'language:change-document',
  'language:close-document',
  'language:completion',
  'language:hover',
  'language:definition',
  'language:rename-symbol',
  'language:code-actions',
  'language:format-document',
  'journal:add',
  'journal:snapshot',
  'settings:storage-mode',
  'environment:check-tools',
]);

const trustedSet = new Set(trustedWorkspaceRequiredChannels);
const preTrustSet = new Set(preTrustAllowedChannels);
const rendererEventSet = new Set(rendererSubscribedChannels);
const classifiedSet = new Set([
  ...preTrustAllowedChannels,
  ...trustedWorkspaceRequiredChannels,
]);

function assertKnownIpcChannel(channel) {
  if (!classifiedSet.has(channel)) {
    throw new Error(`IPC channel is not classified by trust policy: ${channel}`);
  }
}

function isTrustedWorkspaceRequiredChannel(channel) {
  return trustedSet.has(channel);
}

function isDangerousIpcChannel(channel) {
  return dangerousExactChannels.has(channel)
    || channel.startsWith('terminal:')
    || channel.startsWith('git:')
    || channel.startsWith('language:');
}

function assertIpcTrustPolicyComplete(registeredChannels) {
  const channels = [...new Set(registeredChannels)].sort();
  const missing = channels.filter((channel) => !classifiedSet.has(channel));
  const stale = [...classifiedSet].filter((channel) => !channels.includes(channel)).sort();
  const unsafe = channels.filter((channel) => (
    isDangerousIpcChannel(channel) && !isTrustedWorkspaceRequiredChannel(channel)
  ));
  const duplicates = preTrustAllowedChannels.filter((channel) => trustedSet.has(channel)).sort();

  if (missing.length || stale.length || unsafe.length || duplicates.length) {
    throw new Error([
      'IPC trust policy is incomplete.',
      missing.length ? `missing classifications: ${missing.join(', ')}` : '',
      stale.length ? `stale classifications: ${stale.join(', ')}` : '',
      unsafe.length ? `dangerous channels allowed before trust: ${unsafe.join(', ')}` : '',
      duplicates.length ? `duplicate classifications: ${duplicates.join(', ')}` : '',
    ].filter(Boolean).join(' '));
  }

  return {
    preTrustAllowed: channels.filter((channel) => preTrustSet.has(channel)),
    trustedWorkspaceRequired: channels.filter((channel) => trustedSet.has(channel)),
  };
}

function assertPreloadIpcSurfaceComplete({
  registeredChannels = [],
  preloadRequestChannels = [],
  preloadSubscriptionChannels = [],
  mainPublishedChannels = [],
} = {}) {
  const registered = uniqueSorted(registeredChannels);
  const requested = uniqueSorted(preloadRequestChannels);
  const subscribed = uniqueSorted(preloadSubscriptionChannels);
  const published = uniqueSorted(mainPublishedChannels);
  const unclassifiedRequests = requested.filter((channel) => !classifiedSet.has(channel));
  const missingPreloadRequests = registered.filter((channel) => !requested.includes(channel));
  const stalePreloadRequests = requested.filter((channel) => !registered.includes(channel));
  const unsafeRequests = requested.filter((channel) => (
    isDangerousIpcChannel(channel) && !isTrustedWorkspaceRequiredChannel(channel)
  ));
  const unexpectedSubscriptions = subscribed.filter((channel) => !rendererEventSet.has(channel));
  const unexpectedPublished = published.filter((channel) => !rendererEventSet.has(channel));
  const staleSubscriptions = rendererSubscribedChannels
    .filter((channel) => !subscribed.includes(channel) || !published.includes(channel));

  if (
    unclassifiedRequests.length
    || missingPreloadRequests.length
    || stalePreloadRequests.length
    || unsafeRequests.length
    || unexpectedSubscriptions.length
    || unexpectedPublished.length
    || staleSubscriptions.length
  ) {
    throw new Error([
      'Preload IPC surface is incomplete.',
      unclassifiedRequests.length ? `unclassified preload requests: ${unclassifiedRequests.join(', ')}` : '',
      missingPreloadRequests.length ? `main handlers not exposed by preload: ${missingPreloadRequests.join(', ')}` : '',
      stalePreloadRequests.length ? `preload requests without main handlers: ${stalePreloadRequests.join(', ')}` : '',
      unsafeRequests.length ? `dangerous preload requests allowed before trust: ${unsafeRequests.join(', ')}` : '',
      unexpectedSubscriptions.length ? `unexpected renderer subscriptions: ${unexpectedSubscriptions.join(', ')}` : '',
      unexpectedPublished.length ? `unexpected main published events: ${unexpectedPublished.join(', ')}` : '',
      staleSubscriptions.length ? `stale renderer event policy entries: ${staleSubscriptions.join(', ')}` : '',
    ].filter(Boolean).join(' '));
  }

  return {
    registered,
    requested,
    subscribed,
    published,
  };
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

module.exports = {
  assertPreloadIpcSurfaceComplete,
  assertIpcTrustPolicyComplete,
  assertKnownIpcChannel,
  isDangerousIpcChannel,
  isTrustedWorkspaceRequiredChannel,
  preTrustAllowedChannels,
  rendererSubscribedChannels,
  trustedWorkspaceRequiredChannels,
};
