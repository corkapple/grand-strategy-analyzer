/**
 * The game's own arithmetic for one side of a battle:
 *   total  = alive + wounded + dead            (everyone is either alive, wounded or dead)
 *   losses = wounded + dead + casualties reduced   (the headline "Losses" figure)
 * A model (or a text reader) that misreads one number breaks these, which is how it is caught and,
 * when the totals prove which number is wrong, repaired.
 */
export interface SideNumbers {
  totalAssociates: number;
  wounded: number;
  dead: number;
  alive: number;
  casualtiesReduced: number;
  losses: number;
}

const holds1 = (s: SideNumbers) => s.totalAssociates === s.alive + s.wounded + s.dead;
const holds2 = (s: SideNumbers) => s.losses === s.wounded + s.dead + s.casualtiesReduced;

export interface Repair {
  side: SideNumbers;
  /** Human-readable list of what was changed, empty when nothing was. */
  changes: string[];
  /** The numbers add up (after any repair). */
  consistent: boolean;
}

export function repairSide(input: SideNumbers): Repair {
  const s = { ...input };
  const changes: string[] = [];
  const set = (key: keyof SideNumbers, label: string, value: number) => {
    if (value < 0) return false;
    changes.push(`${label} ${s[key].toLocaleString("en-US")} -> ${value.toLocaleString("en-US")}`);
    s[key] = value;
    return true;
  };
  // Nothing was read for this side (for example a failed screenshot): nothing to check.
  if (!s.totalAssociates && !s.losses && !s.alive && !s.dead) return { side: s, changes, consistent: true };

  // A model that could not read a figure often returns 0 for it. Fill those first, from the other numbers.
  if (!holds1(s) && s.alive === 0 && s.totalAssociates > 0) {
    const alive = s.totalAssociates - s.wounded - s.dead;
    if (alive > 0) set("alive", "alive", alive);
  }
  if (!holds2(s) && s.losses === 0) {
    const losses = s.wounded + s.dead + s.casualtiesReduced;
    if (losses > 0) set("losses", "losses", losses);
  }

  const ok1 = holds1(s);
  const ok2 = holds2(s);
  if (ok1 && ok2) return { side: s, changes, consistent: true };

  if (!ok1 && !ok2) {
    // Wounded + dead is the only thing both identities share, so a wrong dead (or wounded) count breaks both.
    // Only that sum matters for the analysis, so the repair goes to "dead" (red text, the one models misread).
    const dead = s.losses - s.wounded - s.casualtiesReduced;
    if (dead >= 0 && s.alive + s.wounded + dead === s.totalAssociates) set("dead", "dead", dead);
  } else if (!ok1) {
    // Only alive/total can be wrong. A zero means "not read"; otherwise it is ambiguous, so leave it.
    if (s.alive === 0) set("alive", "alive", s.totalAssociates - s.wounded - s.dead);
    else if (s.totalAssociates === 0) set("totalAssociates", "total", s.alive + s.wounded + s.dead);
  } else if (!ok2) {
    if (s.losses === 0) set("losses", "losses", s.wounded + s.dead + s.casualtiesReduced);
    else if (s.casualtiesReduced === 0) set("casualtiesReduced", "casualties reduced", s.losses - s.wounded - s.dead);
  }
  return { side: s, changes, consistent: holds1(s) && holds2(s) };
}
