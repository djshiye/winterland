// In-page AI watchdog for the soak run (scripts/soak.mjs injects it as a classic script; plain browser JS, not part
// of the bundle). It finds every moving character the game owns (crew helpers, era workers, customers, townsfolk,
// vehicles, the dog) by walking the live object graph from the debug API, steps the simulation in fixed frames
// without rendering, samples every agent twice a second and records problems:
//
// Failures:
//   escaped   position is NaN / Infinity or far outside the world
//   jammed    has an unfinished route but has not moved for JAM_SECONDS (walking on the spot, never arriving)
//   loaded    carries items but has not moved for LOADED_SECONDS (waits forever with a load)
//   jumped    moved farther in one sample than its own speed allows (teleport) while visible
//   error     the simulation threw
// Minor (listed, do not fail the run):
//   solid     stands inside a solid obstacle (the player's collider world) for SOLID_SECONDS or more in one go
//   stacked   two people stand inside each other (centres < STACK_DIST apart, neither moving) for STACK_SECONDS
// Notes:
//   idle      never moved during a whole measured stretch (staff at counters, a sitting dog, a fully built world's
//             foreman: usually fine, worth a glance when a hauler shows up here)
//
// window.__soak = { reset(label), run(seconds), report(), agents() }
(() => {
  const W = window.__WINTERLAND__;
  const ctx = W.ctx;
  const DT = 1 / 60;
  const SAMPLE = 0.5;
  const RESCAN = 5;
  const JAM_SECONDS = 8;
  const LOADED_SECONDS = 180;
  const SOLID_SECONDS = 1.5;
  const STACK_DIST = 0.3;
  const STACK_SECONDS = 4;
  const JUMP_DIST = 6;
  const WORLD = 3000;
  /** States where a person stands on purpose inside a prop's collider: a seat on a bench, behind a stall counter. */
  const AT_SPOT = new Set(['sit', 'work']);
  /**
   * Collider tags people may be inside by design: the cafe's footprint is mostly its stools and tables, and the
   * bandstand's round deck sits inside its square collider (the corners are open ground).
   */
  const WALKABLE_TAGS = new Set(['town:amenity:cafe', 'town:amenity:bandstand']);
  /** Skaters glide over the pond ice on purpose. */
  const allowedIn = (a, tag) => WALKABLE_TAGS.has(tag) || (tag === 'town:amenity:pond' && a.act === 'pond');

  const SKIP_KEYS = new Set(['ctx', 'level', 'scene', 'parent', 'children', 'peers', 'events', 'tweens', 'items', 'flights', 'renderer', 'camera', 'cameraRig', 'input', 'audio', 'hud', 'particles', 'partner', 'geometry', 'material', 'rig', 'bubble', 'stack', 'cargo', 'basket', 'owner', 'sink']);

  const isObj3D = (o) => !!o && typeof o === 'object' && o.isObject3D === true;

  /** The scene object that carries an agent, if any. */
  function bodyOf(a) {
    if (isObj3D(a.group)) return a.group;
    if (isObj3D(a.object)) return a.object;
    if (a.model && isObj3D(a.model.root)) return a.model.root;
    if (a.parts && isObj3D(a.parts.root)) return a.parts.root;
    return null;
  }

  /** In the scene and visible all the way up. */
  function shown(o) {
    let v = o;
    while (v) {
      if (!v.visible) return false;
      if (v.isScene) return true;
      v = v.parent;
    }
    return false;
  }

  function looksLikeAgent(a) {
    if (typeof a.speed !== 'number') return false;
    if (bodyOf(a)) return true;
    // townsfolk: plain x / z driving a crowd person
    return typeof a.x === 'number' && typeof a.z === 'number' && 'p' in a && a.path && typeof a.path.n === 'number';
  }

  function kindOf(path) {
    if (/^(eras|regions)/.test(path)) return 'eraWorker';
    if (path.startsWith('crew')) return 'crew';
    if (path.startsWith('townsfolk')) return 'townsfolk';
    if (path.startsWith('customers')) return 'customer';
    if (/^(trucks|tricycles|sleds|trains)/.test(path)) return 'vehicle';
    if (path.startsWith('dog')) return 'dog';
    return 'other';
  }

  /** Breadth-first walk of the game objects; returns [{ agent, path }] for every live agent. */
  function scan() {
    const out = [];
    const seen = new Set();
    const queue = [[W.level, '']];
    if (ctx.player && ctx.player.dog) queue.push([ctx.player.dog, 'dog']);
    seen.add(W.level);
    let head = 0;
    while (head < queue.length) {
      const [o, path] = queue[head++];
      if (path.split('.').length > 7) continue;
      // a top-level object (the sled queue itself) is a manager, not an agent; the dog is the one exception
      if (path && (path.includes('.') || path === 'dog') && looksLikeAgent(o)) {
        out.push({ agent: o, path });
        continue;
      }
      const visit = (v, key) => {
        if (!v || typeof v !== 'object' || seen.has(v) || isObj3D(v) || ArrayBuffer.isView(v)) return;
        if (v.isMaterial || v.isTexture || v.isBufferGeometry || v.isVector3 || v.isColor) return;
        seen.add(v);
        queue.push([v, path ? `${path}.${key}` : String(key)]);
      };
      if (Array.isArray(o)) o.forEach((v, i) => visit(v, i));
      else if (o instanceof Map) o.forEach((v, k) => visit(v, k));
      else if (o instanceof Set) {
        let i = 0;
        o.forEach((v) => visit(v, i++));
      } else for (const k of Object.keys(o)) if (!SKIP_KEYS.has(k)) visit(o[k], k);
    }
    return out;
  }

  function live(a) {
    if (a.gone || a.disposing || a.fading) return false;
    if (typeof a.hold === 'number' && a.hold > 0) return false;
    const b = bodyOf(a);
    if (b) return shown(b);
    return !!(a.p && a.p.active);
  }

  const tmp = { x: 0, z: 0 };
  function pos(a) {
    const b = bodyOf(a);
    if (b) {
      b.updateWorldMatrix(true, false);
      const e = b.matrixWorld.elements;
      tmp.x = e[12];
      tmp.z = e[14];
    } else {
      tmp.x = a.x;
      tmp.z = a.z;
    }
    return tmp;
  }

  function hasRoute(a) {
    if (Array.isArray(a.route) && typeof a.routeIdx === 'number') return a.routeIdx < a.route.length;
    if (a.path && typeof a.path.i === 'number' && typeof a.path.n === 'number' && a.mode && a.mode !== 'idle') return a.path.i < a.path.n;
    return false;
  }

  const carrying = (a) => (a.stack && typeof a.stack.size === 'number' ? a.stack.size : 0);
  const stateOf = (a) => String(a.phase ?? a.mode ?? a.kind ?? '');

  let label = '';
  let simTime = 0;
  let tracks = new Map(); // agent -> track
  let findings = [];
  let pairs = new Map(); // "i|j" -> seconds stacked
  let samples = 0;
  let errors = 0;
  let maxAgents = 0;

  function reset(l) {
    label = l;
    simTime = 0;
    tracks = new Map();
    findings = [];
    pairs = new Map();
    samples = 0;
    errors = 0;
    maxAgents = 0;
  }

  const round = (v) => Math.round(v * 10) / 10;

  function add(type, t, detail) {
    return findings[findings.push({ type, scenario: label, agent: t ? t.path : '', kind: t ? t.kind : '', t: Math.round(simTime), ...detail }) - 1];
  }

  function track(agent, path) {
    let t = tracks.get(agent);
    if (!t) {
      const p = pos(agent);
      t = {
        agent,
        path,
        kind: kindOf(path),
        x: p.x,
        z: p.z,
        anchorX: p.x,
        anchorZ: p.z,
        anchorT: simTime,
        stillFor: 0,
        jamFor: 0,
        loadFor: 0,
        solidFor: 0,
        solidAt: null,
        moved: 0,
        firstSeen: simTime,
        lastSeen: simTime,
        live: false,
        reported: new Set(),
        trail: [],
      };
      tracks.set(agent, t);
    }
    t.path = path;
    return t;
  }

  function once(t, key, fn) {
    if (t.reported.has(key)) return;
    t.reported.add(key);
    fn();
  }

  function sample() {
    samples++;
    const liveTracks = [];
    for (const t of tracks.values()) {
      const a = t.agent;
      const wasLive = t.live;
      t.live = live(a);
      if (!t.live) {
        t.stillFor = t.jamFor = t.loadFor = t.solidFor = 0;
        if (t.jam) {
          t.jam.finding.ongoing = false;
          t.jam.finding.endedBy = 'left';
          t.jam = null;
        }
        continue;
      }
      const p = pos(a);
      t.lastSeen = simTime;
      if (!Number.isFinite(p.x) || !Number.isFinite(p.z) || Math.abs(p.x) > WORLD || Math.abs(p.z) > WORLD) {
        once(t, 'escaped', () => add('escaped', t, { x: p.x, z: p.z, state: stateOf(a) }));
        continue;
      }
      const step = Math.hypot(p.x - t.x, p.z - t.z);
      // farther than its own walking speed allows (pooled townsfolk popping in somewhere new are fine)
      const reach = Math.max(t.speed || 0, a.speed || 0) * SAMPLE * 1.5 + 1;
      const popping = a.p && typeof a.p.appear === 'number' && a.p.appear < 0.99;
      if (wasLive && step > Math.max(JUMP_DIST, reach) && t.kind !== 'vehicle' && !popping)
        add('jumped', t, { from: [round(t.x), round(t.z)], to: [round(p.x), round(p.z)], state: stateOf(a), speed: round(a.speed) });
      t.speed = a.speed;
      t.moved += wasLive ? step : 0;
      t.trail.push([round(p.x), round(p.z)]);
      if (t.trail.length > 6) t.trail.shift();
      t.x = p.x;
      t.z = p.z;
      const moving = step > 0.02;
      t.moving = moving;
      // still: no more than 0.3 m from where it stood when it stopped
      if (Math.hypot(p.x - t.anchorX, p.z - t.anchorZ) > 0.3) {
        t.anchorX = p.x;
        t.anchorZ = p.z;
        t.anchorT = simTime;
        t.stillFor = 0;
      } else t.stillFor = simTime - t.anchorT;

      const jam = hasRoute(a) && !moving;
      t.jamFor = jam ? t.jamFor + SAMPLE : 0;
      if (t.jamFor >= JAM_SECONDS && !t.jam) {
        t.jam = { at: [round(p.x), round(p.z)], state: stateOf(a), route: routeOf(a), since: simTime - t.jamFor };
        t.jam.finding = add('jammed', t, { ...t.jam, seconds: t.jamFor, ongoing: true });
      }
      if (t.jam) {
        t.jam.finding.seconds = Math.round(simTime - t.jam.since);
        if (!jam) {
          t.jam.finding.ongoing = false;
          t.jam = null;
        }
      }

      // a customer in the queue holding part of its order waits for the counter to restock: that is the game
      const waitingForStock = t.kind === 'customer' && stateOf(a) === 'queue';
      t.loadFor = carrying(a) > 0 && t.stillFor > 0 && !waitingForStock ? t.stillFor : 0;
      if (t.loadFor >= LOADED_SECONDS) once(t, `load:${Math.round(t.anchorT)}`, () => add('loaded', t, { at: [round(p.x), round(p.z)], items: carrying(a), state: stateOf(a) }));

      const atSpot = AT_SPOT.has(stateOf(a)) && !moving;
      if (t.kind !== 'vehicle' && !atSpot && ctx.colliders.overlaps(p.x, p.z, 0.05) && tagsAt(p.x, p.z).some((g) => !allowedIn(a, g))) {
        if (t.solidFor === 0) t.solidAt = [round(p.x), round(p.z)];
        t.solidFor += SAMPLE;
        if (t.solidFor >= SOLID_SECONDS) once(t, `solid:${t.solidAt}`, () => add('solid', t, { at: t.solidAt, state: stateOf(a), act: a.act, tags: tagsAt(p.x, p.z), route: routeOf(a), plan: planOf(a), from: t.trail.slice() }));
      } else t.solidFor = 0;
      if (t.kind !== 'vehicle') liveTracks.push(t);
    }
    maxAgents = Math.max(maxAgents, liveTracks.length);
    // stacked people: grid hash at 1 m
    const grid = new Map();
    for (let i = 0; i < liveTracks.length; i++) {
      const t = liveTracks[i];
      const k = `${Math.floor(t.x)},${Math.floor(t.z)}`;
      let cell = grid.get(k);
      if (!cell) grid.set(k, (cell = []));
      cell.push(i);
    }
    const nextPairs = new Map();
    for (let i = 0; i < liveTracks.length; i++) {
      const a = liveTracks[i];
      const cx = Math.floor(a.x);
      const cz = Math.floor(a.z);
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++) {
          const cell = grid.get(`${cx + dx},${cz + dz}`);
          if (!cell) continue;
          for (const j of cell) {
            if (j <= i) continue;
            const b = liveTracks[j];
            if (a.moving || b.moving) continue;
            if (Math.hypot(a.x - b.x, a.z - b.z) >= STACK_DIST) continue;
            const key = `${a.path}|${b.path}`;
            const s = (pairs.get(key) ?? 0) + SAMPLE;
            nextPairs.set(key, s);
            if (s >= STACK_SECONDS && s < STACK_SECONDS + SAMPLE) add('stacked', a, { other: b.path, otherKind: b.kind, at: [round(a.x), round(a.z)], states: [stateOf(a.agent), stateOf(b.agent)] });
          }
        }
    }
    pairs = nextPairs;
  }

  function routeOf(a) {
    if (Array.isArray(a.route)) return a.route.slice(a.routeIdx, a.routeIdx + 4).map((p) => [round(p.x), round(p.z)]);
    if (a.path && a.path.x) {
      const r = [];
      for (let i = a.path.i; i < Math.min(a.path.n, a.path.i + 4); i++) r.push([round(a.path.x[i]), round(a.path.z[i])]);
      return r;
    }
    return [];
  }

  function planOf(a) {
    if (!a.path || !a.path.x) return undefined;
    const r = [];
    for (let i = 0; i < a.path.n; i++) r.push([round(a.path.x[i]), round(a.path.z[i])]);
    return { at: a.path.i, points: r };
  }

  function tagsAt(x, z) {
    const out = [];
    for (const c of ctx.colliders.colliders ?? []) {
      if (!c.enabled) continue;
      const hit =
        c.kind === 0
          ? x > c.minX - 0.05 && x < c.maxX + 0.05 && z > c.minZ - 0.05 && z < c.maxZ + 0.05
          : Math.hypot(x - c.x, z - c.z) < c.r + 0.05;
      if (hit) out.push(c.tag);
    }
    return out;
  }

  let rescanIn = 0;
  let sampleIn = 0;
  function rescan() {
    for (const { agent, path } of scan()) track(agent, path);
  }

  /** Step `seconds` of simulation, sampling as it goes. Returns a short progress line. */
  function run(seconds) {
    const steps = Math.round(seconds / DT);
    const t0 = performance.now();
    for (let i = 0; i < steps; i++) {
      try {
        W.game.step(DT);
      } catch (e) {
        errors++;
        if (errors <= 3) add('error', null, { message: String((e && e.stack) || e).slice(0, 600) });
      }
      simTime += DT;
      rescanIn -= DT;
      sampleIn -= DT;
      if (rescanIn <= 0) {
        rescanIn = RESCAN;
        rescan();
      }
      if (sampleIn <= 0) {
        sampleIn = SAMPLE;
        sample();
      }
    }
    return { label, sim: Math.round(simTime), ms: Math.round(performance.now() - t0), agents: maxAgents, findings: findings.length };
  }

  /** Close a measured stretch: agents that never moved get an `idle` note. */
  function report() {
    const idle = [];
    for (const t of tracks.values()) {
      if (t.lastSeen - t.firstSeen < 120 || t.moved > 0.5) continue;
      idle.push({ agent: t.path, kind: t.kind, at: [round(t.x), round(t.z)], state: stateOf(t.agent), items: carrying(t.agent) });
    }
    const byKind = {};
    for (const t of tracks.values()) byKind[t.kind] = (byKind[t.kind] ?? 0) + 1;
    return { scenario: label, simSeconds: Math.round(simTime), samples, agentsSeen: tracks.size, maxLive: maxAgents, byKind, findings: findings.slice(), idle };
  }

  function agents() {
    rescan();
    return [...tracks.values()].map((t) => ({ path: t.path, kind: t.kind, live: live(t.agent) }));
  }

  window.__soak = { reset, run, report, agents };
})();
