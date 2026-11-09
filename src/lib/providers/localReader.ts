import { readScreens } from "../ocr/read";
import { ProviderError, type LLMProvider } from "./types";

/**
 * Reads screenshots on this computer: macOS Vision / Windows OCR (or a bundled WASM reader) turns the image
 * into text, a rule-based parser reads the game's fixed layouts, and the game's own totals check every number.
 * No AI, no key, no quota, and the screenshot never leaves the computer.
 *
 * `extra.strict = "1"`: only answer when everything is verified, otherwise fail so the next provider runs.
 * Otherwise: answer with whatever could be read, marked low-confidence (the last resort).
 */
export const localReader: LLMProvider = {
  id: "local",
  label: "On-device reader (offline, no key)",
  group: "local",
  capabilities: {
    vision: true,
    imageOnly: true,
    requiresApiKey: false,
    local: true,
    notes:
      "Reads the screenshot on this computer, with no AI and no internet. It only answers when every number matches the game's own totals; the app asks an AI service when it is not sure.",
  },
  defaultConfig: {},

  async analyze(req, cfg) {
    if (!req.images.length) throw new ProviderError("The on-device reader only reads screenshots.", "local");
    const strict = cfg.extra?.strict === "1";
    let reading;
    try {
      reading = await readScreens(req.images);
    } catch (e) {
      throw new ProviderError(`The on-device reader could not run: ${(e as Error).message}`, "local");
    }
    if (!reading.recon && !reading.battle && !reading.reconFailed) {
      throw new ProviderError("The on-device reader found no recon report or battle result.", "local");
    }
    if (strict && !reading.verified) {
      throw new ProviderError(
        `not certain enough to trust (${reading.problems.join("; ") || "checks failed"})`,
        "local",
      );
    }
    return {
      status: "complete",
      text: JSON.stringify(reading.payload),
      providerId: "local",
      model: reading.verified ? "on-device reader (verified)" : "on-device reader (unverified)",
      note: reading.verified ? undefined : `read on this computer but not fully verified: ${reading.problems.join("; ")}`,
    };
  },

  async testConnection() {
    return "Nothing to connect: this reader runs on your computer.";
  },
};
