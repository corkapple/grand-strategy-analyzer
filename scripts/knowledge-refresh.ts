// Daily job (run by .github/workflows/knowledge.yml): reads the guide pages listed in data/knowledge-sources.json,
// asks Gemini to extract facts, keeps only facts whose quote is found word-for-word on the page, and writes
// data/knowledge.json. Every copy of the app (browser and desktop) reads that file; users still accept each fact.
//
// Run:  GEMINI_API_KEY=... npx tsx scripts/knowledge-refresh.ts   (add FORCE=1 to re-read unchanged pages)
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXTRACT_SYSTEM_PROMPT, MAX_PAGE_CHARS, buildExtractPrompt, htmlToText, verifyFacts, type KnowledgeEntry } from "../src/lib/knowledgeCore";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCES = path.join(root, "data", "knowledge-sources.json");
const OUT = path.join(root, "data", "knowledge.json");
const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const key = process.env.GEMINI_API_KEY;

interface SourceState {
  url: string;
  label: string;
  hash?: string;
  checkedAt?: string;
  status?: string;
}
interface Stored extends Omit<KnowledgeEntry, "status" | "chart"> {}
interface File {
  generatedAt: string | null;
  sources: SourceState[];
  entries: Stored[];
}

const sources: { url: string; label: string }[] = JSON.parse(fs.readFileSync(SOURCES, "utf8"));
const prev: File = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { generatedAt: null, sources: [], entries: [] };
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const idOf = (url: string, statement: string) => sha(`${url}|${statement.toLowerCase().replace(/\s+/g, " ")}`).slice(0, 16);

async function askGemini(userPrompt: string): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${process.env.GEMINI_BASE ?? "https://generativelanguage.googleapis.com"}/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key! },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: EXTRACT_SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json" },
      }),
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
    const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text) throw new Error("Gemini returned no text");
    return text;
  }
  throw new Error("Gemini is busy; will retry tomorrow");
}

const outSources: SourceState[] = [];
let entries: Stored[] = [...prev.entries];

for (const src of sources) {
  const old = prev.sources.find((s) => s.url === src.url);
  const state: SourceState = { ...src, hash: old?.hash, checkedAt: new Date().toISOString() };
  try {
    if (!/^https:\/\//.test(src.url)) throw new Error("not https");
    const res = await fetch(src.url, { headers: { Accept: "text/html,*/*", "User-Agent": "grand-strategy-analyzer-knowledge-job" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = htmlToText(await res.text()).slice(0, MAX_PAGE_CHARS);
    if (text.length < 300) throw new Error("page has almost no readable text");
    state.hash = sha(text);
    if (state.hash === old?.hash && !process.env.FORCE) {
      state.status = "unchanged";
    } else if (!key) {
      throw new Error("GEMINI_API_KEY is not set");
    } else {
      const { entries: found, dropped } = verifyFacts(await askGemini(buildExtractPrompt(src.url, text)), text, src);
      const mine = found.map((e) => ({
        id: idOf(src.url, e.statement),
        kind: e.kind,
        statement: e.statement,
        quote: e.quote,
        sourceUrl: e.sourceUrl,
        sourceTitle: e.sourceTitle,
        fetchedAt: Date.now(),
        ...(e.counter ? { counter: e.counter } : {}),
        ...(e.formation ? { formation: e.formation } : {}),
      }));
      // Facts already published keep their id and date; the rest of this source's facts are replaced.
      const keep = new Map(prev.entries.filter((e) => e.sourceUrl === src.url).map((e) => [e.id, e]));
      entries = entries.filter((e) => e.sourceUrl !== src.url).concat(mine.map((e) => keep.get(e.id) ?? e));
      state.status = `${mine.length} facts, ${dropped} discarded (quote not on the page)`;
    }
  } catch (e) {
    state.hash = old?.hash; // retry next run
    state.status = `failed: ${e instanceof Error ? e.message : String(e)}`;
  }
  console.log(`${src.label}: ${state.status}`);
  outSources.push(state);
}

// Drop facts of sources that were removed from the list.
const urls = new Set(sources.map((s) => s.url));
entries = entries.filter((e) => urls.has(e.sourceUrl));
const file: File = { generatedAt: new Date().toISOString(), sources: outSources, entries };
const changed = JSON.stringify({ ...file, generatedAt: null, sources: file.sources.map((s) => ({ ...s, checkedAt: null })) }) !==
  JSON.stringify({ ...prev, generatedAt: null, sources: prev.sources.map((s) => ({ ...s, checkedAt: null })) });
if (changed || !fs.existsSync(OUT)) fs.writeFileSync(OUT, JSON.stringify(file, null, 2) + "\n");
console.log(changed ? `wrote ${entries.length} facts` : "no changes");
