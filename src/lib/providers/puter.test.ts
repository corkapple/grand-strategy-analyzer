import { describe, expect, it } from "vitest";
import { fallbackCandidates } from "./fallback";
import { puterText } from "./puter";
import { defaultProviderConfigs } from "./registry";

describe("puter", () => {
  it("reads the reply whatever its shape", () => {
    expect(puterText({ message: { content: "hello" } })).toBe("hello");
    expect(puterText({ message: { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] } })).toBe("ab");
    expect(puterText(null)).toBe("");
  });
  it("joins the fallback chain only once you are signed in", () => {
    const providers = defaultProviderConfigs();
    const base = { activeProvider: "gemini" as const, providers, fallbackEnabled: true, fallbackProvider: "openrouter" as const };
    expect(fallbackCandidates(base).some((c) => c.id === "puter")).toBe(false);
    providers.puter = { ...providers.puter, extra: { signedIn: "1" } };
    expect(fallbackCandidates(base).some((c) => c.id === "puter")).toBe(true);
  });
});
