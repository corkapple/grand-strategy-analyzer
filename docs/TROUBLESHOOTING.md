# Troubleshooting

## The app won't open

**Windows: "Windows protected your PC".** Click **More info**, then **Run anyway**. This is normal for a new app.

**Mac: "Apple could not verify…" or "cannot be opened".**
1. Drag the app into **Applications** first. Don't run it from the disk image.
2. In Applications, **right-click → Open**, then click **Open**.
3. If there is no Open button: **System Settings → Privacy & Security → Open Anyway**.

**Mac says the app is "damaged".** You have an old version. Download the latest one from the Releases page. If it still
happens, open **Terminal** and run this, then try again:

```
xattr -dr com.apple.quarantine "/Applications/Grand Strategy Analyzer.app"
```

## The Mac keeps asking for my password (Keychain)

It is asking permission to read your saved key. Click **Always Allow**. You may see it again after an update.

## "Rate limit" or "free quota reached" (error 429)

The free service has run out of requests for now. Gemini's free plan resets every day.
- Add a second provider in Settings so the app switches by itself. See [Get a free key](FREE-KEY.md).
- Or click **Finish in a web chat instead** and do it by hand.

## "Timed out" or it takes a very long time

Free services are sometimes slow. Click **Cancel** and try again, or use Gemini. If you use OpenRouter, the app tries
several free models in turn, which can take a couple of minutes when they are busy.

## "No valid JSON object found" or "could not read the reply"

The AI answered in words instead of numbers. Try **Analyze** again. If it keeps happening:
- Make sure you dropped the right screenshots (recon, or the victory mail and its details).
- Use clearer, uncropped screenshots.
- Try the other provider.

## "No usable recon"

The recon had no defense numbers (for example the target blocked recon). Send a **full 100% Bikers raid**, as the
app says.

## Gemini or OpenRouter says my key is wrong (401 or 403)

Open **Settings**, paste the key again (no spaces before or after), and click **Test connection**. Make sure the key
belongs to the service chosen under **Provider**.

## "Payment required" (402)

That service wants credit on your account. Choose a free provider, or add credit if you prefer.

## My battle isn't matched with a recon

The app matches by **target coordinates and time**. The recon must be taken **before** the attack, and no other
attack on that target may sit between the two. Do a fresh recon before each attack. A battle without a recon is still
saved.

## History says I led with the wrong troops

Include the **Battle Details** screenshot with the victory mail. Without it the app has to guess from the formation
name: "Hitman - Wedge" counts as Hitmen, "Hitman - Square" as Bikers, "Bruiser - Wedge" as Bruisers. If you use other
formations, add Battle Details so the app can see the real troops.

## Nothing under "Community results"

It fills in once at least 10 attacks share the same enemy type and formation. Until then it simply says there isn't
enough data yet.

## Still stuck?

Open an **Issue** on the repository page and describe what you did and what you saw. **Don't include your key.**
