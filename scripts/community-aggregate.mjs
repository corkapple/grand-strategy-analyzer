// Turns the shared samples into the stats file the app reads.
//   node scripts/community-aggregate.mjs            (needs COMMUNITY_URL and EXPORT_TOKEN)
// Samples are archived per day in data/samples/*.jsonl (GitHub is the permanent store);
// the stats are written to data/community-stats.json and published to the Worker.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateSample } from "../inbox/validate.mjs";

const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const r = (v, d) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

const DEFAULT_LEAD = { "hitman - wedge": "hitmen", "hitman - square": "bikers", "bruiser - wedge": "bruisers" };
/** Lead troop of a sample. Samples from v0.1.4 only have the formation, so use the app's default pairing. */
export function leadOf(s) {
  if (s.lead) return s.lead;
  const f = (s.formation ?? "").toLowerCase();
  if (DEFAULT_LEAD[f]) return DEFAULT_LEAD[f];
  if (f.startsWith("biker")) return "bikers";
  if (f.startsWith("bruiser")) return "bruisers";
  return null;
}

/** Majority type (>= 50% of the three field types) or "mixed". */
export function enemyKey(e) {
  const field = e.bruisers + e.hitmen + e.bikers;
  if (!field) return "mixed";
  for (const k of ["bruisers", "hitmen", "bikers"]) if (e[k] / field >= 0.5) return k;
  return "mixed";
}

export function aggregate(rawSamples, now = new Date()) {
  const samples = rawSamples.map((s) => validateSample(s)).filter((v) => v.ok).map((v) => v.sample);
  const groups = new Map();
  for (const s of samples) {
    const lead = leadOf(s);
    if (!lead) continue;
    const key = `${enemyKey(s.enemy)}|${lead}`;
    (groups.get(key) ?? groups.set(key, []).get(key)).push(s);
  }
  const out = [...groups.entries()].map(([key, g]) => {
    const [enemy, lead] = key.split("|");
    const wins = g.filter((s) => s.result === "victory");
    const cheap = wins.filter((s) => s.ourLoss <= 0.1);
    return {
      enemy,
      lead,
      n: g.length,
      wins: wins.length,
      winRate: r(wins.length / g.length, 3),
      avgOurLoss: r(avg(g.map((s) => s.ourLoss)), 4),
      medianOurLoss: r(median(g.map((s) => s.ourLoss)), 4),
      avgEnemyLoss: r(avg(g.map((s) => s.enemyLoss)), 3),
      /** Median force ratio (ours / theirs) among wins that cost under 10% of the army. */
      medianWinRatio: r(median(cheap.map((s) => s.ratio)), 2),
      cheapWins: cheap.length,
    };
  });
  out.sort((a, b) => b.n - a.n);
  return { generatedAt: now.toISOString(), samples: samples.length, groups: out };
}

async function main() {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const dir = path.join(root, "data", "samples");
  fs.mkdirSync(dir, { recursive: true });
  const base = process.env.COMMUNITY_URL?.replace(/\/$/, "");
  const token = process.env.EXPORT_TOKEN;
  if (base && token) {
    // Re-fetch the last 3 days (late arrivals), and anything newer than the newest archived day.
    const archived = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort();
    const last = archived.at(-1)?.slice(0, 10);
    const start = new Date(Date.now() - 3 * 864e5);
    const from = last && new Date(last) < start ? new Date(last) : start;
    for (let d = new Date(from); d <= new Date(); d = new Date(d.getTime() + 864e5)) {
      const day = d.toISOString().slice(0, 10);
      const lines = [];
      let cursor = "";
      do {
        const res = await fetch(`${base}/v1/export?day=${day}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, {
          headers: { authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`export ${day}: HTTP ${res.status}`);
        const body = await res.json();
        for (const s of body.samples) lines.push(JSON.stringify(s));
        cursor = body.next ?? "";
      } while (cursor);
      if (lines.length) fs.writeFileSync(path.join(dir, `${day}.jsonl`), lines.join("\n") + "\n");
    }
  } else {
    console.log("COMMUNITY_URL / EXPORT_TOKEN not set: aggregating the archive only.");
  }
  const all = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .flatMap((f) => fs.readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
  const stats = aggregate(all);
  fs.writeFileSync(path.join(root, "data", "community-stats.json"), JSON.stringify(stats, null, 2) + "\n");
  console.log(`${stats.samples} samples, ${stats.groups.length} groups`);
  if (base && token) {
    const res = await fetch(`${base}/v1/stats`, { method: "PUT", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(stats) });
    if (!res.ok) throw new Error(`publish stats: HTTP ${res.status}`);
    console.log("published");
    // The samples are safely archived in git; free the inbox of anything older than a week.
    const cutoff = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    const del = await fetch(`${base}/v1/export?before=${cutoff}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
    console.log(del.ok ? `cleaned inbox before ${cutoff}` : `cleanup skipped (HTTP ${del.status})`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
