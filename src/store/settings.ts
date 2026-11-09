import { create } from "zustand";
import { persist } from "zustand/middleware";
import { defaultProviderConfigs, getProvider } from "@/lib/providers/registry";
import type { ProviderConfig, ProviderId } from "@/lib/providers";
import { KEYS_ACCOUNT, apiKeyAccount, getSecret, setSecret } from "@/lib/secrets";
import type { Source } from "@/lib/knowledge";
import { DEFAULT_STRATEGY, FORMATION_NAMES, type StrategyConfig, type TroopType } from "@/lib/strategy";

const DEFAULT_SOURCES: Source[] = [
  {
    id: "note-formation-1",
    url: "https://note.com/game_mafia/n/nc3fd3f77823f?hl=en",
    label: "note.com: Formation Part 1 (2026-01-31)",
  },
];

interface SettingsState {
  activeProvider: ProviderId;
  providers: Record<ProviderId, ProviderConfig>;
  customPrompt: string;
  strategy: StrategyConfig;
  /** Save every successful analysis (with small screenshot thumbnails) to local History. */
  saveHistory: boolean;
  /** Real losses above this share of your army make a win "costly" (not a playbook precedent). */
  lossCap: number;
  /** Associates you can send; used to check whether you can repeat a proven win. 0 = not set. */
  myAssociates: number;
  /** Guide pages the app re-reads to keep its game knowledge current. */
  knowledgeSources: Source[];
  autoUpdate: boolean;
  updateIntervalDays: number;
  /** Formation advice the user accepted from a guide, per lead troop type. */
  formationOverrides: Partial<Record<TroopType, string>>;
  addSource: (url: string, label: string) => void;
  removeSource: (id: string) => void;
  updateSource: (id: string, patch: Partial<Source>) => void;
  setAutoUpdate: (v: boolean) => void;
  setUpdateIntervalDays: (v: number) => void;
  setFormationOverride: (lead: TroopType, name: string | undefined) => void;
  setLossCap: (v: number) => void;
  setMyAssociates: (v: number) => void;
  /**
   * Runtime only (never persisted). True once the OS keychain is confirmed
   * working; from then on API keys are kept out of localStorage. Until then
   * (or if the keychain fails) keys fall back to localStorage so none are lost.
   */
  keychain: boolean;
  /** Runtime only: true once startup keychain loading has finished (successfully or not). */
  secretsReady: boolean;
  secretsError: string | null;
  /** If the main provider fails (quota, outage, timeout), try this one next. */
  fallbackEnabled: boolean;
  fallbackProvider: ProviderId;
  /** Share anonymous result numbers (never screenshots, names or coordinates) with the community. */
  shareResults: boolean;
  /** The first-launch notice about sharing has been shown. */
  shareNoticeSeen: boolean;
  setShareResults: (v: boolean) => void;
  dismissShareNotice: () => void;
  /** Also try every other free provider that has a key. */
  autoFallback: boolean;
  /** Use the public Mesh network (text only, no key) for reading guides. */
  meshGuides: boolean;
  /** Read screenshots on this computer first; ask an AI service only when the numbers cannot be verified. */
  localFirst: boolean;
  setLocalFirst: (v: boolean) => void;
  setAutoFallback: (v: boolean) => void;
  setMeshGuides: (v: boolean) => void;
  setFallbackEnabled: (v: boolean) => void;
  setFallbackProvider: (id: ProviderId) => void;
  setSaveHistory: (v: boolean) => void;
  setActiveProvider: (id: ProviderId) => void;
  updateProvider: (id: ProviderId, patch: Partial<ProviderConfig>) => void;
  setCustomPrompt: (s: string) => void;
  setStrategy: (s: StrategyConfig) => void;
  reset: () => void;
}

const initial = () => ({
  activeProvider: "gemini" as ProviderId,
  providers: defaultProviderConfigs(),
  customPrompt: "",
  strategy: DEFAULT_STRATEGY,
  saveHistory: true,
  lossCap: 0.1,
  myAssociates: 0,
  shareResults: true,
  shareNoticeSeen: false,
  autoFallback: true,
  localFirst: true,
  meshGuides: true,
  fallbackEnabled: true,
  fallbackProvider: "openrouter" as ProviderId,
  knowledgeSources: DEFAULT_SOURCES,
  autoUpdate: true,
  updateIntervalDays: 7,
  formationOverrides: {} as Partial<Record<TroopType, string>>,
});

