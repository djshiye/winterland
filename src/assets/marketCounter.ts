/**
 * 0.9.5 AssetFactory: a region market counter (eras/RegionMarket.ts: the loading dock and the market stall). Era 1's
 * wooden sales counter (createCounterModel) with a striped valance in the era's accent along its road side, and a
 * signpost at its −X end whose two-line board (LOADING DOCK, MARKET STALL) turns to face the camera. Origin = floor
 * centre, long axis = local X, local −Z = the road side. Static parts bake into one mesh; the board is its own mesh.
 */
import * as THREE from 'three';
import { COLORS } from '../config';
import { bake } from '../render/batch';
import { GAME_FONT, geo, makeCanvasTexture, mesh, toon } from '../render/materials';
import { createCounterModel } from './shop';

/** Counter size (metres): long along X, the road side faces local −Z. */
export const COUNTER_SIZE = { length: 3.0, depth: 0.8, height: 0.95 } as const;

const hex = (c: number): string => `#${new THREE.Color(c).getHexString()}`;

/** One canvas texture per accent colour and label (two per era), shared by every copy. */
const boardCache = new Map<string, THREE.MeshBasicMaterial>();
function boardMaterial(accent: number, lines: readonly [string, string]): THREE.MeshBasicMaterial {
  const key = `${accent}|${lines.join('|')}`;
  const hit = boardCache.get(key);
  if (hit) return hit;
  const w = 512;
  const h = 192;
  const { ctx: g, texture } = makeCanvasTexture(w, h);
  g.fillStyle = '#fff4dc';
  g.beginPath();
  g.roundRect(6, 6, w - 12, h - 12, 36);
  g.fill();
  g.lineWidth = 12;
  g.strokeStyle = hex(accent);
  g.stroke();
  g.fillStyle = '#3a2a1e';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 64px ${GAME_FONT}`;
  g.fillText(lines[0], w / 2, h * 0.34);
  g.fillText(lines[1], w / 2, h * 0.7);
  texture.needsUpdate = true;
  const m = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
  boardCache.set(key, m);
  return m;
}

/**
 * `yaw` is the rotation the caller gives the model (the region's facilityYaw): the sign board turns against it so it
 * always faces the camera's side of the world (+X / +Z, docs/ARCHITECTURE.md §1) and reads in both region rows.
 */
export function createMarketCounterModel(accent: number, yaw = 0, lines: readonly [string, string] = ['TRADING', 'POST']): THREE.Group {
  const { length, depth, height } = COUNTER_SIZE;
  const g = new THREE.Group();
  g.name = 'marketCounter';
  g.add(createCounterModel(length, depth, height));

  // striped valance hanging from the road-side lip, and the signpost
  const parts = new THREE.Group();
  const stripe = toon(accent);
  const cream = toon(0xfff4dc);
  const wood = toon(COLORS.FENCE_WOOD);
  const n = 6;
  const sw = length / n;
  for (let i = 0; i < n; i++) {
    const s = mesh(geo.box(sw, 0.22, 0.04), i % 2 === 0 ? stripe : cream, { cast: false });
    s.position.set(-length / 2 + sw * (i + 0.5), height - 0.2, -depth / 2 - 0.03);
    parts.add(s);
  }
  const postX = -length / 2 - 0.3;
  const pole = mesh(geo.boxBase(0.12, 2.4, 0.12), wood);
  pole.position.set(postX, 0, 0);
  parts.add(pole);
  const cap = mesh(geo.box(0.2, 0.08, 0.2), stripe);
  cap.position.set(postX, 2.44, 0);
  parts.add(cap);
  g.add(bake(parts, { name: 'marketCounterParts' }));

  // the board, above the counter's end, faces the camera (world yaw π/4)
  const board = mesh(geo.plane(1.7, 0.64), boardMaterial(accent, lines), { cast: false, receive: false });
  board.position.set(postX, 2.0, 0);
  board.rotation.y = Math.PI / 4 - yaw;
  board.userData.noInstance = true;
  g.add(board);
  return g;
}
