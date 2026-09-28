# Prop Pic

A small photo game: you get a color, go find it, photograph it, and score points.

- **Daily color**: everyone gets the same color each day (1 photo).
- **Challenge a friend**: you both get the same 4 colors for the day. Take 4 photos before midnight; highest total wins.
- **Bonus items**: each color comes with 2 bonus objects (e.g. "cup", "umbrella"). If the photo contains that object *in that color*, you get extra points. Objects are recognised on-device with TensorFlow.js COCO-SSD.

## Run it

It's a static site with no build step:

```sh
npm start            # serves on http://localhost:5173
# or: python3 -m http.server 5173
```

Open it on your phone (same Wi-Fi, use your computer's IP, or deploy to GitHub Pages / Netlify). The camera needs HTTPS or localhost.

## How it works

| File | What it does |
| --- | --- |
| `src/colors.js` | Palette, bonus item list, and seeded random picks. Both players derive the same colors from the challenge code + date, so no server is needed. |
| `src/analyze.js` | Measures how much of a photo (or a region of it) is the target color, matching on CIELAB hue with loose lightness so shadows still count. |
| `src/scoring.js` | **All scoring rules and weights.** Edit `SCORING` to change how points work. |
| `src/detect.js` | Lazy-loads the object detector for bonus items; if it can't load, bonuses are skipped. |
| `src/store.js` | Saves games in `localStorage`; builds/reads share links. |
| `src/app.js` | UI. |

### Current (placeholder) scoring

Per photo, max 100 + bonuses:

- **Coverage** (up to 60): share of the photo that is the color; maxes out at 50%.
- **Accuracy** (up to 40): how close those pixels are to the exact shade.
- **Bonus** (+25 each): a bonus item detected with at least 12% of its box in the color.
- Photos with under 5% of the color score 0.

### Playing with a friend

Tap **New challenge** → **Invite friend** and send the link. Your friend opens it and gets the same 4 colors. The link also carries your scores, so send it again after each photo to update your friend. They do the same back to you.

There's no server yet, so photos stay on each phone and scores are synced by link. A backend (e.g. Supabase or Firebase) would be the next step for live scoreboards, seeing each other's photos, and preventing cheating.