let saveTimer: ReturnType<typeof setTimeout> | undefined;

function currentKeys(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, cfg] of Object.entries(useSettings.getState().providers)) {
    const k = cfg.apiKey?.trim();
    if (k) out[id] = k;
  }
  return out;
}

/** Debounced so typing a key doesn't hit the keychain on every keystroke. One item holds every key. */
function queueKeySave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (!useSettings.getState().keychain) return; // localStorage fallback handles it
    try {
      await setSecret(KEYS_ACCOUNT, JSON.stringify(currentKeys()));
    } catch (e) {
      // Keep the key somewhere durable rather than losing it.
      useSettings.setState({ keychain: false, secretsError: String(e) });
    }
  }, 600);
}

/**
 * On startup: load the keys from the keychain (one read, so one permission prompt), merging in
 * any key still in old localStorage state or in the older one-item-per-provider layout. Only after
 * everything succeeds do we flip `keychain` on, which makes the next persist write drop keys
 * from localStorage.
 */
async function hydrateSecrets() {
  const ids = Object.keys(useSettings.getState().providers) as ProviderId[];
  try {
    let keys: Record<string, string> = {};
    let migrated = false;
    const blob = await getSecret(KEYS_ACCOUNT);
    if (blob) {
      try {
        keys = JSON.parse(blob) as Record<string, string>;
      } catch {
        keys = {};
      }
    } else {
      // First run of this layout: pull keys from the old per-provider items.
      for (const id of ids) {
        const old = await getSecret(apiKeyAccount(id));
        if (old) keys[id] = old;
      }
      migrated = Object.keys(keys).length > 0;
    }
    for (const id of ids) {
      const legacy = useSettings.getState().providers[id].apiKey?.trim();
      if (legacy && legacy !== keys[id]) {
        keys[id] = legacy;
        migrated = true;
      }
    }
    useSettings.setState((s) => ({
      providers: Object.fromEntries(
        ids.map((id) => [id, keys[id] ? { ...s.providers[id], apiKey: keys[id] } : s.providers[id]]),
      ) as typeof s.providers,
    }));
    if (migrated) {
      await setSecret(KEYS_ACCOUNT, JSON.stringify(keys));
      // Remove the old per-provider items (best effort) so they never prompt again.
      for (const id of ids) await setSecret(apiKeyAccount(id), "").catch(() => {});
    }
    useSettings.setState({ keychain: true, secretsReady: true, secretsError: null });
  } catch (e) {
    useSettings.setState({ keychain: false, secretsReady: true, secretsError: String(e) });
  }
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...initial(),
      keychain: false,
      secretsReady: false,
      secretsError: null,
      setLocalFirst: (localFirst) => set({ localFirst }),
      setAutoFallback: (autoFallback) => set({ autoFallback }),
      setMeshGuides: (meshGuides) => set({ meshGuides }),
      setShareResults: (shareResults) => set({ shareResults, shareNoticeSeen: true }),
      dismissShareNotice: () => set({ shareNoticeSeen: true }),
      setFallbackEnabled: (fallbackEnabled) => set({ fallbackEnabled }),
      setFallbackProvider: (fallbackProvider) => set({ fallbackProvider }),
      setActiveProvider: (activeProvider) => set({ activeProvider }),
      updateProvider: (id, patch) => {
        set((s) => ({
          providers: { ...s.providers, [id]: { ...s.providers[id], ...patch } },
        }));
        if (patch.apiKey !== undefined) queueKeySave();
      },
      setSaveHistory: (saveHistory) => set({ saveHistory }),
      setLossCap: (lossCap) => set({ lossCap }),
      addSource: (url, label) =>
        set((s) => ({ knowledgeSources: [...s.knowledgeSources, { id: crypto.randomUUID(), url, label }] })),
      removeSource: (id) => set((s) => ({ knowledgeSources: s.knowledgeSources.filter((x) => x.id !== id) })),
      updateSource: (id, patch) =>
        set((s) => ({ knowledgeSources: s.knowledgeSources.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      setAutoUpdate: (autoUpdate) => set({ autoUpdate }),
      setUpdateIntervalDays: (updateIntervalDays) => set({ updateIntervalDays }),
      setFormationOverride: (lead, name) =>
        set((s) => {
          const formationOverrides = { ...s.formationOverrides };
          if (name) formationOverrides[lead] = name;
          else delete formationOverrides[lead];
          return {
            formationOverrides,
            strategy: { ...s.strategy, formations: { ...DEFAULT_STRATEGY.formations, ...formationOverrides } },
          };
        }),
      setMyAssociates: (myAssociates) => set({ myAssociates }),
      setCustomPrompt: (customPrompt) => set({ customPrompt }),
      setStrategy: (strategy) => set({ strategy }),
      reset: () => {
        const had = useSettings.getState();
        set(initial());
        if (had.keychain) {
          for (const id of Object.keys(had.providers) as ProviderId[]) {
            void setSecret(apiKeyAccount(id), "").catch(() => {});
          }
        }
      },
    }),
    {
      name: "gsa-settings",
      version: 1,
      // Runtime-only fields are never written; API keys are written only while
      // the keychain is not (yet) confirmed working.
      partialize: (s) => ({
        activeProvider: s.activeProvider,
        customPrompt: s.customPrompt,
        // Only the user's thresholds are a setting. Counters, formations and guards are game rules
        // that ship with the app; saving them made old defaults override later fixes.
        strategy: { thresholds: s.strategy.thresholds } as StrategyConfig,
        saveHistory: s.saveHistory,
        lossCap: s.lossCap,
        fallbackEnabled: s.fallbackEnabled,
        fallbackProvider: s.fallbackProvider,
        shareResults: s.shareResults,
        autoFallback: s.autoFallback,
        localFirst: s.localFirst,
        meshGuides: s.meshGuides,
        shareNoticeSeen: s.shareNoticeSeen,
        myAssociates: s.myAssociates,
        knowledgeSources: s.knowledgeSources,
        autoUpdate: s.autoUpdate,
        updateIntervalDays: s.updateIntervalDays,
        formationOverrides: s.formationOverrides,
        providers: Object.fromEntries(
          Object.entries(s.providers).map(([id, cfg]) => [
            id,
            s.keychain ? { ...cfg, apiKey: undefined } : cfg,
          ]),
        ) as Record<ProviderId, ProviderConfig>,
      }),
      // Keep newly added providers/defaults when loading an older saved state.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsState>;
        const providers = { ...current.providers, ...(p.providers ?? {}) };
        // Saved defaults that no longer exist upstream: fall back to the current default.
        if (providers.openrouter?.model === "google/gemini-2.0-flash-exp:free") {
          providers.openrouter = { ...providers.openrouter, model: current.providers.openrouter.model };
        }
        // Accepted guide advice survives updates; anything that is not a real formation name is dropped.
        const formationOverrides = Object.fromEntries(
          Object.entries(p.formationOverrides ?? {}).filter(([, v]) => (FORMATION_NAMES as readonly string[]).includes(v as string)),
        ) as Partial<Record<TroopType, string>>;
        const strategy: StrategyConfig = {
          ...DEFAULT_STRATEGY,
          formations: { ...DEFAULT_STRATEGY.formations, ...formationOverrides },
          thresholds: { ...DEFAULT_STRATEGY.thresholds, ...(p.strategy?.thresholds ?? {}) },
        };
        // A text-only provider (Mesh) cannot read screenshots, so it cannot be the main provider.
        const active = p.activeProvider && !getProvider(p.activeProvider).capabilities.textOnly ? p.activeProvider : current.activeProvider;
        return { ...current, ...p, activeProvider: active, providers, strategy, formationOverrides };
      },
      // useSettings is not assigned yet while this runs, so defer.
      onRehydrateStorage: () => () => {
        setTimeout(() => void hydrateSecrets(), 0);
      },
    },
  ),
);
