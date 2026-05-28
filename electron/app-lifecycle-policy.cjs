const desktopResourceCleanupEvent = 'will-quit';

function unsavedQuitPromptOptions() {
  return {
    type: 'warning',
    buttons: ['Stay in Codeyo', 'Quit Without Saving'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    message: 'Codeyo has unsaved workspace buffers.',
    detail: 'Recovery copies were written before the quit request. Quit only if you do not need to save these buffers first.',
  };
}

function shouldAllowPreventedUnload(choice) {
  return choice === 1;
}

function shouldCleanupDesktopResources(eventName) {
  return eventName === desktopResourceCleanupEvent;
}

module.exports = {
  desktopResourceCleanupEvent,
  shouldAllowPreventedUnload,
  shouldCleanupDesktopResources,
  unsavedQuitPromptOptions,
};
