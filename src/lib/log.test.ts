import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _entries, clearMemoryLog, debugReport, formatEntry, log, newRun, sanitize, setLogEnabled } from "./log";
import { analyzeWithFallback, retry } from "./providers/fallback";

beforeEach(() => {
  clearMemoryLog();
  setLogEnabled(true);
});
afterEach(() => vi.unstubAllGlobals());

describe("what the log refuses to record", () => {
  it("drops keys, screenshots, prompts and anything that identifies a base or player", () => {
    const out = sanitize({
      provider: "gemini",
      apiKey: "AIzaSyD-SECRET-SECRET-SECRET-1234",
      images: [{ base64: "AAAA" }],
      prompt: "long prompt",
      location: { server: 12345, x: 111, y: 222 },
      server: 12345,
      name: "Elite Police Station",
      army: 1738596,
    });
    expect(out).toEqual({ provider: "gemini", army: 1738596 });
  });
  it("masks keys in URLs and error text, coordinates in text, and long blobs", () => {
    const s = JSON.stringify(
      sanitize({
        message: "HTTP 400 from https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=AIzaSyD-SECRET-SECRET-SECRET-1234 failed. Bearer abc.def.ghi at S:12345 X:111 Y:222",
        blob: "A".repeat(500),
        token: "gsk_abcdefghijklmnopqrstuvwxyz",
        note: "used sk-abcdefghijklmnopqrstuvwxyz1234 once",
      }),
    );
    expect(s).not.toMatch(/AIzaSyD|abc\.def|12345|222|gsk_|sk-abc/);
    expect(s).toMatch(/key=\*\*\*/);
    expect(s).toMatch(/<data>/);
    expect(s).toMatch(/S:\* X:\* Y:\*/);
  });
  it("keeps the numbers that explain a problem", () => {
    const out = sanitize({ attacker: { total: 1738596, dead: 864 }, verified: false, problems: ["readings of the battle disagree"] });
    expect(out).toEqual({ attacker: { total: 1738596, dead: 864 }, verified: false, problems: ["readings of the battle disagree"] });
  });
});

describe("the log itself", () => {
  it("does nothing when switched off", () => {
    setLogEnabled(false);
    log("x");
    expect(_entries()).toHaveLength(0);
  });
  it("groups a run's entries so one analysis can be copied alone", () => {
    const a = newRun();
    log("analyze.start", { images: 2 });
    log("provider.fail", { provider: "groq", message: "HTTP 429" }, "warn");
    const b = newRun();
    log("analyze.start", { images: 3 });
    const text = debugReport({ run: a });
    expect(text).toMatch(/Grand Strategy Analyzer/);
    expect(text).toMatch(/\[.{4}\] analyze.start images=2/);
    expect(text).toMatch(/WARN provider.fail provider=groq message=HTTP 429/);
    expect(text).not.toMatch(/images=3/);
    expect(a).not.toBe(b);
  });
  it("keeps only the most recent entries", () => {
    for (let i = 0; i < 700; i++) log("e", { i });
    expect(_entries()).toHaveLength(500);
    expect(formatEntry(_entries()[_entries().length - 1])).toMatch(/e i=699/);
  });
});

describe("the provider chain is explained in the log", () => {
  it("records each attempt, the failure reason and who finally answered, without the key", async () => {
    retry.delayMs = 0;
    newRun();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("generativelanguage")
          ? new Response('{"error":{"message":"Quota exceeded for key=AIzaSyD-SECRET-SECRET-SECRET-1234"}}', { status: 429 })
          : new Response(JSON.stringify({ model: "m", choices: [{ message: { content: '{"ok":1}' } }] }), { status: 200 }),
      ),
    );
    await analyzeWithFallback(
      [
        { id: "gemini", config: { apiKey: "AIzaSyD-SECRET-SECRET-SECRET-1234", model: "gemini-2.5-flash" } },
        { id: "openrouter", config: { apiKey: "sk-or-secret-secret-secret", model: "x" } },
      ],
      { images: [], systemPrompt: "s", userPrompt: "u" },
    );
    const text = debugReport({ last: 50 });
    expect(text).toMatch(/provider.try provider=gemini/);
    expect(text).toMatch(/WARN provider.fail provider=gemini .*status=429/);
    expect(text).toMatch(/provider.ok provider=openrouter/);
    expect(text).not.toMatch(/AIzaSyD|sk-or-secret/);
  });
});
