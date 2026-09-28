# Prop Pic

A small photo game: you get a color, go find it, photograph it, and score points.

- **Daily color**: everyone gets the same color each day (1 photo).
- **Challenge a friend**: you both get the same 4 colors for the day. Take 4 photos before midnight; highest total wins.
- **Bonus items**: each color comes with 2 bonus objects (e.g. "cup", "umbrella"). If the photo contains that object *in that color*, you get extra points. Objects are recognised on-device with TensorFlow.js COCO-SSD.

## Put it online with Cloudflare (live multiplayer)

Hosted on Cloudflare, challenges sync live: everyone in a challenge sees each
other's scores and photos update automatically (every ~10 s), no link resending.
It fits in Cloudflare's free plan.

1. Sign up / log in at https://dash.cloudflare.com
2. **Workers & Pages → Create → Import a repository**, connect GitHub and pick `housedodo/prop-pic`.
3. Keep the project name `prop-pic`, choose the branch to deploy, and leave the deploy command as `npx wrangler deploy`.
4. Deploy. You get a URL like `https://prop-pic.<your-subdomain>.workers.dev` — open it on your phone.

Every push to that branch redeploys automatically.

## Run it locally

```sh
npm install
npm start            # wrangler dev → http://localhost:8787 (app + live API)
npm test
```

The app also runs on any static host (e.g. GitHub Pages) without the API. It then
falls back to *link mode*: scores travel inside the invite link, so you resend it
after each photo.

## How it works

| File | What it does |
| --- | --- |
| `public/src/colors.js` | Palette (with each color's matching range), bonus items, seeded daily picks. Everyone derives the same colors from the challenge code + date. |
| `public/src/analyze.js` | Color recognition (see below). |
| `public/src/scoring.js` | **All scoring rules and weights.** Edit `SCORING` to change how points work. |
| `public/src/detect.js` | Lazy-loads the object detector for bonus items; if it can't load, bonuses are skipped. |
| `public/src/sync.js` | Client for the live-challenge API. |
| `public/src/store.js` | Saves games on the device; builds/reads invite links. |
| `public/src/app.js` | UI. |
| `worker/index.js` | Cloudflare Worker: serves `public/` and the API. One Durable Object per challenge stores players, scores and photos. |

### Color recognition

- Pixels are converted to **OKLCh** (lightness, chroma = vividness, hue), where hue lines up with how people name colors much better than RGB.
- Each color is a **region** in that space, not a single shade: e.g. Brown = orange-ish hue but dark and muted; Orange = same hues but bright and vivid; White = very light and nearly colorless. Ranges were calibrated on named reference colors (navy, denim and sky blue all count as Blue; tan and grey count as nothing) — see the tests.
- **Noise filter**: a matching pixel only counts if most of its neighbours match too, so texture speckles and edge fringes don't add points.
- **Show what counted**: tap it under a photo to see exactly which pixels were recognised.

### Current (placeholder) scoring

Per photo, max 100 + bonuses:

- **Coverage** (up to 60): share of the photo that is the color; maxes out at 50%.
- **Accuracy** (up to 40): how good an example of the color those pixels are (hue near the ideal, vivid).
- **Bonus** (+25 each): a bonus item detected with at least 12% of its box in the color.
- Photos with under 5% of the color score 0.

### Limits

- Scores are computed on each phone and trusted by the server, so a determined friend could cheat.
- Up to 8 players per challenge. Players are identified by a random secret stored on the device; clearing browser data means rejoining as a new player.
