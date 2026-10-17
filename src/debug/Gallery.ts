/**
 * [B2 — items] `?gallery` page: every AssetFactory catalog entry (ASSET_CATALOG) laid out on a snowy
 * floor under the game's lighting, labelled, so the art can be reviewed at a glance.
 *
 * - Own Renderer / CameraRig (the game's iso look) — no GameContext. Rows run left→right on screen, one
 *   row per domain (wrapped when long); assets are spaced by their bounding boxes, a canvas-texture
 *   label sits under each one.
 * - `?gallery` shows everything; `?gallery=<domain>` (e.g. items, machines) or `?gallery=<asset>` /
 *   `?gallery=<domain>/<asset>` focuses a subset. `&spin` turns every asset slowly; `&zoom=<k>`
 *   multiplies the auto-fit zoom. Mouse: drag = pan, wheel = zoom. 0.9.8: `&era=<n>` shows that era's light and grade,
 *   `&night` lights it at full night (glows on), so art can be checked day and night.
 * - A catalog object (or any child) may set `userData.galleryAnimate = (dt) => …`; it runs every frame,
 *   so machines show their moving part (e.g. ?gallery=eraMachines2).
 * - Installs window.__WINTERLAND__ with pause / resume / simulate(seconds) / state() / render() so
 *   scripts/shot.mjs works unchanged: `node scripts/shot.mjs --query gallery=items shot:x.png`.
 */
import * as THREE from 'three';
import { ASSET_CATALOG } from '../assets/AssetFactory';
import { CAMERA, PALETTE } from '../config';
import { clamp } from '../core/math';
import type { DebugApi } from '../game/Game';
import { CameraRig } from '../render/CameraRig';
import { GAME_FONT, basic, geo, makeCanvasTexture, mesh, toon } from '../render/materials';
import { Renderer } from '../render/Renderer';
import { updateGlow } from '../world/env/glow';

interface Cell {
  domain: string;
  name: string;
  object: THREE.Object3D;
  size: THREE.Vector3;
  center: THREE.Vector3;
  error: string | null;
}

/** Rows wrap once they get wider than this (world units). */
const MAX_ROW_WIDTH = 52;
const GAP = 0.9;

export class Gallery {
  private renderer!: Renderer;
  private rig!: CameraRig;
  private paused = false;
  private lastTime = 0;
  private time = 0;
  private readonly spinning: THREE.Object3D[] = [];
  /** Per-frame hooks from catalog entries (`userData.galleryAnimate(dt)`), so animated parts move. */
  private readonly animators: ((dt: number) => void)[] = [];
  private spin = false;
  private fitZoom = 1;
  private count = 0;
  private readonly layout = new THREE.Group();

  constructor(readonly app: HTMLElement) {}

  start(): void {
    const params = new URLSearchParams(location.search);
    const focus = (params.get('gallery') ?? '').trim();
    this.spin = params.has('spin');
    const zoomMul = Number(params.get('zoom')) || 1;

    this.renderer = new Renderer(this.app);
    const era = Number(params.get('era'));
    if (era >= 1) this.renderer.setEra(era, true);
    if (params.has('night')) {
      this.renderer.onDarkness((d) => updateGlow(d));
      this.renderer.setDarkness(1);
    }
    this.rig = new CameraRig(this.renderer.camera);
    const scene = this.renderer.scene;

    const floor = mesh(geo.ground(600, 600), toon(PALETTE.snow), { cast: false });
    scene.add(floor);
    this.layout.rotation.y = Math.PI / 4; // local +X = screen right, local +Z = screen down
    scene.add(this.layout);

    const cells = this.collect(focus);
    this.count = cells.length;
    const bounds = this.arrange(cells);

    // Fit the view: rotate the layout's local rect into the camera's view.
    const target = new THREE.Vector3((bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2);
    this.layout.updateMatrixWorld(true);
    this.layout.localToWorld(target);
    this.rig.target.copy(target);
    const needW = bounds.maxX - bounds.minX + 2;
    const needH = (bounds.maxZ - bounds.minZ) * Math.sin(THREE.MathUtils.degToRad(CAMERA.pitchDeg)) + bounds.maxY * 1.1 + 2;
    const aspect = this.renderer.width / Math.max(1, this.renderer.height);
    const hv = Math.max(CAMERA.viewHeight, CAMERA.minViewWidth / aspect);
    this.fitZoom = clamp(Math.min(hv / needH, (hv * aspect) / needW), 0.05, 5) * zoomMul;
    this.rig.resize(this.renderer.width, this.renderer.height);
    this.rig.setZoom(this.fitZoom, 0);
    this.rig.update(0);
    this.renderer.setShadowFocus(this.rig.target);

    window.addEventListener('resize', () => this.resize());
    this.installPointer();
    this.installDebugApi();

    this.lastTime = performance.now();
    const loop = (now: number): void => {
      requestAnimationFrame(loop);
      const dt = Math.min((now - this.lastTime) / 1000, 0.05);
      this.lastTime = now;
      if (!this.paused) this.step(dt);
      this.renderer.render();
    };
    requestAnimationFrame(loop);
  }

  // --- building the cells ---------------------------------------------------
  private collect(focus: string): Cell[] {
    const cells: Cell[] = [];
    const f = focus.toLowerCase();
    const domains = Object.keys(ASSET_CATALOG);
    // domains are camelCase (eraItems, ridgeMachines): match them case-insensitively
    const domainMatch = domains.some((d) => d.toLowerCase() === f);
    for (const domain of domains) {
      const catalog = ASSET_CATALOG[domain]!;
      for (const name of Object.keys(catalog)) {
        if (f && !domainMatch && f !== name.toLowerCase() && f !== `${domain}/${name}`.toLowerCase()) continue;
        if (f && domainMatch && domain.toLowerCase() !== f) continue;
        cells.push(this.build(domain, name, catalog[name]!));
      }
    }
    if (cells.length === 0 && f) {
      // Unknown focus: fall back to the full gallery.
      return this.collect('');
    }
    return cells;
  }

  private build(domain: string, name: string, builder: () => THREE.Object3D): Cell {
    let object: THREE.Object3D;
    let error: string | null = null;
    try {
      object = builder();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      object = mesh(geo.box(0.6, 0.6, 0.6), basic(0xff3355), { cast: false });
    }
    object.traverse((o) => {
      const f: unknown = o.userData.galleryAnimate;
      if (typeof f === 'function') this.animators.push(f as (dt: number) => void);
    });
    // Measure with the object at the origin, unrotated.
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) box.set(new THREE.Vector3(-0.3, 0, -0.3), new THREE.Vector3(0.3, 0.6, 0.3));
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    center.y = box.min.y; // rest the model's lowest point on the floor
    return { domain, name, object, size, center, error };
  }

