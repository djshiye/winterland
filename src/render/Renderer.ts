/**
 * [B1 — engine] WebGL renderer, scene, lights and shadows.
 *
 * - WebGLRenderer (antialias, sRGB output, neutral tone mapping so palette colours stay vibrant,
 *   pixel ratio ≤ 2), canvas fills `container`.
 * - Scene background = PALETTE.sky; no fog needed (orthographic).
 * - HemisphereLight (LIGHTING.hemi*) + one DirectionalLight "sun" (LIGHTING.sun*) with PCF (soft) shadows (PCFSoftShadowMap was removed in three r18x),
 *   LIGHTING.shadowMapSize, orthographic shadow box ±LIGHTING.shadowExtent.
 * - setShadowFocus(p) moves the sun + its target so the shadow box stays centred on p, snapped to
 *   shadow-map texels to avoid shimmering while the camera glides.
 * - OrthographicCamera is created here; CameraRig owns its placement & frustum.
 */
import * as THREE from 'three';
import { LIGHTING, PALETTE } from '../config';

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly domElement: HTMLCanvasElement;

  private readonly sunOffset = new THREE.Vector3(LIGHTING.sunOffset.x, LIGHTING.sunOffset.y, LIGHTING.sunOffset.z);
  /** Light-space basis (right / up) for texel snapping. */
  private readonly lightRight = new THREE.Vector3();
  private readonly lightUp = new THREE.Vector3();
  private readonly texel: number;
  private readonly snapped = new THREE.Vector3();

  constructor(readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.domElement = this.renderer.domElement;
    this.domElement.style.touchAction = 'none';
    container.appendChild(this.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(PALETTE.sky);
    this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 400);

    this.hemi = new THREE.HemisphereLight(LIGHTING.hemiSky, LIGHTING.hemiGround, LIGHTING.hemiIntensity);
    this.sun = new THREE.DirectionalLight(LIGHTING.sunColor, LIGHTING.sunIntensity);
    this.sun.position.copy(this.sunOffset);
    this.sun.castShadow = true;
    const sh = this.sun.shadow;
    sh.mapSize.set(LIGHTING.shadowMapSize, LIGHTING.shadowMapSize);
    const e = LIGHTING.shadowExtent;
    Object.assign(sh.camera, { left: -e, right: e, top: e, bottom: -e, near: 1, far: this.sunOffset.length() * 2 + 40 });
    sh.camera.updateProjectionMatrix();
    sh.bias = -0.0004;
    sh.normalBias = 0.03;
    sh.radius = 2;
    this.scene.add(this.sun, this.sun.target, this.hemi);

    // Fixed light direction -> precompute the light's right/up axes once.
    const dir = this.sunOffset.clone().normalize();
    this.lightRight.set(0, 1, 0).cross(dir).normalize();
    this.lightUp.copy(dir).cross(this.lightRight).normalize();
    this.texel = (2 * e) / LIGHTING.shadowMapSize;

    this.resize();
  }

  /** Canvas size in CSS pixels. */
  get width(): number {
    return this.container.clientWidth || window.innerWidth;
  }

  get height(): number {
    return this.container.clientHeight || window.innerHeight;
  }

  /** Keep the shadow camera centred on `focus` (snapped to shadow texels so shadows never shimmer). */
  setShadowFocus(focus: THREE.Vector3): void {
    const r = focus.dot(this.lightRight);
    const u = focus.dot(this.lightUp);
    const sr = Math.round(r / this.texel) * this.texel - r;
    const su = Math.round(u / this.texel) * this.texel - u;
    this.snapped.copy(focus).addScaledVector(this.lightRight, sr).addScaledVector(this.lightUp, su);
    this.sun.target.position.copy(this.snapped);
    this.sun.position.copy(this.snapped).add(this.sunOffset);
    this.sun.target.updateMatrixWorld();
  }

  /** Match the drawing buffer to the container (CameraRig.resize handles the frustum). */
  resize(): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(this.width, this.height);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
