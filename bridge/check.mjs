// Reports how many elements each selector matches on each site.
// Usage: npm run bridge:check [gemini|chatgpt|deepseek]
// Uses the same persistent profile as the bridge, so log in first via `npm run bridge`
// (or just sign in in the window this opens and re-run) to also test reply selectors.
// Sites that are unreachable (e.g. blocked network) are reported and skipped.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { SITES } from "./sites.mjs";

const PROFILE = path.join(path.dirname(fileURLToPath(import.meta.url)), ".profile");
const only = process.argv[2];
const names = Object.keys(SITES).filter((n) => !only || n === only);

const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false, channel: "chrome" });
for (const name of names) {
  const cfg = SITES[name];
  const page = await ctx.newPage();
  console.log(`\n== ${name} (${cfg.url})`);
  try {
    await page.goto(cfg.url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForTimeout(3000);
    for (const key of ["input", "openUpload", "fileInput", "send", "response"]) {
      if (!cfg[key]) continue;
      const n = await page.locator(cfg[key]).count();
      console.log(`  ${n ? "OK  " : "MISS"} ${key.padEnd(10)} x${n}  ${cfg[key]}`);
    }
    if (cfg.sendKey) console.log(`  --   sendKey    ${cfg.sendKey} (not selector-based)`);
    console.log("  note: send/response often only appear after typing / a first reply.");
  } catch (e) {
    console.log(`  UNREACHABLE: ${String(e.message).split("\n")[0]}`);
  } finally {
    await page.close();
  }
}
await ctx.close();
