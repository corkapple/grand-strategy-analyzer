import { create } from "zustand";
import { dueSources, extractionChain, updateSource, type EntryStatus, type KnowledgeEntry } from "@/lib/knowledge";
import { fallbackCandidates } from "@/lib/providers/fallback";
import { discoverGuides, type Suggestion } from "@/lib/discover";
import { kAll, kDelete, kPut } from "@/lib/historyDb";
import { useSettings } from "./settings";

interface KnowledgeState {
  entries: KnowledgeEntry[];
  loaded: boolean;
  checking: boolean;
  /** Messages from the last update run. */
  log: string[];
  error: string | null;
  discovering: boolean;
  /** Pages found by search, not yet added to the source list. */
  suggestions: Suggestion[];
  discoverNotes: string[];
  /** Search the web (Gemini + Google Search) for new guide pages. */
  discover: () => Promise<void>;
  dismissSuggestion: (url: string) => void;
  load: () => Promise<void>;
  /** Accept / reject / reset an entry. Accepted formation advice changes the recommendations. */
  setStatus: (id: string, status: EntryStatus) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Re-read the guide sources. `onlyDue` skips sources checked within the update interval. */
  check: (opts?: { force?: boolean; onlyDue?: boolean }) => Promise<void>;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Undo the effect of a formation entry. If another accepted entry gives advice for the same lead
 * type, that one takes over instead of leaving the default in place.
 */
function releaseFormation(e: KnowledgeEntry, all: KnowledgeEntry[]) {
  if (!e.formation) return;
  const s = useSettings.getState();
  if (s.formationOverrides[e.formation.lead] !== e.formation.name) return;
  const lead = e.formation.lead;
  const stillAccepted = all
    .filter((o) => o.id !== e.id && o.status === "accepted" && o.formation?.lead === lead)
    .sort((a, b) => b.fetchedAt - a.fetchedAt)[0];
  s.setFormationOverride(lead, stillAccepted?.formation?.name);
}

export const useKnowledge = create<KnowledgeState>((set, get) => ({
  entries: [],
  loaded: false,
  checking: false,
  log: [],
  error: null,
  discovering: false,
  suggestions: [],
  discoverNotes: [],

  discover: async () => {
    if (get().discovering) return;
    const st = useSettings.getState();
    const gemini = st.providers.gemini;
    if (!gemini.apiKey?.trim()) {
      set({ discoverNotes: ["Searching needs a Gemini API key (Settings, Provider: Google Gemini)."], suggestions: [] });
      return;
    }
    set({ discovering: true, suggestions: [], discoverNotes: [] });
    try {
      const r = await discoverGuides(gemini, st.knowledgeSources.map((x) => x.url));
      set({
        suggestions: r.suggestions,
        discoverNotes: r.suggestions.length ? r.notes : ["No new guide pages found.", ...r.notes],
      });
    } catch (e) {
      const m = msg(e);
      set({
        discoverNotes: [
          `Search failed: ${m}`,
          ...(/429|quota/i.test(m)
            ? ["Searching uses Gemini only (Google Search is not available through OpenRouter's free models). \"Check now\" for your saved sources still works through the fallback provider."]
            : []),
        ],
      });
    } finally {
      set({ discovering: false });
    }
  },

  dismissSuggestion: (url) => set({ suggestions: get().suggestions.filter((x) => x.url !== url) }),

  load: async () => {
    try {
      set({ entries: await kAll(), loaded: true, error: null });
    } catch (e) {
      set({ loaded: true, error: msg(e) });
    }
  },

  setStatus: async (id, status) => {
    const entry = get().entries.find((x) => x.id === id);
    if (!entry) return;
    if (status === "accepted" && entry.chart === "conflicts") return; // never apply chart conflicts
    const updated = { ...entry, status };
    await kPut(updated);
    set({ entries: get().entries.map((x) => (x.id === id ? updated : x)) });
    if (status === "accepted" && entry.formation) {
      useSettings.getState().setFormationOverride(entry.formation.lead, entry.formation.name);
    } else if (entry.status === "accepted") {
      releaseFormation(entry, get().entries);
    }
  },

  remove: async (id) => {
    const entry = get().entries.find((x) => x.id === id);
    if (!entry) return;
    if (entry.status === "accepted") releaseFormation(entry, get().entries);
    await kDelete(id);
    set({ entries: get().entries.filter((x) => x.id !== id) });
  },

  check: async (opts = {}) => {
    if (get().checking) return;
    if (!get().loaded) await get().load();
    const st = useSettings.getState();
    const { chain, problem } = extractionChain(
      { id: st.activeProvider, config: st.providers[st.activeProvider] },
      fallbackCandidates(st),
    );
    if (problem) {
      set({ log: [problem] });
      return;
    }
    const list = opts.onlyDue ? dueSources(st.knowledgeSources, st.updateIntervalDays) : st.knowledgeSources;
    if (!list.length) {
      set({ log: ["Nothing due to check."] });
      return;
    }
    set({ checking: true, log: [] });
    const log: string[] = [];
    for (const src of list) {
      try {
        const out = await updateSource(src, chain, get().entries, opts.force);
        if (out.status === "unchanged") {
          useSettings.getState().updateSource(src.id, { lastChecked: Date.now(), lastStatus: "No changes since last check" });
          log.push(`${src.label}: no changes`);
        } else {
          for (const e of out.entries) await kPut(e);
          set({ entries: [...get().entries, ...out.entries] });
          const text = `${out.fresh} new ${out.fresh === 1 ? "fact" : "facts"} to review` + (out.dropped ? `, ${out.dropped} discarded (not verifiable on the page)` : "");
          useSettings.getState().updateSource(src.id, { lastChecked: Date.now(), lastHash: out.hash, lastStatus: text });
          log.push(`${src.label}: ${text}`);
        }
      } catch (e) {
        // lastChecked stays as it was, so a failed source is retried on the next launch.
        const text = `Failed: ${msg(e)}`;
        useSettings.getState().updateSource(src.id, { lastStatus: text });
        log.push(`${src.label}: ${text}`);
      }
    }
    set({ checking: false, log });
  },
}));
