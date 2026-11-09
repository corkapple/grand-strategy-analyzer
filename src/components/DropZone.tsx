import { useCallback, useEffect, useRef, useState } from "react";
import { fileToImage } from "@/lib/analyze";
import type { ImageInput } from "@/lib/providers";

const MAX_IMAGES = 8;

interface Props {
  images: ImageInput[];
  onChange: (images: ImageInput[]) => void;
}

/** Drag-and-drop, click-to-browse and global Ctrl/Cmd+V paste. */
export default function DropZone({ images, onChange }: Props) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const imagesRef = useRef(images);
  imagesRef.current = images;

  const add = useCallback(
    async (files: File[]) => {
      // Cap the batch: every screenshot is sent to the AI provider.
      const room = Math.max(0, MAX_IMAGES - imagesRef.current.length);
      const imgs = files.filter((f) => f.type.startsWith("image/")).slice(0, room);
      if (!imgs.length) return;
      const converted = await Promise.all(imgs.map(fileToImage));
      onChange([...imagesRef.current, ...converted]);
    },
    [onChange],
  );

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) {
        e.preventDefault();
        void add(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [add]);

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void add(Array.from(e.dataTransfer.files));
        }}
        onClick={() => input.current?.click()}
        className={`flex h-36 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed text-sm text-zinc-400 transition ${
          over ? "border-accent bg-accent/10" : "border-border"
        }`}
      >
        Drop all screenshots of one attack here, click to browse, or paste (Ctrl/Cmd+V)
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            void add(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((img, i) => (
            <div key={i} className="relative">
              <img
                alt={`Screenshot ${i + 1}${img.name ? `: ${img.name}` : ""}`}
                src={`data:${img.mimeType};base64,${img.base64}`}
                className="h-24 rounded border border-border"
              />
              <button
                aria-label={`Remove screenshot ${i + 1}`}
                className="absolute -right-2 -top-2 h-5 w-5 rounded-full bg-red-600 text-xs"
                onClick={() => onChange(images.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
