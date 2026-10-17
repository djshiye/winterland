# Changelog

What changed in each Winterland release, newest first. The game shows the entries since your last version the first
time it opens after an update (src/ui/changelog.ts reads this file), so write for players: plain words, no code.
Each release is a `## x.y.z (YYYY-MM-DD)` heading, an optional one-line summary, then `###` sections of `-` items.

## Unreleased

### Fixes

- **Builders build again.** Each era's builder (Master Mason, Pit Boss and friends) now brings materials to a machine as soon as you choose it, and also pays for what you picked so the house, shop or machine actually goes up. They always leave a safety cushion in your wallet, and they never choose what to build or pay for a new era: that stays your call.

## 0.9.8 (2026-10-17)

The big cozy makeover: every era, machine, worker, menu and sky has a new hand-made look, every era has its own music, and the game can now tell you when an update is out.

### A whole new look

- **Warmer everywhere.** New soft lighting, colours and snow make every era feel like a little snow globe, by day and by night.
- **Every era has its own world.** Each era's ground, paths and landmarks are built around its resource: packed earth and fieldstone in the early eras, brick and copper in the middle, a sand-snow silicon campus, mint-glazed pools and cream hex panels with gold seams at the end. Era 3's rusty yard now has snow banks to rest the eye.
- **A lighter, cozier city.** Districts climb taller and lighter era by era, windows show sky-blue glass by day, and the far skyline turns pearl and cream in the late eras.
- **New machines.** All machines in all ten eras were remade with chunky, toy-like detail and gentle working animations.
- **New characters.** Everyone shares one cute round body with a real face. You wear a red knit hat and a long striped scarf. Every crew role has its own hat colour and tool, and each era dresses for its resource.
- **Sky and weather.** Softer snowfall, a reworked aurora, clouds, stars and little bits of life around the world.
- **Upgrade pads.** Pads look, sound and feel more satisfying to step on, with new glow and juice on every upgrade.

### Menus and moments

- **One cozy style for every menu.** Cream cards, gold and pine buttons, rounded numbers and a softer night version that fades in after dark. Icons share one warm outline.
- **Era postcards.** Opening a new era shows a postcard of its region. It closes by itself, and Esc or B closes it sooner.
- **A prettier ending.** The 100% card gets a honey prize ribbon and a new toy trophy.
- **Readable signs.** Signs in the world fade softly with distance and never get too small to read.

### Music and ambience

- **A theme for every era.** Ten cozy tunes built around each era's resource, from the familiar Cabin Hearth in era 1 to Golden Halo in the AI Era. Each one has a quieter, sparser night version.
- **Every place has its own sounds.** Pine wind and chickadees, kiln roar, boiler hum, server fans, water lapping, street murmur and sleigh bells in the city. Music and sounds crossfade as you walk through a gate.
- **New Ambience volume slider** in Settings, under Music volume. Calm and Minimal effects settings thin the ambient sounds out.

### Updates inside the game

- **The game tells you when a new version is out.** A cozy card shows what's new and lets you pick *Update now* or *Keep playing*. It asks once per version, and you can turn the check off in Settings › Game.
- **One click to update.** The game downloads the new version, checks it's genuine against the release checksum, closes, updates and opens again. Your save is never touched, and if anything goes wrong you're back in your game as it was.
- Updates reach you once Winterland's downloads are public (planned with 1.0). Until then the check quietly finds nothing and you keep playing.
- **What's new.** The first time you open the game after an update, it shows everything that changed since your last version. Settings › Game › *What's new* opens it any time.

No save, price or pacing changes. Your save carries over as it is.

## 0.9.7 (2026-10-17)

Winterland now has a real ending, every late era runs on a resource that makes sense, each era plot feels like a little town, and the game plays with a gamepad.

### Winterland Complete

- **A 100% award.** The era chip always shows how complete your Winterland is and the next missing piece. Its Go button takes you there.
- **A real ending.** The AI Era has one last goal, *Winterland Complete*. Reaching 100% plays a cozy fireworks finale, puts a glowing gold trophy beside the Great Lodge and opens a stats page: time played, money earned, time per era and your seasons.
- **New Season** now lives on the 100% card, and its confirm lists exactly what resets and what stays. Trophies and stats always stay.
- The Great Lodge card now says "Survival complete, the Frontier awaits" instead of claiming the game is over.

