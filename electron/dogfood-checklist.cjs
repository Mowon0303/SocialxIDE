const REQUIRED_DOGFOOD_DAYS = 2;
const REQUIRED_DOGFOOD_MINUTES = 120;
const DOGFOOD_SCHEMA = 'codeyo-dogfood-v1';
const MIN_EVIDENCE_CHARS = 24;
const placeholderEvidencePattern = /^(?:ok|pass(?:ed)?|done|verified|works?|n\/a|na|none|todo|tbd|pending|yes|no|same as above|see above)$/i;

const dogfoodChecklist = [
  {
    id: 'install-launch',
    label: 'Install and launch packaged app',
    requirement: 'Install and launch the packaged macOS ARM DMG or Windows x64 installer.',
  },
  {
    id: 'trusted-nested-project',
    label: 'Open trusted nested project',
    requirement: 'Open a trusted project with nested files and confirm trust-gated capabilities enable.',
  },
  {
    id: 'edit-save-reopen',
    label: 'Edit, save, Save All, and reopen',
    requirement: 'Edit files, save manually, Save All, close, reopen, and confirm no edits are lost.',
  },
  {
    id: 'file-create-rename-delete',
    label: 'Create, rename, and delete files',
    requirement: 'Create, rename, and delete a test file, including destructive confirmation.',
  },
  {
    id: 'python-diagnostics',
    label: 'Run Python and inspect diagnostics',
    requirement: 'Run a Python file and navigate at least one diagnostic to CodeMirror.',
  },
  {
    id: 'cpp-profile',
    label: 'Run C++ profile',
    requirement: 'Run a C++ profile, including one multi-source profile when available.',
  },
  {
    id: 'terminal-tabs',
    label: 'Use terminal tabs',
    requirement: 'Open terminal tabs, rename one, resize the window, close a tab, and confirm process lifecycle feedback.',
  },
  {
    id: 'git-workflow',
    label: 'Complete Git workflow',
    requirement: 'Review status/diff, stage or unstage a hunk, discard only after confirmation, commit, pull, and push.',
  },
  {
    id: 'snapshot-review',
    label: 'Complete snapshot review loop',
    requirement: 'Create a review snapshot with run evidence, reopen it from Journal, compare, restore one hunk, and fork one snapshot.',
  },
  {
    id: 'restart-persistence',
    label: 'Restart and verify persistence',
    requirement: 'Restart Codeyo and verify recent workspace, recovery buffers, settings, terminal state, journal entries, and snapshots.',
  },
];

function createDogfoodTemplate({
  codeyoVersion = '',
  generatedAt = new Date().toISOString(),
  releaseArtifact = emptyReleaseArtifact(),
} = {}) {
  return {
    schema: DOGFOOD_SCHEMA,
    codeyoVersion,
    generatedAt,
    releaseArtifact,
    project: {
      name: '',
      path: '',
      notes: '',
    },
    startedAt: '',
    completedAt: '',
    sessions: [
      {
        date: '',
        durationMinutes: 0,
        summary: '',
      },
      {
        date: '',
        durationMinutes: 0,
        summary: '',
      },
    ],
    checklist: dogfoodChecklist.map((step) => ({
      id: step.id,
      label: step.label,
      requirement: step.requirement,
      status: 'pending',
      evidence: '',
    })),
    blockers: [],
  };
}

function validateDogfoodLog(log, { expectedVersion = '', expectedReleaseArtifact = null } = {}) {
  const errors = [];
  if (!log || typeof log !== 'object' || Array.isArray(log)) {
    return {
      ok: false,
      errors: ['dogfood log must be a JSON object'],
      summary: '',
    };
  }

  if (log.schema !== DOGFOOD_SCHEMA) {
    errors.push(`schema must be ${DOGFOOD_SCHEMA}`);
  }
  if (expectedVersion && log.codeyoVersion !== expectedVersion) {
    errors.push(`codeyoVersion must be ${expectedVersion}`);
  }

  validateReleaseArtifact(log.releaseArtifact, errors, { expectedVersion, expectedReleaseArtifact });
  validateProject(log.project, errors);
  validateDates(log.startedAt, log.completedAt, errors);
  const sessionSummary = validateSessions(log.sessions, errors);
  const checklistSummary = validateChecklist(log.checklist, errors);
  validateBlockers(log.blockers, errors);

  return {
    ok: errors.length === 0,
    errors,
    summary: [
      `${checklistSummary.passed}/${dogfoodChecklist.length} checklist step(s) passed`,
      `${sessionSummary.days} day(s)`,
      `${sessionSummary.minutes} minute(s)`,
    ].join(', '),
  };
}

