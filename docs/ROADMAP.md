# Winterland roadmap

**Where it stands (2026-10-15, v0.3.0).**
- The "make it a game" list is done, plus the village and the Great Lodge finale.
- **Waves 6–7 are done:**
  - longer upgrade ladders and the Sales tab;
  - music, graphics quality, FPS overlay;
  - tests and CI;
  - Timber Ridge, the bunkhouse, the feller, the loader, the tubes and trains;
  - New Season.
- **Wave 8 is done** (see `docs/DESIGN.md`): day/night with an aurora, 20 quests, VIP customers and rush hours, the onboarding hand, vibration, auto quality, and the furniture workshop with dog sleds.
- The autoplay bot finishes in about 64 minutes when it keeps the workshop busy (about 51 without it). Milestones: mega saw 14, Town 19, ridge 29, bunkhouse 33, workshop 38, Winter City 53, finale 64.
- Late-game draw calls at High quality are about 880 at the village at night, about 540 elsewhere, and about 410 at the workshop. The ceiling is ~950.
- Saves from v0.1 and v0.2 load. Fixtures are in `tests/fixtures/`.

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

## Done: make it a game (wave 4–5)

Kept for reference. Deviations: the shop is one doormat that opens a panel (not pads), and the conveyors have no levels (belts are never the bottleneck).


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

- **Pile instancing (M):** settled items in each pile render as one InstancedMesh per kind, while items in flight stay individual. This turns the 182-mesh cash pile into 1 draw call and is the biggest perf lever left.
- **Real-phone pass (S, owner):** open the artifact on a phone and report frame rate and feel.

## Later: content (pick a few)

- **Another product chain:** a firewood stand (logs into firewood bundles for snowmobile customers). The furniture workshop is done.
- **A furniture runner (S):** a crew role that carries chairs from the workshop bench to the sleds.
- **A second zone across the river.** The bridge already exists. Timber Ridge (east) is done; the river zone could bring birch and river barges.
- **Customer variety, deeper:** VIPs and rush hours exist. Timed boosts are still open.
- **Achievements across seasons (S):** quests reset with each New Season; lifetime badges could persist.
- **Prestige, deeper:** New Season exists (a permanent price bonus). It could add a new biome or perks per season.
- **Seasonal events:** for example, Christmas tree deliveries.

## Engineering track (any time)

- **More unit tests (S–M):** Pile reservations and the transfer lifecycle. Economy and save tests exist, and CI runs them.
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
