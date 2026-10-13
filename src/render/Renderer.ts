/**
 * [B1 — engine] WebGL renderer, scene, lights and shadows. STUB: replace bodies, keep the public API.
 *
 * Requirements:
 * - WebGLRenderer (antialias, sRGB output, ACES or neutral tone mapping, pixel ratio ≤ 2), canvas fills `container`.
 * - Scene background = PALETTE.sky (optionally a subtle vertical gradient); no fog needed (orthographic).
 * - HemisphereLight (LIGHTING.hemi*) + one DirectionalLight "sun" (LIGHTING.sun*) with PCFSoft shadows,
 *   LIGHTING.shadowMapSize, orthographic shadow box ±LIGHTING.shadowExtent.
 * - setShadowFocus(p) moves the sun + its target so the shadow box stays centred on p (texel-snapped
 *   to avoid shimmering) — called every frame with the camera target.
 * - OrthographicCamera is created here; CameraRig owns its placement & frustum.
 */
import * as THREE from 'three';
import { PALETTE } from '../config';

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly domElement: HTMLCanvasElement;

  constructor(readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.domElement = this.renderer.domElement;
    container.appendChild(this.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(PALETTE.sky);
    this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 400);
    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.2);
    this.scene.add(this.sun, this.sun.target, this.hemi);
    this.resize();
  }

  /** Canvas size in CSS pixels. */
  get width(): number {
    return this.container.clientWidth || window.innerWidth;
  }

  get height(): number {
    return this.container.clientHeight || window.innerHeight;
  }

  /** Keep the shadow camera centred on `focus`. */
  setShadowFocus(_focus: THREE.Vector3): void {}

  /** Match the drawing buffer to the container (CameraRig.resize handles the frustum). */
  resize(): void {
    this.renderer.setSize(this.width, this.height);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
