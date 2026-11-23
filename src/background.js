chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-annotation") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await chrome.tabs.sendMessage(tab.id, { type: "annotate" });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "capture-screenshot") return;
  chrome.tabs.captureVisibleTab(sender.tab?.windowId, { format: "png" })
    .then((dataUrl) => sendResponse({ dataUrl }))
    .catch((error) => sendResponse({ error: String(error?.message || error) }));
  return true;
});
