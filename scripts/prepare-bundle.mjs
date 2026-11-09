// Stages everything the packaged app needs for the browser bridge:
//  1. src-tauri/binaries/node-<target-triple>[.exe]  (Tauri sidecar: a Node runtime)
//  2. src-tauri/resources/bridge/                    (server.mjs, sites.mjs, playwright-core)
//  3. public/ocr/                                    (bundled WASM text reader, used when no native reader works)
//  4. src-tauri/binaries/gsa-ocr-<target-triple>     (macOS only: Vision-based text reader, built from native/macos-ocr)
// Runs automatically before `tauri dev` / `tauri build`.
// The Node binary is a copy of the Node that runs this script (CI uses setup-node), so the
// build machine's Node must match the target OS/arch. On macOS a universal Node is thinned
// to the target architecture with lipo, so Intel and Apple Silicon builds both work from a Mac.

import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tauri = path.join(root, "src-tauri");
const bridge = path.join(root, "bridge");

function hostTriple() {
  const out = execSync("rustc -vV", { encoding: "utf8" });
  return out.match(/^host: (.+)$/m)[1];
}
const triple = process.env.TAURI_ENV_TARGET_TRIPLE || hostTriple();
const isWin = triple.includes("windows");
const isMac = triple.includes("apple-darwin");

// --- 1. Node sidecar -------------------------------------------------------
const binDir = path.join(tauri, "binaries");
fs.mkdirSync(binDir, { recursive: true });
const dest = path.join(binDir, `node-${triple}${isWin ? ".exe" : ""}`);
fs.rmSync(dest, { force: true });

if (isMac) {
  const want = triple.startsWith("aarch64") ? "arm64" : "x86_64";
  const have = execFileSync("lipo", ["-archs", process.execPath], { encoding: "utf8" }).trim().split(/\s+/);
  if (!have.includes(want)) {
    throw new Error(`This Node (${have.join(", ")}) has no ${want} slice; run the build with a matching Node.`);
  }
  if (have.length > 1) execFileSync("lipo", ["-thin", want, process.execPath, "-output", dest]);
  else fs.copyFileSync(process.execPath, dest);
} else {
  fs.copyFileSync(process.execPath, dest);
}
fs.chmodSync(dest, 0o755);
console.log(`sidecar: ${path.relative(root, dest)} (${(fs.statSync(dest).size / 1e6).toFixed(0)} MB)`);

// --- 2. Bridge resources ---------------------------------------------------
if (!fs.existsSync(path.join(bridge, "node_modules", "playwright-core"))) {
  console.log("installing bridge dependencies...");
  execSync("npm --prefix bridge install --no-audit --no-fund", { cwd: root, stdio: "inherit" });
}
const stage = path.join(tauri, "resources", "bridge");
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
for (const f of ["server.mjs", "sites.mjs", "package.json"]) {
  fs.copyFileSync(path.join(bridge, f), path.join(stage, f));
}
// Only playwright-core (no CLI, no .bin symlinks, no browser downloads).
fs.cpSync(
  path.join(bridge, "node_modules", "playwright-core"),
  path.join(stage, "node_modules", "playwright-core"),
  { recursive: true, dereference: true },
);
console.log(`bridge staged: ${path.relative(root, stage)}`);

// --- 3. WASM text reader assets (fallback reader; works offline) -------------
const ocrDir = path.join(root, "public", "ocr");
fs.rmSync(ocrDir, { recursive: true, force: true });
fs.mkdirSync(ocrDir, { recursive: true });
const nm = path.join(root, "node_modules");
fs.copyFileSync(path.join(nm, "tesseract.js", "dist", "worker.min.js"), path.join(ocrDir, "worker.min.js"));
for (const f of ["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"]) {
  fs.copyFileSync(path.join(nm, "tesseract.js-core", f), path.join(ocrDir, f));
}
fs.copyFileSync(
  path.join(nm, "@tesseract.js-data", "eng", "4.0.0_best_int", "eng.traineddata.gz"),
  path.join(ocrDir, "eng.traineddata.gz"),
);
console.log(`ocr assets: ${path.relative(root, ocrDir)}`);

// --- 4. macOS native text reader (Apple Vision) -----------------------------
if (isMac) {
  const out = path.join(binDir, `gsa-ocr-${triple}`);
  fs.rmSync(out, { force: true });
  const arch = triple.startsWith("aarch64") ? "arm64" : "x86_64";
  execFileSync(
    "swiftc",
    ["-O", "-target", `${arch}-apple-macos11.0`, path.join(root, "native", "macos-ocr", "ocr.swift"), "-o", out],
    { stdio: "inherit" },
  );
  fs.chmodSync(out, 0o755);
  console.log(`macOS reader: ${path.relative(root, out)}`);
}
