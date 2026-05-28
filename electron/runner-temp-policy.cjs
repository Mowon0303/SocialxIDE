function runnerOutputFileName(platform = process.platform) {
  return platform === 'win32' ? 'codeyo-run.exe' : 'codeyo-run';
}

async function createRunnerTempBuild(fsApi, pathApi, osApi, platform = process.platform) {
  const directoryPath = await fsApi.mkdtemp(pathApi.join(osApi.tmpdir(), 'codeyo-run-'));
  const stat = await fsApi.lstat(directoryPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Runner temp build directory is not valid');
  }
  return {
    directoryPath,
    outputPath: pathApi.join(directoryPath, runnerOutputFileName(platform)),
  };
}

async function cleanupRunnerTempBuild(fsApi, build) {
  if (!build?.directoryPath) {
    return;
  }
  await fsApi.rm(build.directoryPath, { recursive: true, force: true });
}

module.exports = {
  cleanupRunnerTempBuild,
  createRunnerTempBuild,
  runnerOutputFileName,
};
