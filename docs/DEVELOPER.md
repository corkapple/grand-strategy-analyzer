# Developer guide

Technical notes for people building or changing the app. Players: see the [main page](../README.md).


Desktop app (Tauri v2 + React + TypeScript + Tailwind) that reads *The Grand Mafia* recon/victory
screenshots with a vision LLM and suggests an attack plan.

## Layout

```
src/
  lib/
    providers/        LLMProvider abstraction
      types.ts          LLMProvider, VisionRequest/Response, ProviderConfig
      http.ts           Tauri HTTP (no CORS) + helpers
      openaiCompatible.ts  OpenAI, OpenRouter, DeepSeek, LM Studio/LocalAI
      gemini.ts  anthropic.ts  ollama.ts
      browserBridge.ts  API-less: talks to bridge/ (Playwright)
      clipboard.ts      API-less: copy prompt, paste reply back
      registry.ts       provider list + default configs
    prompt.ts         strict-JSON vision system prompt
    schema.ts         zod schema + tolerant JSON extraction/validation
    strategy.ts       counter composition, formation, solo/rally verdict, chat text
    analyze.ts        runVision(): provider-agnostic entry point
  store/settings.ts   persisted settings (zustand)
  views/ components/  Analyzer + Settings UI
bridge/             Node + Playwright web-chat driver (separate package)
src-tauri/          Rust shell (http + clipboard plugins)
```

## Setup

Prereqs: Node 20+, Rust (https://rustup.rs). Windows also needs MSVC Build Tools + WebView2;
macOS needs Xcode Command Line Tools (`xcode-select --install`).

```bash
npm install
npx tauri icon path/to/icon-1024.png   # generates src-tauri/icons (required for builds)
npm run tauri:dev
```

### Building the apps

The app bundles its own Node runtime and the browser bridge, so end users need nothing installed
except Google Chrome or Microsoft Edge (only for "Browser Web Automation" mode).

- **macOS (on a Mac):** `npm run tauri:build:mac-arm` (Apple Silicon) or `npm run tauri:build:mac-intel`
  (needs `rustup target add x86_64-apple-darwin`). Output: `src-tauri/target/<target>/release/bundle/`
  (`macos/*.app`, `dmg/*.dmg`).
- **Windows:** must be built on Windows. Easiest: push this project to GitHub and run the
  "Build desktop apps" workflow (`.github/workflows/build.yml`); it builds Windows plus both Mac
  architectures and attaches the installers as downloadable artifacts. On a Windows PC with Rust and
  MSVC Build Tools you can also run `npm run tauri:build:win`.
- Builds are **unsigned**. macOS: right-click the app, choose Open the first time (or
  `xattr -dr com.apple.quarantine "/Applications/Grand Strategy Analyzer.app"`). Windows SmartScreen:
  More info, then Run anyway. Removing these warnings needs an Apple Developer ID / a code-signing
  certificate.

### Browser mode

Nothing to start by hand: the app launches the bridge when needed and stops it on exit. In Settings choose
"Browser Web Automation", click **Open site to log in** once and sign in; the login is kept in the app's
data folder. If Google blocks sign-in in the automation window, use the Gemini API instead.
Developers can still run `npm run bridge` / `npm run bridge:check` manually.

## History

Every successful analysis can be saved (Settings: "Save analyses ... to History", on by default) as
parsed data plus small screenshot thumbnails, in the app's local IndexedDB. Drop every screenshot of an
attack at once (recon, Victory/Defeat mail, Battle Details, Buff Comparison, even a "Recon Failed" mail);
the app sorts them and saves the recon and the battle separately. A failed recon means a full 100% Bikers raid.
The History tab pairs each battle with the latest earlier recon of the same coordinates and tabulates
enemy mix vs. your lead troop, wins, real losses (wounded + dead; the headline "Losses" figure includes
casualties the game reduced), and whether you followed the app's advice.

The app does **not** learn on its own. The "Your rules vs. your results" panel compares the fixed counter
rules with your logged battles and proposes changes (use another counter, move a solo limit); nothing
changes until you click Apply. It needs 5+ battles per matchup, ignores mixed defenses and battles where
your Crew ATK buff led by more than 200 points, and checks solo limits only for battles you label Solo/Rally. Nothing is uploaded except
what your chosen AI provider receives during analysis.

### Playbook

Under every recon result the app shows "Your playbook": your own past wins against similar defenses (same troop
mix, similar size and building level) with the formation, army size, force ratio and real losses, plus how
many associates it would take to repeat each one here. Enter your available associates to see whether you
have enough. A win counts as good when real losses stay under the loss cap (Settings, default 10%); wins
above it are counted as costly and defeats are counted too. Wins against the matchup chart are labelled
as such, since buffs or numbers may explain them. With no logged defeats, force ratios are amounts that were
enough, not proven minimums.

### Knowledge updates

The Knowledge tab keeps a list of guide URLs (default: the note.com formation article). On launch (every
7 days by default) and on "Check now", the app downloads each page, skips it if unchanged, and asks your
active API provider (Gemini or OpenRouter free) to extract facts. Safeguards: the page text is treated as
untrusted data; every fact must include a quote that appears verbatim on the page, otherwise it is discarded;
formations must be one of the six real names; facts that contradict the in-game matchup chart cannot be
accepted; and nothing affects the recommendations until you click Accept. Accepted formation advice
replaces the default formation for that lead troop type. Only pages in the list are fetched. "Find new guides" (needs a Gemini key) uses
Gemini's Google Search tool to suggest more pages; a suggestion must be on a site the search returned, be a public
https page, load, and mention the game, and it is only added when you click Add.

### Provider fallback

Settings has "If the main provider fails, try a second one automatically" (on by default, second provider
OpenRouter). It applies to screenshot analysis and to guide reading. It moves on after quota/rate limits,
timeouts and outages, but not after a bad key or an empty account, and never after you cancel. The result shows
when a fallback answered. Gemini's free tier allows only a small number of requests per day per model (the
limit seen was 20 for gemini-2.5-flash), so keeping a second free provider configured is worthwhile. "Find
new guides" needs Gemini's Google Search tool and has no fallback.

