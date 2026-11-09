// Development only: fills the app with example data so documentation screenshots show real screens.
// Open http://localhost:1420/?shot=analyzer|recon|battle|history|settings|knowledge
import React from "react";
import ReactDOM from "react-dom/client";
import App from "../App";
import { dbClear, dbPut } from "../lib/historyDb";
import type { BattleRecord, HistoryRecord, ReconRecord } from "../lib/history";
import { parseBattleReport, parseCombatReport } from "../lib/schema";
import { useSettings } from "../store/settings";
import "../index.css";

const recon = (over: Record<string, unknown> = {}) =>
  parseCombatReport(
    JSON.stringify({
      reportType: "recon",
      timestamp: "11-08 21:13",
      location: { server: 1, x: 101, y: 201 },
      building: { name: "Elite Police Station", level: 8 },
      enforcers: { count: 5 },
      wallDurability: { current: 2500000, max: 2500000 },
      traps: { lacerator: 16145, pineappleGrenade: 104080, napalmBomb: 4775, total: 125000 },
      associates: { bruisers: 322900, hitmen: 95500, bikers: 2081600, mortars: 0, total: 2500000 },
      confidence: "high",
      ...over,
    }),
  );

const battle = (over: Record<string, unknown> = {}, att: Record<string, unknown> = {}) =>
  parseBattleReport(
    JSON.stringify({
      result: "victory",
      timestamp: "11-08 21:25",
      location: { server: 1, x: 101, y: 201 },
      target: { name: "Elite Police Station", level: 8 },
      attacker: { formation: "Hitman - Wedge", totalAssociates: 2044290, wounded: 2951, dead: 1962, alive: 2039377, casualtiesReduced: 486579, losses: 491492, influence: -176868, ...att },
      defender: { formation: "Bruiser - Square", totalAssociates: 2500000, wounded: 0, dead: 622087, alive: 1877913, casualtiesReduced: 0, losses: 622087, influence: -22568577 },
      traps: { total: 125000, requiresRepair: 0, destroyed: 34689, remaining: 90311 },
      wallDurability: 2500000,
      buffs: [{ stat: "Crew ATK", attacker: 325.3, defender: 1200 }],
      confidence: "high",
      ...over,
    }),
  );

/** Several attacks on Bruiser-heavy bases so History, insights and playbook have something to show. */
function sampleHistory(): HistoryRecord[] {
  const out: HistoryRecord[] = [];
  const now = Date.now();
  const mix = (b: number, h: number, k: number) => ({ bruisers: b, hitmen: h, bikers: k, mortars: 0, total: b + h + k });
  const cases = [
    { x: 101, y: 201, assoc: mix(322900, 95500, 2081600), form: "Hitman - Wedge", ours: 2044290, dead: 1962, wounded: 2951, hh: 21, mm: 13, day: "11-08" },
    { x: 102, y: 202, assoc: mix(250000, 120000, 2130000), form: "Hitman - Wedge", ours: 2100000, dead: 1500, wounded: 3100, hh: 20, mm: 5, day: "11-08" },
    { x: 104, y: 204, assoc: mix(400000, 150000, 1950000), form: "Hitman - Wedge", ours: 2200000, dead: 2600, wounded: 4800, hh: 19, mm: 12, day: "11-08" },
    { x: 105, y: 205, assoc: mix(300000, 200000, 1900000), form: "Hitman - Wedge", ours: 2050000, dead: 5200, wounded: 9800, hh: 18, mm: 5, day: "11-08" },
    { x: 106, y: 206, assoc: mix(350000, 100000, 2000000), form: "Hitman - Wedge", ours: 2150000, dead: 2100, wounded: 4000, hh: 17, mm: 30, day: "11-08" },
    { x: 107, y: 207, assoc: mix(280000, 130000, 2090000), form: "Hitman - Wedge", ours: 2250000, dead: 1300, wounded: 2500, hh: 16, mm: 2, day: "11-08" },
  ];
  cases.forEach((c, i) => {
    const total = c.assoc.total;
    const rt = `${c.day} ${String(c.hh).padStart(2, "0")}:${String(c.mm).padStart(2, "0")}`;
    const bt = `${c.day} ${String(c.hh).padStart(2, "0")}:${String(c.mm + 12).padStart(2, "0")}`;
    const loc = { server: 1, x: c.x, y: c.y };
    out.push({
      id: `r${i}`, kind: "recon", createdAt: now - (i * 2 + 1) * 3600e3, thumbs: [],
      report: recon({ timestamp: rt, location: loc, associates: c.assoc }),
    } as ReconRecord);
    out.push({
      id: `b${i}`, kind: "battle", createdAt: now - (i * 2) * 3600e3, thumbs: [], attackType: "solo",
      report: battle(
        { timestamp: bt, location: loc, defender: { formation: "Bruiser - Square", totalAssociates: total, wounded: 0, dead: Math.round(total * 0.8), alive: Math.round(total * 0.2), casualtiesReduced: 0, losses: Math.round(total * 0.8), influence: -22000000 } },
        { formation: c.form, totalAssociates: c.ours, wounded: c.wounded, dead: c.dead, alive: c.ours - c.dead, losses: c.dead + c.wounded + 200000 },
      ),
    } as BattleRecord);
  });
  return out;
}

/** Demo data must never leave this page: every request is answered locally. */
function blockNetwork() {
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/v1/stats") && (init?.method ?? "GET") === "GET") {
      return new Response(JSON.stringify({ generatedAt: null, samples: 0, groups: [] }), { status: 200 });
    }
    return new Response(null, { status: 204 });
  };
}

/** Documentation must never show coordinates or server numbers, so mask them wherever they render. */
function maskCoordinates() {
  const re = [
    [/S:\d+\s+X:\d+\s+Y:\d+/g, "S:••• X:••• Y:•••"],
    [/\(\d+,\s*\d+\)/g, "(•••, •••)"],
  ] as const;
  const run = () => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      let t = n.nodeValue ?? "";
      let changed = false;
      for (const [r, to] of re) if (r.test(t)) { t = t.replace(r, to); changed = true; }
      r_reset(re);
      if (changed) n.nodeValue = t;
    }
  };
  const r_reset = (list: typeof re) => list.forEach(([r]) => (r.lastIndex = 0));
  new MutationObserver(run).observe(document.body, { subtree: true, childList: true, characterData: true });
  run();
}

async function main() {
  blockNetwork();
  const shot = new URLSearchParams(location.search).get("shot") ?? "analyzer";
  useSettings.setState({ shareNoticeSeen: true, autoUpdate: false, keychain: true, secretsReady: true, secretsError: null });
  await dbClear();
  for (const r of sampleHistory()) await dbPut(r);
  (window as unknown as { __gsaDemo?: unknown }).__gsaDemo =
    shot === "recon" ? { recon: recon() } : shot === "battle" ? { battle: battle() } : undefined;
  const view = ({ history: "history", settings: "settings", knowledge: "knowledge" } as Record<string, string>)[shot] ?? "analyzer";
  maskCoordinates();
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App initialView={view as "analyzer"} />
    </React.StrictMode>,
  );
}
void main();
