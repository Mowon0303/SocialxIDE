async function assertRealPathInsideWorkspace(fsApi, pathApi, workspaceRoot, target) {
  const [rootRealPath, targetRealPath] = await Promise.all([
    assertWorkspaceRootDirectory(fsApi, workspaceRoot),
    fsApi.realpath(target),
  ]);
  assertPathInsideRoot(pathApi, rootRealPath, targetRealPath);
  return targetRealPath;
}

async function assertWritableParentInsideWorkspace(fsApi, pathApi, workspaceRoot, target) {
  const rootRealPath = await assertWorkspaceRootDirectory(fsApi, workspaceRoot);
  let parent = pathApi.dirname(target);
  while (parent && parent !== pathApi.dirname(parent)) {
    try {
      const stat = await fsApi.stat(parent);
      if (!stat.isDirectory()) {
        throw new Error('Workspace parent path is not a directory');
      }
      const parentRealPath = await fsApi.realpath(parent);
      assertPathInsideRoot(pathApi, rootRealPath, parentRealPath);
      return parentRealPath;
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
      parent = pathApi.dirname(parent);
    }
  }
  throw new Error('Workspace parent path is not available');
}

async function assertWorkspaceRootDirectory(fsApi, workspaceRoot) {
  const rootStat = await fsApi.lstat(workspaceRoot);
  if (rootStat.isSymbolicLink()) {
    throw new Error('Workspace root must not be a symlink');
  }
  if (!rootStat.isDirectory()) {
    throw new Error('Workspace root is not a directory');
  }
  return fsApi.realpath(workspaceRoot);
}

function assertWorkspaceRootDirectorySync(fsApi, workspaceRoot) {
  const rootStat = fsApi.lstatSync(workspaceRoot);
  if (rootStat.isSymbolicLink()) {
    throw new Error('Workspace root must not be a symlink');
  }
  if (!rootStat.isDirectory()) {
    throw new Error('Workspace root is not a directory');
  }
  return fsApi.realpathSync(workspaceRoot);
}

function assertPathInsideRoot(pathApi, rootRealPath, targetRealPath) {
  const relative = pathApi.relative(rootRealPath, targetRealPath);
  if (relative && (relative.startsWith('..') || pathApi.isAbsolute(relative))) {
    throw new Error('Path leaves the trusted workspace');
  }
}

module.exports = {
  assertRealPathInsideWorkspace,
  assertWorkspaceRootDirectory,
  assertWorkspaceRootDirectorySync,
  assertWritableParentInsideWorkspace,
};
