const clients = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !sender.tab) return;
  if (message.kind === 'rbuilder-client') {
    clients.set(sender.tab.id, sender.tab.id);
    routeToProvider(sender.tab.id, message.payload).then(sendResponse);
    return true;
  }
  if (message.kind === 'provider-result') {
    for (const clientId of clients.keys()) {
      chrome.tabs.sendMessage(clientId, { kind: 'bridge-result', payload: message.payload }).catch(() => clients.delete(clientId));
    }
  }
});

async function routeToProvider(clientId, payload) {
  const tabs = await chrome.tabs.query({});
  const providerTab = tabs.find((tab) => {
    const url = tab.url || '';
    return payload.provider === 'qwen'
      ? /(^|\.)qwen\.ai\//.test(url)
      : /(^|\.)deepseek\.com\//.test(url);
  });
  if (!providerTab?.id) return { ok: false, message: `Open a signed-in ${payload.provider} tab first.` };
  await chrome.tabs.sendMessage(providerTab.id, { kind: 'bridge-command', payload });
  return { ok: true, message: `Connected to the selected ${payload.provider} tab.` };
}
