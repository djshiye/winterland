# Changelog

What changed in each Winterland release, newest first. The game shows the entries since your last version the first
time it opens after an update (src/ui/changelog.ts reads this file), so write for players: plain words, no code.
Each release is a `## x.y.z (YYYY-MM-DD)` heading, an optional one-line summary, then `###` sections of `-` items.

## Unreleased

### Small fixes before 1.0

- **Every machine gets its belts.** On a busy belt lane a machine's second input was sometimes left for the crew to carry. Two belts can now leave one pile, or reach one hopper, back to back, and a fourth, higher belt can run straight along a row, so every input of every era's yard gets its own belt.
- **A cozy North Road.** The road the log trucks use, seen in the opening flyover, no longer looks like a modern highway. It is now a packed-snow road with wheel ruts that crosses the river on a timber bridge with snow-capped wooden rails, and the trucks come out of a stone tunnel mouth.
- **Workers no longer stand inside each other.** Era workers waiting at a busy dock or machine used to bunch up on the same spot. Now a worker who finds someone already waiting there walks back to their own post.
- **Builders always notice your purchases.** The era builders keep 40% of your cash for you. In a rare case they missed a purchase you made and measured that 40% against your old, higher balance. They now see every purchase.
- **Copper and stone look like themselves.** Copper is now a cluster of smooth nuggets with green patina, so it no longer looks like iron ore, and stone's icon is a cut block, so it no longer looks like a lump of coal.
- **Nobody pops up inside the snowman park.** When the Market Town square was crowded, a resident could choose a spot to stand inside the snowman park's fence or a stall. They now pick a free spot on the square, or walk to the village street.

## 0.9.13 (2026-10-21)

Snow that builds up in storms, a river promenade, a festival band, worked harvest fields, every late era its own yard and market, people running errands, city traffic, and a smoother late game.

### Snow, the river walk and the festival

- **Snow that builds up.** During a snowstorm the roofs and the harvest fields slowly gather a soft, patchy layer of snow over about a minute, then shed it over the next few minutes once the storm passes. The fields only drift over in patches, so you can still read them.
- **A river promenade.** A wide snow walk now runs along the river between the mill and the road to the Market Town, with a stone kerb, a timber rail, lamps, benches looking out over the river and the pond, and a little bandstand at the overlook. It sits on open snow, clear of every road, lane and path. It opens with the new land.
- **The festival comes to the plaza.** On festival day strings of warm paper lanterns fade in over the Market Town plaza and the village street, and a little brass band of two horns and a drummer walks in to play at the plaza. They step aside for you and walk off when the festival ends.

### Steadier saves and small fixes

- **A crash no longer hides your save.** If the game ever fails to start for a reason that has nothing to do with your save, it now shows the message and keeps your save as it is, instead of starting a fresh game. Only a save that really can't be loaded is set aside (and can still be restored from Settings, Game, Earlier saves).
- **Contracts right after loading.** The first contract after you load a game is now sized from your real sales, not from an empty start.
- **Foreman wording.** The guidebook and the shop now say what the foremen really do: they leave you 40% of your cash in the eras and at least $500 at the mill.
- **More room at the market stalls.** Residents on errands walk a little wider round the stalls and their crates instead of brushing past them.
- **No more bunching at the kerb.** Shoppers waiting at the kerb by a market gate now spread out a step apart along the kerb instead of standing inside each other.

### Livelier harvest fields

- **Worked fields.** Every era's harvest field now looks dug and worked: terraced quarry benches and a haul ramp in eras 2 to 6, a row of oil derricks in era 7, a sand terrace in era 8, a hazard-striped concrete wall in era 9 and a rocky crater rim in era 10. The heaps, slabs, ridges and pools come in three sizes and sit at their own angles instead of a neat grid.
- **Things at work.** Each field has two working props: a crane swinging its load over the pit, an ore cart running along the top bench, a turning headframe wheel, a flickering flare, or scanner drones drifting over the dunes, the pits and the crater.
- **Trodden paths.** A worn track runs from each hand node toward the yard, with cart ruts from the ramp.
- **Empty machine slots look like building sites.** Survey stakes and string, a flag and a stack of crates wait on every slot until its machine goes up.
- **Fliers have shadows.** The sleigh, the airship and the drones cast a soft shadow on the ground, so they read as flying, not parked on a roof or in the market lane.
- **Era 9 in white and yellow.** The Nuclear era gets white concrete and hazard-striped kerbs by day and a deep blue night sky, so its green glow stands out.