  /** Lay the cells out in rows per domain; returns the layout-space bounds (maxY = tallest asset). */
  private arrange(cells: Cell[]): { minX: number; maxX: number; minZ: number; maxZ: number; maxY: number } {
    // Label size follows the overall scale of the content so it stays legible after auto-fit.
    /** Footprint in layout space: the world-aligned bbox seen from the 45°-rotated layout. */
    const fp = (c: Cell): number => (c.size.x + c.size.z) * Math.SQRT1_2;
    const totalW = cells.reduce((s, c) => s + fp(c) + GAP, 0);
    const widest = Math.max(...cells.map((c) => fp(c)), 1);
    const labelH = clamp(Math.min(totalW, MAX_ROW_WIDTH) / 55, 0.28, 1.6) * Math.max(1, Math.min(2, widest / 6));
    const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, maxY: 0 };
    let z = 0;
    let domain = '';
    let rowX = 0;
    let rowDepth = 0;
    let rowStart = true;

    const finishRow = (): void => {
      z += rowDepth + labelH * 2.4 + GAP;
      rowX = 0;
      rowDepth = 0;
      rowStart = true;
    };

    const cellW = (c: Cell): number => Math.max(fp(c), this.labelWidth(c.error ? `${c.name} (ERROR)` : c.name, labelH));

