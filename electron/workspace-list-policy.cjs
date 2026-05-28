const maxWorkspaceListFiles = 400;
const maxWorkspaceListDirectories = 1200;
const maxWorkspaceListDepth = 7;

function createWorkspaceListBudget({
  maxFiles = maxWorkspaceListFiles,
  maxDirectories = maxWorkspaceListDirectories,
  maxDepth = maxWorkspaceListDepth,
} = {}) {
  return {
    files: 0,
    directories: 0,
    maxFiles,
    maxDirectories,
    maxDepth,
    truncated: false,
  };
}

function canEnterWorkspaceDirectory(budget, depth) {
  if (!budget || typeof budget !== 'object') {
    throw new Error('Workspace list budget is required');
  }
  if (budget.truncated) {
    return false;
  }
  if (depth > budget.maxDepth) {
    return false;
  }
  if (budget.directories >= budget.maxDirectories) {
    budget.truncated = true;
    return false;
  }
  budget.directories += 1;
  return true;
}

function canAddWorkspaceFile(budget) {
  if (!budget || typeof budget !== 'object') {
    throw new Error('Workspace list budget is required');
  }
  if (budget.truncated || budget.files >= budget.maxFiles) {
    budget.truncated = true;
    return false;
  }
  budget.files += 1;
  return true;
}

module.exports = {
  canAddWorkspaceFile,
  canEnterWorkspaceDirectory,
  createWorkspaceListBudget,
  maxWorkspaceListDepth,
  maxWorkspaceListDirectories,
  maxWorkspaceListFiles,
};
