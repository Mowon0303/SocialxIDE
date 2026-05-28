const { constants } = require('node:fs');
const {
  assertRealPathInsideWorkspace,
  assertWritableParentInsideWorkspace,
} = require('./workspace-path-policy.cjs');

async function appendCodeyoGitignore(fsApi, pathApi, rootPath) {
  const ignorePath = pathApi.join(rootPath, '.gitignore');
  const linkStat = await fsApi.lstat(ignorePath).catch((error) => {
    if (error?.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  });
  if (linkStat?.isSymbolicLink()) {
    throw new Error('Workspace .gitignore must not be a symlink');
  }
  if (linkStat && !linkStat.isFile()) {
    throw new Error('Workspace .gitignore path is not a file');
  }
  if (linkStat) {
    await assertRealPathInsideWorkspace(fsApi, pathApi, rootPath, ignorePath);
  } else {
    await assertWritableParentInsideWorkspace(fsApi, pathApi, rootPath, ignorePath);
  }

  const handle = await fsApi.open(ignorePath, gitignoreOpenFlags(Boolean(linkStat)));
  try {
    const content = linkStat ? await handle.readFile('utf8') : '';
    const entries = content.split(/\r?\n/).map((line) => line.trim());
    if (entries.includes('.codeyo/') || entries.includes('.codeyo')) {
      return { appended: false };
    }
    const prefix = content && !content.endsWith('\n') ? '\n' : '';
    await handle.writeFile(`${prefix}.codeyo/\n`, 'utf8');
  } finally {
    await handle.close();
  }
  return { appended: true };
}

function gitignoreOpenFlags(fileExists) {
  return fileExists
    ? constants.O_RDWR | (constants.O_NOFOLLOW || 0)
    : constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0);
}

module.exports = {
  appendCodeyoGitignore,
  gitignoreOpenFlags,
};
