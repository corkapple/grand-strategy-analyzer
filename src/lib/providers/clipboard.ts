import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { ImageInput, LLMProvider } from "./types";

const inTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function copyText(text: string): Promise<void> {
  if (inTauri) await writeText(text);
  else await navigator.clipboard.writeText(text);
}

/** Puts an image on the clipboard as PNG (the only format browsers reliably accept). */
export async function copyImage(img: ImageInput): Promise<void> {
  const el = new Image();
  el.src = `data:${img.mimeType};base64,${img.base64}`;
  await el.decode();
  const canvas = document.createElement("canvas");
  canvas.width = el.naturalWidth;
  canvas.height = el.naturalHeight;
  canvas.getContext("2d")!.drawImage(el, 0, 0);
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Could not encode image"))), "image/png"));
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

/** Stitches all screenshots side by side into one PNG, so a chat needs only one paste. */
export async function copyCombined(imgs: ImageInput[]): Promise<void> {
  const els = await Promise.all(
    imgs.map(async (img) => {
      const el = new Image();
      el.src = `data:${img.mimeType};base64,${img.base64}`;
      await el.decode();
      return el;
    }),
  );
  const h = Math.min(1400, Math.max(...els.map((e) => e.naturalHeight)));
  const widths = els.map((e) => Math.round((e.naturalWidth * h) / e.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = widths.reduce((a, b) => a + b + 8, -8);
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let x = 0;
  els.forEach((e, i) => {
    ctx.drawImage(e, x, 0, widths[i], h);
    x += widths[i] + 8;
  });
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Could not encode image"))), "image/png"));
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

/** Web chats you can finish an analysis in by hand when the APIs are busy. */
export const CHAT_SITES = [
  { id: "openrouter", label: "OpenRouter chat" },
  { id: "gemini", label: "Gemini chat" },
  { id: "deepseek", label: "DeepSeek chat" },
] as const;

export async function openChat(site: string): Promise<void> {
  if (inTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_chat", { site });
  } else {
    const urls: Record<string, string> = {
      openrouter: "https://openrouter.ai/workspaces/default/chat",
      gemini: "https://gemini.google.com/app",
      deepseek: "https://chat.deepseek.com/",
    };
    window.open(urls[site], "_blank", "noopener");
  }
}

/**
 * Manual fallback. Copies a ready-to-send query (system + user prompt) to the
 * clipboard. The user pastes it, plus the screenshot, into any chat UI and then
 * pastes the JSON reply back into the app.
 */
export const clipboardFallback: LLMProvider = {
  id: "clipboard",
  label: "Clipboard-to-Chat (manual)",
  group: "no-api",
  capabilities: {
    vision: true,
    requiresApiKey: false,
    local: true,
    manual: true,
    notes:
      "No network calls. The prompt is copied; attach the screenshot yourself, then paste the model's JSON reply back here.",
  },
  defaultConfig: {},

  async analyze(req) {
    const prompt = `${req.systemPrompt}\n\n---\n\n${req.userPrompt}\n\n(Attach the ${req.images.length} screenshot(s) to this message.)`;
    await copyText(prompt);
    return {
      status: "awaiting-manual-response",
      text: "",
      manualPrompt: prompt,
      providerId: "clipboard",
    };
  },
};
