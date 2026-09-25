const isRbuilder = /localhost:(5185|5173)/.test(location.host);
const isQwen = /(^|\.)qwen\.ai$/.test(location.hostname);
const isDeepSeek = /(^|\.)deepseek\.com$/.test(location.hostname);
const provider = isQwen ? 'qwen' : isDeepSeek ? 'deepseek' : null;

if (isRbuilder) {
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.source !== 'rbuilder-browser-bridge') return;
    chrome.runtime.sendMessage({ kind: 'rbuilder-client', payload: event.data.payload }, (response) => {
      window.postMessage({ source: 'rbuilder-browser-bridge', type: 'bridge:response', requestId: event.data.payload.requestId, ...response }, '*');
    });
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message.kind === 'bridge-result') window.postMessage({ source: 'rbuilder-browser-bridge', type: 'bridge:response', ...message.payload }, '*');
  });
}

if (provider) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.kind !== 'bridge-command') return;
    const payload = message.payload;
    if (payload.type === 'rbuilder:connect' || payload.type === 'rbuilder:status') {
      sendResponse({ ok: true, message: `Connected to the visible ${provider} tab.`, state: 'connected', provider });
      return;
    }
    if (payload.type === 'rbuilder:disconnect') {
      sendResponse({ ok: true, message: 'Tab disconnected.', state: 'disconnected', provider });
      return;
    }
    if (payload.type === 'rbuilder:prompt') {
      sendPrompt(payload.prompt).then((result) => {
        chrome.runtime.sendMessage({ kind: 'provider-result', payload: { requestId: payload.requestId, provider, ...result } });
      });
      sendResponse({ ok: true, message: `Prompt sent to ${provider}.` });
    }
  });
}

async function sendPrompt(prompt) {
  const input = findInput();
  if (!input) return { ok: false, message: `Could not find the ${provider} composer. Keep the chat page open.` };
  const before = visibleReplyText();
  input.focus();
  if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, prompt);
  } else {
    input.textContent = prompt;
  }
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  const send = findSendButton();
  if (!send) return { ok: false, message: `Could not find the ${provider} send button.` };
  send.click();
  const reply = await waitForReply(before);
  return reply ? { ok: true, message: 'Reply received.', reply } : { ok: false, message: 'Timed out waiting for a visible reply.' };
}

function findInput() {
  const selectors = provider === 'qwen'
    ? ['textarea', '[contenteditable="true"]', 'textarea[placeholder*="message" i]']
    : ['textarea', '[contenteditable="true"]', 'textarea[placeholder*="message" i]'];
  return selectors.map((selector) => document.querySelector(selector)).find(Boolean);
}

function findSendButton() {
  const buttons = [...document.querySelectorAll('button')];
  const terms = provider === 'qwen' ? ['send', '发送', 'submit'] : ['send', '发送', 'submit'];
  return buttons.find((button) => {
    const label = `${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''} ${button.textContent || ''}`.toLowerCase();
    return terms.some((term) => label.includes(term)) && !button.disabled;
  });
}

function visibleReplyText() {
  const selectors = provider === 'qwen'
    ? ['[data-message-author-role="assistant"]', '[class*="markdown"]', '[class*="assistant"]']
    : ['[data-message="assistant"]', '[class*="markdown"]', '[class*="assistant"]'];
  return selectors.map((selector) => [...document.querySelectorAll(selector)].map((node) => node.innerText).join('\n')).find(Boolean) || '';
}

function waitForReply(before) {
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const current = visibleReplyText();
      if (current && current !== before && current.length > before.length) {
        clearInterval(timer); resolve(current.slice(before.length).trim());
      } else if (Date.now() - started > 90_000) {
        clearInterval(timer); resolve(null);
      }
    }, 500);
  });
}
