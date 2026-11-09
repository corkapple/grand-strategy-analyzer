// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
let nextUpdate: unknown = null;
let checkError: Error | null = null;
vi.mock("@tauri-apps/plugin-updater", () => ({
  check: async () => {
    if (checkError) throw checkError;
    return nextUpdate;
  },
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: async () => void calls.push("relaunch") }));
vi.mock("@/lib/secrets", () => ({ inTauri: true, KEYS_ACCOUNT: "k", apiKeyAccount: (i: string) => i, getSecret: async () => null, setSecret: async () => undefined }));

beforeEach(() => {
  calls.length = 0;
  nextUpdate = null;
  checkError = null;
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  vi.resetModules();
});

const update = (over: Record<string, unknown> = {}) => ({
  version: "0.2.0",
  body: "Better reading of Battle Details",
  downloadAndInstall: async (cb: (e: unknown) => void) => {
    cb({ event: "Started", data: { contentLength: 100 } });
    cb({ event: "Progress", data: { chunkLength: 40 } });
    cb({ event: "Progress", data: { chunkLength: 60 } });
    cb({ event: "Finished" });
    calls.push("installed");
  },
  ...over,
});

describe("app updates", () => {
  it("offers a newer version with its notes", async () => {
    nextUpdate = update();
    const { useUpdater } = await import("./updater");
    await useUpdater.getState().check();
    expect(useUpdater.getState()).toMatchObject({ status: "available", version: "0.2.0", notes: "Better reading of Battle Details" });
  });
  it("says you are up to date when there is nothing newer", async () => {
    const { useUpdater } = await import("./updater");
    await useUpdater.getState().check(true);
    expect(useUpdater.getState().status).toBe("uptodate");
  });
  it("stays quiet when the server cannot be reached, unless you asked", async () => {
    checkError = new Error("error sending request: could not resolve host");
    const { useUpdater } = await import("./updater");
    await useUpdater.getState().check(false);
    expect(useUpdater.getState()).toMatchObject({ status: "idle", error: null });
    await useUpdater.getState().check(true);
    expect(useUpdater.getState().status).toBe("error");
    expect(useUpdater.getState().error).toMatch(/Could not reach the update server/);
  });
  it("downloads, installs and restarts, reporting progress", async () => {
    nextUpdate = update();
    const { useUpdater } = await import("./updater");
    await useUpdater.getState().check();
    await useUpdater.getState().install();
    expect(calls).toEqual(["installed", "relaunch"]);
    expect(useUpdater.getState().progress).toBe(1);
  });
  it("refuses and explains when the signature does not match", async () => {
    nextUpdate = update({
      downloadAndInstall: async () => {
        throw new Error("the signature verification failed");
      },
    });
    const { useUpdater } = await import("./updater");
    await useUpdater.getState().check();
    await useUpdater.getState().install();
    expect(calls).not.toContain("relaunch");
    expect(useUpdater.getState().status).toBe("error");
    expect(useUpdater.getState().error).toMatch(/signature did not match/);
  });
  it("lets you close the banner for one version only", async () => {
    nextUpdate = update();
    const { useUpdater } = await import("./updater");
    await useUpdater.getState().check();
    useUpdater.getState().dismiss();
    expect(useUpdater.getState().dismissed).toBe("0.2.0");
  });
  it("does nothing outside the desktop app", async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    vi.resetModules();
    nextUpdate = update();
    const { useUpdater } = await import("./updater");
    await useUpdater.getState().check(true);
    expect(useUpdater.getState().status).toBe("idle");
  });
});