### Every late era its own yard, square and street

- **Yards you can tell apart.** The Electric era's yard gets an art-deco power house with glowing insulators, the Oil era two round gas tanks and a flare stack, and the Computer era a raised showroom deck with a big satellite dish. Each of the three also gets its own gate arch: copper deco, honey-yellow pipes, and a white panel with a glowing marquee.
- **A centrepiece on every late green.** Eras 6 to 10 get a quartz-crystal lamp, a little pumpjack statue by an eternal flame, a glowing holo-tree, an atom fountain and a crystal tree. Each green also gets market stalls round its edge and a snowman in an era hat.
- **Livelier late markets.** The Electric and Oil streets get two-storey shops, rooftop water tanks and signs, tall blade signs and striped awnings. Eras 6 to 8 each park their own vehicle at the market, with crates waiting at its open doors.
- **The export depot works.** A little cart, forklift or loader bot carries the crates to a freight lift beside the depot. When the lift is full it sinks out of sight and comes back up empty.
- **Windows light up one by one.** At dusk the windows of the era huts, the shops and the city towers come on one after another, not all at once.

### People with somewhere to go

- **Errands to the market stall.** Every era's green now has a market stall, and the crew's families pop out to it: they queue up a step apart, buy something, wave, and carry a basket of goods home. At night they take a lantern.
- **A loader at the parked van.** In the Electric, Oil and Computer eras someone works at the market's parked vehicle by day, lifting crates off the stack and loading them in at its side.
- **City traffic.** From the Industrial era on, each built city district sends its own era vehicle, from the pony cart to the hover pod, round the city blocks. They keep their lane and their distance, and stop for you and for anyone crossing.
- **Room to pass.** People on the greens step to their right and give way instead of walking through each other.

### Arriving in a city district

- Fast travel to a city district now lands you on its front street with every lot ahead of you, instead of behind the front row where a building hid you and you seemed to stand on its roof.
- Among the tall towers of the later eras the see-through window around you is wider, so you never lose sight of yourself.
- City benches, hedges, planters, bike racks and lamp posts are solid now, like the ones in the regions; the walks stay clear.

### Smoother late game

- **Opening a new era no longer freezes the game.** The moment you paid for an era, building its yard briefly locked up the game; that pause is now far shorter.
- **A lighter world.** Era yards you can't see run at half rate behind the scenes (they make and sell exactly as much), and the guide arrow and the first-minute hint do less work each frame, so a fully built world runs about a quarter lighter.

### Small touches

- **Paying counts down.** "Pay for the shelter ($120)" now counts down as you pay, instead of showing the full price until the end.
- **The guide steps aside when you're there.** The arrow hides as soon as goods start flowing from a pile, not only once you stand in its middle, and after fast travel the goal updates right away.
- **The hold chip stays up** while you stand where two spots overlap and step out of one.
- **Phone edge arrow.** The arrow at the screen edge keeps clear of the notch, rounded corners, the home bar and the wide goal banner.
- **Critters and skaters.** The cat, the deer and the finches fade in instead of popping up, and the cat fades away at dusk instead of blinking out; footprints beside a crowd last their full time; the hand-in-hand skating pair stays together all the way round.

### Smoother in motion

- **Shoppers head home.** Era market shoppers no longer gather at the crossroads by the Granite Hollow market, where they stood for good while more piled up. They now walk off down the long side of the road until they're out of sight.
- **Look both ways.** Shoppers wait at the kerb while a vehicle comes, and buyer carts and trucks stop a safe step short of anyone crossing in front of the market.
- **The market gate stays clear.** The second buyer in line no longer parks right across the market gate, so shoppers never walk through a cart.
- **No more parking inside each other.** Tricycles, trucks and walk-in customers that wait at the end of their road now stand a proper gap apart, and a tricycle is never pulled back up the road when the new land appears.
- **Steady traffic when a new era opens.** Opening Silicon Shore no longer makes every buyer truck on the southern road jump 80 m along it.
- **A new hut doesn't empty the green.** People chatting round the fire on a region's green stay put when you build a new hut; its family simply comes out to join them.
- **Gentler sledding.** Sledders slow down along the flat at the bottom of the hill instead of stopping dead.

