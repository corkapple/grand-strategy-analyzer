// Publishes the in-app update for the version in package.json to the public update server (Netlify).
//   node scripts/publish-update.mjs --arm [--intel] [--windows]
// The Mac packages are signed by `tauri build` (TAURI_SIGNING_PRIVATE_KEY). For --windows the installer built by
// GitHub is downloaded from the release and signed HERE, so the signing key never leaves this computer.
// Apps look at <server>/updates/latest.json; only platforms listed there get the update.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const SERVER = (process.env.GSA_UPDATE_SERVER ?? "https://gsa-community-udz745.netlify.app").replace(/\/$/, "");
const KEY = process.env.GSA_UPDATER_KEY ?? path.join(os.homedir(), ".tauri", "gsa-updater.key");
const updatesDir = path.join(root, "site", "updates");
const outDir = path.join(updatesDir, version);

fs.rmSync(updatesDir, { recursive: true, force: true }); // only the current version is served
fs.mkdirSync(outDir, { recursive: true });

const platforms = {};
function add(key, file, name) {
  const sig = `${file}.sig`;
  if (!fs.existsSync(file) || !fs.existsSync(sig)) throw new Error(`missing signed package for ${key}: ${file}(.sig)`);
  fs.copyFileSync(file, path.join(outDir, name));
  platforms[key] = { signature: fs.readFileSync(sig, "utf8").trim(), url: `${SERVER}/updates/${version}/${name}` };
  console.log(`  ${key}: ${name} (${(fs.statSync(file).size / 1e6).toFixed(0)} MB)`);
}
const mac = (triple) => path.join(root, "src-tauri", "target", triple, "release", "bundle", "macos", "Grand Strategy Analyzer.app.tar.gz");

if (args.has("--arm")) add("darwin-aarch64", mac("aarch64-apple-darwin"), "GrandStrategyAnalyzer_aarch64.app.tar.gz");
if (args.has("--intel")) add("darwin-x86_64", mac("x86_64-apple-darwin"), "GrandStrategyAnalyzer_x64.app.tar.gz");
if (args.has("--windows")) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gsa-win-"));
  execFileSync("gh", ["release", "download", `v${version}`, "-p", "*setup.exe", "-D", tmp], { cwd: root, stdio: "inherit" });
  const exe = fs.readdirSync(tmp).find((f) => f.endsWith("setup.exe"));
  if (!exe) throw new Error("no Windows installer on the release yet: run the Build desktop apps workflow first");
  const file = path.join(tmp, exe);
  execFileSync("npx", ["tauri", "signer", "sign", "-f", KEY, "-p", "", file], { cwd: root, stdio: "inherit" });
  add("windows-x86_64", file, "GrandStrategyAnalyzer_x64-setup.exe");
}
if (!Object.keys(platforms).length) throw new Error("nothing to publish: pass --arm, --intel or --windows");

const notes =
  process.env.GSA_UPDATE_NOTES ?? execFileSync("git", ["log", "-1", "--pretty=%s"], { cwd: root, encoding: "utf8" }).trim();
fs.writeFileSync(
  path.join(updatesDir, "latest.json"),
  JSON.stringify({ version, notes, pub_date: new Date().toISOString(), platforms }, null, 2) + "\n",
);
console.log(`manifest for ${version}: ${Object.keys(platforms).join(", ")}`);

console.log("deploying the update server ...");
execFileSync("npx", ["netlify", "deploy", "--prod", "--dir", "site", "--functions", "netlify/functions"], { cwd: root, stdio: "inherit" });
console.log(`Published: ${SERVER}/updates/latest.json`);