function dogfoodProgressReport(log, { expectedVersion = '', expectedReleaseArtifact = null } = {}) {
  const validation = validateDogfoodLog(log, { expectedVersion, expectedReleaseArtifact });
  if (!log || typeof log !== 'object' || Array.isArray(log)) {
    return {
      ok: false,
      errors: validation.errors,
      summary: {
        checklistPassed: 0,
        checklistTotal: dogfoodChecklist.length,
        sessionDays: 0,
        requiredDays: REQUIRED_DOGFOOD_DAYS,
        sessionMinutes: 0,
        requiredMinutes: REQUIRED_DOGFOOD_MINUTES,
        openBlockers: 0,
        releaseArtifactStatus: 'blocked',
        projectStatus: 'blocked',
        dateStatus: 'blocked',
      },
      checklist: dogfoodChecklist.map((step) => ({
        ...step,
        status: 'pending',
        evidence: '',
        issues: ['log is not a dogfood object'],
      })),
      sessions: {
        days: 0,
        minutes: 0,
        requiredDays: REQUIRED_DOGFOOD_DAYS,
        requiredMinutes: REQUIRED_DOGFOOD_MINUTES,
        issues: ['sessions are unavailable'],
      },
      blockers: { openCount: 0, items: [], issues: [] },
      releaseArtifact: { status: 'blocked', issues: ['releaseArtifact is unavailable'] },
      project: { status: 'blocked', issues: ['project is unavailable'] },
      dates: { status: 'blocked', issues: ['dates are unavailable'] },
    };
  }

  const checklist = dogfoodChecklistProgress(log.checklist);
  const sessions = dogfoodSessionProgress(log.sessions);
  const blockers = dogfoodBlockerProgress(log.blockers);
  const releaseArtifact = dogfoodReleaseArtifactProgress(log.releaseArtifact, {
    expectedVersion,
    expectedReleaseArtifact,
  });
  const project = dogfoodProjectProgress(log.project);
  const dates = dogfoodDateProgress(log.startedAt, log.completedAt);
  return {
    ok: validation.ok,
    errors: validation.errors,
    summary: {
      checklistPassed: checklist.passed,
      checklistTotal: dogfoodChecklist.length,
      sessionDays: sessions.days,
      requiredDays: REQUIRED_DOGFOOD_DAYS,
      sessionMinutes: sessions.minutes,
      requiredMinutes: REQUIRED_DOGFOOD_MINUTES,
      openBlockers: blockers.openCount,
      releaseArtifactStatus: releaseArtifact.status,
      projectStatus: project.status,
      dateStatus: dates.status,
    },
    checklist: checklist.items,
    sessions,
    blockers,
    releaseArtifact,
    project,
    dates,
  };
}

function emptyReleaseArtifact() {
  return {
    productName: '',
    appId: '',
    version: '',
    platform: '',
    arch: '',
    artifactLabel: '',
    artifactPath: '',
    artifactBytes: 0,
    artifactSha256: '',
    manifestPath: '',
    manifestSha256: '',
    verificationReceiptPath: '',
    verificationReceiptBytes: 0,
    verificationReceiptSha256: '',
    verification: [],
  };
}

function releaseArtifactFromManifest(manifest, { manifestPath = '', manifestSha256 = '' } = {}) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return emptyReleaseArtifact();
  }
  const primaryLabel = manifest.platform === 'darwin'
    ? 'macOS DMG'
    : manifest.platform === 'win32'
      ? 'Windows NSIS installer'
      : '';
  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  const artifact = artifacts.find((item) => item?.label === primaryLabel) || artifacts[0] || {};
  const verificationReceipt = manifest.verificationReceipt && typeof manifest.verificationReceipt === 'object'
    && !Array.isArray(manifest.verificationReceipt)
    ? manifest.verificationReceipt
    : {};
  return {
    productName: stringValue(manifest.productName),
    appId: stringValue(manifest.appId),
    version: stringValue(manifest.version),
    platform: stringValue(manifest.platform),
    arch: stringValue(manifest.arch),
    artifactLabel: stringValue(artifact.label),
    artifactPath: stringValue(artifact.relativePath),
    artifactBytes: Number.isInteger(artifact.bytes) ? artifact.bytes : 0,
    artifactSha256: stringValue(artifact.sha256),
    manifestPath: stringValue(manifestPath),
    manifestSha256: stringValue(manifestSha256),
    verificationReceiptPath: stringValue(verificationReceipt.relativePath),
    verificationReceiptBytes: Number.isInteger(verificationReceipt.bytes) ? verificationReceipt.bytes : 0,
    verificationReceiptSha256: stringValue(verificationReceipt.sha256),
    verification: Array.isArray(manifest.verification)
      ? manifest.verification.filter((entry) => typeof entry === 'string' && entry.trim()).slice(0, 32)
      : [],
  };
}