### Clearer screen

- **Your population shows by day.** The little person next to the village badge's head count no longer disappears on the light badge, and the badge drops its extra "Town" label ("80 Town" next to "Frontier Town"). Town happiness still says what it is when you hover the heart.
- **Welcome back closes like every card.** Esc and the controller's B close the "Welcome back" card and the save notices, and Start no longer opens Settings on top of them.
- **Quest rewards wait their turn.** "Quest complete!" and other big messages wait while a card, sheet or the guidebook is open and show once you close it, and the reward coins fly behind the text instead of over it.
- **Banners only where they matter.** Rush hour and Festival day only show while you're at the mill or in the Market Town, the only places they change. Snowstorms and the northern lights still show everywhere.
- **Tidier wording.** "1 log", not "1 logs". "Sell 10 planks". Era goals and crew name the place ("All Granite Hollow upgrades", "Loading Dock"). Settlement levels use plain numbers, signs say "Lv 3" like the shop, one spelling of "cozy", the mill is "the Mill" on the final card, skaters loop "until late", the settlement card no longer repeats "Everyone loves your mill", and big populations roll over to "1M" instead of "1000K".

## 0.9.12 (2026-10-20)

Easier pickups, a guide arrow that follows the path, bigger and livelier towns, a belt for every machine, and the whole game playable with a keyboard, a controller or a phone.

### Easier to carry

- **Easy pickups.** Piles, counters and drop-offs now count your whole body, with a little slack: walk up until you touch the spot and goods start flowing, and they keep flowing if you drift a bit. The spot glows gold while you're in range.
- **Walking across a pad pays nothing.** With hold-to-interact off (phones and tablets), a pad only spends once you slow down or stop on it.
- **"Takes Stone".** Stop at a machine, shop or counter with the wrong goods and it tells you what it takes.
- **A clearer market square.** The bench by the first shop and the lamp by the entrance moved out of the way.
- **MANAGE signs on the working side.** Each era machine's MANAGE sign now stands in front, beside its feed spot, and its card opens when you stop on it, not while you walk past.

### Roads and traffic

- **The train no longer drives backwards.** It has an engine at each end now, so an engine always leads, in to the platform and back out to the tunnel.
- **Buyers no longer vanish in the middle of the road.** Carts, wagons and trucks drive in from the city and the link roads, turn the corners, park in their own lane and drive on until they are out of sight. Passing traffic keeps to the other lane, and parked buyers no longer stand over the fences. Sleds, trikes and shoppers on foot also come and go out of sight.
- **Fast travel to a city district lands in that district,** on its own street, not beside the district before it.
- **Roads join up.** Ruts follow the road round corners and stop at junctions, city streets are cozy cobbles that meet the trail cleanly, the south avenue reaches the town, each era's gate has its own paving, and signposts no longer cross.
- **A cozier highway.** The North Highway you fly past at the start is a warm slate road with soft cream dashes now, not black asphalt with yellow lines.
- **Nothing pokes through the fences.** Trees, cranes, cacti and boulders keep clear of the fences, gate signs stand clear of the gate posts, the old cart track and pipes end properly, the market walk leads all the way to the stall, and floor joins and grid lines are softer.

### Bigger, livelier towns

