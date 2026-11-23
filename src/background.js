chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-annotation") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await chrome.tabs.sendMessage(tab.id, { type: "annotate" });
});