### New resources in the late eras

- **Industrial Age:** hammer iron pellets at Taconite Ridge and bake coke in glowing ovens. The steel mill takes 2 pellets and 1 coke.
- **AI Era:** mine rare earth at the Rare Earth Geode, gather helium-3 with the new Helium Skimmer, and power the Neural Fab with cells from the Fusion Reactor.
- **Your save converts by itself.** Pig iron becomes iron pellets, data shards become rare earth, and nothing is lost. If you had more than one Fusion Plant, one stays as your Fusion Reactor so your line keeps running. A short card explains it the first time you load.

### Era plots that feel like home

- Every era plot now has crew huts round a green, market streets behind the counters, a paved processing yard and a harvest field themed on the era's resource. These are first shapes; the full makeover arrives in 0.9.8.
- Each era has its own delivery vehicle and cash machine.
- Residents and shoppers walk the city districts, the era Foreman carries material to your city lots, and a warmer skyline grows behind them.
- **Fixed:** city buildings were counting each payment twice and cost only about half their price. They now cost what the sign says.

### Comfort and controls

- **Interface size** slider (80 to 150%) in Settings › Comfort.
- **Keyboard menus:** arrow keys and Tab move a gold focus ring through any menu.
- **Gamepad:** walk, pay, open menus, the map and the market, and zoom, all from a controller. Rumble follows the Vibration switch.
- A cozy splash while the game loads, and a calm five-step guide whenever a new era opens.
- Reduce motion and calm effects now cover every pop, bob, flicker and arrow in the game, and era colours read better for colour-blind players.

### Your save

Saves from every 0.9.x version load. Nothing you earned is lost.

## 0.9.6 (2026-10-16)

A fix release before the big 1.0 makeover. Every era now runs on its own, money adds up, and your save is safer than ever.

### Every era works on its own

- **No more dead factories.** The Steam Age, Silicon Age and AI Era used to need materials from older eras that nobody brought, so their chains stalled. Every era from Frontier to the AI Era now runs its whole chain from its own land.
- **New raw materials.** The Industrial era mines **pig iron**, and the AI Era grows **data shards**. Each has its own hand node, icon and Fine upgrade.
- **Busy machines.** Crews feed the next machine before selling raw goods, and hoppers grow from 8 to 24 as you level a machine. Belts now reach nearly every input.
- **Customers keep up.** Buyers come faster and carry more in later eras and as you level the Loading Dock and Market Stall. A "COUNTERS FULL" sign shows over the depot if they ever fall behind.
- **Your tool matters in every era.** Each strike on an era's hand node now pays in step with that era's prices.

### Fair money

- Buying a Market order and reselling it at an era market no longer turns a profit.
- The index fund and ventures now grow per hour, not per minute, and how much you can put in depends on what you earn. Leaving money there overnight no longer makes trillions.
- Every level you can buy now does something. Sled Dog Lv 5, 7 and 9 and every era Pal's Lv 10 used to do nothing, and the shop no longer promises a "+1 Mastery".
- **Trade and Fine are one upgrade.** Each material has a single Fine upgrade that raises its price at the depot, the dock and the stall.
- The climb after the Great Lodge is shorter, eras grow from about 90 to about 160 minutes, and offline earnings now include your city's income.

### Clearer goals

- The goal line shows something you can do right now first, then what to build, then what to save for.
- The era card, gate card and map explain the Lv 10 rule in one sentence. The gate card groups its rows with a progress bar.
- Settlement rises freely from era 2, so every home you build counts.
- Contracts and quest rewards follow the era you're in. No more sausage contracts in the Nuclear Age.
- The map numbers regions only, so there's just one "II". There's one population number on screen, and MANAGE signs only show when you're near them.
- **Reduce motion** in Settings now calms the upgrade pads too.

### Your save

- **An unreadable save is never overwritten.** You'll see a "Your save is safe" card with a Download button instead.
- **Earlier saves.** Settings › Game › Earlier saves keeps three rolling backups, plus a copy from right before any Reset, Restore or New Season.
- **Old levels past 10 are refunded.** If you levelled things past 10 in 0.9.1 to 0.9.4, each extra level is paid back as cash at what it cost you. The old Mastery bonus and any Trade levels are paid back once too, and a "Welcome to the new level rule" card explains it all.
- Saves from every 0.9.x version load.