- **The empty square is a build spot now.** Every era area had one paved square you could not build on. Each area now has one more machine spot there. Prices rose a little so each era still takes about as long.
- **The city districts are much bigger.** Each district is about half again as wide and deep, with up to twice the lots: 12 in Brickside instead of 6. Settlement levels still need the same number of homes, so the new lots are free room for more homes, shops and parks. Your buildings stay on their lot numbers.
- **More to look at.** Street trees, benches, planters and little touches in every district, and the bare market squares and hut yards in eras 2 to 10 now have stalls, crates and clutter that fit their era. Every path stays clear.
- **Lantern Lane.** Once the Great Lodge is built, the Market Town grows south down the avenue to the main road: a cobbled street with four new lots, lamps, benches and little lit firs. Shoppers and strollers walk down it too. Your first hour in the village plays exactly as before.
- **Roomier era towns.** The towns in eras 2 to 10 run deeper now, so their markets and hut greens have more room to walk, with snowy fir groves, bushes and benches among the stalls and crates. The machines and how long each era takes are unchanged.
- **Districts open on the town.** Fast travel to the bigger districts now lands you among their lots instead of on the street south of them.
- **Clear roads and walks.** Zebra crossings at every era market gate, at the Market Town's exits and wherever a city district's sidewalk meets a street, and soft centre lines on the city streets. Era foremen now walk beside the roads, cross straight over at the corners and crossings (never cutting through a junction), and wait at the kerb while a truck goes by. Era buyers brake for anyone already crossing.
- **Room to walk.** The alley from the town square down to Lantern Lane is 3 m wide now (the two shops beside it moved apart), and the path down the west side of the hut greens keeps 3 m clear in every era. Your pal no longer sits inside a hut.
- **Townsfolk doing things.** People on the era hut greens sit on the benches, build snowmen on the snow piles, sweep their doorsteps, and kids have snowball fights. In the city districts people sweep, sit, and kids pelt each other (and the odd grown-up) with snowballs.
- **Lantern garlands.** Strings of warm paper lanterns hang from lamp to lamp along every era market street and under the shop eaves, glowing at night, high over everyone's heads.
- **Skating and sledding.** Once the new land shows, people skate loops on the frozen pond by the village (a pair hand in hand), and kids drag their sleds up a snowy hill beside the customers' path, whizz down and trudge back up while a grown-up watches from a bench. Fewer at night, nobody in a snowstorm.
- **Animals about.** Little finches land near you to hop and peck, then flutter off when you, your dog or a cart comes close. A cat sits and watches you go by and trots off if you get too near, and deer graze in the snow between the areas, bounding away as you walk up. They stay in when it is dark or stormy.
- **Footprints in the snow.** You, your dog and the townsfolk walking near you leave soft prints that slowly fill back in, so the busy ways between huts, shops and gates wear into trodden paths while you watch.
- **Something of each era in the sky.** A reindeer sleigh circles over the towns of eras II to IV, a little airship in the era's colours drifts over eras V to VII with its gondola windows lit, and delivery drones ferry parcels between the market and the huts in eras VIII to X.
- **Hanging shop signs and sky sounds.** The shops of eras II to V hang out a sign over the street, carved wood on an iron bracket and later an enamel plate in the era's colours. You hear sleigh bells, the airship's propeller or a passing drone now and then, in the eras they fly over.
- **A centrepiece in every era market.** Each market square has its own, ringed with winter flowers and plenty of room to walk round: a lantern bearer and a smith on their plinths, a street clock, a girder arch, a lit fountain, a little derrick, a glowing data pillar, a fountain of glowing water and a floating orb.
- **Icicles and snowdrifts.** Icicles hang from the eaves of the huts and shops in eras II to VIII, and soft drifts bank up against their side and back walls.
- **Easier to spot the fun.** Snowballs and snowmen are bigger, a hit bursts into a little puff of snow, more kids come out to play, and every green already has a snowman or two standing when you arrive.
- **Plazas on the big greens.** The larger hut greens in eras V to X get a ring walk and four paths out to their corners, so their middles no longer look empty.
- **The sledding hill sits nearer the road.** You can watch the sledders from R1 without zooming out.
- **A finished game may show less than 100 % now.** The new machine spots and lots count towards completion, so an older finished save shows a lower percentage until you build on them. Every trophy you've earned is kept.

### Connected machine yards

