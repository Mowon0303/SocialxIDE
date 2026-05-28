const path = require('node:path');
const {
  ignoredDirectories,
  isEditableRelativePath,
  portableEditableRelativePath,
} = require('./path-policy.cjs');
const {
  canAddWorkspaceFile,
  canEnterWorkspaceDirectory,
  createWorkspaceListBudget,
} = require('./workspace-list-policy.cjs');

async function listWorkspaceFiles(fsApi, rootPath, {
  currentPath = '',
  depth = 0,
  budget = createWorkspaceListBudget(),
  languageFor = () => 'text',
} = {}) {
  if (!canEnterWorkspaceDirectory(budget, depth)) {
    return [];
  }

  const entries = await fsApi.readdir(path.join(rootPath, currentPath), { withFileTypes: true }).catch(() => []);
  const files = [];
  const sortedEntries = entries.slice().sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of sortedEntries) {
    if (budget.truncated) {
      break;
    }

    const relativePath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name) && !entry.name.startsWith('.')) {
        files.push(...await listWorkspaceFiles(fsApi, rootPath, {
          currentPath: relativePath,
          depth: depth + 1,
          budget,
          languageFor,
        }));
      }
      continue;
    }

    if (!entry.isFile() || !isEditableRelativePath(relativePath) || !canAddWorkspaceFile(budget)) {
      continue;
    }

    const safePath = portableEditableRelativePath(relativePath);
    files.push({
      path: safePath,
      name: entry.name,
      language: languageFor(safePath),
      status: 'saved',
    });
  }

  return files.sort((a, b) => a.path.localeCompare(b.path));
}

module.exports = {
  listWorkspaceFiles,
};
