import { describe, expect, it } from "vitest";
import { extractUrls, hostMatchesGrounding, isSafePublicUrl, mentionsGame, pageTitle } from "./discover";

describe("isSafePublicUrl", () => {
  it("accepts ordinary public https pages", () => {
    expect(isSafePublicUrl("https://note.com/game_mafia/n/abc")).toBe(true);
    expect(isSafePublicUrl("https://www.example.co.uk/guide?x=1")).toBe(true);
  });
  it("rejects http, localhost, private names, IP literals, credentials and odd ports", () => {
    for (const u of [
      "http://note.com/x",
      "https://localhost/x",
      "https://127.0.0.1/x",
      "https://192.168.1.5/x",
      "https://[::1]/x",
      "https://router.local/x",
      "https://intranet/x",
      "https://user:pw@example.com/x",
      "https://example.com:8443/x",
      "javascript:alert(1)",
      "not a url",
    ]) {
      expect(isSafePublicUrl(u), u).toBe(false);
    }
  });
});

describe("extractUrls", () => {
  it("pulls https URLs out of a model reply and trims punctuation", () => {
    const t = "1. https://a.com/x | Guide A\n2. https://b.org/y). Done.\nhttp://insecure.com/z https://a.com/x";
    expect(extractUrls(t)).toEqual(["https://a.com/x", "https://b.org/y"]);
  });
});

describe("hostMatchesGrounding", () => {
  it("requires the site to be one the search returned", () => {
    expect(hostMatchesGrounding("https://note.com/a", ["note.com", "reddit.com"])).toBe(true);
    expect(hostMatchesGrounding("https://www.reddit.com/r/x", ["reddit.com"])).toBe(true);
    expect(hostMatchesGrounding("https://evil.example/a", ["note.com", "reddit.com"])).toBe(false);
    expect(hostMatchesGrounding("https://notreddit.com/a", ["reddit.com"])).toBe(false);
    expect(hostMatchesGrounding("https://note.com/a", [])).toBe(false);
  });
});

describe("page helpers", () => {
  it("reads the title and checks the game is mentioned", () => {
    expect(pageTitle("<html><head><title>Formation &amp; Tips | note</title></head></html>", "x")).toBe("Formation & Tips | note");
    expect(pageTitle("<html></html>", "fallback")).toBe("fallback");
    expect(mentionsGame("Welcome to The Grand Mafia strategy")).toBe(true);
    expect(mentionsGame("Welcome to a cooking blog")).toBe(false);
  });
});

import { pickFreeModels } from "./providers/openrouterModels";

describe("pickFreeModels", () => {
  it("prefers Gemma, puts reasoning models last, drops the auto-router and stealth models", () => {
    const list = [
      "openrouter/free",
      "stealth/crouton-alpha",
      "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
      "nvidia/nemotron-3.5-super-vl:free",
      "google/gemma-4-31b-it:free",
      "google/gemma-4-26b-a4b-it:free",
    ].map((id) => ({ id }));
    expect(pickFreeModels(list)).toEqual([
      "google/gemma-4-31b-it:free",
      "google/gemma-4-26b-a4b-it:free",
      "nvidia/nemotron-3.5-super-vl:free",
      "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    ]);
    expect(pickFreeModels(list, 2)).toHaveLength(2);
  });
});
