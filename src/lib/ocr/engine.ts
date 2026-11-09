import { invoke } from "@tauri-apps/api/core";
import type { ImageInput } from "../providers/types";
import { tesseractRows } from "./tesseract";

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Reads an image and returns its rows of text. `scale` asks for an independent second reading. */
export type OcrEngine = (img: ImageInput, scale: number) => Promise<string[]>;

let override: OcrEngine | null = null;
/** Tests (and the screenshot tool) can swap the reader. */
export function setOcrEngine(e: OcrEngine | null) {
  override = e;
}

const toRows = (text: string) =>
  text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * The best reader this computer has: macOS Vision or Windows' built-in OCR (both run locally, via the
 * Rust shell), then a bundled WASM reader as a backup. No image ever leaves the computer.
 */
export const readRows: OcrEngine = async (img, scale) => {
  if (override) return override(img, scale);
  if (inTauri) {
    try {
      const rows = toRows(await invoke<string>("ocr_native", { imageBase64: img.base64, scale }));
      if (rows.length) return rows;
    } catch {
      // No native reader here (or it failed): use the bundled one.
    }
  }
  return tesseractRows(img, scale);
};
