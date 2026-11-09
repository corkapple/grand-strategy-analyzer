// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
const reads: string[] = [];
vi.mock("@/lib/secrets", () => ({
  inTauri: true,
  KEYS_ACCOUNT: "apikeys",
  apiKeyAccount: (id: string) => `apikey:${id}`,
  getSecret: async (a: string) => (reads.push(a), store.get(a) ?? null),
  setSecret: async (a: string, v: string) => void (v ? store.set(a, v) : store.delete(a)),
}));

beforeEach(() => {
  store.clear();
  reads.length = 0;
  vi.resetModules();
  localStorage.clear();
});

const settle = () => new Promise((r) => setTimeout(r, 50));

describe("keychain layout", () => {
  it("moves old per-provider items into one item and reads only that item afterwards", async () => {
    store.set("apikey:gemini", "G");
    store.set("apikey:openrouter", "O");
    const { useSettings } = await import("./settings");
    await useSettings.persist.rehydrate();
    await settle();
    expect(useSettings.getState().providers.gemini.apiKey).toBe("G");
    expect(useSettings.getState().providers.openrouter.apiKey).toBe("O");
    expect(JSON.parse(store.get("apikeys")!)).toEqual({ gemini: "G", openrouter: "O" });
    expect(store.has("apikey:gemini")).toBe(false); // old items removed

    // Next start: a single keychain read.
    reads.length = 0;
    vi.resetModules();
    const again = (await import("./settings")).useSettings;
    await again.persist.rehydrate();
    await settle();
    expect(reads.filter((r) => r === "apikeys").length).toBeGreaterThan(0);
    expect(reads.some((r) => r.startsWith("apikey:"))).toBe(false);
    expect(again.getState().providers.gemini.apiKey).toBe("G");
  });
});
