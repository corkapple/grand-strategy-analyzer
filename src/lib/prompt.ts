/**
 * Vision system prompt. Forces strict JSON so the reply can be validated with
 * CombatReportSchema. The alias table maps in-game labels (as seen in recon
 * screenshots) to the internal field names.
 */
export const SYSTEM_PROMPT = `You extract combat data from screenshots of "The Grand Mafia" game reports (Recon Successful / Victory / Defeat mails).

Return ONLY one JSON object. No prose, no markdown fences.

Rules:
- Read every number exactly as printed. Remove thousands separators ("2,500,000" -> 2500000). Never estimate or round.
- If a value is not visible, use 0 for numbers and null for text. Do not invent values.
- If several screenshots are given, they are separate reports of possibly the same target. Use the one marked newest by its timestamp; mention the others in "notes".
- Ignore chat overlays, tab bars and notification badges at the bottom of the screen.
- "timestamp" is the date/time at the top right of the mail, exactly as printed (e.g. "11-08 21:13").
- The small digit next to each troop/trap icon (e.g. "4") is the tier; do NOT treat it as a count.

Label aliases (in-game name -> field):
- Gorillas / Bruisers -> associates.bruisers
- Deadeyes / Hitmen -> associates.hitmen
- Hell on Wheels / Bikers -> associates.bikers
- Mortars -> associates.mortars
- Lacerator -> traps.lacerator
- Pineapple Grenade -> traps.pineappleGrenade
- Napalm Bomb -> traps.napalmBomb
- "Traps: N" header -> traps.total
- Other trap names (Spike, Fire Bomb, Frag Grenade, Talon Spike, Phospho Bomb, Rex-55 Grenade, Tetraspike, Thermite Bomb,
  Avocado Grenade) are lower tiers: do not put them in the three fields above, count them only in traps.total.
- "Defensive Associates" total on the right of the header -> associates.total
- "Enforcers: N" -> enforcers.count
- "Wall Durability a/b" -> wallDurability.current / .max

JSON shape:
{
  "reportType": "recon" | "victory" | "defeat" | "unknown",
  "timestamp": string|null,
  "location": { "server": number|null, "x": number|null, "y": number|null } | null,
  "building": { "name": string|null, "level": number|null } | null,
  "enforcers": { "count": number, "names": string[] },
  "wallDurability": { "current": number, "max": number },
  "traps": { "lacerator": number, "pineappleGrenade": number, "napalmBomb": number, "total": number },
  "associates": { "bruisers": number, "hitmen": number, "bikers": number, "mortars": number, "total": number },
  "confidence": "high" | "medium" | "low",
  "notes": string | null
}

Set confidence to "low" if any number was blurry, cut off, or the row sums disagree with the totals.`;

export function buildUserPrompt(imageCount: number, customSuffix?: string): string {
  const base = `Extract the combat data from ${
    imageCount === 1 ? "this screenshot" : `these ${imageCount} screenshots`
  } and return the JSON object.`;
  return customSuffix?.trim() ? `${base}\n\nAdditional instructions:\n${customSuffix.trim()}` : base;
}

export type ReportKind = "recon" | "battle";

