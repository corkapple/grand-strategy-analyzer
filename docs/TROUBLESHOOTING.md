# Troubleshooting

## How to ask for help (without screenshots)

After an analysis that went wrong, click **Copy debug info** next to the Analyze button and paste the text where you are asking for
help. It is a few short lines: which services were tried, why each failed, who answered, and the numbers that were read or repaired.
For something that happened earlier, use **Settings → Copy recent log**. **Open log folder** shows the file itself.

The log stays on your computer. It never contains your API keys, your screenshots, coordinates, the server number or player
names. It is only shared if you paste it yourself, and you can switch it off in Settings.

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

## Every provider failed

Add more free providers in **Settings** (see [Get a free key](FREE-KEY.md#more-free-options-extra-backups)). The app tries each
one you added a key for. As a last resort use **Finish in a web chat instead**.

## "Could not reach the update server" or the update won't install

Check your internet connection and try **Settings → Check for updates** again. If the message says the update's signature did
not match, nothing was installed; wait a little and try again, or install the newest version from the Releases page.

## The Mac keeps asking for my password (Keychain)

It is asking permission to read your saved key. Click **Always Allow**. You may see it again after an update.

## The result says "on-device reader (unverified)"

Every AI service was unavailable, so the app gave you its own best reading of the screenshot. It could not confirm the
numbers against the game's totals, so it shows them but **does not save them**. Compare the key numbers with your
screenshot, then click **Save anyway** if they are right, or try again later when an AI service is available.

## The app used the AI even though I want everything on my computer

The on-device reader only answers when every number checks out. A blurry or cropped screenshot, or a screen the app
doesn't know, makes it hand over to the AI service. Clear, uncropped screenshots work best. To never use an AI service,
remove your keys in Settings. The app then gives you the on-device reading, marked unverified when it isn't certain.

## "temporarily unavailable or overloaded" (error 503)

That AI service is busy right now. The app waits a moment and tries it once more, then moves on to your next provider.
You don't need to do anything.

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

## A battle shows "no matching recon"

Send the **Battle Details** screen together with the victory mail. The app then uses the enemy troops shown there as the
enemy mix. Or send a recon of the same target before the attack. See "No recon? That works too" in [Using the app](USING-THE-APP.md).

## History says I led with the wrong troops

Include the **Battle Details** screenshot with the victory mail. Without it the app has to guess from the formation
name: "Hitman - Wedge" counts as Hitmen, "Hitman - Square" as Bikers, "Bruiser - Wedge" as Bruisers. If you use other
formations, add Battle Details so the app can see the real troops.

## Nothing under "Community results"

It fills in once at least 10 attacks share the same enemy type and formation. Until then it simply says there isn't
enough data yet.

## Still stuck?

Open an **Issue** on the repository page and describe what you did and what you saw. **Don't include your key.**
