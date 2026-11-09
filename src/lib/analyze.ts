import { buildUserPrompt, systemPromptFor, type ReportKind } from "./prompt";
import { type ImageInput, type ProviderConfig, type ProviderId, type VisionResponse } from "./providers";
import { analyzeWithFallback, type Candidate } from "./providers/fallback";

const MAX_EDGE = 1568; // plenty to read the report text; larger gains nothing
const JPEG_QUALITY = 0.88;

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/**
 * Downscale + re-encode as JPEG. Big PNG screenshots made requests huge, and
 * the Tauri HTTP plugin serialises request bodies as number arrays over IPC,
 * which stalls on multi-MB payloads.
 */
export async function fileToImage(file: File): Promise<ImageInput> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff"; // flatten transparency for JPEG
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await new Promise<Blob>((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/jpeg", JPEG_QUALITY),
    );
    const [, base64] = (await readAsDataUrl(blob)).split(",", 2);
    return { base64, mimeType: "image/jpeg", name: file.name };
  } catch {
    // Fallback: send the original bytes.
    const [, base64] = (await readAsDataUrl(file)).split(",", 2);
    return { base64, mimeType: file.type || "image/png", name: file.name };
  }
}

export interface AnalyzeOptions {
  providerId: ProviderId;
  config: ProviderConfig;
  images: ImageInput[];
  /** Tried in order if the main provider fails with a retryable error. */
  fallbacks?: Candidate[];
  /** Read on this computer first and only ask an AI service when the numbers cannot be verified. */
  localFirst?: boolean;
  kind?: ReportKind | "auto";
  customPrompt?: string;
  signal?: AbortSignal;
}

/**
 * The order screenshots are tried in: the on-device reader first (it only answers when every number is
 * verified), then your provider and its fallbacks, then the on-device reader again as a last resort so a
 * total outage still gives a best-effort reading (marked unverified).
 */
export function screenshotChain(opts: Pick<AnalyzeOptions, "providerId" | "config" | "fallbacks" | "localFirst">): Candidate[] {
  const local = (strict: boolean): Candidate => ({ id: "local", config: { extra: { strict: strict ? "1" : "0" } } });
  const mainIsLocal = opts.providerId === "local";
  return [
    ...(opts.localFirst && !mainIsLocal ? [local(true)] : []),
    mainIsLocal
      ? { id: "local", config: { ...opts.config, extra: { ...opts.config.extra, strict: "0" } } }
      : { id: opts.providerId, config: opts.config },
    ...(opts.fallbacks ?? []),
    ...(mainIsLocal ? [] : [local(false)]),
  ];
}

/** Single entry point the UI calls. Provider-agnostic. */
export function runVision(opts: AnalyzeOptions): Promise<VisionResponse> {
  return analyzeWithFallback(
    screenshotChain(opts),
    {
      images: opts.images,
      systemPrompt: systemPromptFor(opts.kind ?? "auto"),
      userPrompt: buildUserPrompt(opts.images.length, opts.customPrompt),
      temperature: 0,
      signal: opts.signal,
    },
  );
}

/** Small JPEG data URL for storing alongside history records. */
export async function thumbnail(img: ImageInput, maxEdge = 720): Promise<string> {
  const el = new Image();
  el.src = `data:${img.mimeType};base64,${img.base64}`;
  await el.decode();
  const scale = Math.min(1, maxEdge / Math.max(el.naturalWidth, el.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(el.naturalWidth * scale);
  canvas.height = Math.round(el.naturalHeight * scale);
  canvas.getContext("2d")!.drawImage(el, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.75);
}
