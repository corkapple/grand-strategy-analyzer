import { afterEach, describe, expect, it, vi } from "vitest";
import { getText, postJson } from "./http";

afterEach(() => vi.unstubAllGlobals());

/** A response whose headers arrive but whose body never finishes. */
const stalledBody = () =>
  new Response(new ReadableStream({ start() {} }), { status: 200, headers: { "content-type": "application/json" } });

describe("http layer", () => {
  it("does not send a request when the signal is already aborted", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const ctl = new AbortController();
    ctl.abort();
    await expect(postJson("gemini", "https://x.test/a", {}, {}, ctl.signal)).rejects.toThrow("Cancelled.");
    expect(f).not.toHaveBeenCalled();
  });

  it("times out when the body stalls after the headers arrive", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => stalledBody()));
    await expect(postJson("gemini", "https://x.test/a", {}, {}, undefined, 200)).rejects.toThrow(/Timed out reading the reply/);
  });

  it("turns a non-JSON 200 reply into a readable error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Bad gateway</html>", { status: 200 })));
    await expect(postJson("openrouter", "https://x.test/a", {})).rejects.toThrow(/Could not read the reply from openrouter/);
  });

  it("reports 429 with the retry hint and no raw JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"error":{"message":"quota. Please retry in 9h59m41.38s."}}', { status: 429 })),
    );
    await expect(postJson("gemini", "https://x.test/a", {})).rejects.toThrow(/free quota reached \(HTTP 429\); it says to retry in 9h59m41s\.$/);
  });

  it("refuses non-https page fetches", async () => {
    await expect(getText("http://insecure.test/")).rejects.toThrow(/https/);
  });
});
