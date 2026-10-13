// Renderer-cost breakdown for the current scene (a single expression for shot.mjs `eval:`, like playtest-bot.js).
// Renders one frame, then lists every visible scene root by mesh count, labelled by its first named
// node (or its position when unnamed), with how many of those meshes cast shadows (each caster is a
// second draw call in the shadow pass).
//
//   node scripts/shot.mjs eval:__WINTERLAND__.skipIntro() \
//     "eval:['harvester','processor','westConveyor','eastConveyor','megaSaw'].forEach(id => __WINTERLAND__.unlock(id))" \
//     sim:150 "eval:$(cat scripts/perf-breakdown.js)"
(() => {
  const W = window.__WINTERLAND__;
  const scene = W.ctx.scene;
  W.simulate(1 / 60, 1 / 60);
  const info = W.ctx.renderer.renderer.info.render;
  const rows = [];
  let meshes = 0;
  let casters = 0;
  for (const root of scene.children) {
    if (!root.visible) continue;
    let n = 0;
    let cast = 0;
    let label = root.name;
    root.traverseVisible((o) => {
      if (!label && o.name) label = o.name;
      if (!o.isMesh && !o.isSprite && !o.isPoints && !o.isLine) return;
      n++;
      if (o.castShadow) cast++;
    });
    if (n === 0) continue;
    meshes += n;
    casters += cast;
    const p = root.position;
    rows.push({ n, cast, label: `${label || '(unnamed)'} @(${p.x.toFixed(1)}, ${p.z.toFixed(1)})` });
  }
  rows.sort((a, b) => b.n - a.n);
  return JSON.stringify({
    calls: info.calls,
    triangles: info.triangles,
    meshes,
    casters,
    liveItems: W.state().liveItems,
    top: rows.slice(0, 40).map((r) => `${String(r.n).padStart(4)} meshes ${String(r.cast).padStart(4)} cast  ${r.label}`),
  });
})()
