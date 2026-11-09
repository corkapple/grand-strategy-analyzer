// Copies the WASM text reader into public/ocr for the web build (the full prepare-bundle needs macOS tools).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nm = path.join(root, "node_modules");
const out = path.join(root, "public", "ocr");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(nm, "tesseract.js", "dist", "worker.min.js"), path.join(out, "worker.min.js"));
for (const f of ["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"]) {
  fs.copyFileSync(path.join(nm, "tesseract.js-core", f), path.join(out, f));
}
fs.copyFileSync(path.join(nm, "@tesseract.js-data", "eng", "4.0.0_best_int", "eng.traineddata.gz"), path.join(out, "eng.traineddata.gz"));
console.log("ocr assets ready");