- **Machines in eras 2 to 10 are linked up like a real production line.** Neighbouring machines are joined overhead in each era's own style, with goods visibly travelling between them: a timber stone chute, an ore ropeway with swinging buckets, brass capsule tubes, a covered pellet bridge, copper power lines with bright sparks, an oil pipeline with glowing flow rings, data cable trays, glowing coolant tubes and golden light conduits. They light up softly at night and stay well above everyone's heads.
- **Conveyor belts in every era are painted in that era's own colours** instead of the starting area's red and cream.
- **The lone ninth machine in eras 8 and 9 is linked up too,** and era 10's golden light conduits look solid instead of see-through.
- **Every machine gets its conveyor belt.** A steel mill could end up with no belt from the pellet mine (and other machines with none at all) when their feeders stood further away or the belt lane was busy. Belts now reach a machine two rows away, and every machine that can be fed gets at least one belt in before any machine gets a second.

### Keyboard and controller

- **Build with a keyboard or a controller.** Every build card in the town, the era areas and the city can now be picked with Tab, the arrow keys and Enter, or the D-pad and A. The chosen card lights up with a gold ring, and locked cards say why.
- **Back / View opens the top buttons.** On a controller, Back (or View) steps up to the top buttons: the guidebook, quests, era checklist, map, Settings and sound. Move with the D-pad, press A, or B to step back to the game. Y still opens the map.
- **Menus open on their first choice,** never on the close button, and the arrow keys scroll long cards like the stats page.
- **Pick places on the map itself,** not only in the list beside it.
- **A purchase keeps your place.** After a buy, the shop button stays selected even when you can't afford the next level yet.
- **Clearer controls list.** Settings > Game lists every key and every controller button, and close buttons show their Esc key when you hover them.
- **Screen readers:** the sound button says on or off, shop, market and guidebook tabs say which is selected, prices say when you can't afford them yet, the quest and era counts are read in words, the pick-up prompt is read out, and cards are announced once. Key hints like "(T)" no longer show on phones and tablets.

### Clearer words

- **Era names read right.** No more "Needs the AI Era era" or "Reach the Frontier first": it's "Needs the AI Era" and "Reach the Frontier era first" everywhere.
- **Goods are named properly.** "1 gear" instead of "1 gears", and "AI cores" instead of "ai cores", in contracts, goals and the guidebook.
- **The guidebook matches how you play.** It says to hold E (or A on a controller) to pick up and pay, that drop-offs need no key, that a tap on a price buys one level, and that upgrades reach Lv 10 once the Great Lodge is built. The shop says so too ("Lv 4/9 · 10 after the Lodge").
- **Settlement spelled out.** The era checklist and the locked expansion pads say "Settlement 8/10" instead of "S8/10". On phones the checklist shows the same little house as the village badge.
- **City lots say what they give** on their own line, so it no longer gets cut off: homes add residents to your settlement, the rest say they add none.
- **The market in plain words.** "Your investments", "paid $3 each", "profit" and "Cash out" instead of positions, avg, P/L and withdraw.
- **Snowstorms and festivals tell the truth.** In a snowstorm the porter rushes firewood to the shops, and on festival day townsfolk come to shop twice as often.
- **Welcome back.** After a long break the card says how long you were away and that the first 2 hours count, and the guidebook explains what you earn while away.
- **Friendlier problem messages.** Startup and update problems speak plainly now, with no developer words or terminal commands.
- **Granite Hollow by name.** The Great Lodge card now sends you "On to Granite Hollow", the place you see on the map.
- **Down leaves the guidebook search box,** so you can reach the pages with the arrow keys.

### Phones and small screens

- **See more on a phone.** Held upright, a phone now shows about a third more of the world, the same scale as held sideways, so the counter, cash piles and pads are on screen from the start.
- **A tidier top bar on phones.** The era checklist chip moved next to the quests button, so the village badge has its whole row: its name, population and town happiness no longer get cut off or hide under the chip.
- **The goal banner stays put.** Opening the quest list on a phone no longer throws the goal banner to the bottom of the screen; the list opens just under it instead.
- **A readable map on phones.** The map is drawn bigger and you drag it to look around, so region and district names are a real size. It opens centred on you.
- **Price tags no longer pile up.** When signs and price tags would cover each other, the one nearest you shows and the others step aside until you walk closer.
- **Tall towers open up wider** around you in the later city districts, so you can see the street and the MANAGE board you are standing by.
- **Big numbers read easily.** The village badge shows "468K" people instead of "468085".
- **Shop lines wrap** instead of being cut off ("2 extra i…").
- **Short windows** (like 800 x 600) start with the quest list folded, and when you open it, it is wider and tighter.

