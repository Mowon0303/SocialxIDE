const { constants } = require('node:fs');

async function renameWorkspaceFile(fs, path, sourcePath, targetPath) {
  const sourceStat = await fs.lstat(sourcePath);
  if (!sourceStat.isFile()) {
    throw new Error('Can only rename regular workspace files');
  }
  if (await fs.lstat(targetPath).catch(() => undefined)) {
    throw new Error('Cannot rename over an existing workspace file');
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await fs.copyFile(sourcePath, targetPath, constants.COPYFILE_EXCL);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error('Cannot rename over an existing workspace file');
    }
    throw error;
  }
  try {
    await fs.unlink(sourcePath);
  } catch (error) {
    await fs.unlink(targetPath).catch(() => undefined);
    throw error;
  }
  return { renamed: true };
}

module.exports = { renameWorkspaceFile };
