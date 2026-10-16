/**
 * [eras] 0.9.5: an era's HAND NODE, the giant log of eras 2..10 (docs/ERA_RESOURCES.md "Wiring notes"). Generic over
 * every era: the model, verb, tool and yield come from assets/eraNodes.ts ERA_NODES[n].
 *
 * - Model: createNodeModel(n) at `place`, turned by `yaw` (its +Z toward where the player stands); a round collider.
 * - Harvest: a zone of radius (model radius + 1 m). While the player stands in it, setChopTarget(strike point, {era,
 *   interval, tier}) every step, or null while the node pile is full. The Player swaps the axe for the era tool and
 *   swings every `interval` seconds (`${key}Tool` upgrade when it exists, else NODE_BASE_INTERVAL).
 * - Every 'player:chopHit' carrying this era: node.hit() (the era's reaction), one unit of ERA_NODES[n].yields
 *   launched onto the node pile, stats.materialsMade++, 'material:made' (so era quests and stats count it).
 * - 0.9.6 (F11): each strike also pays a small harvest bonus scaled to the era (nodeStrikeBonus), so swinging the
 *   era's tool matters as much in the AI era as in the Frontier ('income' {source: 'harvest'}).
 * - Node pile: a small pile beside the node. The player takes from it (hold to interact); the era's Gatherer role
 *   carries it to the processors, or to the depot when nobody wants it (npc/EraWorker.ts), so harvesting never stalls.
 */
import * as THREE from 'three';
import { TIMING, UPGRADES, rect, type UpgradeDef } from '../config';
import { costAt, introEra } from '../core/ladder';
import { createNodeModel, ERA_NODES, type NodeModel } from '../assets/eraNodes';
import type { GameContext, ItemKind } from '../core/types';
import { Pile } from '../items/Pile';
import { launchNew } from '../items/transfer';
import type { Zone } from '../items/Zones';
import type { ColliderHandle } from '../world/Colliders';
import { ERAS, MATERIALS, isMaterial } from './data';
import type { RegionLayout, XZ } from './layout';

/** Seconds per swing at Tool level 0 (the Survival axe starts at 0.4 s; era tools are a touch heavier). */
export const NODE_BASE_INTERVAL = 0.5;
/** The node pile: 3 × 2 × 3 = 18 units. */
export const NODE_PILE = { cols: 3, rows: 2, layers: 3, spacing: { x: 0.5, y: 0.32, z: 0.5 } };
/** Where the pile sits, in the node's frame (u right, v toward the player). */
const PILE_AT = { u: 2.6, v: 0.6 };

/**
 * Where era n's node stands: the layout's own `node` place if it has one, else the middle of its HARVEST zone
 * (eras/layout.ts zones, 0.9.5), facing the gate side where the player comes from; null while the layout has neither
 * (then the region simply has no node).
 */
export function handNodePlace(L: RegionLayout): { x: number; z: number; yaw: number } | null {
  const ext = L as RegionLayout & { node?: { x: number; z: number; yaw: number }; zones?: { harvest: { minX: number; maxX: number; minZ: number; maxZ: number } } };
  if (ext.node) return ext.node;
  const h = ext.zones?.harvest;
  if (!h) return null;
  // the node's +Z faces the processing yard (toward the gate): north gate → −Z (yaw π), south gate → +Z (yaw 0)
  return { x: (h.minX + h.maxX) / 2 - 1.3, z: (h.minZ + h.maxZ) / 2, yaw: L.inward > 0 ? Math.PI : 0 };
}

/**
 * 0.9.6 (F11): this many strikes earn as much as one of the era's own upgrades costs from Lv 0 to Lv 10 (the average
 * gate row), in every era from 3 on. That is about 1 % of a second of the era's income per strike everywhere (the
 * pacing model), like era 2's stone; later eras used to need 50-190k strikes a row, so the tool stopped mattering.
 */
export const NODE_STRIKES_PER_ROW = 20_000;

const strikeBonus = new Map<number, number>();

/**
 * 0.9.6 (F11): dollars one strike pays on top of the unit it drops: the era's average gate row (each of its own
 * upgrades from Lv 0 to Lv 10) ÷ NODE_STRIKES_PER_ROW, less the unit's own value; 0 where the unit already pays that.
 */
export function nodeStrikeBonus(n: number): number {
  const hit = strikeBonus.get(n);
  if (hit !== undefined) return hit;
  const defs = (Object.values(UPGRADES) as UpgradeDef[]).filter((d) => introEra(d) === n);
  let row = 0;
  for (const d of defs) for (let l = 0; l < 10; l++) row += costAt(d, l);
  row = defs.length > 0 ? row / defs.length : 0;
  const kind = ERA_NODES[n]?.yields;
  const unit = kind && isMaterial(kind) ? MATERIALS[kind].value : 0;
  const bonus = Math.max(0, Math.round(row / NODE_STRIKES_PER_ROW - unit));
  strikeBonus.set(n, bonus);
  return bonus;
}

