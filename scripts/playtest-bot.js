// In-page autoplay bot for Winterland (a single expression: shot.mjs evaluates `return (<code>)`). Injected by scripts/playtest.mjs (via shot.mjs `eval:`); it is
// plain browser JS, not part of the bundle. It plays the real economy loop — chop, carry, sell, collect,
// pay pads — teleporting between stations (walking is covered by other tests) and stepping the
// simulation without rendering. Every position comes from the live config, so layout changes are fine.
//
//   __bot.runUntil(goal, budgetSeconds) → { ok, goal, simSeconds, state }   goal: phase name | 'bothConveyors'
//   __bot.runFor(seconds) · __bot.frame(stationId) · __bot.report()
(() => {
  const W = window.__WINTERLAND__;
  const { LAYOUT, PADS } = W.config;
  const ctx = W.ctx;
  const level = W.level;
  const DT = 1 / 60;

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
  };

  const timeline = [];
  const stamp = () => Math.round(ctx.time.elapsed * 10) / 10;
  ctx.events.on('phase:changed', ({ phase }) => timeline.push({ t: stamp(), phase, money: ctx.economy.money }));
  ctx.events.on('pad:shown', ({ id }) => timeline.push({ t: stamp(), padShown: id }));
  ctx.events.on('pad:unlocked', ({ id }) => timeline.push({ t: stamp(), unlocked: id }));

  const actions = {};
  const count = (holder, kind) => (holder ? holder.count(kind) : 0);
  const room = (pile) => !!pile && pile.total < pile.capacity;

  function sim(seconds) {
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) W.game.step(DT);
  }

  function act(name, spot, seconds) {
    actions[name] = (actions[name] ?? 0) + 1;
    W.teleport(spot.x, spot.z);
    sim(seconds);
  }

  /** One decision + a few seconds of play. */
  function turn() {
    const arms = ctx.player.arms;
    const s = ctx.state;

    // 1. Pay any visible pad we can fully afford.
    for (const id of Object.keys(PADS)) {
      const pad = level.pads[id];
      if (s.padsVisible[id] && !s.unlocked[id] && ctx.economy.money >= pad.remaining) {
        act(`pay:${id}`, PADS[id], 4);
        return;
      }
    }
    // 2. Collect cash lying around.
    for (const [pile, spot] of [
      [level.walkInCash, spots.walkInCash],
      [level.seCash, spots.seCash],
      [level.truckCash, spots.truckCash],
    ]) {
      if (pile && pile.value >= 15) {
        act('collect', spot, 1.5);
        return;
      }
    }
    // 3. Deliver what we carry.
    if (count(arms, 'crate') > 0 && level.seCounter && room(level.seCounter.pile)) {
      act('deliver:crates', spots.se, 2);
      return;
    }
    if (count(arms, 'log') > 0) {
      if (level.truckCounter && room(level.truckCounter.pile) && count(level.truckCounter.pile) < 12) {
        act('deliver:truck', spots.truck, 2);
        return;
      }
      if (level.processor && !s.unlocked.eastConveyor && room(level.processor.input) && count(level.walkInCounter.pile) >= 6) {
        act('deliver:processor', spots.feed, 2);
        return;
      }
      if (room(level.walkInCounter.pile)) {
        act('deliver:walkIn', spots.walkIn, 2);
        return;
      }
      if (level.processor && room(level.processor.input)) {
        act('deliver:processor', spots.feed, 2);
        return;
      }
    }
    // 4. Fetch crates for the trikes.
    if (level.processor && count(level.processor.output, 'crate') >= 3 && level.seCounter && room(level.seCounter.pile) && arms.size < arms.capacity) {
      act('fetch:crates', spots.bench, 1.5);
      return;
    }
    // 5. Fetch logs, or chop more.
    if (count(level.dropZone.pile, 'log') >= 4 && arms.size < arms.capacity) {
      act('fetch:logs', spots.pickup, 1.5);
      return;
    }
    act('chop', spots.chop, 3);
  }

  const goals = {
    bothConveyors: () => ctx.state.unlocked.westConveyor && ctx.state.unlocked.eastConveyor,
  };

  function snapshot() {
    const st = W.state();
    return { t: st.t, phase: st.phase, money: st.money, liveItems: st.liveItems, stats: st.stats, level: st.level };
  }

  function runUntil(goal, budget = 300) {
    const reached = goals[goal] ?? (() => ctx.state.phase === goal || (goal !== 'expansion' && phaseIndex(ctx.state.phase) > phaseIndex(goal)));
    const t0 = ctx.time.elapsed;
    while (!reached() && ctx.time.elapsed - t0 < budget) turn();
    return { ok: reached(), goal, simSeconds: Math.round(ctx.time.elapsed - t0), state: snapshot() };
  }

  function phaseIndex(p) {
    return ['intro', 'manual', 'harvester', 'processor', 'automation', 'expansion'].indexOf(p);
  }

  function runFor(seconds) {
    const t0 = ctx.time.elapsed;
    while (ctx.time.elapsed - t0 < seconds) turn();
    return snapshot();
  }

  /** Park the player next to something worth photographing. */
  function frame(id) {
    const p = new ctx.player.position.constructor();
    level.anchorOf(id, p);
    W.teleport(p.x + 2.5, p.z + 2.5);
    sim(0.6);
  }

  window.__bot = { runUntil, runFor, frame, turn, spots, report: () => ({ timeline, actions, state: snapshot() }) };
  return 'bot ready';
})()
