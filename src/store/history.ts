import { create } from "zustand";
import { fingerprint, type HistoryRecord } from "@/lib/history";
import { dbAll, dbClear, dbDelete, dbPut } from "@/lib/historyDb";

interface HistoryState {
  records: HistoryRecord[];
  loaded: boolean;
  error: string | null;
  load: () => Promise<void>;
  /** Stores the record; if the same event is already there it is updated instead. Returns what was stored. */
  add: (r: HistoryRecord) => Promise<HistoryRecord>;
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
    // The same screenshots analysed again are the same event: keep one record (the newest reading).
    const fp = fingerprint(r);
    const same = fp ? get().records.find((o) => o.kind === r.kind && fingerprint(o) === fp) : undefined;
    if (same) {
      const merged = { ...r, id: same.id, ...(same.kind === "battle" && r.kind === "battle" ? { attackType: same.attackType ?? r.attackType } : {}) } as HistoryRecord;
      await dbPut(merged);
      set({ records: get().records.map((o) => (o.id === same.id ? merged : o)) });
      return merged;
    }
    await dbPut(r);
    set({ records: [...get().records, r] });
    return r;
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
