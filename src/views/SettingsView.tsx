import { useState } from "react";
import { PROVIDER_LIST, getProvider, type ProviderId } from "@/lib/providers";
import { openSiteForLogin } from "@/lib/providers/browserBridge";
import { listFreeVisionModels } from "@/lib/providers/openrouterModels";
import { SYSTEM_PROMPT } from "@/lib/prompt";
import { DEFAULT_STRATEGY } from "@/lib/strategy";
import { COMMUNITY_URL } from "@/lib/community/config";
import { useCommunity } from "@/store/community";
import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "@/lib/secrets";
import { signInToPuter } from "@/lib/providers/puter";
import { clearMemoryLog, recentLogText } from "@/lib/log";
import { copyText } from "@/lib/providers/clipboard";
import { CURRENT_VERSION, useUpdater } from "@/store/updater";
import { useSettings } from "@/store/settings";

const GROUP_LABEL = {
  "free-api": "Free API tier",
  "paid-api": "Paid cloud API",
  local: "Local (self-hosted)",
  "no-api": "No API key",
} as const;

export default function SettingsView() {
  const s = useSettings();
  const [testMsg, setTestMsg] = useState<string>("");
  const [freeModels, setFreeModels] = useState<{ id: string; name: string }[]>([]);
  const provider = getProvider(s.activeProvider);
  const cfg = s.providers[s.activeProvider];
  const up = (patch: Parameters<typeof s.updateProvider>[1]) =>
    s.updateProvider(s.activeProvider, patch);

  const test = async () => {
    setTestMsg("Testing…");
    try {
      setTestMsg(
        provider.testConnection ? await provider.testConnection(cfg) : "No test available for this provider.",
      );
    } catch (e) {
      setTestMsg((e as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <section className="card space-y-3">
        <label className="block text-sm font-medium">Provider</label>
        <select
          className="input"
          value={s.activeProvider}
          onChange={(e) => {
            s.setActiveProvider(e.target.value as ProviderId);
            setTestMsg("");
          }}
        >
          {(Object.keys(GROUP_LABEL) as (keyof typeof GROUP_LABEL)[]).map((g) => (
            <optgroup key={g} label={GROUP_LABEL[g]}>
              {PROVIDER_LIST.filter((p) => p.group === g && !p.capabilities.textOnly).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {provider.capabilities.notes && (
          <p className="text-xs text-zinc-400">{provider.capabilities.notes}</p>
        )}

        {provider.capabilities.requiresApiKey && (
          <Field label="API key">
            <input
              className="input"
              type="password"
              autoComplete="off"
              value={cfg.apiKey ?? ""}
              onChange={(e) => up({ apiKey: e.target.value })}
            />
            <span className="text-xs text-zinc-500">
              {!inTauri
                ? "Stored in this browser only; it is sent to nowhere except the AI service you chose."
                : s.keychain
                  ? "Stored in your OS keychain."
                  : "Stored in app storage (OS keychain unavailable)."}
              {inTauri && s.secretsError && <span className="text-amber-400"> Keychain: {s.secretsError}</span>}
              {!inTauri && s.activeProvider === "github" && (
                <span className="text-amber-400"> GitHub Models does not allow web pages to call it; use the desktop app, or pick another provider.</span>
              )}
            </span>
          </Field>
        )}
        {!provider.capabilities.manual && (
          <>
            {provider.id === "puter" ? (
              <p className="text-xs text-amber-400">
                Puter needs a one-time sign-in: use the "Free backup AI with no API key (Puter)" card further down this page.
                {!s.providers.puter?.extra?.signedIn && " You are not signed in yet."}
              </p>
            ) : (
              <Field label="Base URL">
                <input
                  className="input"
                  value={cfg.baseUrl ?? ""}
                  onChange={(e) => up({ baseUrl: e.target.value })}
                />
              </Field>
            )}
            {provider.id !== "browser" && (
              <Field label="Model">
                <input
                  className="input"
                  value={cfg.model ?? ""}
                  onChange={(e) => up({ model: e.target.value })}
                />
              </Field>
            )}
            {provider.id === "openrouter" && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <button
                  className="btn"
                  onClick={async () => {
                    setTestMsg("Loading free vision models…");
                    try {
                      const list = await listFreeVisionModels(cfg.baseUrl?.trim() || undefined);
                      setFreeModels(list);
                      setTestMsg(`${list.length} free vision models found.`);
                    } catch (e) {
                      setTestMsg((e as Error).message);
                    }
                  }}
                >
                  Load free vision models
                </button>
                {freeModels.length > 0 && (
                  <select
                    className="input w-auto"
                    value={freeModels.some((m) => m.id === cfg.model) ? cfg.model : ""}
                    onChange={(e) => e.target.value && up({ model: e.target.value })}
                  >
                    <option value="">Pick a model…</option>
                    {freeModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.id}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </>
        )}
        {provider.id === "browser" && (
          <Field label="Web chat site">
            <select
              className="input"
              value={cfg.extra?.site ?? "gemini"}
              onChange={(e) => up({ extra: { ...cfg.extra, site: e.target.value } })}
            >
              <option value="gemini">Gemini (gemini.google.com)</option>
              <option value="chatgpt">ChatGPT (chatgpt.com)</option>
              <option value="deepseek">DeepSeek (chat.deepseek.com)</option>
            </select>
          </Field>
        )}
        <div className="flex items-center gap-3">
          {provider.testConnection && (
            <button className="btn" onClick={test}>
              Test connection
            </button>
          )}
          {provider.id === "browser" && (
            <button
              className="btn"
              onClick={async () => {
                setTestMsg("Opening…");
                try {
                  await openSiteForLogin(cfg);
                  setTestMsg("Opened. Sign in in the browser window that appeared, then come back here and analyze.");
                } catch (e) {
                  setTestMsg((e as Error).message);
                }
              }}
            >
              Open site to log in
            </button>
          )}
          <span className="text-xs text-zinc-400">{testMsg}</span>
        </div>
      </section>

      <section className="card space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={s.localFirst} onChange={(e) => s.setLocalFirst(e.target.checked)} />
          Read screenshots on this computer first, and use an AI service only when the numbers can't be verified
        </label>
        <p className="text-xs text-zinc-500">
          Private and instant, with no key or quota used. The app reads each screenshot twice and checks every number
          against the game's own totals; if anything doesn't match, it asks your AI service as before. It is also the last
          resort when every online service is unavailable (marked as unverified).
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={s.fallbackEnabled}
            onChange={(e) => s.setFallbackEnabled(e.target.checked)}
          />
          If the main provider fails (quota, outage, timeout), try a second one automatically
        </label>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-zinc-400">Second provider</span>
          <select
            className="input w-auto"
            value={s.fallbackProvider}
            onChange={(e) => s.setFallbackProvider(e.target.value as ProviderId)}
          >
            {PROVIDER_LIST.filter((p) => !p.capabilities.manual && p.id !== "browser").map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={s.autoFallback} onChange={(e) => s.setAutoFallback(e.target.checked)} />
          Then also try my other free providers that have a key (Gemini, OpenRouter, Groq, GitHub Models)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={s.meshGuides} onChange={(e) => s.setMeshGuides(e.target.checked)} />
          Use the public Mesh LLM network (no key) as a last resort for reading game guides
        </label>
        <p className="text-xs text-zinc-500">
          Mesh runs on volunteers' computers and only reads public guide text. It never receives your screenshots.
        </p>
        <p className="text-xs text-zinc-500">
          Your screenshots and guide text are sent to the second provider only when the main one fails. It needs its
          own key under Settings → Provider. Gemini's free tier allows only a small number of requests per day per
          model, so a second free provider keeps the app working.
        </p>
      </section>

      <PuterSettings />
      {inTauri && <UpdateSettings />}

      <DiagnosticsSettings />

      <CommunitySettings />

      <section className="card">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={s.saveHistory}
            onChange={(e) => s.setSaveHistory(e.target.checked)}
          />
          Save analyses and small screenshot thumbnails to History (stored only on this computer)
        </label>
      </section>

      <section className="card space-y-2">
        <label className="block text-sm font-medium">Playbook: acceptable losses</label>
        <p className="text-xs text-zinc-400">
          A win counts as a good precedent when your real losses (wounded + dead) stay under this share of your
          army. Anything lower is fine; "a win is a win".
        </p>
        <Field label="Loss cap (% of your army)">
          <input
            className="input"
            type="number"
            min={1}
            max={100}
            value={Math.round(s.lossCap * 100)}
            onChange={(e) => s.setLossCap(Math.min(1, Math.max(0.01, Number(e.target.value) / 100)))}
          />
        </Field>
      </section>

      <section className="card space-y-2">
        <label className="block text-sm font-medium">Custom vision prompt (appended to the built-in one)</label>
        <textarea
          className="input h-24"
          value={s.customPrompt}
          onChange={(e) => s.setCustomPrompt(e.target.value)}
          placeholder="e.g. The game UI is in Finnish."
        />
        <details className="text-xs text-zinc-400">
          <summary className="cursor-pointer">Built-in system prompt</summary>
          <pre className="mt-2 whitespace-pre-wrap">{SYSTEM_PROMPT}</pre>
        </details>
      </section>

      <section className="card space-y-2">
        <label className="block text-sm font-medium">Solo-attack thresholds</label>
        {(
          [
            ["soloMaxTraps", "Max traps for solo"],
            ["soloMaxAssociates", "Max associates for solo"],
            ["soloMaxWall", "Max wall durability for solo"],
          ] as const
        ).map(([k, label]) => (
          <Field key={k} label={label}>
            <input
              className="input"
              type="number"
              value={s.strategy.thresholds[k]}
              onChange={(e) =>
                s.setStrategy({
                  ...s.strategy,
                  thresholds: { ...s.strategy.thresholds, [k]: Number(e.target.value) },
                })
              }
            />
          </Field>
        ))}
        <button className="btn" onClick={() => s.setStrategy(DEFAULT_STRATEGY)}>
          Reset strategy defaults
        </button>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="text-zinc-400">{label}</span>
      {children}
    </label>
  );
}


function CommunitySettings() {
  const s = useSettings();
  const last = useCommunity((c) => c.lastSample);
  const [show, setShow] = useState(false);
  return (
    <section className="card space-y-2">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={s.shareResults} onChange={(e) => s.setShareResults(e.target.checked)} />
        Share anonymous results to improve suggestions for everyone (on by default)
      </label>
      {!COMMUNITY_URL && (
        <p className="text-xs text-amber-400">This build has no community server configured, so nothing is sent.</p>
      )}
      <p className="text-xs text-zinc-400">
        <b>Sent</b> after a battle that has a matching recon: result, defender troop mix in whole percent, both army sizes
        (rounded to 50,000), your formation, loss percentages, building level, and the app version and date.
        <br />
        <b>Never sent</b>: screenshots, player or alliance names, coordinates, server, exact times, your API keys or
        anything else. The community stats you see in History are built from everyone's numbers.
      </p>
      <button className="text-xs text-zinc-400 underline" onClick={() => setShow(!show)}>
        {show ? "Hide" : "Show"} the last payload
      </button>
      {show && (
        <pre className="max-h-48 overflow-auto rounded border border-border p-2 text-xs text-zinc-300">
          {last ? JSON.stringify(last, null, 2) : "Nothing has been sent yet."}
        </pre>
      )}
    </section>
  );
}

function PuterSettings() {
  const s = useSettings();
  const cfg = s.providers.puter ?? { extra: {} };
  const signedIn = !!cfg.extra?.signedIn;
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <section className="card space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium">Free backup AI with no API key (Puter)</span>
        {signedIn ? <span className="text-green-400">Signed in. It is used when your other AIs are out of quota.</span> : <span className="text-zinc-400">Not signed in.</span>}
        <button
          className="btn"
          onClick={async () => {
            setMsg("Opening Puter's sign-in window…");
            try {
              const ok = await signInToPuter();
              s.updateProvider("puter", { extra: { signedIn: ok ? "1" : "" } });
              setMsg(ok ? "Signed in." : "Sign-in was not completed.");
            } catch (e) {
              setMsg(String((e as Error)?.message ?? e));
            }
          }}
        >
          {signedIn ? "Sign in again" : "Sign in to Puter"}
        </button>
        {signedIn && (
          <button className="btn" onClick={() => s.updateProvider("puter", { extra: { signedIn: "" } })}>
            Turn off
          </button>
        )}
        {msg && <span className="text-xs text-zinc-400">{msg}</span>}
      </div>
      <p className="text-xs text-zinc-500">
        Puter gives free AI that can read screenshots without any API key. You sign in once with a free Puter account; that account pays from
        its own free monthly allowance. When on, your screenshots can be sent to Puter and the model's vendor if your other AIs fail, so leave
        it off if you would rather not. Model: <input className="input inline w-64 py-0" value={cfg.model ?? ""} onChange={(e) => s.updateProvider("puter", { model: e.target.value })} />
      </p>
    </section>
  );
}

function UpdateSettings() {
  const s = useSettings();
  const up = useUpdater();
  return (
    <section className="card space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium">App updates</span>
        <span className="text-zinc-400">You have version {CURRENT_VERSION}.</span>
        <button className="btn" disabled={up.status === "checking" || up.status === "downloading"} onClick={() => void up.check(true)}>
          {up.status === "checking" ? "Checking…" : "Check for updates"}
        </button>
        {up.status === "uptodate" && <span className="text-green-400">You have the latest version.</span>}
        {up.status === "available" && (
          <>
            <span className="text-amber-400">Version {up.version} is available.</span>
            <button className="btn btn-primary" onClick={() => void up.install()}>
              Install and restart
            </button>
          </>
        )}
        {up.status === "error" && <span className="text-red-400">{up.error}</span>}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={s.checkUpdates} onChange={(e) => s.setCheckUpdates(e.target.checked)} />
        Look for updates automatically
      </label>
      <p className="text-xs text-zinc-500">
        Updates are signed. The app checks the signature with a key built into it and installs nothing that doesn't match.
      </p>
    </section>
  );
}

function DiagnosticsSettings() {
  const s = useSettings();
  const [msg, setMsg] = useState("");
  const desktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  return (
    <section className="card space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium">Diagnostic log</span>
        <button
          className="btn"
          onClick={async () => {
            const text = await recentLogText();
            await copyText(text);
            setMsg(`Copied ${text.split("\n").length} lines. Paste them when asking for help.`);
          }}
        >
          Copy recent log
        </button>
        {desktop && (
          <button className="btn" onClick={() => void invoke("log_reveal").catch((e) => setMsg(String(e)))}>
            Open log folder
          </button>
        )}
        <button
          className="btn"
          onClick={async () => {
            clearMemoryLog();
            if (desktop) await invoke("log_clear").catch(() => undefined);
            setMsg("Log cleared.");
          }}
        >
          Clear log
        </button>
        {msg && <span className="text-xs text-zinc-400">{msg}</span>}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={s.keepLog} onChange={(e) => s.setKeepLog(e.target.checked)} />
        Keep a diagnostic log on this computer
      </label>
      <p className="text-xs text-zinc-500">
        It records what the app did (which service answered, what failed and why, what numbers were repaired) so a problem can be
        fixed from a few lines of text. It never contains your API keys, screenshots, coordinates, server number or player names,
        and it is never sent anywhere unless you paste it yourself. After an analysis, <b>Copy debug info</b> next to the Analyze
        button copies just that run.
      </p>
    </section>
  );
}