### Desktop

Only one copy of the game runs at a time. There's a **Save & quit** button, and Settings shows your version. The release build is locked down: no cheat hooks, no DevTools.

## 0.9.5 (2026-10-16)

Every era is now as full as Survival.

### What's new

- **Bigger eras with real places in them.** Each era from Frontier to the AI Era now has a large plot, bigger with every era, split like Survival into a front yard, a processing yard, a harvest field, a market corner and worker huts. The old roads that cut through Granite Hollow are gone: the eras sit along clean roads that never cross a plot, the tricycle road ends at the first era road and the river ends in a frozen pond.
- **Full production chains.** Every era has five producing machines plus its own cash machine, each with its own materials: Frontier makes stone, clay, bricks, roof tiles and hearths; the Iron Age makes ore, charcoal, iron, tools and rails; and so on up to quantum cores in the AI Era.
- **Seven kinds of workers per era.** Haulers, Feeders, Shippers, Porters, Gatherers, a Foreman and a Clerk, each with their own job, hired at the era's shop mat.
- **Conveyor belts.** A Belts upgrade in each era links its machines with roller conveyors.
- **Customers in every era.** Buyer trucks pull up at a loading dock and shoppers walk in to a market stall. They pay into a cash pile that you, the Clerk or the era's cash machine (Strongbox, Mint Chute … Quantum Bank) collect.
- **Sales upgrades per era.** Loading Dock, Market Stall and a "Fine" price upgrade for every material.
- **Hands-on work in every era.** Each era has its own hand node (a great boulder, an ore vein, an oil seep …) that you work with that era's tool, plus Carry, Boots, Tool and Pal upgrades. Every era has its own pal, from the Pack Mule to the Robo Pup.
- **Level pads on every machine.** Era machines are upgraded hands-on on their own pads, like Survival's.

### The new level rule

Every upgrade in every era now stops at **Lv 10**. To open the next era, bring everything of the current era to Lv 10, reach the settlement level and buy the expansion. Levelling Survival past 10 is no longer needed. Prices grow era by era, so each era is a longer grind than the one before.

The shop at an era's mat shows only that era's cards, and cards for an era you haven't reached show as locked instead of "MAX".

### Your save

Saves from 0.9.4 and earlier load as they are. A level above 10 from the old rule is kept in your save and counts as Lv 10. Machines you built stay on their slots. New slots, workers and upgrades start empty.

## 0.9.4 (2026-10-16)

A roomier Market Town.

### What's new

- **Market Town has room to walk.** Once every shop, the café, the pond, the bandstand, the snowman park and the Grand Market were built, the square was too crowded to get around. The town now stretches further south: the square is half again as deep, so there are wide, clear paths between the big fir, the amenities, the benches and every shop's pads. The north shops and the road in from the village stay where they were; the south and east shops, the amenities and the Grand Market move out to give everything space. The road south to the eras leaves from the new south edge.

### Your save

Saves from 0.9.3 and earlier load as they are: every shop, amenity and the Grand Market appear on their new spots in the larger town. Nothing is lost.

## 0.9.3 (2026-10-16)

One-click updates, faster deliveries, a carry meter, a tidier era map and fullscreen on Mac.

### What's new

