function shouldWatchWorkspace(workspace) {
  return Boolean(workspace && workspace.trusted === true);
}

module.exports = {
  shouldWatchWorkspace,
};
