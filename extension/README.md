# RBUILDER Browser Bridge (experimental)

An optional Chrome/Edge extension that connects a **user-selected** Qwen or
DeepSeek tab to the RBUILDER web app. It never reads cookies, passwords, or
session tokens: the user signs in to the site themselves, and the extension
only forwards explicit commands through the page's visible DOM.

## Install (Chrome / Edge)

1. Open the extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `extension/` folder of this project.
4. Open http://localhost:5185 (RBUILDER) and keep the tab open.
5. In a second tab, open and sign in to https://qwen.ai or https://chat.deepseek.com.
6. In RBUILDER, click **Browser sessions → Connect current tab**.

## How it works

- The RBUILDER tab posts an `rbuilder-browser-bridge` message.
- `bridge.js` (content script on the RBUILDER tab) forwards it to `background.js`.
- `background.js` finds an open Qwen/DeepSeek tab and sends it the command.
- `bridge.js` inside the provider tab answers, and the result travels back.

No cookies are read; if no provider tab is open, connection simply fails with
`Open a signed-in <provider> tab first.`

## Limits

- Prompt forwarding into the provider tab is intentionally disabled until a
  DOM adapter for that provider's UI is configured (selectors change often).
- The provider tab must stay open; background requests are not supported.
- This is an experimental companion to the supported OpenAI-compatible API
  providers configured in RBUILDER Settings.
