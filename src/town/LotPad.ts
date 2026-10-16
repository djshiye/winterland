/**
 * [T2 — town] The "BUILD" tile of an empty town lot: a chunky pad (same slab as the construction pads) showing a
 * little house with a plus and the word BUILD, with a floating sign. It only shows; Town owns the zone that opens
 * the build panel while the player stands on it.
 */
import * as THREE from 'three';
import { COLORS, PALETTE } from '../config';
import { createPadModel, createPadSign } from '../assets/pads';
import type { GameContext } from '../core/types';
import { GAME_FONT, makeCanvasTexture } from '../render/materials';

const SIZE = 256;
const BORDER = 10;
const CORNER = 36;
const SIGN_HEIGHT = 1.7;
const SIGN_SCALE = 0.72;

const hex = (c: number): string => `#${new THREE.Color(c).getHexString()}`;

function roundedRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function draw(g: CanvasRenderingContext2D, texture: THREE.CanvasTexture): void {
  g.clearRect(0, 0, SIZE, SIZE);
  const inset = BORDER / 2;
  roundedRect(g, inset, inset, SIZE - BORDER, SIZE - BORDER, CORNER);
  g.fillStyle = hex(COLORS.PAD_BG);
  g.fill();
  g.lineWidth = BORDER;
  g.strokeStyle = hex(COLORS.PAD_BORDER);
  g.stroke();

  // a little house (roof, walls, door) in white …
  g.save();
  g.translate(118, 98);
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#ffffff';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(-58, 8);
  g.lineTo(0, -48);
  g.lineTo(58, 8);
  g.lineTo(46, 8);
  g.lineTo(46, 52);
  g.lineTo(-46, 52);
  g.lineTo(-46, 8);
  g.closePath();
  g.fill();
  g.fillStyle = hex(COLORS.PAD_BG);
  g.fillRect(-11, 20, 22, 32);
  g.restore();
  // … with a green plus badge
  g.beginPath();
  g.arc(184, 66, 30, 0, Math.PI * 2);
  g.fillStyle = hex(PALETTE.cash);
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = '#ffffff';
  g.stroke();
  g.lineCap = 'round';
  g.lineWidth = 11;
  g.beginPath();
  g.moveTo(184, 50);
  g.lineTo(184, 82);
  g.moveTo(168, 66);
  g.lineTo(200, 66);
  g.stroke();

  g.font = `700 54px ${GAME_FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 9;
  g.strokeStyle = hex(COLORS.PAD_BG);
  g.fillStyle = '#ffffff';
  g.strokeText('BUILD', SIZE / 2, 206, SIZE - 50);
  g.fillText('BUILD', SIZE / 2, 206, SIZE - 50);
  texture.needsUpdate = true;
}

export class LotPad {
  /** Root at the tile's floor centre. */
  readonly object = new THREE.Group();
  private shown = false;
  private readonly pulse = new THREE.Group();
  private readonly sign: THREE.Mesh;

  constructor(
    readonly ctx: GameContext,
    x: number,
    z: number,
    size: number,
  ) {
    const { ctx: g, texture } = makeCanvasTexture(SIZE, SIZE);
    draw(g, texture);
    if (typeof document !== 'undefined' && document.fonts) {
      void document.fonts
        .load(`700 54px ${GAME_FONT}`)
        .catch(() => undefined)
        .then(() => draw(g, texture));
    }
    this.pulse.add(createPadModel(size, texture));
    this.object.add(this.pulse);
    this.sign = createPadSign('BUILD', true);
    this.sign.scale.setScalar(SIGN_SCALE);
    this.sign.position.set(0, SIGN_HEIGHT, 0);
    this.object.add(this.sign);
    this.object.position.set(x, 0, z);
    this.object.visible = false;
    ctx.occlusion?.addTarget(this.object, size, () => this.shown);
  }

  get visible(): boolean {
    return this.shown;
  }

  show(instant = false): void {
    if (this.shown) return;
    this.shown = true;
    const tw = this.ctx.tweens;
    tw.killTweensOf(this.object);
    this.object.scale.setScalar(1);
    this.object.visible = true;
    if (instant) return;
    tw.popIn(this.object, { duration: 0.5 });
    this.ctx.particles.ring(this.object.position, { color: PALETTE.padFill, radius: 1.6, life: 0.5 });
  }

  hide(): void {
    const was = this.shown;
    this.shown = false;
    const tw = this.ctx.tweens;
    tw.killTweensOf(this.object);
    if (!was || !this.object.visible) {
      this.object.visible = false;
      return;
    }
    tw.run({
      duration: 0.25,
      onUpdate: (k) => this.object.scale.setScalar(Math.max(0.0001, 1 - k)),
      onComplete: () => {
        if (this.shown) return;
        this.object.visible = false;
        this.object.scale.setScalar(1);
      },
    });
  }

  update(_dt: number): void {
    if (!this.shown) return;
    const t = this.ctx.time.elapsed;
    const s = 1 + 0.03 * Math.sin(t * 3 + this.object.position.x);
    this.pulse.scale.set(s, 1 + (s - 1) * 0.5, s);
    this.sign.quaternion.copy(this.ctx.camera.quaternion);
    this.sign.position.y = SIGN_HEIGHT + Math.sin(t * 2.2 + this.object.position.x) * 0.05;
  }
}