## Things to verify before relying on it

- `src/lib/strategy.ts`: the counter triangle (now confirmed by the in-game Strengths & Weaknesses chart; all three types counter Mortar Cars). Guards: a majority type (50%+) gets a 100% counter, minorities under 15% are ignored when there is no majority. Only the solo thresholds are saved as settings; rules always come from the app. Original note: the counter triangle is sourced in the code comment (Bruisers > Hitmen from the
  brief, Bikers > Bruisers from the community article on formations, Hitmen > Bikers inferred). Mortar
  guidance is a placeholder. Formation advice follows that article (single-type attacks only). The solo/rally
  thresholds are my assumptions; tune them in Settings or `DEFAULT_STRATEGY`.
- Default model IDs (Gemini, OpenRouter free, DeepSeek) are editable and may be outdated. DeepSeek
  endpoints may be text-only.
- Bridge selectors in `bridge/server.mjs` are unverified starting points.
- API keys are stored in the OS keychain (macOS Keychain / Windows Credential Manager). Keys saved by
  earlier versions in localStorage are migrated automatically on first launch. In a plain browser (no
  Tauri) the keychain is unavailable and keys fall back to localStorage.

## Tests

`npm test` runs 100+ tests: parsing of messy model output, strategy guards, history pairing, insights, playbook,
knowledge verification, provider fallback, the HTTP layer, and render smoke tests of every screen. `cargo test --lib`
in `src-tauri` checks the keychain and bridge launcher.

## Community stats (shared anonymous results)

On by default, with a notice on first launch and a switch in Settings. After a battle that has a matching recon,
the app sends **numbers only**: result, defender troop mix (whole percent), both army sizes (rounded to 50,000),
formation, loss percentages, building level, app version and date. Never screenshots, names, coordinates, server,
exact times or keys. Settings can show the last payload.

How it flows: app -> Netlify Function inbox (`netlify/functions/community.mjs`, validates strictly, keeps no IP) ->
daily GitHub Action (`.github/workflows/community.yml`) archives samples in `data/samples/`, computes
`data/community-stats.json` and publishes it back -> every app shows it in History and as a line on the recon
dashboard once 10 attacks share the same enemy type and formation. The counter chart stays locked; community data
never rewrites game rules.

Setup (once): `npx netlify login`, `npx netlify sites:create`, set the `EXPORT_TOKEN` env var on the site,
`npx netlify deploy --prod --dir site --functions netlify/functions`, then set the repo variable `COMMUNITY_URL`
and secret `EXPORT_TOKEN` and rebuild.

## Regenerating the documentation screenshots

`src/dev/shots.tsx` fills the app with example data (never real data, and all network calls are answered locally).
It is compiled only in a special docs build, so release builds do not contain it.

```bash
VITE_COMMUNITY_URL=https://example.invalid npx vite build --mode docs --outDir /tmp/gsa-docs --emptyOutDir
npx vite preview --outDir /tmp/gsa-docs --port 4173
# then open http://localhost:4173/?shot=analyzer|recon|battle|history|settings|knowledge
```

The images in `docs/images/` are 800 px wide captures of those pages.
