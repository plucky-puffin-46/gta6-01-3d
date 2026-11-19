# gta6-01

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/plucky-puffin-46/gta6-01-3d/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/plucky-puffin-46/gta6-01-3d/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

**Puffin Vice 3D** — a third-person 3D open-world crime game that runs in a desktop browser from static files, no build step and no network. Built on the vendored Three.js library. The city is not a grid: seven radial avenues and two ring roads meet at a central plaza, diagonal avenues cut the corners, and a curved boulevard follows the beach — traffic, pedestrians and the minimap all run on that same road graph. Drive and walk a sunset city of lit towers, palms and beachfront: traffic and pedestrians fill the streets, any car can be jacked, crimes raise a 0–5 star wanted level and the police pursue with strobing light bars. A three-mission story chain for Rico (steal and deliver a teal Comet, a timed package run, a briefcase delivery under a locked three-star wanted level) pays cash and advances the plot. Full HUD with cash, health, wanted stars, mission objective and a live minimap (roads, police blips, waypoint), a start screen with Start/Continue, progress saved to localStorage, WebAudio-synthesised sound effects, and pause/help overlays.

Controls: WASD/arrows move, Shift sprint, E/F enter/exit cars, mouse drag orbits the camera, click/F punch, mouse aim + click to shoot while on foot, P/Esc pause, H help, K save.

## Run it

```sh
node serve.ts
```

then open http://localhost:8080 in desktop Chrome. The game itself is the plain static files under `game/` — any static file server pointed at `game/` works too.

---

<sub>Entered on [make.fun](https://make.fun/?ref=rk2jtqf1&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
