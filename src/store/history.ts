import { create } from "zustand";
import type { HistoryRecord } from "@/lib/history";
import { dbAll, dbClear, dbDelete, dbPut } from "@/lib/historyDb";

interface HistoryState {
  records: HistoryRecord[];
  loaded: boolean;
  error: string | null;
  load: () => Promise<void>;
  add: (r: HistoryRecord) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setAttackType: (id: string, type: "solo" | "rally" | undefined) => Promise<void>;
  clear: () => Promise<void>;
}

const fail = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const useHistory = create<HistoryState>((set, get) => ({
  records: [],
  loaded: false,
  error: null,
  load: async () => {
    try {
      set({ records: await dbAll(), loaded: true, error: null });
    } catch (e) {
      set({ loaded: true, error: fail(e) });
    }
  },
  add: async (r) => {
    // Without this, saving before History was ever opened leaves `records` holding only the new
    // record, and pairing/learning then ignores everything already stored.
    if (!get().loaded) await get().load();
    await dbPut(r);
    set({ records: [...get().records, r] });
  },
  remove: async (id) => {
    await dbDelete(id);
    set({ records: get().records.filter((r) => r.id !== id) });
  },
  setAttackType: async (id, type) => {
    const rec = get().records.find((r) => r.id === id);
    if (!rec || rec.kind !== "battle") return;
    const updated = { ...rec, attackType: type };
    await dbPut(updated);
    set({ records: get().records.map((r) => (r.id === id ? updated : r)) });
  },
  clear: async () => {
    await dbClear();
    set({ records: [] });
  },
}));