/** Tool swing interval for era n: the `${key}Tool` upgrade's value when the upgrade exists. */
export function nodeInterval(ctx: GameContext, n: number): number {
  const id = `${ERAS[n]!.key}Tool`;
  if (!(id in UPGRADES)) return NODE_BASE_INTERVAL;
  return ctx.upgrades.value(id as keyof typeof UPGRADES);
}

/** Tool look band 0..5 from the Tool upgrade level (gold from band 4, like the axe). */
export function nodeToolTier(ctx: GameContext, n: number): number {
  const id = `${ERAS[n]!.key}Tool`;
  if (!(id in UPGRADES)) return 0;
  return Math.min(5, Math.floor(ctx.upgrades.level(id as keyof typeof UPGRADES) / 2));
}

export class HandNode {
  readonly era: number;
  readonly model: NodeModel;
  readonly pile: Pile;
  readonly zone: Zone;
  /** Where a worker stands to take from the pile (world). */
  readonly pileSpot: XZ;
  readonly yields: ItemKind;
  private readonly collider: ColliderHandle;
  private readonly strikeTmp = new THREE.Vector3();
  private readonly fromTmp = new THREE.Vector3();
  private readonly offChop: () => void;
  private readonly takeZone: Zone;

  constructor(
    private readonly ctx: GameContext,
    era: number,
    place: XZ,
    yaw: number,
    parent: THREE.Object3D,
  ) {
    this.era = era;
    const def = ERA_NODES[era];
    if (!def) throw new Error(`no hand node for era ${era}`);
    this.yields = def.yields;
    this.model = createNodeModel(era);
    this.model.root.position.set(place.x, 0, place.z);
    this.model.root.rotation.y = yaw;
    parent.add(this.model.root);
    const r = this.model.radius;
    this.collider = ctx.colliders.addBox(rect(place.x, place.z, r * 1.5, r * 1.5), `era:${era}:node`);

    // pile to the node's right, a little toward the player
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const px = place.x + PILE_AT.u * c + PILE_AT.v * s;
    const pz = place.z - PILE_AT.u * s + PILE_AT.v * c;
    this.pile = new Pile(ctx, { id: `pile:era${era}Node`, accepts: [def.yields], position: new THREE.Vector3(px, 0, pz), rotationY: yaw, grid: NODE_PILE });
    this.pileSpot = { x: px + 1.3 * s, z: pz + 1.3 * c };
    this.takeZone = ctx.zones.addTransfer({
      id: `pile:era${era}Node:take`,
      area: rect(px + 1.2 * s, pz + 1.2 * c, 1.8, 1.8),
      from: this.pile,
      to: ctx.player.arms,
      kinds: [def.yields],
      kind: 'take',
      interval: TIMING.pickupInterval,
      marker: true,
    });

    // harvest zone: a square around the node (zones are rects), the player swings while inside it
    const reach = r + 1;
    this.zone = ctx.zones.add({
      id: `zone:node${era}`,
      area: rect(place.x, place.z, reach * 2, reach * 2),
      marker: true,
      onStay: () => {
        if (this.pile.isFull()) {
          ctx.player.setChopTarget(null);
          return;
        }
        ctx.player.setChopTarget(this.strikePoint(), { era, interval: nodeInterval(ctx, era), tier: nodeToolTier(ctx, era) });
      },
      onExit: () => ctx.player.setChopTarget(null),
    });
    this.offChop = ctx.events.on('player:chopHit', ({ position, node }) => {
      if (node === era) this.strike(position);
    });
  }

  /** The world point the tool bites (the model's strike point). */
  strikePoint(): THREE.Vector3 {
    this.model.root.updateMatrixWorld();
    return this.model.root.localToWorld(this.strikeTmp.copy(this.model.strike));
  }

  /** One strike: the node reacts and one unit hops onto the pile (false when the pile is full). */
  strike(from: THREE.Vector3): boolean {
    const item = launchNew(this.ctx, this.yields, this.fromTmp.copy(from), this.pile, { duration: TIMING.launchTime, arcHeight: TIMING.launchHeight, spin: 1 });
    if (!item) return false;
    this.model.hit();
    this.ctx.state.stats.materialsMade++;
    const bonus = nodeStrikeBonus(this.era);
    if (bonus > 0) {
      this.ctx.economy.add(bonus);
      this.ctx.events.emit('income', { source: 'harvest', amount: bonus, position: this.fromTmp.copy(from) });
    }
    return true;
  }

  update(dt: number): void {
    this.model.animate(dt);
  }

  dispose(): void {
    this.offChop();
    this.ctx.zones.remove(this.zone);
    this.ctx.zones.remove(this.takeZone);
    this.model.root.removeFromParent();
    this.ctx.colliders.remove(this.collider);
  }
}
