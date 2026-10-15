// In-page autoplay bot for Winterland (a single expression: shot.mjs evaluates `return (<code>)`). Injected by scripts/playtest.mjs (via shot.mjs `eval:`); it is
// plain browser JS, not part of the bundle. It plays the whole game like a decent player — chop, carry, sell,
// collect, pay unlock and level pads, shop, carry logs to the village plots, build the Great Lodge — and steps the
// simulation without rendering. Walking is modelled, not animated: the player waits on a zone-free spot for
// distance × DETOUR / walk speed (so speed upgrades count), then appears at the destination and stays until the job
// there is done. Every position comes from the live config, so layout changes are fine.
//
// Spending policy: unlock pads first (as soon as affordable); otherwise the cheapest affordable purchase (level pad,
// shop item, next shelter tier), but while saving for a visible unlock pad / the Great Lodge only purchases up to
// SPEND_SHARE of what that goal still costs. Shelters stop at Winter City (more villagers change nothing).
//
//   __bot.runUntil(goal, budgetSeconds) → { ok, goal, simSeconds, state }
//       goal: phase name | pad id | 'bothConveyors' | 'shop' | 'village' | 'vl:<n>' (village level ≥ n) |
//             'hired:<crew id>' | 'q:<tier>' (bunkhouse tier ≥ n) | 'finale'
//   __bot.runFor(seconds) · __bot.frame(stationId | 'village' | 'shop') · __bot.perf() · __bot.report()
//   __bot.milestones() → first time (minutes) of every milestone seen, in order
(() => {
  const W = window.__WINTERLAND__;
  const { LAYOUT, PADS, VILLAGE, QUARTERS } = W.config;
  const ctx = W.ctx;
  const level = W.level;
  const up = ctx.upgrades;
  const DT = 1 / 60;
  /** Walking is never a straight line (machines, fences, turning). */
  const DETOUR = 1.3;
  /** While saving for a goal, purchases up to this share of what the goal still costs are fine. */
  const SPEND_SHARE = 0.3;
  /** Only to rank purchases: a log carried to a plot is worth this many dollars. */
  const LOG_VALUE = 10;
  /** Shelters also cost hand-carried logs (time), so an upgrade of similar price goes first. */
  const SHELTER_WEIGHT = 1.6;
  const WINTER_CITY = VILLAGE.levels.findIndex((l) => l.name === 'Winter City');

  const mid = (r) => ({ x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2 });
  const P = LAYOUT.processor;
  const spots = {
    chop: mid(LAYOUT.chopZone),
    pickup: { x: (LAYOUT.dropZone.zone.minX + LAYOUT.dropZone.collider.minX) / 2, z: LAYOUT.dropZone.z },
    walkIn: mid(LAYOUT.walkInCounter.playerZone),
    walkInCash: mid(LAYOUT.walkInCash.zone),
    feed: { x: (P.inputZone.minX + P.hopper.x - P.hopper.w / 2) / 2, z: P.hopper.z },
    bench: { x: (P.outputZone.maxX + P.outputTable.x + P.outputTable.w / 2) / 2, z: P.outputTable.z },
    se: mid(LAYOUT.seCounter.playerZone),
    seCash: mid(LAYOUT.seCash.zone),
    truck: mid(LAYOUT.expansion.truckCounter.playerZone),
    truckCash: mid(LAYOUT.expansion.truckCash.zone),
    shop: mid(LAYOUT.shop.mat),
    deck: mid(LAYOUT.ridge.deck.zone),
    platform: mid(LAYOUT.ridge.platform.playerZone),
    platformCash: mid(LAYOUT.ridge.platformCash.zone),
    workshopFeed: mid(LAYOUT.ridge.workshop.hopper.zone),
    workshopBench: mid(LAYOUT.ridge.workshop.bench.zone),
    sled: mid(LAYOUT.ridge.sledCounter.playerZone),
    sledCash: mid(LAYOUT.ridge.sledCash.zone),
  };

  // --- timeline + milestones ---------------------------------------------------------------------------------
  const timeline = [];
  const marks = {};
  const stamp = () => Math.round(ctx.time.elapsed * 10) / 10;
  const note = (entry) => timeline.push({ t: stamp(), money: ctx.economy.money, ...entry });
  const mark = (name) => {
    if (marks[name] === undefined) marks[name] = stamp();
  };
  const on = (event, fn) => ctx.events.on(event, fn);
  on('phase:changed', ({ phase }) => (note({ phase }), mark(`phase:${phase}`)));
  on('pad:shown', ({ id }) => note({ padShown: id }));
  on('pad:unlocked', ({ id }) => (note({ unlocked: id }), mark(id)));
  on('upgrade:bought', ({ id, level: lv }) => {
    note({ bought: `${id} ${lv}` });
    if (up.def(id).group === 'crew' && lv === 1) mark(`hire:${id}`);
    mark(`${id}:${lv}`);
  });
  on('shelter:built', ({ plot, tier }) => (note({ built: plot, tier }), plot < 0 && mark('greatLodge')));
  on('village:revealed', () => (note({ reveal: 'village' }), mark('village')));
  on('village:levelUp', ({ level: lv }) => (note({ villageLevel: lv }), mark(VILLAGE.levels[lv]?.name ?? `vl:${lv}`)));
  on('reveal', ({ what }) => (note({ reveal: what }), mark(`reveal:${what}`)));
  on('quarters:built', ({ tier }) => (note({ quarters: tier }), mark(`quarters:${tier}`)));
  on('sale', ({ buyer }) => buyer === 'sled' && mark('firstSled'));
  on('finale:start', () => (note({ finale: true }), mark('finale')));

  // --- primitives --------------------------------------------------------------------------------------------
  const actions = {};
  const count = (holder, kind) => (holder ? holder.count(kind) : 0);
  const room = (pile) => !!pile && pile.total < pile.capacity;
  const held = (stack) => stack.total ?? stack.size;
  const money = () => ctx.economy.money;

  function sim(seconds) {
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) W.game.step(DT);
  }

  /** A walkable spot no zone covers (rechecked every call: pads and mats appear over time). */
  let lobbyPos = null;
  function lobby() {
    const zones = ctx.zones.zones.filter((z) => !z.removed);
    const free = (x, z) =>
      !ctx.colliders.overlaps(x, z, 0.6) &&
      !zones.some((zn) => x > zn.area.minX - 0.8 && x < zn.area.maxX + 0.8 && z > zn.area.minZ - 0.8 && z < zn.area.maxZ + 0.8);
    if (lobbyPos && free(lobbyPos.x, lobbyPos.z)) return lobbyPos;
    const Y = LAYOUT.yard;
    for (let x = Y.minX + 1.5; x <= Y.maxX - 1.5; x += 0.5) {
      for (let z = Y.minZ + 1.5; z <= Y.maxZ - 1.5; z += 0.5) if (free(x, z)) return (lobbyPos = { x, z });
    }
    return (lobbyPos = { x: 0, z: 0 });
  }

  /** Walk to `spot`: time passes at walking speed while the player is out of every zone, then they arrive. */
  function walkTo(spot) {
    const p = ctx.player.position;
    const d = Math.hypot(spot.x - p.x, spot.z - p.z) * DETOUR;
    if (d > 0.8) {
      const l = lobby();
      W.teleport(l.x, l.z);
      sim(d / up.value('speed'));
    }
    W.teleport(spot.x, spot.z);
  }

  /** Stand still until done() (checked every 0.1 s) or `max` seconds. */
  function stay(max, done) {
    for (let t = 0; t < max; t += 0.1) {
      sim(0.1);
      if (done && done()) return;
    }
  }

  function act(name, spot, max, done) {
    actions[name] = (actions[name] ?? 0) + 1;
    walkTo(spot);
    stay(max, done);
  }

  // --- village -----------------------------------------------------------------------------------------------
  /** The offered pad of plot `plot` (−1 = Great Lodge): where to stand and what it still needs; null if none. */
  function plotInfo(plot) {
    if (plot === 'q') return quartersInfo();
    const village = level.village;
    const spot = village && village.padSpot(plot);
    if (!spot) return null;
    const v = ctx.state.village;
    const p = plot < 0 ? v.greatLodge : v.plots[plot];
    const def = plot < 0 ? VILLAGE.greatLodge : VILLAGE.tiers[p.tier + 1];
    if (!p || !def) return null;
    return { plot, spot, logsLeft: Math.max(0, def.logs - p.logs), cashLeft: Math.max(0, def.cash - p.cash) };
  }

  /** The crew bunkhouse's next tier on Timber Ridge (plot id 'q'), same shape as plotInfo. */
  function quartersInfo() {
    const spot = level.quarters && level.quarters.padSpot();
    const q = ctx.state.quarters;
    const def = QUARTERS.tiers[q.tier + 1];
    if (!spot || !def) return null;
    return { plot: 'q', spot, logsLeft: Math.max(0, def.logs - q.logs), cashLeft: Math.max(0, def.cash - q.cash) };
  }

  /** Plot being built and the tier it started from (kept across turns until that tier completes). */
  let build = null;
  let buildTier = 0;
  const tierOf = (plot) => (plot === 'q' ? ctx.state.quarters.tier : plot < 0 ? ctx.state.village.greatLodge.tier : ctx.state.village.plots[plot].tier);
  const startBuild = (plot, info) => ((build = plot), (buildTier = tierOf(plot)), buildTurn(info));

  /** One step toward finishing `info`; false when there is nothing useful to do for it right now. */
  function buildTurn(info) {
    const arms = ctx.player.arms;
    const logs = count(arms, 'log');
    if (info.logsLeft > 0 && logs === 0) {
      if (held(arms) >= arms.capacity) return false; // arms full of something else: let the loop clear them
      // The bunkhouse stands on the ridge: the log deck is the nearer source when it has logs.
      const deck = level.treeFeller && level.treeFeller.deck;
      const fromDeck = info.plot === 'q' && count(deck, 'log') > 0;
      const pile = fromDeck ? deck : level.dropZone.pile;
      if (count(pile, 'log') > 0) {
        act('build:fetch', fromDeck ? spots.deck : spots.pickup, 4, () => held(arms) >= arms.capacity || count(pile, 'log') === 0 || count(arms, 'log') >= info.logsLeft);
      } else {
        act('chop', spots.chop, 3);
      }
      return true;
    }
    if (info.logsLeft === 0 && money() < info.cashLeft) return false; // logs done; earn the rest first
    act(info.plot === 'q' ? 'build:quarters' : info.plot < 0 ? 'build:greatLodge' : 'build:plot', info.spot, 10, () => {
      const now = plotInfo(info.plot);
      return !now || tierOf(info.plot) !== buildTier || ((now.logsLeft === 0 || count(arms, 'log') === 0) && (now.cashLeft === 0 || money() < 5));
    });
    return true;
  }

  // --- spending ----------------------------------------------------------------------------------------------
  /** What the visible unlock pads / the Great Lodge still cost (the cheapest), or null when nothing is saved for. */
  function savingGoal() {
    let goal = null;
    for (const id of Object.keys(PADS)) {
      const pad = level.pads[id];
      if (pad && pad.visible && !pad.levelMode && !ctx.state.unlocked[id]) goal = goal === null ? pad.remaining : Math.min(goal, pad.remaining);
    }
    // The first bunkhouse tier opens the pine hauler and more crew: save for it like an unlock.
    const q = quartersInfo();
    if (q && ctx.state.quarters.tier < 0) goal = goal === null ? q.cashLeft : Math.min(goal, q.cashLeft);
    const lodge = plotInfo(-1);
    if (lodge) goal = goal === null ? lodge.cashLeft : Math.min(goal, lodge.cashLeft);
    return goal;
  }

  function shop(id) {
    actions[`buy:${id}`] = (actions[`buy:${id}`] ?? 0) + 1;
    walkTo(spots.shop);
    stay(0.8);
    up.buy(id);
  }

  function payLevel(id) {
    const pad = level.pads[id];
    const before = up.level(id);
    act(`level:${id}`, PADS[id], 6, () => up.level(id) > before || !pad.visible);
  }

  /** Buy the cheapest worthwhile thing we can afford; false if nothing qualifies. */
  function spendTurn() {
    const s = ctx.state;
    const cash = money();
    const goal = savingGoal();
    const ok = (cost) => cost <= cash && (goal === null || cost <= SPEND_SHARE * goal);
    const options = [];
    for (const id of Object.keys(PADS)) {
      const pad = level.pads[id];
      if (pad && pad.visible && pad.levelMode && ok(pad.remaining)) options.push({ rank: pad.remaining, run: () => payLevel(id) });
    }
    if (s.flags.shopRevealed) {
      for (const id of up.ids) {
        if (up.def(id).group === 'machine') continue; // machines level up on their pads
        const cost = up.nextCost(id);
        if (cost !== null && up.canBuy(id) && ok(cost)) options.push({ rank: cost, run: () => shop(id) });
      }
    }
    if (build === null && s.village.revealed) {
      const lodge = plotInfo(-1);
      if (lodge && lodge.cashLeft <= cash) options.push({ rank: -1, run: () => startBuild(-1, lodge) });
      const q = quartersInfo();
      if (q && s.quarters.tier < 0 && q.cashLeft <= cash) options.push({ rank: -2, run: () => startBuild('q', q) });
      else if (q && ok(q.cashLeft)) options.push({ rank: q.cashLeft + q.logsLeft * LOG_VALUE, run: () => startBuild('q', q) });
      if (s.village.level < WINTER_CITY) {
        for (let i = 0; i < VILLAGE.plotLevels.length; i++) {
          const info = plotInfo(i);
          if (info && ok(info.cashLeft)) options.push({ rank: SHELTER_WEIGHT * (info.cashLeft + info.logsLeft * LOG_VALUE), run: () => startBuild(i, info) });
        }
      }
    }
    if (options.length === 0) return false;
    options.sort((a, b) => a.rank - b.rank);
    const r = options[0].run();
    return r !== false;
  }

  // --- the economy loop --------------------------------------------------------------------------------------
  /** One decision + the time it takes. */
  function turn() {
    const arms = ctx.player.arms;
    const s = ctx.state;

    // 1. An unlock pad we can fully afford.
    for (const id of Object.keys(PADS)) {
      const pad = level.pads[id];
      if (pad && pad.visible && !pad.levelMode && !s.unlocked[id] && money() >= pad.remaining) {
        act(`pay:${id}`, PADS[id], 6, () => !!s.unlocked[id]);
        return;
      }
    }
    // 2a. Furniture in hand goes to the dog sleds.
    const sledCounter = level.sledCounter;
    if (count(arms, 'furniture') > 0 && sledCounter && room(sledCounter.pile)) {
      act('deliver:furniture', spots.sled, 4, () => count(arms, 'furniture') === 0 || !room(sledCounter.pile));
      return;
    }
    // 2. Crates in hand go to the trikes.
    const se = level.seCounter;
    if (count(arms, 'crate') > 0 && se && room(se.pile)) {
      act('deliver:crates', spots.se, 4, () => count(arms, 'crate') === 0 || !room(se.pile));
      return;
    }
    // 3. The shelter being built.
    if (build !== null) {
      const info = plotInfo(build);
      if (!info || tierOf(build) !== buildTier || (info.logsLeft === 0 && info.cashLeft === 0)) build = null;
      else if (buildTurn(info)) return;
    }
    // 4. Spend.
    if (spendTurn()) return;

    const cashSpots = [
      [level.walkInCash, spots.walkInCash],
      [level.seCash, spots.seCash],
      [level.truckCash, spots.truckCash],
      [level.platformCash, spots.platformCash],
      [level.sledCash, spots.sledCash],
    ];
    const collect = (min) => {
      for (const [pile, spot] of cashSpots) {
        if (pile && pile.value >= min) {
          act('collect', spot, 3, () => pile.value === 0);
          return true;
        }
      }
      return false;
    };
    // 5. Deliver the logs we carry.
    const truck = level.truckCounter;
    const proc = level.processor;
    const walkIn = level.walkInCounter;
    const drop = (name, spot, pile) => act(name, spot, 4, () => count(arms, 'log') === 0 || !room(pile));
    const platform = level.platformCounter;
    if (count(arms, 'log') > 0) {
      // Furniture pays the most per log, then trains; the walk across the ridge is the price.
      const ws = level.workshop;
      if (ws && room(ws.input) && count(ws.input) < 10) return drop('deliver:workshop', spots.workshopFeed, ws.input);
      if (platform && room(platform.pile) && count(platform.pile) < 10) return drop('deliver:platform', spots.platform, platform.pile);
      if (truck && room(truck.pile) && count(truck.pile) < 12) return drop('deliver:truck', spots.truck, truck.pile);
      if (proc && !s.unlocked.eastConveyor && room(proc.input) && count(walkIn.pile) >= 6) return drop('deliver:processor', spots.feed, proc.input);
      if (room(walkIn.pile)) return drop('deliver:walkIn', spots.walkIn, walkIn.pile);
      if (proc && room(proc.input)) return drop('deliver:processor', spots.feed, proc.input);
    }
    // 6. A big cash pile is worth a trip.
    if (collect(40)) return;
    // 7. Phase 5: only the player (or the log hauler) feeds the trucks, so an emptying truck counter comes first.
    const dz = level.dropZone.pile;
    const fetchLogs = () => act('fetch:logs', spots.pickup, 4, () => held(arms) >= arms.capacity || count(dz, 'log') === 0);
    const logsReady = count(dz, 'log') >= 4 && held(arms) < arms.capacity;
    if (truck && count(truck.pile) < 6 && logsReady && !level.truckLoader) return fetchLogs();
    // 7a. Chairs from the workshop bench to the sleds.
    const wshop = level.workshop;
    if (wshop && count(wshop.output, 'furniture') >= 3 && sledCounter && room(sledCounter.pile) && held(arms) < arms.capacity) {
      act('fetch:furniture', spots.workshopBench, 4, () => held(arms) >= arms.capacity || count(wshop.output, 'furniture') === 0);
      return;
    }
    // 7b. Pine logs from the ridge deck to the train (until the pine hauler does it).
    const deck = level.treeFeller && level.treeFeller.deck;
    const workshopHungry = !!wshop && count(wshop.input) < 4;
    if (count(deck, 'log') >= 4 && held(arms) < arms.capacity && (workshopHungry || (platform && count(platform.pile) < 6 && !up.isHired('pineHauler')))) {
      act('fetch:pine', spots.deck, 4, () => held(arms) >= arms.capacity || count(deck, 'log') === 0);
      return;
    }
    // 8. Fetch crates for the trikes.
    if (proc && count(proc.output, 'crate') >= 3 && se && room(se.pile) && held(arms) < arms.capacity) {
      act('fetch:crates', spots.bench, 4, () => held(arms) >= arms.capacity || count(proc.output, 'crate') === 0);
      return;
    }
    // 9. Fetch logs while something still needs them carried by hand.
    const needLogs = (!!truck && count(truck.pile) < 12 && !level.truckLoader) || (!!platform && count(platform.pile) < 6) || !s.unlocked.westConveyor || !s.unlocked.eastConveyor;
    if (needLogs && logsReady) return fetchLogs();
    // 10. Small change, or chop more.
    if (collect(5)) return;
    act('chop', spots.chop, 3);
  }

  // --- driver ------------------------------------------------------------------------------------------------
  const PHASES = ['intro', 'manual', 'harvester', 'processor', 'automation', 'expansion'];
  function reachedFn(goal) {
    const s = ctx.state;
    if (goal === 'bothConveyors') return () => s.unlocked.westConveyor && s.unlocked.eastConveyor;
    if (goal === 'shop') return () => !!s.flags.shopRevealed;
    if (goal === 'village') return () => s.village.revealed;
    if (goal === 'finale') return () => s.village.greatLodge.tier >= 0;
    if (goal.startsWith('vl:')) return () => s.village.level >= Number(goal.slice(3));
    if (goal.startsWith('q:')) return () => s.quarters.tier >= Number(goal.slice(2));
    if (goal.startsWith('hired:')) return () => up.isHired(goal.slice(6));
    if (PHASES.includes(goal)) return () => s.phase === goal || (goal !== 'expansion' && PHASES.indexOf(s.phase) > PHASES.indexOf(goal));
    if (goal in PADS) return () => !!s.unlocked[goal];
    throw new Error(`unknown goal ${goal}`);
  }

  function snapshot() {
    const st = W.state();
    return {
      t: st.t,
      min: Math.round((ctx.time.elapsed / 60) * 10) / 10,
      phase: st.phase,
      money: st.money,
      liveItems: st.liveItems,
      stats: st.stats,
      upgrades: { ...ctx.state.upgrades },
      village: { level: ctx.state.village.level, population: ctx.state.village.population, plots: ctx.state.village.plots.map((p) => p.tier) },
      crew: level.crew ? level.crew.size : 0,
      quarters: ctx.state.quarters.tier,
    };
  }

  function runUntil(goal, budget = 300) {
    const reached = reachedFn(goal);
    const t0 = ctx.time.elapsed;
    while (!reached() && ctx.time.elapsed - t0 < budget) turn();
    return { ok: reached(), goal, simSeconds: Math.round(ctx.time.elapsed - t0), state: snapshot() };
  }

  function runFor(seconds) {
    const t0 = ctx.time.elapsed;
    while (ctx.time.elapsed - t0 < seconds) turn();
    return snapshot();
  }

  /** Milestones in the order they happened, in minutes of play. */
  function milestones() {
    return Object.entries(marks)
      .sort((a, b) => a[1] - b[1])
      .map(([name, t]) => `${(t / 60).toFixed(1).padStart(5)}  ${name}`);
  }

  /** Park the player next to something worth photographing. */
  function frame(id) {
    if (id === 'village') {
      const st = LAYOUT.village.street;
      W.teleport((st.minX + st.maxX) / 2, 19);
    } else if (id === 'shop') {
      W.teleport(spots.shop.x, spots.shop.z + 1.5);
    } else {
      const p = new ctx.player.position.constructor();
      level.anchorOf(id, p);
      W.teleport(p.x + 2.5, p.z + 2.5);
    }
    sim(0.6);
  }

  /** Renderer cost of the current view: renders one frame, returns three.js render/memory counters. */
  function perf() {
    W.simulate(DT, DT);
    const info = ctx.renderer.renderer.info;
    return { calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures, liveItems: W.state().liveItems };
  }

  window.__bot = { runUntil, runFor, frame, turn, spots, perf, milestones, report: () => ({ timeline, actions, marks, state: snapshot() }) };
  return 'bot ready';
})()
