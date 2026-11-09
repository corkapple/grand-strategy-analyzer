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
  /** At least two independent readings gave exactly the same critical values. */
  agreed: boolean;
}

/**
 * Picks the reading two independent passes agree on. With two passes that means both; if they disagree a
 * third pass at another size breaks the tie. The agreed reading must also pass the game's arithmetic.
 * With no such pair the reading is returned as not agreed.
 */
async function consensus<T extends { verified: boolean }>(
  img: ImageInput,
  parse: (rows: string[]) => T,
  critical: (t: T) => unknown,
  merge: (a: T, b: T) => T,
  rowsFirst: string[],
  rowsSecond: string[],
): Promise<Read<T>> {
  const reads = [parse(rowsFirst), parse(rowsSecond)];
  if (!same(critical(reads[0]), critical(reads[1]))) reads.push(parse(await readRows(img, 1.5)));
  for (let i = 0; i < reads.length; i++) {
    for (let j = i + 1; j < reads.length; j++) {
      if (same(critical(reads[i]), critical(reads[j])) && (reads[i].verified || reads[j].verified)) {
        return { value: merge(reads[i], reads[j]), agreed: true };
      }
    }
  }
  return { value: reads.find((r) => r.verified) ?? reads[0], agreed: false };
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
      const r = await consensus(img, parseRecon, criticalRecon, mergeRecon, a, b);
      const agreed = r.agreed;
      recons.push(r);
      if (!agreed) problems.push(`${label}: the readings of the recon do not agree`);
      recognised++;
    } else if (kind === "mail") {
      const r = await consensus(img, parseBattleMail, criticalBattle, mergeBattle, a, b);
      const agreed = r.agreed;
      mails.push(r);
      if (!agreed) problems.push(`${label}: the readings of the battle result do not agree`);
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
    !problems.some((p) => /do not agree|no recon/.test(p));

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