function validateReleaseArtifact(releaseArtifact, errors, { expectedVersion = '', expectedReleaseArtifact = null } = {}) {
  if (!releaseArtifact || typeof releaseArtifact !== 'object' || Array.isArray(releaseArtifact)) {
    errors.push('releaseArtifact must be an object');
    return;
  }

  const requiredText = [
    'productName',
    'appId',
    'version',
    'platform',
    'arch',
    'artifactLabel',
    'artifactPath',
    'manifestPath',
    'verificationReceiptPath',
  ];
  for (const key of requiredText) {
    if (typeof releaseArtifact[key] !== 'string' || !releaseArtifact[key].trim()) {
      errors.push(`releaseArtifact.${key} is required`);
    }
  }
  if (expectedVersion && releaseArtifact.version !== expectedVersion) {
    errors.push(`releaseArtifact.version must be ${expectedVersion}`);
  }
  if (!Number.isInteger(releaseArtifact.artifactBytes) || releaseArtifact.artifactBytes <= 0) {
    errors.push('releaseArtifact.artifactBytes must be a positive integer');
  }
  if (!isSha256(releaseArtifact.artifactSha256)) {
    errors.push('releaseArtifact.artifactSha256 must be a SHA256 hex digest');
  }
  if (!isSha256(releaseArtifact.manifestSha256)) {
    errors.push('releaseArtifact.manifestSha256 must be a SHA256 hex digest');
  }
  if (!Number.isInteger(releaseArtifact.verificationReceiptBytes) || releaseArtifact.verificationReceiptBytes <= 0) {
    errors.push('releaseArtifact.verificationReceiptBytes must be a positive integer');
  }
  if (!isSha256(releaseArtifact.verificationReceiptSha256)) {
    errors.push('releaseArtifact.verificationReceiptSha256 must be a SHA256 hex digest');
  }
  if (!Array.isArray(releaseArtifact.verification) || releaseArtifact.verification.length === 0) {
    errors.push('releaseArtifact.verification must contain release verification entries');
  } else if (!releaseArtifact.verification.every((entry) => typeof entry === 'string' && entry.trim())) {
    errors.push('releaseArtifact.verification must contain only non-empty strings');
  }

  if (expectedReleaseArtifact) {
    for (const key of [
      'productName',
      'appId',
      'version',
      'platform',
      'arch',
      'artifactLabel',
      'artifactPath',
      'artifactBytes',
      'artifactSha256',
      'manifestPath',
      'manifestSha256',
      'verificationReceiptPath',
      'verificationReceiptBytes',
      'verificationReceiptSha256',
    ]) {
      if (releaseArtifact[key] !== expectedReleaseArtifact[key]) {
        errors.push(`releaseArtifact.${key} must match current release manifest`);
      }
    }
    if (!sameStringArray(releaseArtifact.verification, expectedReleaseArtifact.verification)) {
      errors.push('releaseArtifact.verification must match current release manifest');
    }
  }
}

function validateProject(project, errors) {
  if (!project || typeof project !== 'object' || Array.isArray(project)) {
    errors.push('project must be an object');
    return;
  }
  const name = typeof project.name === 'string' ? project.name.trim() : '';
  const projectPath = typeof project.path === 'string' ? project.path.trim() : '';
  if (!name && !projectPath) {
    errors.push('project.name or project.path is required');
  }
}

function validateDates(startedAt, completedAt, errors) {
  const started = parseDateTime(startedAt);
  const completed = parseDateTime(completedAt);
  if (!started) {
    errors.push('startedAt must be an ISO date-time string');
  }
  if (!completed) {
    errors.push('completedAt must be an ISO date-time string');
  }
  if (started && completed && completed.getTime() < started.getTime()) {
    errors.push('completedAt must be after startedAt');
  }
}