- **One-click updates.** Every download now has an **Update Winterland** file next to the game (`Update Winterland.cmd` on Windows, `Update Winterland.command` on Mac, `Update Winterland.sh` on Linux). Double-click it to get the newest version: it checks GitHub, asks once, downloads the update, makes sure it's genuine (SHA-256 checksum), swaps the game files and starts the game. Your save is never touched. On a Mac, *right-click → Open* it the first time. This is the last version you need to download by hand.
- **Faster deliveries.** Trucks, tricycles, dog sleds, trains and shop customers load twice as fast, and every dock level speeds loading up further (and brings vehicles up to the counter quicker). With full tables, trucks went from 12 to 16 a minute, and 24 with a level 7 Truck Dock.
- **Carry meter.** A small pill in the bottom-left corner shows how much you're carrying out of how much you can carry, and turns gold when your arms are full.
- **The Market is easier to find.** The Market button now shows (locked) once the Great Lodge is built, so you know where trading and investing will open in era 2.
- **Fullscreen works on Mac.** The Settings switch, the F key and the green window button all go fullscreen, and Ctrl+Cmd+F and *View → Enter Full Screen* work too. Windows and Linux are unchanged.
- **A clearer world map.** Era regions now follow one trail from Market Town, so the next era is always the next plot along the road, and a dashed trail on the map leads to the next era's gate. City blocks show as dark city tiles with their names under a "City" heading, so they no longer look like a second era II. The mountain that covered a corner of Copper Gorge is gone. Old saves load as normal; each era's machines and buildings appear on its new plot.
- **Demolish and rebuild is easier to find.** Every built city lot, Market Town shop and era machine now shows a big floating MANAGE sign; step on it to open its card with the Demolish button.
- **The Tree Feller saws again.** It cuts through the trunk with its spinning blade instead of hammering it with its bare arm.
- **Pads and you stay in view.** A city tower or Market Town building that stands between the camera and a build or upgrade pad (or you) now fades to see-through, so you can always read the price and see where you're walking. It turns solid again once nothing is behind it.

### Your save

Saves from 0.9.2 and earlier load as they are.

## 0.9.2 (2026-10-16)

Market Town fixes and a tidier screen: getting around is much easier, the Grand Market tells you how to get its toys, every upgrade pad is in view, and deliveries no longer pile up waiting for customers.

### What changed

- **Easier to get around the Market Town.** Walking into the big fir, the stalls, benches, lamps, the snowman or the square's amenities now bends you round them instead of stopping you dead. The same goes for the town's edges.
- **More room.** You can now walk all the way up to the shop fronts and their build pads, not just the cobbled square, so you no longer bump into invisible edges at the sides.
- **The Grand Market explains its toys.** When the Grand Market appears, a tip says it needs 20 toys from a Toy Factory. The guide then walks you through it: build a Toy Factory, bring it crates, pick the toy trains up off its counter, and carry them to the Grand Market pad (with a count, like 8/20). The Toy Factory's card mentions it too.
- **Cocoa Café pad moved.** Its build pad sat behind the big Christmas tree, so you couldn't see the price. The pad is now on the café's west side, by the corridor, in clear view.
- **Every upgrade pad in view.** The Cash Tubes, Workshop and Tree Feller pads moved to the camera side of their buildings, so you can always read the price.
- **Tidier screen.** The objective, rush hour and event banners now stack neatly instead of overlapping, and guide hints like "Pick up wheat at the farm" go quiet once a worker does that job for you.
- **No more waiting on customers.** Every place where goods wait for a buyer now has its own upgrade in the cabin shop's *Sales* tab: the **Shop Counter** (plank customers), **Tricycle Dock**, **Truck Dock**, **Sled Dock** and **Rail Platform**. Each level makes that table hold more (up to double), so your workers can keep unloading, and brings its customers more often and loads them faster. You buy each level yourself on the shop mat, and they count toward the Era 2 expansion (now 28 upgrades to Lv 10).

### Your save

Saves from 0.9.1 and earlier load as they are. Toys you already delivered still count.

## 0.9.1 (2026-10-16)

This fixes how far upgrades can go in each era. In 0.9.0 machines could be levelled far past the era's goal, which made the climb much too fast.

### What changed

- **Every era has a level cap.** Machines (Harvester, Processor, Mega Saw and the rest), workers and every other upgrade stop at **level 10** in era 1. Once everything is at 10 and your settlement is at 5, buy the era 2 expansion and the cap rises to 20, then 30 in era 3, and so on up to 100 in era 10.
- **One level number everywhere.** Machine pads now show the same level as the shop and the era checklist, so the last era 1 pad reads **LV 10**. (Before, a machine's pads counted one higher.)
- **You can see the cap.** When something reaches the era cap it says *Max for this era*, and the shop button reads *Era MAX*.

### Your save

Saves from 0.9.0 and earlier load as they are, and nothing you bought is taken away. If something was already above the new cap, it keeps its level and simply can't go higher until the next era.
