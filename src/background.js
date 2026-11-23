chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-annotation" && command !== "toggle-annotation-shot") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await chrome.tabs.sendMessage(tab.id, { type: "annotate", screenshot: command === "toggle-annotation-shot" });
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install" || details.reason === "update") {
    chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "capture-screenshot") return;
  chrome.tabs.captureVisibleTab(sender.tab?.windowId, { format: "png" })
    .then((dataUrl) => sendResponse({ dataUrl }))
    .catch((error) => sendResponse({ error: String(error?.message || error) }));
  return true;
});
