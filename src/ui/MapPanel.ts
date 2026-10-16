/**
 * [0.9.0 Ages — UI] The world map and fast travel. Opens on 'map:open' (HUD Map button, chip, key T), closes on
 * 'map:close', its X, a tap on the backdrop and Esc. A modal card with an SVG schematic of the whole world drawn from the
 * data (the old map's yard / ridge / village / Market Town, the era regions and city districts coloured by their era,
 * the roads, a "you are here" dot) and the travel list from travelPoints(state) grouped Home / Regions / City. Locked
 * regions show their expansion price and what to reach first. Tapping an open point (list row or map shape) emits
 * 'travel:request' { x, z, label } and closes the map; Level answers with 'travel:done' (HUD shows the welcome toast).
 *
 * 0.9.3: regions read as big era-coloured plots with their number and name; the city districts read as dark city
 * blocks under a "City" heading with their district name, so the two never look like two "era II" places. A dashed
 * trail (eras/layout.ts eraTrail) runs from the town along the roads through every region gate in era order and ends
 * on the next era's gate, so the way on is always on the map.
 */
import type { GameContext } from '../core/types';
import { DISTRICTS, ERAS, REGIONS, ROADS, type ERect } from '../eras/data';
import { climbOpen } from '../eras/gate';
import { eraTrail, travelPoints, type TravelPoint } from '../eras/layout';
import { backOut, cubicOut, h, onTap, shield, Slide } from './dom';
import { eraRoman, groupTravelPoints, travelNote } from './agesLogic';
import { hexCss, ICON_CLOSE, ICON_LOCK, ICON_PIN, shadeCss } from './icons';
import './ages.css';

/** World rectangle the SVG shows (x −100..150, z −24..160). */
const VIEW = { x: -100, y: -24, w: 250, h: 184 };

/** The old map's places (schematic rectangles, world units) and their colours. */
const OLD_PLACES: ReadonlyArray<{ id: string; label: string; rect: ERect; fill: string }> = [
  { id: 'yard', label: 'Yard', rect: { minX: -10, maxX: 10, minZ: -20, maxZ: 10 }, fill: '#b98a5a' },
  { id: 'ridge', label: 'Ridge', rect: { minX: 13.4, maxX: 34, minZ: -18, maxZ: 8 }, fill: '#7fa06c' },
  { id: 'village', label: 'Village', rect: { minX: 0, maxX: 9.6, minZ: 10.8, maxZ: 31.8 }, fill: '#d9bf91' },
  { id: 'town', label: 'Town', rect: { minX: 15.2, maxX: 38, minZ: 14, maxZ: 48.8 }, fill: '#cdb89b' },
];

const rectAttrs = (r: ERect): string => `x="${r.minX}" y="${r.minZ}" width="${r.maxX - r.minX}" height="${r.maxZ - r.minZ}"`;

export class MapPanel {
  private readonly root: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly view: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly slide = new Slide();
  private you: SVGCircleElement | null = null;
  private ring: SVGCircleElement | null = null;
  private signature = '';
  private points = new Map<string, TravelPoint>();
  private clock = 0;
  private youPos = '';