### Clearer rules

- **The era checklist leads with the real cost.** It now says "Upgrades left: 28 (about $319M), then the expansion: $4.5M + 35 bricks", so the small pad price no longer hides the big part.
- **Quest rewards stay put.** A reward is fixed when the quest first shows and kept in your save, so a reload no longer turns $120,000 into $5,000.
- **Happiness and the northern lights say what they boost:** mill and Market Town sales. The guidebook adds that the market pays the same as the export depot, and that bigger docks and stalls only bring buyers more often.
- **Parks no longer promise jobs.** Park cards say "no residents, no jobs", and workplace cards show how full their jobs are across the whole city.
- **A heads-up before a lot blocks your quests.** If a park or workplace would leave too few lots for the district's homes and landmark goals, its card says so before you build, and once a district is too full, the workplace and park cards say which kind can come down to make room.
- **Village level-ups list every new hire,** including the Sled Dog, Town Porter and Foreman you need for the Frontier.
- **Builders explain their reserve.** Foremen always leave you part of your cash (40% in the eras, a fifth at the mill), and their shop text and the guidebook now say so.
- **Era gear says where it works.** Each era's Carry, Boots, Tool and Pal upgrades say they work only inside their own region.
- **Settlement gifts say to walk over them,** and the guidebook explains that machine staff count toward settlement and that residents fill jobs city-wide.
- **The market is easier to read.** Each price line is coloured by the same % it shows, the Prices and Invest tabs open with one plain line of help, the bond text says a better Stock Broker pays more, and every investment says how much you can put in.
- **While you were away, in full.** The guidebook says offline earnings never exceed a fifth of everything you've earned, that quests, contracts and Jack don't count, and that a hidden browser tab pauses the game.

### A guide you can follow

- **The arrow points the way you can walk.** It follows the path round fences, rivers and buildings instead of pointing through them, and a short trail of gold dots on the ground shows the way when it bends or the goal is off-screen. It finds the way again after fast travel, the map or a reload.
- **Steadier goals.** A new goal stays up long enough to read, the guide no longer flips back and forth between two goals, and it never pulls you off a pad while you're paying into it.
- **It tells you where things come from.** "Pick up 40 crates for Iron Ridge" leads you to the right machine or dock first, and new machine sites say what to bring and where to get it.
- **Expanding comes first.** Once you've met the next era's goal, the guide sends you there before anything else, and the crate crew holds crates back for it.
- **Town builds say what they need.** The Cocoa Café and the other town builds ask you to bring their logs, and send you to chop more when your arms are empty.
- **The arrow takes you all the way.** It stays up until you're standing on the pad that does the work, city goals point at a free lot rather than the whole district, and an empty maker sends you to feed it first.
- **You wake up where you left off.** Reloading puts you back where you were standing (just beside a pad or pile if you were on one), not back at the cabin.
- **The arrow keeps clear of the banner and the corner cards** (money, Winterland, quests, buttons), and the on-screen move pad stays hidden on desktop.

### Every era looks its own

- **Jack's cart dresses for the era.** His swap cart wears each era's colours, from terracotta in the Frontier to lavender and gold in the AI era, with a smarter straight trim from the Oil Age on.
- **Market shops of their time.** Iron Age shops are half-timbered forges with wooden canopies, Steam Age shops are brick with iron-and-glass canopies, Industrial shops are corrugated works stores with roller shutters. Computer Age pavilions now come in three shapes and four colours, and the AI era's dome shops in four colours with little side domes and antenna rings.
- **Crew icons tell you who's who.** Each era's crew icon shows that era's headgear (flat cap, miner's lamp, goggles, hard hat, clean-room hood, bubble hood, a friendly robot) and each job its own tool badge: scoop, flag, rucksack, basket, mallet or ledger.
- **City edges finished.** Where a district meets open snow, a soft snowbank with little firs, bushes and hedges now edges the pavement.
- **Calmer floors.** The Industrial era's brick yard and the Nuclear era's glazed slabs no longer read as zig-zags and polka dots.
- **Your pal keeps clear of the fire.** Warming up at a fire, your pal always sits a safe step away from it.