function validateSessions(sessions, errors) {
  if (!Array.isArray(sessions) || sessions.length === 0) {
    errors.push('sessions must contain at least one dogfood session');
    return { days: 0, minutes: 0 };
  }

  const days = new Set();
  let minutes = 0;
  for (const [index, session] of sessions.entries()) {
    if (!session || typeof session !== 'object' || Array.isArray(session)) {
      errors.push(`sessions[${index}] must be an object`);
      continue;
    }
    const date = sessionDate(session);
    if (!date) {
      errors.push(`sessions[${index}].date must be YYYY-MM-DD or startedAt must be ISO date-time`);
    } else {
      days.add(date);
    }
    if (!Number.isFinite(session.durationMinutes) || session.durationMinutes <= 0) {
      errors.push(`sessions[${index}].durationMinutes must be a positive number`);
    } else {
      minutes += session.durationMinutes;
    }
    if (typeof session.summary !== 'string' || session.summary.trim().length < 8) {
      errors.push(`sessions[${index}].summary must describe what was tested`);
    }
  }

  if (days.size < REQUIRED_DOGFOOD_DAYS) {
    errors.push(`dogfood must cover at least ${REQUIRED_DOGFOOD_DAYS} distinct day(s)`);
  }
  if (minutes < REQUIRED_DOGFOOD_MINUTES) {
    errors.push(`dogfood must cover at least ${REQUIRED_DOGFOOD_MINUTES} total minute(s)`);
  }

  return { days: days.size, minutes };
}

function validateChecklist(checklist, errors) {
  if (!Array.isArray(checklist)) {
    errors.push('checklist must be an array');
    return { passed: 0 };
  }

  const byId = new Map();
  for (const item of checklist) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.id !== 'string') {
      errors.push('checklist contains an invalid item');
      continue;
    }
    if (byId.has(item.id)) {
      errors.push(`checklist contains duplicate item ${item.id}`);
    }
    byId.set(item.id, item);
  }

  let passed = 0;
  for (const step of dogfoodChecklist) {
    const item = byId.get(step.id);
    if (!item) {
      errors.push(`checklist is missing ${step.id}`);
      continue;
    }
    if (item.status !== 'pass') {
      errors.push(`checklist ${step.id} must have status "pass"`);
      continue;
    }
    const evidenceError = dogfoodEvidenceError(item.evidence);
    if (evidenceError) {
      errors.push(`checklist ${step.id} ${evidenceError}`);
      continue;
    }
    passed += 1;
  }

  return { passed };
}

function dogfoodChecklistProgress(checklist) {
  const byId = new Map();
  if (Array.isArray(checklist)) {
    for (const item of checklist) {
      if (item && typeof item === 'object' && !Array.isArray(item) && typeof item.id === 'string') {
        byId.set(item.id, item);
      }
    }
  }

  let passed = 0;
  const items = dogfoodChecklist.map((step) => {
    const item = byId.get(step.id);
    const issues = [];
    if (!item) {
      issues.push('missing checklist item');
    } else {
      if (item.status !== 'pass') {
        issues.push(`status is "${stringValue(item.status) || 'missing'}"`);
      }
      const evidenceError = dogfoodEvidenceError(item.evidence);
      if (evidenceError) {
        issues.push(evidenceError);
      }
    }
    if (issues.length === 0) {
      passed += 1;
    }
    return {
      id: step.id,
      label: step.label,
      requirement: step.requirement,
      status: issues.length === 0 ? 'pass' : 'pending',
      evidence: typeof item?.evidence === 'string' ? item.evidence : '',
      issues,
    };
  });

  if (!Array.isArray(checklist)) {
    for (const item of items) {
      item.issues = ['checklist must be an array'];
      item.status = 'pending';
    }
    passed = 0;
  }

  return { passed, items };
}

function dogfoodEvidenceError(evidence) {
  if (typeof evidence !== 'string') {
    return 'must include concrete evidence';
  }
  const text = evidence.trim();
  if (text.length < MIN_EVIDENCE_CHARS) {
    return `must include concrete evidence of at least ${MIN_EVIDENCE_CHARS} characters`;
  }
  if (placeholderEvidencePattern.test(text)) {
    return 'must replace placeholder evidence with concrete notes';
  }
  return '';
}

