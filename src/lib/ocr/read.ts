import type { ImageInput } from "../providers/types";
import { readRows } from "./engine";
import {
  classify,
  parseBattleMail,
  parseBuffs,
  parseRecon,
  type BattleRead,
  type Buff,
  type ReconRead,
  type ScreenKind,
} from "./parse";

export interface ScreenReading {
  recon: ReconRead | null;
  battle: (BattleRead & { buffs: Buff[] }) | null;
  reconFailed: boolean;
  /** Everything read was confirmed twice and passed the totals checks. */
  verified: boolean;
  problems: string[];
  /** The JSON the rest of the app understands (same shape the AI models return). */
  payload: { recon: unknown; battle: unknown; reconFailed: boolean };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The values the rest of the app relies on. Two readings must agree on these. Display-only extras (building
 * name, influence, wall durability, trap repair figures) are taken from whichever reading has them.
 */
const criticalRecon = (r: ReconRead) => ({
  timestamp: r.timestamp,
  location: r.location,
  level: r.building.level,
  wall: r.wall,
  traps: r.traps,
  associates: r.associates,
});
const criticalBattle = (b: BattleRead) => {
  const side = (s: BattleRead["attacker"]) => ({ ...s, influence: 0 });
  return {
    result: b.result,
    timestamp: b.timestamp,
    location: b.location,
    level: b.target.level,
    attacker: side(b.attacker),
    defender: side(b.defender),
    trapsTotal: b.traps.total,
    trapsDestroyed: b.traps.destroyed,
  };
};

/** Fills what one reading lacks from the other (only for the display-only extras). */
function mergeRecon(a: ReconRead, b: ReconRead): ReconRead {
  const base = a.verified || !b.verified ? a : b;
  const other = base === a ? b : a;
  const name = [base.building.name, other.building.name].find((n) => n && /Police|Station|Base|Hideout/i.test(n)) ?? base.building.name;
  return { ...base, building: { name, level: base.building.level ?? other.building.level }, enforcers: base.enforcers || other.enforcers };
}
function mergeBattle(a: BattleRead, b: BattleRead): BattleRead {
  const base = a.verified || !b.verified ? a : b;
  const other = base === a ? b : a;
  const pick = (x: number, y: number) => x || y;
  return {
    ...base,
    target: {
      name: [base.target.name, other.target.name].find((n) => n && /Police|Station|Base|Hideout/i.test(n)) ?? base.target.name,
      level: base.target.level ?? other.target.level,
    },
    attacker: { ...base.attacker, influence: pick(base.attacker.influence, other.attacker.influence) },
    defender: { ...base.defender, influence: pick(base.defender.influence, other.defender.influence) },
    traps: {
      ...base.traps,
      requiresRepair: pick(base.traps.requiresRepair, other.traps.requiresRepair),
      remaining: pick(base.traps.remaining, other.traps.remaining),
    },
    wallDurability: pick(base.wallDurability, other.wallDurability),
  };
}

interface Read<T> {
  value: T;
  /** Two independent readings gave exactly the same values. */
  agreed: boolean;
}

/**
 * Reads every screenshot twice, at two sizes. A value is only trusted when both readings match and the
 * game's own totals add up; the second condition catches the first reading error, the first catches a
 * wrong coordinate or time that no total could.
 */
export async function readScreens(images: ImageInput[]): Promise<ScreenReading> {
  const recons: Read<ReconRead>[] = [];
  const mails: Read<BattleRead>[] = [];
  const buffs: Buff[][] = [];
  let reconFailed = false;
  const problems: string[] = [];
  let recognised = 0;

  for (const [i, img] of images.entries()) {
    const a = await readRows(img, 1);
    const b = await readRows(img, 2);
    const kind: ScreenKind = classify(a) !== "unknown" ? classify(a) : classify(b);
    const label = `screenshot ${i + 1}`;
    if (kind === "recon") {
      const pa = parseRecon(a);
      const pb = parseRecon(b);
      const agreed = same(criticalRecon(pa), criticalRecon(pb));
      recons.push({ value: mergeRecon(pa, pb), agreed });
      if (!agreed) problems.push(`${label}: two readings of the recon differ`);
      recognised++;
    } else if (kind === "mail") {
      const pa = parseBattleMail(a);
      const pb = parseBattleMail(b);
      const agreed = same(criticalBattle(pa), criticalBattle(pb));
      mails.push({ value: mergeBattle(pa, pb), agreed });
      if (!agreed) problems.push(`${label}: two readings of the battle result differ`);
      recognised++;
    } else if (kind === "reconFailed") {
      reconFailed = true;
      recognised++;
    } else if (kind === "buff") {
      // Only rows both readings agree on.
      const rb = parseBuffs(b);
      buffs.push(parseBuffs(a).filter((x) => rb.some((y) => same(x, y))));
      recognised++;
    }
  }

  const newest = <T extends { timestamp: string | null }>(xs: Read<T>[]) =>
    [...xs].sort((p, q) => (q.value.timestamp ?? "").localeCompare(p.value.timestamp ?? ""))[0];
  const recon = newest(recons);
  const mail = newest(mails);

  for (const r of [recon, mail]) {
    if (r && !r.value.verified) problems.push(...r.value.problems);
  }
  if (!recognised) problems.push("no recon report or battle result found in these screenshots");
  if (recons.length > 1) problems.push(`using the newest of ${recons.length} recon screenshots`);

  const verified =
    recognised > 0 &&
    !!(recon || mail || reconFailed) &&
    (!recon || (recon.agreed && recon.value.verified)) &&
    (!mail || (mail.agreed && mail.value.verified)) &&
    !problems.some((p) => /differ|no recon/.test(p));

  const confidence = verified ? "high" : "low";
  const note = verified
    ? "Read on this computer; every number was read twice and matches the game's totals."
    : `Read on this computer; NOT fully verified (${problems.join("; ") || "unknown"}).`;

  const r = recon?.value ?? null;
  const m = mail?.value ?? null;
  const battleBuffs = buffs.flat();
  const payload = {
    recon: r && {
      reportType: "recon",
      timestamp: r.timestamp,
      location: r.location,
      building: r.building,
      enforcers: { count: r.enforcers, names: [] },
      wallDurability: r.wall ?? { current: 0, max: 0 },
      traps: r.traps,
      associates: r.associates,
      confidence,
      notes: note,
    },
    battle: m && {
      result: m.result,
      timestamp: m.timestamp,
      location: m.location,
      target: m.target,
      attacker: { ...m.attacker, troops: null },
      defender: { ...m.defender, troops: null },
      traps: m.traps,
      wallDurability: m.wallDurability,
      buffs: battleBuffs,
      confidence,
      notes: `${note} Troop mix is not read on this path; the lead troop comes from the formation.`,
    },
    reconFailed,
  };
  return {
    recon: r,
    battle: m ? { ...m, buffs: battleBuffs } : null,
    reconFailed,
    verified,
    problems,
    payload,
  };
}