## 0.9.11 (2026-10-19)

Every era its own place, clearer pads and icons, a guidebook, a cooler-running game and a few cozy touches.

### Every era its own place

- **Each era has its own mood.** Its own light, sky, weather and air: warm frontier evenings, smoky steam-age haze, a cold sparkling tundra in era 7, soft pastel skies at the end. Nights differ from era to era too.
- **Eras 2 to 5 got their own ground and a landmark each:** a row of brick kilns, a mine cliff, a water tower with a coal wagon and a coke battery.
- **Era 7 is a cold tundra now,** era 8 has a little lighthouse on a frozen shore and era 9 has twin cooling towers.
- **Glass Heights steps down toward the frontier,** so its towers no longer loom over the log cabins next door.
- Homes in eras 8 and 10 come in different colours, and the busy floor patterns in eras 5 and 9 are calmer.

### Cozy touches

- **Warm-up spots.** Every era from 2 on has a little fire, stove or cocoa cart. Stand by it for a moment: the music softens and your pal settles down beside you.
- **Pet your pal.** Stand still next to your pal and it gets a pat now and then, with a little heart and a wag.
- **Paw prints.** Your pal leaves small paw prints in the snow next to yours.

### Easier to read

- **Pads say what they need.** Upgrade tags are bigger and show the materials to bring.
- **Every resource has its own icon shape,** not just its own colour, so iron ore and copper, or stone and coal, no longer look alike.
- **The carry counter shows what you hold,** whatever you picked up, not only logs.
- **Builders bring their material** to the quarry and the city again.
- **New: the guidebook.** Press G or tap the book button to look up every good, machine, crew, upgrade and rule of the eras you've reached.

### Runs cooler

- **Runs cooler.** Late-game scenes draw about half as much, so laptops stay cooler and quieter. The frame rate tops out at 60 and drops to 30 while another window is in front.
- **Macs: Apple chips only.** Winterland now ships for Macs with an Apple chip (M1 and later). Intel Macs stay on 0.9.10. If your Apple-chip Mac runs the Intel build (under Rosetta), download the `darwin-arm64` zip once by hand; updates work from then on.

### Linux

- **New: an AppImage download.** One file for Linux. Allow it to run as a program, then double-click it, or add it with Gear Lever. The game's own updater keeps it up to date in place, and Gear Lever's update button works too.
- **Starts on Ubuntu 24.04.** Ubuntu 24.04 blocks the game's safety sandbox, so the game used to close at once without a word. Now it asks once, with Ubuntu's own password window, to add Winterland to Ubuntu's list. The sandbox stays on. The zip has a *Set up for Ubuntu* file that does the same.

### Balance

- **Investing is a small bonus now.** Bonds, the index fund and ventures used to add about half again on top of what your factories earn, so investing could skip much of an era. They now add about a tenth: still worth a few clicks, never a shortcut past the grind. Bonds pay +4% after 10 minutes, and each product holds a few minutes of your sales. Money you already invested is safe and keeps its value.

## 0.9.10 (2026-10-18)

A calmer first hour, safer saves and updates, a fairer climb through the eras, tidier town life and prettier fields in eras 6 to 8.

### Easier to find your way

- **One next step.** The era chip and the goal banner now always show the same goal, and from era 2 on the guide keeps you on the current era instead of sending you back to old yard chores.
- **A calmer start.** A new game keeps the quest list folded until your first harvester, so the first minutes show one goal.
- **The era postcard no longer covers the move hint,** and its perks no longer look like buttons.
- **Meet MANAGE and the market.** A one-time tip shows what MANAGE signs do, and a small new quest, *Buy or sell a good at the market*, introduces trading.
- The cash hint now says "Walk over the cash to bank it", and a new era's "harvest by hand" step can no longer get stuck.

