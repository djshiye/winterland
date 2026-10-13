/**
 * [B2 — items] `?gallery` page: every AssetFactory catalog entry (ASSET_CATALOG) laid out on a snowy
 * floor under the game's lighting, labelled, so the art can be reviewed at a glance. STUB.
 *
 * - Own renderer / scene / camera (reuse render/Renderer + the game's iso CameraRig look if practical;
 *   no GameContext needed). One row per domain, assets spaced by their bounding boxes, a canvas-texture
 *   label under each. Slow turntable or a fixed 3/4 view; `?gallery=<domain or asset>` focuses one.
 * - Installs window.__WINTERLAND__ with at least pause / resume / simulate(seconds) / state() /
 *   render() so scripts/shot.mjs works unchanged: `node scripts/shot.mjs --query gallery shot:x.png`.
 */
export class Gallery {
  constructor(readonly app: HTMLElement) {}

  start(): void {
    this.app.textContent = 'Asset gallery: not built yet.';
  }
}
