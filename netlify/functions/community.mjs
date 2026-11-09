// Netlify Function: the write-only inbox for anonymous shared results.
//  POST   /v1/samples   anyone (the app): validated, stored. No IP or identifier is stored.
//  GET    /v1/export    token only (the GitHub Action): all samples for one day.
//  DELETE /v1/export    token only: remove samples older than a date (after they are archived in GitHub).
//  PUT    /v1/stats     token only: publish the aggregated stats.
//  GET    /v1/stats     anyone: the aggregated stats the app reads.

import { getStore } from "@netlify/blobs";
import { validateSample } from "../../inbox/validate.mjs";

const MAX_BODY = 2048;
const DAILY_LIMIT_PER_IP = 200;
const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...extra } });

async function sha(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function authorized(req) {
  const token = process.env.EXPORT_TOKEN;
  return !!token && (req.headers.get("authorization") ?? "") === `Bearer ${token}`;
}

export default async (req, context) => {
  const url = new URL(req.url);
  const store = getStore({ name: "gsa", consistency: "strong" });

  if (req.method === "POST" && url.pathname === "/v1/samples") {
    const text = await req.text();
    if (text.length > MAX_BODY) return json({ error: "too large" }, 413);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: "bad json" }, 400);
    }
    const v = validateSample(body);
    if (!v.ok) return json({ error: v.error }, 400);

    // Per-day cap per sender. The hash is peppered with the secret and is the only trace of the sender.
    const day = new Date().toISOString().slice(0, 10);
    const ip = context?.ip ?? req.headers.get("x-nf-client-connection-ip") ?? "unknown";
    const rlKey = `rl/${day}/${await sha(`${ip}|${day}|${process.env.EXPORT_TOKEN ?? ""}`)}`;
    const used = Number((await store.get(rlKey)) ?? "0");
    if (used >= DAILY_LIMIT_PER_IP) return json({ error: "rate limited" }, 429);
    await store.set(rlKey, String(used + 1));

    await store.set(`s/${day}/${crypto.randomUUID()}`, JSON.stringify(v.sample));
    return new Response(null, { status: 204 });
  }

  if (url.pathname === "/v1/export") {
    if (!authorized(req)) return json({ error: "unauthorized" }, 401);
    if (req.method === "GET") {
      const day = url.searchParams.get("day") ?? "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ error: "day=YYYY-MM-DD required" }, 400);
      const { blobs } = await store.list({ prefix: `s/${day}/` });
      const samples = (await Promise.all(blobs.slice(0, 5000).map((b) => store.get(b.key)))).filter(Boolean).map((t) => JSON.parse(t));
      return json({ samples, next: null });
    }
    if (req.method === "DELETE") {
      const before = url.searchParams.get("before") ?? "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(before)) return json({ error: "before=YYYY-MM-DD required" }, 400);
      let removed = 0;
      for (const prefix of ["s/", "rl/"]) {
        const { blobs } = await store.list({ prefix });
        for (const b of blobs) {
          const day = b.key.split("/")[1];
          if (day < before) {
            await store.delete(b.key);
            removed++;
          }
        }
      }
      return json({ removed });
    }
  }

  if (url.pathname === "/v1/stats") {
    if (req.method === "PUT") {
      if (!authorized(req)) return json({ error: "unauthorized" }, 401);
      const text = await req.text();
      if (text.length > 1_000_000) return json({ error: "too large" }, 413);
      JSON.parse(text);
      await store.set("stats", text);
      return new Response(null, { status: 204 });
    }
    if (req.method === "GET") {
      const t = await store.get("stats");
      return new Response(t ?? JSON.stringify({ generatedAt: null, samples: 0, groups: [] }), {
        headers: { "content-type": "application/json", "cache-control": "public, max-age=600", "access-control-allow-origin": "*" },
      });
    }
  }

  return json({ error: "not found" }, 404);
};

export const config = { path: ["/v1/samples", "/v1/export", "/v1/stats"] };