### Menus for everyone

- **Settings and the Shop work fully with a keyboard and screen reader.** Tab stays inside, and focus goes back where it was when they close.
- **New Comfort option: "Pause when a menu is open".** The world waits while Settings, the shop or a card is open. It's off unless you turn it on.
- **Credits** in Settings › Game.
- **Colour-blind friendly mode** now also covers the ticks and prices on pads and their tags.

### Your save and updates are safer

- **A spare copy of your save.** The desktop game keeps a copy of your save on your computer. If the main save is ever lost, the game offers to bring it back.
- **Saves from older versions always open now,** instead of being set aside.
- **Lighter when minimised.** A minimised game no longer draws in the background. Your factory keeps earning, and the game saves as you minimise.
- **Interrupted updates are undone cleanly.** If an update is cut off (a power cut, for example), the previous version is put back. Your save is never touched.
- Releases now come with signed build provenance, so anyone can check a download was built from this repository.

### A fairer climb

- **Era prices are re-balanced now that delivery-contract bonuses are counted.** Every era from 2 to 10 takes a little longer than the one before, from about 2 hours to about 2 h 40 min. Era 1 is unchanged.
- **Era builders leave you money to play with.** They always leave you at least 40 % of what you had.

### Market Town

- **No more surprise MANAGE cards.** Walking through the town no longer pops up a shop's card: it opens when you stop on the tile.
- **Townsfolk no longer stand inside each other** around the tree, the bandstand, the café and the benches, and they walk round the snowman park's fence and the benches instead of through them.

### Prettier fields, smoother arrivals

- **Walking into a newly opened era no longer stutters:** the game gets it ready while the era opens.
- **Electric Age:** copper-veined boulders and soft quartz clusters.
- **Oil Age:** honey-painted pumpjacks with barrels and little warm lamps.
- **Computer Age:** snowy silica dunes and gold-panning pools.

Your save carries over as it is.

## 0.9.9 (2026-10-17)

A fairer economy from era 2 on, builders that actually build, roads that lead somewhere, and a round of polish.

### A fairer economy from era 2 on

- **No more surprise millions.** Some goals for eras 4 to 10 showed up from era 2 and paid out those eras' rewards far too early. Each era's goals now wait for that era. Money you already got stays yours.
- **Era 2 to 10 upgrades cost more, and more with every level.** Each level now costs 10 to 20 % more than the last, so the late levels of an era are worth saving up for instead of costing pocket change. Era 1 is unchanged, and every later era is a little longer than the one before.

### Roads, rails and paths that make sense

- **The Timber Ridge rail ends at a proper buffer stop** north of the Market Town instead of running through houses into open snow.
- **Streets end in T-junctions,** the tricycle road gets stop lines where it meets the highway, and roads no longer run into fences or into nothing.
- **Fingerposts at every junction** of the era trail point to the next and previous eras by name.
- **Fences have gates where you need them,** era 7's pipes no longer cross its pads, and the era 3 and 4 tracks end at buffer stops.
- **A roomier Market Town.** The walks between its exits are clear, and a new east gate leads straight to the city's west street.

### Clearer signs and pads

- **MANAGE boards.** Every MANAGE sign is now a cream board on a little wooden post with the building's own name on it, standing right beside its building. On era machines it sits on the corner nearest you.
- **Frosty lantern pads stand out on pale snow,** with a deeper frost rim and a darker foot.
- Era 7 has more snow drifts, so it reads as winter, not desert.
- On the finale card at night, eras you haven't reached yet are easier to read.

### Fixes

- **Builders build again.** Each era's builder (Master Mason, Pit Boss and friends) now brings materials to a machine as soon as you choose it, and also pays for what you picked so the house, shop or machine actually goes up. They always leave a safety cushion in your wallet, and they never choose what to build or pay for a new era: that stays your call.
- **No more workers standing inside each other** at the era 1 yard drop-off. Porters and the foreman have their own spots.
- **Updating is safer when the game is slow to close.** The updater now waits for the game to close properly, so you're never left with no game open.

Your save carries over as it is.

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
