export function enemyKey(e: { bruisers: number; hitmen: number; bikers: number; mortars: number }): string;
export function leadOf(s: { lead?: string | null; formation?: string | null }): string | null;
export function aggregate(samples: unknown[], now?: Date): {
  generatedAt: string;
  samples: number;
  groups: {
    enemy: string;
    lead: string;
    n: number;
    wins: number;
    winRate: number;
    avgOurLoss: number;
    medianOurLoss: number | null;
    avgEnemyLoss: number;
    medianWinRatio: number | null;
    cheapWins: number;
  }[];
};
