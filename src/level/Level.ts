/**
 * [MAIN — wave-1 sandbox] Temporary level used to integrate and test the wave-1 systems (piles,
 * carry stacks, flights, zones, chopping) at their real layout positions. Wave 2 replaces this file
 * with the real game level — the public API (constructor, start, update, skipIntro, forceUnlock,
 * snapshot) must stay the same because game/Game.ts calls it.
 */
import * as THREE from 'three';
import { LAYOUT, PALETTE, TIMING, rect } from '../config';
import { clamp } from '../core/math';
import type { GameContext, PadId } from '../core/types';
import { Pile } from '../items/Pile';
import { launchNew } from '../items/transfer';
import { geo, mesh, toon } from '../render/materials';

export class Level {
  private dropZone: Pile | null = null;
  private counter: Pile | null = null;
  private cash: Pile | null = null;
  private sellTimer = 0;
  private readonly chopPoint = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  constructor(readonly ctx: GameContext) {}

  start(): void {
    const ctx = this.ctx;
    const L = LAYOUT;
    ctx.state.phase = 'manual';

    // Giant log stand-in (wave 2 builds the real one with its intro).
    const g = L.giantLog;
    const log = mesh(geo.cylinder(g.radius, g.radius, g.length, 20), toon(PALETTE.bark));
    log.rotation.x = Math.PI / 2;
    log.position.set(g.x, g.y, g.z);
    ctx.scene.add(log);

    // Raw log drop zone: grey slab + pile + pickup zone.
    const dz = L.dropZone;
    const slab = mesh(geo.boxBase(dz.slab.w, 0.08, dz.slab.d), toon(PALETTE.dropSlab), { cast: false });
    slab.position.set(dz.x, 0, dz.z);
    ctx.scene.add(slab);
    const dropZone = new Pile(ctx, { id: 'pile:dropZone', accepts: ['log'], position: new THREE.Vector3(dz.x, 0.08, dz.z), grid: dz.grid });
    dropZone.fill('log', 12);
    ctx.colliders.addBox(dz.collider, 'dropZone');
    ctx.zones.addTransfer({ id: 'dropZone>arms', area: dz.zone, from: dropZone, to: ctx.player.arms, kinds: ['log'], marker: true });
    this.dropZone = dropZone;

    // Walk-in counter: table + pile on top + drop-off zone.
    const wc = L.walkInCounter;
    const table = mesh(geo.boxBase(wc.length, wc.height, wc.depth), toon(PALETTE.plank));
    table.position.set(wc.x, 0, wc.z);
    ctx.scene.add(table);
    ctx.colliders.addBox(rect(wc.x, wc.z, wc.length, wc.depth), 'walkInCounter');
    const counter = new Pile(ctx, { id: 'counter:walkIn', accepts: ['log'], position: new THREE.Vector3(wc.x, wc.height, wc.z), grid: wc.grid });
    ctx.zones.addTransfer({
      id: 'arms>walkInCounter',
      area: wc.playerZone,
      from: ctx.player.arms,
      to: counter,
      kinds: ['log'],
      interval: TIMING.dropInterval,
      marker: true,
    });
    this.counter = counter;

    // Cash pile next to the counter.
    const wcash = L.walkInCash;
    const cash = new Pile(ctx, {
      id: 'pile:walkInCash',
      accepts: ['cash'],
      position: new THREE.Vector3(wcash.x, 0, wcash.z),
      grid: wcash.grid,
      overflowMerge: true,
    });
    cash.fill('cash', 6);
    ctx.zones.addTransfer({ id: 'walkInCash>back', area: wcash.zone, from: cash, to: ctx.player.back, kinds: ['cash'], marker: true });
    this.cash = cash;

    // Chop zone on the river bank.
    ctx.zones.add({
      id: 'chop',
      area: L.chopZone,
      marker: true,
      onStay: () => {
        const z = clamp(ctx.player.position.z, g.z - g.length / 2 + 0.5, g.z + g.length / 2 - 0.5);
        this.chopPoint.set(g.x + g.radius * 0.85, 0.8, z);
        ctx.player.setChopTarget(dropZone.canAccept('log') ? this.chopPoint : null);
      },
      onExit: () => ctx.player.setChopTarget(null),
    });
    ctx.events.on('player:chopHit', ({ position }) => {
      const item = launchNew(ctx, 'log', position, dropZone, {
        duration: TIMING.launchTime,
        arcHeight: TIMING.launchHeight,
        spin: 1,
      });
      if (item) {
        ctx.state.stats.logsChopped++;
        ctx.events.emit('log:chopped', { position, source: 'player' });
      }
    });
  }

  update(dt: number): void {
    // Stand-in for customers: one log off the counter every 0.6 s becomes a $5 bundle on the cash pile.
    this.sellTimer += dt;
    if (this.sellTimer < 0.6 || !this.counter || !this.cash) return;
    this.sellTimer = 0;
    const item = this.counter.take('log');
    if (!item) return;
    this.counter.topWorldPosition(this.tmp);
    this.ctx.items.release(item);
    launchNew(this.ctx, 'cash', this.tmp, this.cash);
    this.ctx.state.stats.logsSold++;
  }

  skipIntro(): void {}

  forceUnlock(_id: PadId): void {}

  snapshot(): Record<string, unknown> {
    return {
      dropZone: this.dropZone?.count() ?? 0,
      counter: this.counter?.count() ?? 0,
      cashPile: this.cash?.count() ?? 0,
    };
  }
}
