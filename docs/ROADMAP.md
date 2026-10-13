# Winterland roadmap

**Where it stands (2026-10-13).**
- Phases 1–5 play end to end, and every model and texture is procedural (AssetFactory, canvas textures, synthesized sound).
- The autoplay bot reaches the mega sawmill in about 2.5 minutes.
- Late-game cost is about 430 draw calls on desktop and 505 at phone size; the budget is about 800.
- A private artifact build exists for phone play.

Effort sizes: **S** is a small slice. **M** is about one builder for a wave. **L** is several waves.

## What the playtests show

| Finding | Evidence |
|---|---|
| A refresh restarts from $0 | Nothing is persisted except the mute toggle (`fx/Audio.ts`). |
| The content stops dead | After the mega saw, the guide goes quiet and nothing is left to unlock. |
| Money has nowhere to go | The bot holds **$2,215 after 90 s of phase 5**. Total spend in the whole game is $800. |
| The player never grows | Carry capacity 10 and move speed 6.4 are fixed, with no upgrades. |
| Some loops are still manual (by design so far) | Crates go from the bench to the SE counter by hand, cash is collected by hand, and logs reach the trucks by hand. |
| Gaps | No music. No tests or CI. Never run on a real phone GPU. |

## The fork: game or playable ad

The original brief said "in the style of mobile playable ads". The two readings lead to different builds.

| | **Game** (recommended) | **Playable ad** |
|---|---|---|
| Pacing | Stretch it 10–50× with tiers of things to buy. | Already close (about 2.5 min); compress to 30–60 s. |
| Must-haves | Save and resume, offline earnings, upgrades, content after phase 5. | End card with a CTA, a single HTML file, zero network requests (inline a subset of the font), network SDK hooks. |
| Size | Not a constraint. | 778 KB today. Network limits are roughly 2–5 MB but vary; verify each network's current spec at build time. |

Recommendation: **game**. The brief asked for something to play and test. An ad build can be a cheap side target later, because it reuses almost everything.

## Next: make it a game

1. **Save and resume (M).**
   - What it saves: a versioned localStorage snapshot of money, unlocks, pad progress, the phase, and item counts per pile and counter.
   - When it saves: every few seconds and when the tab is hidden, after in-flight items have landed.
   - On load, it rebuilds the unlocked stations and refills the piles.
   - A reset option goes in settings.
2. **Offline earnings (S, after 1).** A "While you were away: $X" card, capped at 2 hours. The rate comes from an income-per-minute table per automation level, measured with the bot.
3. **Upgrade shop at the log cabin (M).** The red-roof cabin already in the yard gets upgrade pads, with 3–5 levels each at rising prices:
   - carry capacity: 10, 14, 18, 24;
   - move speed;
   - chop speed (axe level).
4. **Hire helpers (M).** Each helper is bought on a pad and reuses the existing pawn models:
   - crate runner: bench to SE counter;
   - cashier: empties the cash piles into your balance;
   - log hauler: drop zone to the trucks.
5. **Machine levels (S–M).** Speed levels for the harvester, processor and conveyors, bought on small pads next to each machine.
6. **Rebalance with the bot (S).**
   - Target times: harvester at about 1 min, processor about 4, conveyors about 8, mega saw about 15.
   - Upgrades and helpers should fill roughly the first 45 minutes.
   - Check income per minute at each phase.
7. **Completion moment (S).** After the mega saw: a celebration, a stats card, and a teaser for what comes next.

## Then: polish and reach

- **Music (S–M):** a procedural cozy loop in WebAudio, ducked under the sound effects, with its own toggle.
- **Settings and pause (S):** sound, music, quality, haptics, reset progress.
- **Quality tiers (S):** lower the pixel ratio and shadow-map size automatically when FPS drops, with a manual override.
- **Pile instancing (M):** settled items in each pile render as one InstancedMesh per kind, while items in flight stay individual. This turns the 182-mesh cash pile into 1 draw call and is the biggest perf lever left.
- **Onboarding hand (S):** the genre's animated "drag to move" hand at the start, and a highlight on the first sale.
- **Haptics (S):** `navigator.vibrate` on pickups and pad payments. Android only; iOS ignores it.
- **Real-phone pass (S, owner):** open the artifact on a phone and report frame rate and feel.

## Later: content (pick a few)

- **A new product chain.** Either a firewood stand (logs into firewood bundles for cabin customers on snowmobiles) or a furniture workshop (planks into chairs and tables).
- **A second zone across the river.** The bridge already exists. It could bring a new log type (birch or pine) and new buyers (dog sleds, or river barges at the spring thaw).
- **Customer variety:** VIP orders with tips, rush hours, timed boosts.
- **Day/night cycle:** the lamps and cabin windows glow, with an aurora at night.
- **Quests and achievements:** short goals with cash rewards.
- **Prestige:** sell the mill and restart in a new biome with a permanent multiplier.
- **Seasonal events:** for example, Christmas tree deliveries.

## Engineering track (any time)

- **Push to a private GitHub repo** (waiting on the owner's OK).
- **CI (S):** a GitHub Action runs `tsc` and the autoplay playtest on every push, and fails if the milestone times regress.
- **Unit tests (S–M):** vitest for the economy, Pile reservations and the transfer lifecycle.
- **Free hosting (S):** GitHub Pages or Cloudflare Pages, auto-deployed on push. That gives a public URL you control, while the artifact stays private. Add a PWA manifest for "Add to Home Screen". No recurring cost.
- **Balance report (S):** run the bot with different strategies and produce a table of unlock times and income per minute.

## Playable-ad track (only if the ad route is chosen)

- `npm run build:playable` produces one HTML file with an inlined subset of the Fredoka font and zero network requests.
- A 30–60 s flow: cheaper pads, the intro skipped, a guiding hand, and an end card with a CTA after phase 3 or at 60 s.
- Network hooks:
  - `mraid.open()` for AppLovin, Unity and ironSource;
  - `FbPlayableAd.onCTAClick()` for Meta;
  - ExitApi for Google;
  - event pings for start, phase reached and CTA.
  - Size limits and SDK hooks change, so check each network's current spec at build time.

## Constraints that carry forward

- **No external asset files.** New models go through the AssetFactory and `bake()`, textures are drawn on canvas, and audio is synthesized.
- **Draw-call budget.** About 800 or fewer in the late game (about 430–505 today). Bake every new model per animated pivot.
- **The plank flow is unconfirmed.** Logs turning into planks on the walk-in counter is an interpretation of the brief. Confirm it or change it.
