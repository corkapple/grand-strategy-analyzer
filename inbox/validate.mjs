// Shared by the Cloudflare Worker (server-side check) and the tests. A shared sample is numbers only:
// no names, no coordinates, no server, no screenshots, no exact timestamps. Anything that does not
// match this exact shape is rejected, so the endpoint cannot be used to store arbitrary text.

export const FORMATIONS = [
  "Bruiser - Square",
  "Bruiser - Wedge",
  "Hitman - Square",
  "Hitman - Wedge",
  "Biker - Square",
  "Biker - Wedge",
];
const KEYS = [
  "v",
  "app",
  "day",
  "result",
  "level",
  "enemy",
  "enemyTotal",
  "formation",
  "lead",
  "ours",
  "ratio",
  "ourLoss",
  "enemyLoss",
  "trapsDestroyed",
  "buffEdge",
  "attackType",
];
const ENEMY_KEYS = ["bruisers", "hitmen", "bikers", "mortars"];

const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const isNum = (v, lo, hi) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;

/** Returns { ok: true, sample } with only the known fields, or { ok: false, error }. */
export function validateSample(x) {
  if (!x || typeof x !== "object" || Array.isArray(x)) return { ok: false, error: "not an object" };
  for (const k of Object.keys(x)) if (!KEYS.includes(k)) return { ok: false, error: `unexpected field ${k}` };
  if (x.v !== 1) return { ok: false, error: "unsupported version" };
  if (typeof x.app !== "string" || !/^[0-9A-Za-z.\-+]{1,20}$/.test(x.app)) return { ok: false, error: "app" };
  if (typeof x.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x.day)) return { ok: false, error: "day" };
  if (x.result !== "victory" && x.result !== "defeat") return { ok: false, error: "result" };
  if (!(x.level === null || isInt(x.level, 1, 60))) return { ok: false, error: "level" };
  const e = x.enemy;
  if (!e || typeof e !== "object") return { ok: false, error: "enemy" };
  for (const k of Object.keys(e)) if (!ENEMY_KEYS.includes(k)) return { ok: false, error: "enemy field" };
  for (const k of ENEMY_KEYS) if (!isInt(e[k], 0, 100)) return { ok: false, error: `enemy.${k}` };
  const sum = ENEMY_KEYS.reduce((s, k) => s + e[k], 0);
  if (sum < 95 || sum > 105) return { ok: false, error: "enemy mix does not add up" };
  if (!isInt(x.enemyTotal, 1, 20_000_000)) return { ok: false, error: "enemyTotal" };
  if (!isInt(x.ours, 1, 20_000_000)) return { ok: false, error: "ours" };
  if (!(x.formation === null || FORMATIONS.includes(x.formation))) return { ok: false, error: "formation" };
  // `lead` is the troop type the attack was led with. Samples from v0.1.4 did not have it.
  if (!(x.lead === undefined || x.lead === null || ["bruisers", "hitmen", "bikers"].includes(x.lead))) return { ok: false, error: "lead" };
  if (!isNum(x.ratio, 0, 20)) return { ok: false, error: "ratio" };
  if (!isNum(x.ourLoss, 0, 1)) return { ok: false, error: "ourLoss" };
  if (!isNum(x.enemyLoss, 0, 1)) return { ok: false, error: "enemyLoss" };
  if (!(x.trapsDestroyed === null || isNum(x.trapsDestroyed, 0, 1))) return { ok: false, error: "trapsDestroyed" };
  if (!(x.buffEdge === null || isInt(x.buffEdge, -3000, 3000))) return { ok: false, error: "buffEdge" };
  if (!(x.attackType === null || x.attackType === "solo" || x.attackType === "rally")) return { ok: false, error: "attackType" };
  const sample = {};
  for (const k of KEYS) if (x[k] !== undefined) sample[k] = x[k];
  sample.enemy = Object.fromEntries(ENEMY_KEYS.map((k) => [k, e[k]]));
  return { ok: true, sample };
}
