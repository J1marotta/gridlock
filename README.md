# GRIDLOCK — top-down traffic racer

Top-down circuit racing: the whole track is always visible, 12 color-coded cars,
Mario-Kart-lite items, GTA-style traffic vans, and forced pit stops with a
nitro-style timing crew.

Same backend shape as `nitro`/`deathRace` (Colyseus room, 20Hz authoritative sim,
React shell + canvas track).

## The game

- **Track library**: Speedway circle (default), Riverside Park, Hairpin Alley,
  The Esses — plus anything painted in the Track Studio. Solo and the host
  pick from premade + studio saves; the host can upload a studio loop online.
- **12 cars**, bots fill the grid. 3 laps (tunable), checkpoints validate laps.
- Controls: keyboard **↑ gas, ↓ brake, ← → steer, Space item, P pit**. Touch screens use auto-gas, thumb steering, item and pit buttons.
- **Items** (hold one, boxes respawn, odds favor the back): rocket **boost** and
  **oil spills**. Each toggleable live.
- **Traffic**: slow civilian vans on the racing line. Tag one, lose speed.
- **Tires wear** (driving, drifting, grass). Bald = half top speed. Enter the
  marked pit lane and tap **P** (or the touch PIT button) to stop for fresh tyres.
- **Live tune**: press **~** anywhere for the admin panel — every variable
  adjustable mid-race. Solo: free. Multiplayer: host only.

## Run it

```bash
npm install
npm run dev:colyseus   # ws://127.0.0.1:2567
npm run dev            # http://localhost:5173 (VITE_COLYSEUS_URL to point elsewhere)
```

Solo test mode needs no server. Tests: `npm test`.