    for (const cell of cells) {
      if (cell.domain !== domain) {
        if (domain !== '') finishRow();
        domain = cell.domain;
        const head = this.makeLabel(cell.domain.toUpperCase(), labelH * 1.5, '#1c3f66');
        head.position.set(head.scale.x / 2, labelH * 0.8, z + labelH * 1.4);
        this.layout.add(head);
        bounds.minX = Math.min(bounds.minX, 0);
        bounds.maxX = Math.max(bounds.maxX, head.scale.x);
        bounds.minZ = Math.min(bounds.minZ, z);
        z += labelH * 3.2;
      } else if (rowX > 0 && rowX + cellW(cell) > MAX_ROW_WIDTH) {
        finishRow();
      }
      if (!rowStart) rowX += GAP;
      rowStart = false;
      const cx = rowX + cellW(cell) / 2;
      const cz = z + fp(cell) / 2;
      // Model is shifted so its bbox centre (x, z) lands on (cx, cz) and its lowest point on y = 0.
      const holder = new THREE.Group();
      holder.position.set(cx, 0, cz);
      holder.rotation.y = -Math.PI / 4; // cancel the layout yaw: assets keep their in-game world orientation
      cell.object.position.set(-cell.center.x, -cell.center.y, -cell.center.z);
      holder.add(cell.object);
      this.layout.add(holder);
      if (this.spin) this.spinning.push(holder);

      const label = this.makeLabel(cell.error ? `${cell.name} (ERROR)` : cell.name, labelH, cell.error ? '#b0122f' : '#1c3f66');
      label.position.set(cx, labelH * 0.5, z + fp(cell) + labelH * 1.7);
      this.layout.add(label);

      bounds.minX = Math.min(bounds.minX, cx - cellW(cell) / 2);
      bounds.maxX = Math.max(bounds.maxX, cx + cellW(cell) / 2);
      bounds.maxZ = Math.max(bounds.maxZ, z + fp(cell) + labelH * 2);
      bounds.maxY = Math.max(bounds.maxY, cell.size.y);
      rowX += cellW(cell);
      rowDepth = Math.max(rowDepth, fp(cell));
    }
    return bounds;
  }

  private scratch: CanvasRenderingContext2D | null = null;
  private static readonly LABEL_PX = 64;

  /** World width of a label whose text height corresponds to `height`. */
  private labelWidth(text: string, height: number): number {
    this.scratch ??= document.createElement('canvas').getContext('2d')!;
    this.scratch.font = `700 ${Gallery.LABEL_PX}px ${GAME_FONT}`;
    return ((this.scratch.measureText(text).width + 32) / (Gallery.LABEL_PX * 2)) * height * 2;
  }

  /** Canvas-texture label sprite; `height` = world height of the text line (width follows the text). */
  private makeLabel(text: string, height: number, color: string): THREE.Sprite {
    const px = Gallery.LABEL_PX;
    this.scratch ??= document.createElement('canvas').getContext('2d')!;
    this.scratch.font = `700 ${px}px ${GAME_FONT}`;
    const cw = Math.min(4096, Math.max(128, Math.ceil(this.scratch.measureText(text).width) + 32));
    const { canvas, ctx: g, texture } = makeCanvasTexture(cw, px * 2);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.font = `700 ${px}px ${GAME_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = 12;
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    g.strokeText(text, canvas.width / 2, canvas.height / 2);
    g.fillStyle = color;
    g.fillText(text, canvas.width / 2, canvas.height / 2);
    texture.needsUpdate = true;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, fog: false }));
    // Canvas is 2·px tall → world height 2·height; width follows the canvas aspect.
    sprite.scale.set((canvas.width / canvas.height) * height * 2, height * 2, 1);
    sprite.renderOrder = 10;
    return sprite;
  }

  // --- loop / debug api -----------------------------------------------------
  private step(dt: number): void {
    this.time += dt;
    if (this.spin) for (const o of this.spinning) o.rotation.y += dt * 0.6;
    for (const f of this.animators) f(dt);
    this.rig.update(0);
    this.renderer.setShadowFocus(this.rig.target);
  }

  private resize(): void {
    this.renderer.resize();
    this.rig.resize(this.renderer.width, this.renderer.height);
  }

  private installPointer(): void {
    const el = this.renderer.domElement;
    let drag: { x: number; y: number } | null = null;
    const right = new THREE.Vector3();
    const down = new THREE.Vector3();
    el.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointerup', () => {
      drag = null;
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const cam = this.renderer.camera;
      const worldPerPx = (cam.right - cam.left) / Math.max(1, this.renderer.width);
      right.set(1, 0, 0).applyQuaternion(cam.quaternion).setY(0).normalize();
      down.set(0, -1, 0).applyQuaternion(cam.quaternion).setY(0).normalize();
      this.rig.target.addScaledVector(right, -(e.clientX - drag.x) * worldPerPx);
      this.rig.target.addScaledVector(down, -(e.clientY - drag.y) * worldPerPx * 1.35);
      drag = { x: e.clientX, y: e.clientY };
    });
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.rig.setZoom(clamp(this.rig.zoom * Math.exp(-e.deltaY * 0.001), 0.05, 12), 0);
      },
      { passive: false },
    );
  }

  private installDebugApi(): void {
    const state = (): Record<string, unknown> => ({
      gallery: true,
      assets: this.count,
      t: Math.round(this.time * 100) / 100,
      zoom: Math.round(this.rig.zoom * 100) / 100,
      domains: Object.fromEntries(Object.entries(ASSET_CATALOG).map(([k, v]) => [k, Object.keys(v)])),
    });
    const api = {
      state,
      pause: () => {
        this.paused = true;
      },
      resume: () => {
        this.paused = false;
        this.lastTime = performance.now();
      },
      simulate: (seconds: number, dt = 1 / 60) => {
        const steps = Math.max(0, Math.round(seconds / dt));
        for (let i = 0; i < steps; i++) this.step(dt);
        this.renderer.render();
        return state();
      },
      render: () => this.renderer.render(),
      /** Gallery-only: zoom multiplier relative to the auto-fit zoom. */
      setZoom: (k: number) => this.rig.setZoom(this.fitZoom * k, 0),
    };
    window.__WINTERLAND__ = api as unknown as DebugApi;
  }
}