  constructor(
    private readonly ctx: GameContext,
    layer: HTMLElement,
  ) {
    this.root = h('div', 'wl-map wl-modal wl-modal-dim');
    shield(this.root);
    this.root.style.display = 'none';
    this.card = h('div', 'wl-card wl-map-card');
    const head = h('div', 'wl-map-head');
    const titles = h('div', 'wl-map-titles');
    titles.append(h('div', 'wl-map-title wl-outline', 'Map'), h('div', 'wl-map-sub', 'Tap a place to travel there'));
    head.appendChild(titles);
    const close = h('button', 'wl-build-close', ICON_CLOSE);
    close.type = 'button';
    close.setAttribute('aria-label', 'Close map');
    onTap(close, () => {
      ctx.audio.play('click');
      this.close();
    });
    head.appendChild(close);
    this.card.appendChild(head);
    const body = h('div', 'wl-map-body');
    this.view = h('div', 'wl-map-view');
    this.list = h('div', 'wl-map-list');
    body.append(this.view, this.list);
    this.card.appendChild(body);
    this.root.appendChild(this.card);
    layer.appendChild(this.root);

    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close();
    });
    this.view.addEventListener('click', (e) => {
      const el = (e.target as Element).closest('[data-tp]');
      const p = el ? this.points.get(el.getAttribute('data-tp') ?? '') : undefined;
      if (p) this.travel(p);
    });

    ctx.events.on('map:open', () => this.open());
    ctx.events.on('map:close', () => this.close());
  }

  /** True while the map is (or is animating to be) on screen. */
  get visible(): boolean {
    return this.slide.open;
  }

  open(): void {
    this.rebuild();
    this.slide.open = true;
  }

  close(): void {
    this.slide.open = false;
  }

  /** Toggle (HUD button / T key). */
  toggle(): void {
    if (this.slide.open) this.close();
    else this.open();
  }

  private travel(p: TravelPoint): void {
    if (!p.open) {
      this.ctx.audio.play('full', { volume: 0.5 });
      return;
    }
    this.ctx.audio.unlock();
    this.ctx.audio.play('click');
    this.ctx.events.emit('travel:request', { x: p.x, z: p.z, label: p.label });
    this.close();
  }

  private signatureOf(pts: readonly TravelPoint[]): string {
    return `${this.ctx.state.eras.age}|${pts.map((p) => (p.open ? 1 : 0)).join('')}`;
  }

  /** Redraw the schematic and the list from the current state. */
  private rebuild(): void {
    const { state } = this.ctx;
    const pts = travelPoints(state);
    this.signature = this.signatureOf(pts);
    this.points = new Map(pts.map((p) => [p.id, p]));
    this.view.innerHTML = this.svg(pts);
    this.you = this.view.querySelector('.wl-map-you');
    this.ring = this.view.querySelector('.wl-map-ring');
    this.youPos = '';
    this.renderList(pts);
    this.moveYou();
  }

  private svg(pts: readonly TravelPoint[]): string {
    const { state } = this.ctx;
    const age = state.eras.age;
    const out: string[] = [];
    out.push(`<svg viewBox="${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}" role="img" aria-label="World map" preserveAspectRatio="xMidYMid meet">`);
    out.push(`<rect x="${VIEW.x}" y="${VIEW.y}" width="${VIEW.w}" height="${VIEW.h}" rx="5" fill="#dcebf8"/>`);
    // roads
    for (const r of ROADS) {
      const open = r.opensAt <= 2 ? climbOpen(state) || age >= 2 : age >= r.opensAt - 1;
      out.push(`<rect ${rectAttrs(r.rect)} fill="#8a94a8" opacity="${open ? 0.95 : 0.28}"/>`);
    }
    // the old map
    for (const p of OLD_PLACES) {
      out.push(`<rect ${rectAttrs(p.rect)} rx="2" fill="${p.fill}" stroke="#fff" stroke-width="0.9"/>`);
      out.push(`<text class="wl-map-old" x="${(p.rect.minX + p.rect.maxX) / 2}" y="${p.rect.minZ - 1.6}">${p.label}</text>`);
    }
    // city districts: dark city blocks with their district name (not just a number, which read as a second region)
    let cityMinX = Infinity;
    let cityMaxX = -Infinity;
    let cityMinZ = Infinity;
    for (let n = 2; n < DISTRICTS.length; n++) {
      const d = DISTRICTS[n];
      if (!d) continue;
      cityMinX = Math.min(cityMinX, d.rect.minX);
      cityMaxX = Math.max(cityMaxX, d.rect.maxX);
      cityMinZ = Math.min(cityMinZ, d.rect.minZ);
    }
    if (age >= 2 || climbOpen(state)) out.push(`<text class="wl-map-city" x="${(cityMinX + cityMaxX) / 2}" y="${cityMinZ - 2.2}">City</text>`);
    for (let n = 2; n < DISTRICTS.length; n++) {
      const d = DISTRICTS[n];
      const e = ERAS[n];
      if (!d || !e) continue;
      const open = age >= n;
      const tp = pts.find((p) => p.id === `district:${n}`);
      const cx = (d.rect.minX + d.rect.maxX) / 2;
      const cz = (d.rect.minZ + d.rect.maxZ) / 2;
      out.push(
        `<g ${open && tp ? `data-tp="${tp.id}" class="is-open"` : ''}>` +
          `<rect ${rectAttrs(d.rect)} rx="2.5" fill="#4a5672" stroke="${hexCss(e.colors.accent)}" stroke-width="1.1" ${open ? '' : 'opacity="0.35" stroke-dasharray="3 2"'}/>` +
          `<text class="wl-map-dnum" x="${cx}" y="${cz - 1}" ${open ? '' : 'opacity="0.6"'}>${eraRoman(n)}</text>` +
          `<text class="wl-map-dname" x="${cx}" y="${cz + 6}" ${d.name.length > 14 ? 'textLength="26" lengthAdjust="spacingAndGlyphs"' : ''} ${open ? '' : 'opacity="0.6"'}>${d.name}</text></g>`,
      );
    }
    // era regions
    for (let n = 2; n < REGIONS.length; n++) {
      const r = REGIONS[n];
      const e = ERAS[n];
      if (!r || !e) continue;
      const tp = pts.find((p) => p.id === `region:${n}`);
      const bought = age >= n;
      const open = !!tp?.open;
      out.push(
        `<g ${open && tp ? `data-tp="${tp.id}" class="is-open"` : ''}>` +
          `<rect ${rectAttrs(r.rect)} rx="2.5" fill="${hexCss(e.colors.ground)}" stroke="${hexCss(e.colors.accent)}" stroke-width="1.4" ${bought ? '' : `opacity="${open ? 0.7 : 0.38}" stroke-dasharray="3 2"`}/>` +
          `<text class="wl-map-num" x="${(r.rect.minX + r.rect.maxX) / 2}" y="${(r.rect.minZ + r.rect.maxZ) / 2 + 3}" fill="${shadeCss(e.colors.accent, -0.35)}" ${bought ? '' : 'opacity="0.55"'}>${eraRoman(n)}</text>` +
          `<text class="wl-map-name" x="${(r.rect.minX + r.rect.maxX) / 2}" y="${(r.rect.minZ + r.rect.maxZ) / 2 + 9}" ${bought ? '' : 'opacity="0.55"'}>${e.region}</text></g>`,
      );
    }
    // the era trail: town → every region gate in order → the next era's gate
    if (age >= 2 || climbOpen(state)) {
      const goal = Math.min(age + 1, REGIONS.length - 1);
      const trail = eraTrail(goal);
      const line = trail.map((q) => `${q.x},${q.z}`).join(' ');
      const end = trail[trail.length - 1]!;
      out.push(`<polyline class="wl-map-trail-bg" points="${line}"/>`);
      out.push(`<polyline class="wl-map-trail" points="${line}"/>`);
      if (age < REGIONS.length - 1) out.push(`<circle class="wl-map-next" cx="${end.x}" cy="${end.z}" r="2.6"/>`);
    }
    // home points as tappable pins
    for (const p of pts) {
      if (p.kind !== 'home') continue;
      out.push(`<g ${p.open ? `data-tp="${p.id}" class="is-open"` : ''}><circle cx="${p.x}" cy="${p.z}" r="3" fill="#fff" stroke="#1f2b46" stroke-width="1.2" ${p.open ? '' : 'opacity="0.4"'}/></g>`);
    }
    out.push(`<circle class="wl-map-ring" cx="0" cy="0" r="4" fill="none" stroke="#e8553e" stroke-width="1"/>`);
    out.push(`<circle class="wl-map-you" cx="0" cy="0" r="2.7" fill="#e8553e" stroke="#fff" stroke-width="1.1"/>`);
    out.push('</svg>');
    return out.join('');
  }

  private renderList(pts: readonly TravelPoint[]): void {
    const age = this.ctx.state.eras.age;
    this.list.textContent = '';
    for (const g of groupTravelPoints(pts)) {
      this.list.appendChild(h('div', 'wl-map-group', g.title));
      for (const p of g.points) this.list.appendChild(this.makeRow(p, age));
    }
  }

  private makeRow(p: TravelPoint, age: number): HTMLElement {
    const note = travelNote(p, age);
    const e = p.era >= 2 ? ERAS[p.era] : null;
    const row = h('button', 'wl-map-row');
    row.type = 'button';
    row.classList.toggle('is-locked', !p.open);
    const badge = h('div', 'wl-map-badge', p.era >= 2 ? eraRoman(p.era) : ICON_PIN);
    if (e && p.kind === 'district') {
      // a city block: dark like the map's blocks, the number in the era's colour
      badge.style.background = '#4a5672';
      badge.style.color = hexCss(e.colors.accent);
      badge.style.boxShadow = `inset 0 0 0 2px ${hexCss(e.colors.accent)}`;
    } else if (e) {
      badge.style.background = hexCss(e.colors.accent);
      badge.style.color = '#fff';
    }
    const mid = h('div', 'wl-map-rowmid');
    const name = h('div', 'wl-map-rowname');
    name.textContent = p.label;
    mid.appendChild(name);
    if (note.cost) mid.appendChild(h('div', 'wl-map-note', '')).textContent = note.cost;
    if (note.need) mid.appendChild(h('div', `wl-map-note${p.open ? ' is-ok' : ''}`, '')).textContent = note.need;
    const go = h('div', p.open ? 'wl-map-go' : 'wl-map-go is-lock', p.open ? 'Go' : `<span class="wl-lock">${ICON_LOCK}</span>`);
    row.append(badge, mid, go);
    if (p.open) onTap(row, () => this.travel(p));
    else row.disabled = true;
    return row;
  }

  /** Put the "you are here" dot on the player's position. */
  private moveYou(): void {
    const obj = this.ctx.player?.object;
    if (!obj || !this.you || !this.ring) return;
    const x = Math.max(VIEW.x + 2, Math.min(VIEW.x + VIEW.w - 2, obj.position.x));
    const z = Math.max(VIEW.y + 2, Math.min(VIEW.y + VIEW.h - 2, obj.position.z));
    const key = `${x.toFixed(1)}|${z.toFixed(1)}`;
    if (key === this.youPos) return;
    this.youPos = key;
    for (const c of [this.you, this.ring]) {
      c.setAttribute('cx', x.toFixed(1));
      c.setAttribute('cy', z.toFixed(1));
    }
  }

  update(dt: number): void {
    const s = this.slide;
    if (s.open) {
      this.clock += dt;
      // the state can change while the map is open (an expansion is bought, a place is found)
      const sig = this.signatureOf(travelPoints(this.ctx.state));
      if (sig !== this.signature) this.rebuild();
      this.moveYou();
      if (this.ring) {
        const t = (this.clock % 1.4) / 1.4;
        this.ring.setAttribute('r', (3 + t * 6).toFixed(2));
        this.ring.setAttribute('opacity', (1 - t).toFixed(2));
      }
    }
    if (s.step(dt, 0.24) || s.k > 0) {
      if (s.k <= 0) {
        this.root.style.display = 'none';
      } else {
        if (this.root.style.display === 'none') this.root.style.display = 'flex';
        const e = s.open ? backOut(Math.min(1, s.k)) : cubicOut(s.k);
        this.root.style.opacity = Math.min(1, s.k * 3).toFixed(2);
        this.card.style.transform = `scale(${(0.9 + 0.1 * e).toFixed(3)})`;
      }
    }
  }
}
