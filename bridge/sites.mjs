// Per-site selectors for the web-chat driver.
//
// Verification status (2026-11-08, signed-out pages inspected in a browser):
//  gemini   input, send, file input: VERIFIED. response: UNVERIFIED (needs login).
//  chatgpt  signed-out composer VERIFIED; the logged-in UI is A/B tested, so older
//           ids are kept as fallbacks. response: UNVERIFIED.
//  deepseek ALL UNVERIFIED (site was unreachable from the dev network). Sending uses
//           the Enter key so a wrong send-button selector cannot break it.
// Run `npm run bridge:check` on your own network to see which selectors match.

export const SITES = {
  gemini: {
    url: "https://gemini.google.com/app",
    input: 'div.ql-editor[contenteditable="true"]',
    // File <input>s only exist after the "Upload & tools" menu is opened.
    openUpload: 'button[aria-label="Upload & tools"], button:has-text("Upload & tools")',
    fileInput: 'input[type="file"]',
    // Appears only once the box has text.
    send: 'button[aria-label="Send message"]',
    response: "message-content, .model-response-text",
  },
  chatgpt: {
    url: "https://chatgpt.com/",
    input: '#prompt-textarea, #mobile-composer-prompt, textarea[aria-label="Chat with ChatGPT"]',
    fileInput:
      '#octane-mobile-composer-files-input, #octane-mobile-composer-photos-input, input[type="file"]',
    send: 'button[data-testid="send-button"], button[aria-label="Send message"]',
    response: '[data-message-author-role="assistant"]',
  },
  deepseek: {
    url: "https://chat.deepseek.com/",
    input: "#chat-input, textarea",
    fileInput: 'input[type="file"]',
    sendKey: "Enter", // press Enter in the box instead of clicking a button
    response: ".ds-markdown",
  },
};
