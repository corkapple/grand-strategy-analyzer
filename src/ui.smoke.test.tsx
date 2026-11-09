// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
import App from "./App";
import BattleDashboard from "./components/BattleDashboard";
import Dashboard from "./components/Dashboard";
import type { BattleRecord, ReconRecord } from "./lib/history";
import type { KnowledgeEntry } from "./lib/knowledge";
import { parseBattleReport, parseCombatReport } from "./lib/schema";
import { DEFAULT_STRATEGY } from "./lib/strategy";
import { useHistory } from "./store/history";
import { useKnowledge } from "./store/knowledge";

// Values from the real 21:13 recon and 21:25 victory screenshots.
const recon = parseCombatReport(
  JSON.stringify({
    reportType: "recon",
    timestamp: "11-08 21:13",
    location: { server: 1, x: 101, y: 201 },
    building: { name: "Elite Police Station", level: 8 },
    enforcers: { count: 5 },
    wallDurability: "2,500,000/2,500,000",
    traps: { lacerator: 16145, pineappleGrenade: 104080, napalmBomb: 4775, total: 125000 },
    associates: { bruisers: 322900, hitmen: 95500, bikers: 2081600, mortars: 0, total: 2500000 },
  }),
);
const battle = parseBattleReport(
  JSON.stringify({
    result: "victory",
    timestamp: "11-08 21:25",
    location: { server: 1, x: 101, y: 201 },
    target: { name: "Elite Police Station", level: 8 },
    attacker: { formation: "Hitman - Wedge", totalAssociates: 2044290, wounded: 2951, dead: 1962, alive: 2039377, casualtiesReduced: 486579, losses: 491492, influence: "-176,868" },
    defender: { formation: "Bruiser - Square", totalAssociates: 2500000, dead: 622087, alive: 1877913, losses: 622087, influence: "-22,568,577" },
    traps: { total: 125000, destroyed: 34689, remaining: 90311 },
    wallDurability: 2500000,
    buffs: [{ stat: "Crew ATK", attacker: "+325.3%", defender: "+1200.0%" }],
  }),
);
const reconRec: ReconRecord = { id: "r", kind: "recon", createdAt: Date.now(), thumbs: [], report: recon };
const battleRec: BattleRecord = { id: "b", kind: "battle", createdAt: Date.now(), thumbs: [], report: battle, attackType: "solo" };
const entries: KnowledgeEntry[] = [
  { id: "k1", kind: "number", statement: "Good compatibility: +100% damage", quote: "damage dealt is 100% UP", sourceUrl: "https://note.com/x", sourceTitle: "Guide", fetchedAt: 1, status: "pending", chart: "unknown" },
  { id: "k2", kind: "counter", statement: "Hitmen beat Bruisers", quote: "made up quote here", sourceUrl: "https://note.com/x", sourceTitle: "Guide", fetchedAt: 1, status: "pending", counter: { winner: "hitmen", loser: "bruisers" }, chart: "conflicts" },
  { id: "k3", kind: "formation", statement: "Use Hitman - Wedge", quote: "formation quote text", sourceUrl: "https://note.com/x", sourceTitle: "Guide", fetchedAt: 1, status: "accepted", formation: { lead: "hitmen", name: "Hitman - Wedge" }, chart: "unknown" },
];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Mounts in a real (jsdom) DOM like the app does, returns the HTML, then unmounts. */
async function render(el: ReactElement): Promise<string> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(el);
  });
  const html = host.innerHTML;
  await act(async () => root.unmount());
  host.remove();
  return html;
}

beforeAll(() => {
  useHistory.setState({ records: [reconRec, battleRec], loaded: true });
  useKnowledge.setState({ entries, loaded: true });
});

describe("screens render without crashing", () => {
  it("the whole app, with history and knowledge loaded", async () => {
    const html = await render(<App />);
    expect(html).toContain("Grand Strategy Analyzer");
    // History tab: paired battle, matchup table, insights panel
    expect(html).toContain("Elite Police Station");
    expect(html).toContain("Your rules vs. your results");
    expect(html).toContain("What worked");
    // Knowledge tab: chart conflict is flagged
    expect(html).toContain("contradicts the game's chart");
    expect(html).toContain("Hitmen beat Bruisers");
    // Settings tab
    expect(html).toContain("Provider");
    expect(html).toContain("Playbook: acceptable losses");
  });

  it("the recon dashboard shows the majority guard and the playbook", async () => {
    const html = await render(<Dashboard report={recon} config={DEFAULT_STRATEGY} />);
    expect(html).toContain("Counter composition");
    expect(html).toContain("send 100% Hitmen");
    expect(html).toContain("Recommended formation");
    expect(html).toContain("Your playbook");
    // The 21:25 battle is a good win against a similar Biker-heavy defense.
    expect(html).toContain("Repeat what worked");
    expect(html).toContain("Hitman - Wedge");
  });

  it("the battle dashboard shows real losses, not the headline figure", async () => {
    const html = await render(<BattleDashboard report={battle} />);
    expect(html).toContain("Victory");
    expect(html).toContain("4,913"); // wounded + dead
    expect(html).toContain("Crew ATK");
  });

  it("the dashboards survive an all-zero report without throwing", async () => {
    const zero = parseCombatReport(
      JSON.stringify({
        wallDurability: 1,
        traps: { lacerator: 0, pineappleGrenade: 0, napalmBomb: 0, total: 1 },
        associates: { bruisers: 0, hitmen: 0, bikers: 0, mortars: 0, total: 1 },
      }),
    );
    await expect(render(<Dashboard report={zero} config={DEFAULT_STRATEGY} />)).resolves.toContain("Counter composition");
  });
});
