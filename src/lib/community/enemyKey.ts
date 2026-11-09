/** Majority troop type (>= 50% of the three field types) or "mixed". Same rule the aggregation uses. */
export function enemyKey(e: { bruisers: number; hitmen: number; bikers: number }): string {
  const field = e.bruisers + e.hitmen + e.bikers;
  if (!field) return "mixed";
  for (const k of ["bruisers", "hitmen", "bikers"] as const) if (e[k] / field >= 0.5) return k;
  return "mixed";
}