function dogfoodSessionProgress(sessions) {
  const issues = [];
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return {
      days: 0,
      minutes: 0,
      requiredDays: REQUIRED_DOGFOOD_DAYS,
      requiredMinutes: REQUIRED_DOGFOOD_MINUTES,
      status: 'pending',
      issues: ['sessions must contain at least one dogfood session'],
    };
  }

  const days = new Set();
  let minutes = 0;
  for (const [index, session] of sessions.entries()) {
    if (!session || typeof session !== 'object' || Array.isArray(session)) {
      issues.push(`sessions[${index}] must be an object`);
      continue;
    }
    const date = sessionDate(session);
    if (date) {
      days.add(date);
    } else {
      issues.push(`sessions[${index}].date must be YYYY-MM-DD or startedAt must be ISO date-time`);
    }
    if (Number.isFinite(session.durationMinutes) && session.durationMinutes > 0) {
      minutes += session.durationMinutes;
    } else {
      issues.push(`sessions[${index}].durationMinutes must be a positive number`);
    }
    if (typeof session.summary !== 'string' || session.summary.trim().length < 8) {
      issues.push(`sessions[${index}].summary must describe what was tested`);
    }
  }
  if (days.size < REQUIRED_DOGFOOD_DAYS) {
    issues.push(`dogfood must cover at least ${REQUIRED_DOGFOOD_DAYS} distinct day(s)`);
  }
  if (minutes < REQUIRED_DOGFOOD_MINUTES) {
    issues.push(`dogfood must cover at least ${REQUIRED_DOGFOOD_MINUTES} total minute(s)`);
  }

  return {
    days: days.size,
    minutes,
    requiredDays: REQUIRED_DOGFOOD_DAYS,
    requiredMinutes: REQUIRED_DOGFOOD_MINUTES,
    status: issues.length === 0 ? 'pass' : 'pending',
    issues,
  };
}

function dogfoodBlockerProgress(blockers) {
  if (blockers === undefined) {
    return { openCount: 0, items: [], status: 'pass', issues: [] };
  }
  if (!Array.isArray(blockers)) {
    return { openCount: 1, items: [], status: 'blocked', issues: ['blockers must be an array'] };
  }
  const open = blockers.filter((blocker) => {
    if (!blocker || typeof blocker !== 'object' || Array.isArray(blocker)) {
      return true;
    }
    const status = typeof blocker.status === 'string' ? blocker.status.toLowerCase() : '';
    return !['closed', 'resolved', 'accepted'].includes(status);
  });
  return {
    openCount: open.length,
    items: open,
    status: open.length === 0 ? 'pass' : 'blocked',
    issues: open.length === 0 ? [] : [`dogfood has ${open.length} unresolved blocker(s)`],
  };
}

function dogfoodReleaseArtifactProgress(releaseArtifact, { expectedVersion = '', expectedReleaseArtifact = null } = {}) {
  const issues = [];
  validateReleaseArtifact(releaseArtifact, issues, { expectedVersion, expectedReleaseArtifact });
  return {
    status: issues.length === 0 ? 'pass' : 'blocked',
    issues,
  };
}

function dogfoodProjectProgress(project) {
  const issues = [];
  validateProject(project, issues);
  return {
    status: issues.length === 0 ? 'pass' : 'pending',
    issues,
  };
}

function dogfoodDateProgress(startedAt, completedAt) {
  const issues = [];
  validateDates(startedAt, completedAt, issues);
  return {
    status: issues.length === 0 ? 'pass' : 'pending',
    issues,
  };
}

function validateBlockers(blockers, errors) {
  if (blockers === undefined) {
    return;
  }
  if (!Array.isArray(blockers)) {
    errors.push('blockers must be an array');
    return;
  }

  const openBlockers = blockers.filter((blocker) => {
    if (!blocker || typeof blocker !== 'object' || Array.isArray(blocker)) {
      return true;
    }
    const status = typeof blocker.status === 'string' ? blocker.status.toLowerCase() : '';
    return !['closed', 'resolved', 'accepted'].includes(status);
  });
  if (openBlockers.length > 0) {
    errors.push(`dogfood has ${openBlockers.length} unresolved blocker(s)`);
  }
}

function sessionDate(session) {
  if (typeof session.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(session.date)) {
    return session.date;
  }
  const started = parseDateTime(session.startedAt);
  return started ? started.toISOString().slice(0, 10) : '';
}

function parseDateTime(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function stringValue(value) {
  return typeof value === 'string' ? value : '';
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function sameStringArray(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

module.exports = {
  DOGFOOD_SCHEMA,
  REQUIRED_DOGFOOD_DAYS,
  REQUIRED_DOGFOOD_MINUTES,
  dogfoodChecklist,
  createDogfoodTemplate,
  emptyReleaseArtifact,
  dogfoodProgressReport,
  releaseArtifactFromManifest,
  validateDogfoodLog,
};
