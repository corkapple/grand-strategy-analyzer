// API-less bridge: drives a logged-in web chat via Playwright.
// Usage: npm run bridge:install (once) && npm run bridge
//
// Selectors live in sites.mjs (see its verification notes; run `npm run bridge:check`).
// Vendors change their DOM often. Using web UIs programmatically may
// violate a site's terms of service; you are responsible for that choice.

import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { SITES } from "./sites.mjs";

const PORT = 47821;
// The packaged app passes a per-user data dir; never write inside the app bundle.
const PROFILE =
  process.env.GSA_PROFILE_DIR ??
  path.join(path.dirname(fileURLToPath(import.meta.url)), ".profile");
const MAX_BODY = 64 * 1024 * 1024;
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const ALLOWED_ORIGINS = new Set([
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
  "http://localhost:1420",
]);

async function readBody(req) {
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > MAX_BODY) throw new Error("Request too large");
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function validImages(images) {
  return (
    Array.isArray(images) &&
    images.length <= 10 &&
    images.every(
      (i) => typeof i?.base64 === "string" && /^image\/(png|jpeg|webp|gif)$/.test(i?.mimeType ?? ""),
    )
  );
}

// Uses the user's installed Chrome, then Edge, then a Playwright-downloaded Chromium.
let ctxPromise;
async function launch() {
  const errors = [];
  for (const channel of ["chrome", "msedge", undefined]) {
    try {
      const ctx = await chromium.launchPersistentContext(PROFILE, {
        headless: false,
        channel,
        // Reduces "this browser is not secure" blocks on login pages; not guaranteed.
        ignoreDefaultArgs: ["--enable-automation"],
        args: ["--disable-blink-features=AutomationControlled"],
      });
      ctx.on("close", () => (ctxPromise = undefined)); // user closed the window: relaunch next time
      return ctx;
    } catch (e) {
      errors.push(`${channel ?? "bundled chromium"}: ${String(e.message).split("\n")[0]}`);
    }
  }
  throw new Error(`Could not open Chrome or Edge. Install Google Chrome. (${errors.join(" | ")})`);
}
const getContext = () => (ctxPromise ??= launch().catch((e) => ((ctxPromise = undefined), Promise.reject(e))));

// Opens the site in the automation browser and leaves it open so the user can log in.
async function openSite(site) {
  const cfg = SITES[site];
  if (!cfg) throw new Error(`Unknown site: ${site}`);
  const page = await (await getContext()).newPage();
  await page.goto(cfg.url, { waitUntil: "domcontentloaded" });
}

async function analyze({ site, systemPrompt, userPrompt, images }) {
  const cfg = SITES[site];
  if (!cfg) throw new Error(`Unknown site: ${site}`);
  const ctx = await getContext();
  const page = await ctx.newPage();
  try {
    await page.goto(cfg.url, { waitUntil: "domcontentloaded" });
    const input = page.locator(cfg.input).first();
    await input.waitFor({ timeout: 300_000 }); // first run: the user may need to log in

    if (images?.length) {
      if (cfg.openUpload && !(await page.locator(cfg.fileInput).count())) {
        await page.locator(cfg.openUpload).first().click();
        await page.locator(cfg.fileInput).first().waitFor({ state: "attached", timeout: 5000 });
      }
      await page.locator(cfg.fileInput).first().setInputFiles(
        images.map((img, i) => ({
          name: img.name ?? `shot${i}.png`,
          mimeType: img.mimeType,
          buffer: Buffer.from(img.base64, "base64"),
        })),
      );
      await page.waitForTimeout(2500); // let the upload finish
    }

    await input.click();
    await page.keyboard.insertText(`${systemPrompt}\n\n${userPrompt}`);
    const before = await page.locator(cfg.response).count();
    if (cfg.sendKey) await page.keyboard.press(cfg.sendKey);
    else await page.locator(cfg.send).first().click();

    // Wait for a new reply, then for its text to stop changing.
    await page.waitForFunction(
      ([sel, n]) => document.querySelectorAll(sel).length > n,
      [cfg.response, before],
      { timeout: 120_000 },
    );
    let last = "";
    for (let stable = 0; stable < 3; ) {
      await page.waitForTimeout(1500);
      const t = await page.locator(cfg.response).last().innerText();
      stable = t && t === last ? stable + 1 : 0;
      last = t;
    }
    return last;
  } finally {
    await page.close();
  }
}

const server = http.createServer(async (req, res) => {
  // Reject DNS-rebinding attempts: only our own loopback host names are valid.
  if (!ALLOWED_HOSTS.has(req.headers.host ?? "")) {
    res.writeHead(403).end();
    return;
  }
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    res.writeHead(403).end();
    return;
  }
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return void res.writeHead(204).end();

  const send = (code, obj) => {
    res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(obj));
  };
  if (req.method === "GET" && req.url === "/health") {
    return send(200, { ok: true, sites: Object.keys(SITES) });
  }
  if (req.method === "POST" && req.url === "/open") {
    try {
      const body = await readBody(req);
      await openSite(JSON.parse(body).site);
      send(200, { ok: true });
    } catch (e) {
      send(500, { error: String(e?.message ?? e) });
    }
    return;
  }
  if (req.method === "POST" && req.url === "/analyze") {
    try {
      const payload = JSON.parse(await readBody(req));
      if (!validImages(payload.images)) throw new Error("Invalid images in request");
      send(200, { text: await analyze(payload) });
    } catch (e) {
      send(500, { error: String(e?.message ?? e) });
    }
    return;
  }
  send(404, { error: "not found" });
});

// Exit when the app that launched us is gone (crash, force-quit, SIGKILL).
if (process.env.GSA_PARENT_PID) {
  const parent = Number(process.env.GSA_PARENT_PID);
  setInterval(() => {
    try {
      process.kill(parent, 0);
    } catch {
      process.exit(0);
    }
  }, 2000);
}

// Loopback only: never expose this to the network.
server.listen(PORT, "127.0.0.1", () =>
  console.log(`GSA bridge listening on http://127.0.0.1:${PORT}`),
);
