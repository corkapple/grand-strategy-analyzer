# Privacy: what leaves your computer

## Your screenshots

When you click **Analyze**, the app first reads your screenshots **on your own computer**. Nothing is sent anywhere
if that reading checks out. Only when it can't verify the numbers is a screenshot sent to the AI service you picked
(Google Gemini, OpenRouter and so on) so it can read them; that service's own privacy rules then apply. When you send a battle with its Battle Details screen and no recon, the app asks an AI service to read those
screenshots, because the troop icons on Battle Details need an AI to tell apart. The screenshots
are **never** sent to the app's makers. You can switch the on-device reading off in Settings. A small thumbnail is stored in your own **History** on your computer.

## Your keys and history

- Your API keys live in your computer's keychain.
- Your History, playbook and settings live in the app's storage on your computer. **Delete all** in History clears it.

## Anonymous community stats

This is **on by default** so everyone's advice can get better. You can switch it off any time in
**Settings → Share anonymous results**.

**What is sent**, once per battle that has a matching recon:
- win or loss
- the enemy's troop mix, in whole percentages
- both army sizes, rounded to the nearest 50,000
- the formation you used and which troop type led the attack
- your losses and the enemy's losses as percentages
- building level, the app version and the date

**What is never sent:** screenshots, player or alliance names, coordinates, server, exact times, your keys, or anything
about your computer.

Each battle is shared **once**, even if you analyze the same screenshots again; the app keeps one record per fight.

Settings has **Show the last payload**, so you can see exactly what was sent.

**How it is handled:** the data goes to a small server that checks it, drops anything unexpected, and does not store
your IP address. A daily job collects the anonymous numbers into a statistics file that every copy of the app reads.
The counter chart (what beats what) is fixed and cannot be changed by this data.

## Game guides

If you use the **Knowledge** tab, the app downloads the guide pages in your list and asks an AI service to read them.
Nothing from your own data is included. If your AI services are out of requests, the app may use the public
**Mesh LLM** network, which runs on volunteers' computers, to read the same public guide text. Your screenshots are
**never** sent to Mesh. You can turn this off in **Settings → "Use the public Mesh LLM network…"**.