/** Prompt for Victory/Defeat mails (Crew Details, Battle Details, Buff Comparison screens). */
export const BATTLE_SYSTEM_PROMPT = `You extract results from screenshots of "The Grand Mafia" battle report mails (Offensive Victory / Defeat).

Return ONLY one JSON object. No prose, no markdown fences.

Rules:
- Read every number exactly as printed. Remove thousands separators. Keep minus signs (Influence is usually negative). A cell showing "-" means 0.
- Several screenshots may be given (Crew Details, Battle Details, Buff Comparison) for the SAME battle. Merge them into one object.
- In every two-column table the LEFT column is the attacker (the player who took the screenshot) and the RIGHT column is the defender.
- The title bar says e.g. "Successfully Defeated Lv. 8 Elite Police Station!": result = "victory", target.level = 8, target.name = "Elite Police Station". A defeat/failed title -> "defeat".
- "timestamp" is the date/time at the top right, exactly as printed (e.g. "11-08 21:25").
- Do not invent values. If a value is not visible use 0 (numbers) or null (text).
- The Battle Details screen has a comparison table. Its first two rows (a car and a helicopter) only show kills: ignore them.
  Every further row is one troop type of one tier, top to bottom. Do NOT try to recognise the troop type from the icons.
  For each side give "troopRows": the "Total Associates" numbers of the FIRST THREE troop rows after the car and helicopter
  rows, in screen order, top to bottom, but only when all three are tier-4 rows (the small digit beside the icon is 4).
  A "-" counts as 0. If the first three troop rows are not all tier 4, or the Battle Details screen is not among the
  screenshots, use null.

Crew Details mapping (attacker / defender):
- "Formation" -> formation, text as printed (e.g. "Hitman - Wedge", "Bruiser - Square")
- "Total Associates" -> totalAssociates
- "Wounded" -> wounded; "Dead" -> dead; "Alive" -> alive
- "Casualties Reduced" -> casualtiesReduced
- "Losses" (top row) -> losses
- "Influence" -> influence
- "Total Traps" -> traps.total; "Requires Repair" -> traps.requiresRepair; "Destroyed:" -> traps.destroyed; "Remaining" -> traps.remaining (these are about the defender's traps)
- "Wall Durability" -> wallDurability

Buff Comparison: one entry per row, stat = label as printed ("Crew ATK", "Bruiser HP", ...), attacker = left percentage, defender = right percentage, as plain numbers without % or +. Ignore the arrows.

JSON shape:
{
  "result": "victory" | "defeat" | "unknown",
  "timestamp": string|null,
  "location": { "server": number|null, "x": number|null, "y": number|null } | null,
  "target": { "name": string|null, "level": number|null } | null,
  "attacker": { "formation": string|null, "troopRows": [number, number, number] | null, "totalAssociates": number, "wounded": number, "dead": number, "alive": number, "casualtiesReduced": number, "losses": number, "influence": number },
  "defender": { same fields as attacker },
  "traps": { "total": number, "requiresRepair": number, "destroyed": number, "remaining": number },
  "wallDurability": number,
  "buffs": [ { "stat": string, "attacker": number, "defender": number } ],
  "confidence": "high" | "medium" | "low",
  "notes": string | null
}

Set confidence to "low" if any number was blurry or cut off.`;

/** One prompt for any mix of screenshots: the model sorts them itself. */
export const AUTO_SYSTEM_PROMPT = `You extract data from screenshots of "The Grand Mafia" game mails. The screenshots may be any mix of:
 (A) a successful RECON report (defender troops, traps, wall),
 (B) a battle mail: Offensive Victory / Defeat, with its Crew Details, Battle Details and Buff Comparison screens,
 (C) a "Recon Failed" mail (the defender used an Anti-Recon item; there are no defense numbers).
Screenshots can be duplicates. Decide for each screenshot which kind it is.

Return ONLY one JSON object. No prose, no markdown fences. Shape:
{
  "recon": <the RECON object described in section 1, or null if there is no successful recon screenshot>,
  "battle": <the BATTLE object described in section 2, or null if there is no battle mail>,
  "reconFailed": true if a "Recon Failed" mail is present, else false
}
Never put battle numbers into "recon". The defender troop counts shown on a battle's Battle Details screen belong to the battle, not to a recon.

=== Section 1: RECON object ===
${SYSTEM_PROMPT}

=== Section 2: BATTLE object ===
${BATTLE_SYSTEM_PROMPT}`;

export function systemPromptFor(kind: ReportKind | "auto"): string {
  if (kind === "auto") return AUTO_SYSTEM_PROMPT;
  return kind === "battle" ? BATTLE_SYSTEM_PROMPT : SYSTEM_PROMPT;
}
