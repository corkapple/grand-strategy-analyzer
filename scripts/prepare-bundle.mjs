// Stages everything the packaged app needs for the browser bridge:
//  1. src-tauri/binaries/node-<target-triple>[.exe]  (Tauri sidecar: a Node runtime)
//  2. src-tauri/resources/bridge/                    (server.mjs, sites.mjs, playwright-core)
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
