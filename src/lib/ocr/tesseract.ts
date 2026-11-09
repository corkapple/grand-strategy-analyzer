import type { ImageInput } from "../providers/types";

// Bundled with the app (public/ocr), so it works offline and nothing is fetched from a CDN.
type Worker = import("tesseract.js").Worker;
let worker: Promise<Worker> | null = null;

function getWorker(): Promise<Worker> {
  worker ??= (async () => {
    const { createWorker } = await import("tesseract.js");
    const w = await createWorker("eng", 1, {
      workerPath: "/ocr/worker.min.js",
      corePath: "/ocr",
      langPath: "/ocr",
      gzip: true,
      cacheMethod: "none",
    });
    await w.setParameters({ tessedit_pageseg_mode: "6" as never, user_defined_dpi: "300" });
    return w;
  })().catch((e) => {
    worker = null;
    throw e;
  });
  return worker;
}

/**
 * Game text is light, coloured text on a dark background. Brightness = the brightest channel, so red and
 * green numbers read as well as white ones, then inverted and stretched to dark-on-light.
 */
async function prepare(img: ImageInput, factor: number): Promise<HTMLCanvasElement> {
  const el = new Image();
  el.src = `data:${img.mimeType};base64,${img.base64}`;
  await el.decode();
  const w = Math.min(4000, Math.round(el.naturalWidth * factor));
  const h = Math.round((el.naturalHeight * w) / el.naturalWidth);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(el, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h);
  const d = px.data;
  let lo = 255;
  let hi = 0;
  for (let i = 0; i < d.length; i += 4) {
    const v = 255 - Math.max(d[i], d[i + 1], d[i + 2]);
    d[i] = v;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.round(((d[i] - lo) / span) * 255);
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(px, 0, 0);
  return canvas;
}

export async function tesseractRows(img: ImageInput, scale: number): Promise<string[]> {
  const w = await getWorker();
  const canvas = await prepare(img, 2 + scale); // 3x, 3.5x or 4x, so each pass sees different pixels
  const { data } = await w.recognize(canvas);
  return data.text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}
