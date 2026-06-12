chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'pickerResult' || msg.type === 'pickerCancelled') {
    chrome.runtime.sendMessage(msg).catch(() => {});
  }
});

chrome.storage.local.get(['brandColors', 'ignoreRules'], (data) => {
  if (!data.brandColors) chrome.storage.local.set({ brandColors: [] });
  if (!data.ignoreRules) chrome.storage.local.set({ ignoreRules: [] });
});
