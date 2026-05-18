# Reaction Timer

A browser-based reaction time game that measures how fast you respond to a visual cue. The entire experience lives in a single `index.html` file — no build step, no dependencies to install.

## How it works

1. Press **Start** to begin a session of 5 rounds.
2. After a randomized delay (1.5–4s), the screen flashes **GO!**
3. Click anywhere (or press **Space**) the moment you see it.
4. Click too early and the round restarts as a false start.
5. After 5 rounds, you get a summary with your best, average, and worst times.

## Ratings

Each round is scored against typical human reaction time benchmarks:

- **Lightning** — under 200ms
- **Sharp** — 200–300ms
- **Average** — 300–450ms (most adults land here)
- **Slow** — over 450ms

## Tech

- Vanilla JS, no framework, no bundler.
- [Three.js](https://threejs.org/) (loaded via CDN import map) renders an animated organic-crystal background that morphs and bursts in sync with game state.
- Pointer + keyboard input handled at the document level, so the whole viewport is one click target.

## Running it

Open `index.html` in any modern browser. That's it.
