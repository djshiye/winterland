/**
 * [B4 — juice & HUD] DOM overlay HUD.
 *
 * Styles live in hud.css (imported below). Chunky rounded "mobile game" look using GAME_FONT
 * (Fredoka, loaded by index.html), white text with dark outline / drop shadow, bright pills; works
 * from 320 px phones to desktop (safe-area insets). All motion is driven from update(dt) on
 * simulation time (never CSS animations / timers) so the headless fast-forward is deterministic.
 * - Money pill top-left: green cash icon + "$123"; the number counts up/down smoothly toward the
 *   real value and the pill bumps (scale pop) on increase. Subscribes to 'money:changed'.
 * - floatText: pooled world-anchored text ("+$15", "MAX", "FULL") that rises and fades; reprojected
 *   every frame via ctx.cameraRig.worldToScreen.
 * - setObjective: top-centre banner with the current hint; animates out/in on change; null hides.
 * - setGuideTarget: a bouncing 3D arrow hovering above the world point; when the point is
 *   off-screen, a DOM arrow pinned to the screen edge points toward it. null hides both.
 * - toast: big centred title + optional subtitle that pops in and fades out.
 * - Mute toggle button top-right (calls ctx.audio.toggleMute()); a gear button next to it opens Settings
 *   (sound / music / graphics / show-FPS switches, reset progress with an in-page confirmation). PerfOverlay is the
 *   bottom-left FPS / draw-call readout.
 * - ShopPanel (opens on 'shop:open'), VillageBadge, SeasonBadge ("Season N · +X% prices" chip after a New Season), OfflineCard (showOfflineEarnings), FinaleCard ('finale:start').
 * - Wave 8: QuestPanel (3 active quests, collapsible), RushBanner (countdown), MoveHand (first-run drag hint),
 *   coinBurst() (gold coins flying into the money pill), AutoQuality (one-way drop to Low graphics on a slow device).
 * - Wave 10b: InteractChip ("Hold to pick up / pay" above the player, from 'interact:prompt').
 * - 0.9.0 Ages: ManagePanel / ChoosePanel (info-demolish and build-chooser sheets), MapPanel (fast travel; Map button, key T),
 *   MarketPanel (Market button, key B), EraChip (current era / city rank, opens the map), IncomeFeed ("+$12.5K city" next to the
 *   money pill), AgeCard (new-era celebration, city rank banner). Only one of the shop / build / choose / manage / market sheets
 *   is open at a time (opening one closes the others); Esc closes the topmost.
 * - toast() queues briefly: a toast arriving < 1 s after another waits its turn (max 2 waiting, dropped after 3 s).
 */
import * as THREE from 'three';
import { PALETTE } from '../config';
import { toggleFullscreen } from '../platform/desktop';
import { basic, geo, GAME_FONT, toon } from '../render/materials';
import type { GameContext } from '../core/types';
import { expansionOffered } from '../eras/layout';
import { AgeCard } from './AgeCard';
import { AutoQuality } from './AutoQuality';
import { BuildPanel } from './BuildPanel';
import { ChoosePanel } from './ChoosePanel';
import { CoinBurst } from './CoinBurst';
import { ContractCard } from './ContractCard';
import { EraChip, IncomeFeed } from './EraChip';
import { FinaleCard } from './FinaleCard';
import { InteractChip } from './InteractChip';
import { ManagePanel } from './ManagePanel';
import { MapPanel } from './MapPanel';
import { MarketPanel } from './MarketPanel';
import { MoveHand } from './MoveHand';
import { OfflineCard } from './OfflineCard';
import { PerfOverlay } from './PerfOverlay';
import { QuestPanel } from './QuestPanel';
import { EraCard } from './EraCard';
import { EventBanner } from './EventBanner';
import { RushBanner } from './RushBanner';
import { SeasonBadge } from './SeasonBadge';
import { SettingsPanel } from './SettingsPanel';
import { ShopPanel } from './ShopPanel';
import { VillageBadge } from './VillageBadge';
import { formatMoney } from './format';
import { ICON_MAP, ICON_MARKET } from './icons';
import './hud.css';

export interface FloatTextOptions {
  color?: string;
  /** CSS px font size (default ~26). */
  size?: number;
  duration?: number;
  /** World units to rise. */
  rise?: number;
}

interface FloatSlot {
  el: HTMLDivElement;
  active: boolean;
  age: number;
  dur: number;
  rise: number;
  ox: number;
  world: THREE.Vector3;
}

const FLOAT_POOL = 28;
/** Queued toasts older than this (seconds since toast() was called) are dropped. */
const TOAST_STALE = 3;
/** World-size multiplier of the 3D guide arrow (iso camera looks down on it, so it needs to be chunky). */
const ARROW_SCALE = 1.5;

const backOut = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const cubicOut = (t: number): number => 1 - Math.pow(1 - t, 3);

const ICON_CASH = `<svg viewBox="0 0 40 40" aria-hidden="true">
  <rect x="2" y="9" width="36" height="22" rx="5" fill="#2e9c48" stroke="#fff" stroke-width="2.5"/>
  <rect x="6" y="13" width="28" height="14" rx="3" fill="#46c35f"/>
  <circle cx="20" cy="20" r="6.5" fill="#f3fff0" stroke="#2e9c48" stroke-width="1.5"/>
  <text x="20" y="24.6" text-anchor="middle" font-family="${GAME_FONT.replace(/"/g, "'")}" font-weight="700" font-size="11" fill="#2e9c48">$</text>
</svg>`;

const ICON_SPEAKER = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="#fff" stroke="#fff" stroke-width="1.6"/>
  <g class="wl-waves" stroke="#fff" stroke-width="2.2"><path d="M15.2 9.2a4 4 0 0 1 0 5.6"/><path d="M17.8 6.6a7.6 7.6 0 0 1 0 10.8"/></g>
  <path class="wl-slash" d="M15.5 9.5l5 5m0-5l-5 5" stroke="#ff7a6b" stroke-width="2.4"/>
</svg>`;

const ICON_EDGE_ARROW = `<svg viewBox="0 0 52 52" aria-hidden="true">
  <path d="M8 16h18V6l20 20-20 20V36H8z" fill="#f6c343" stroke="#fff" stroke-width="4" stroke-linejoin="round"/>
</svg>`;

export class HUD {
  // --- DOM ---
  private readonly moneyEl: HTMLDivElement;
  private readonly moneyValue: HTMLSpanElement;
  private readonly objectiveEl: HTMLDivElement;
  private readonly muteBtn: HTMLButtonElement;
  private readonly toastEl: HTMLDivElement;
  private readonly toastTitle: HTMLDivElement;
  private readonly toastSub: HTMLDivElement;
  private readonly edgeEl: HTMLDivElement;
  private readonly floats: FloatSlot[] = [];
  private readonly layer: HTMLDivElement;
  private readonly shop: ShopPanel;
  private readonly build: BuildPanel;
  /** 0.9.0 Ages. */
  private readonly manage: ManagePanel;
  private readonly choose: ChoosePanel;
  private readonly map: MapPanel;
  private readonly market: MarketPanel;
  private readonly eraChip: EraChip;
  private readonly incomeFeed: IncomeFeed;
  private readonly ageCard: AgeCard;
  private readonly mapBtn: HTMLButtonElement;
  private readonly marketBtn: HTMLButtonElement;
  private hasMapBtn = false;
  private hasMarketBtn = false;
  private hasEraChip = false;
  private readonly settings: SettingsPanel;
  private readonly perf: PerfOverlay;
  private readonly offline: OfflineCard;
  private readonly village: VillageBadge;
  private readonly seasonBadge: SeasonBadge;
  private readonly finale: FinaleCard;
  private readonly quests: QuestPanel;
  private readonly rushBanner: RushBanner;
  /** Wave 13: the delivery contract card under the quests. */
  private readonly contractCard: ContractCard;
  private readonly eventBanner: EventBanner;
  /** Wave 9: era card on each village level-up (replaces the old level-up toast). */
  private readonly era: EraCard;
  private readonly moveHand: MoveHand;
  private readonly coins: CoinBurst;
  private readonly autoQuality: AutoQuality;
  /** Wave 10b: "Hold to pick up / pay" chip above the player. */
  private readonly chip: InteractChip;

  // --- money ---
  private moneyTarget = 0;
  private moneyShown = 0;
  private moneyText = '';
  private moneyRounded = Number.NaN;
  private bump = 0;

  // --- objective ---
  private objWant: string | null = null;
  private objShown: string | null = null;
  private objK = 0;
  private objStyleKey = '';

  // --- toast ---
  private toastAge = 0;
  private toastDur = 0;
  private toastActive = false;
  private hasVillage = false;
  private hasSeason = false;
  private readonly toastQueue: Array<{ title: string; sub: string; dur: number; at: number; small: boolean }> = [];

  // --- guide ---
  private readonly arrow: THREE.Group;
  private readonly guideTarget = new THREE.Vector3();
  private readonly guidePos = new THREE.Vector3();
  private hasGuide = false;
  private guideScale = 0;
  private guideTime = 0;
  private guideSnap = true;

  private readonly tmp2 = new THREE.Vector2();
  private readonly tmp3 = new THREE.Vector3();

  constructor(
    readonly ctx: GameContext,
    readonly root: HTMLElement,
  ) {
    const layer = document.createElement('div');
    layer.className = 'wl-hud';
    root.appendChild(layer);
    this.layer = layer;

    // money pill
    this.moneyEl = document.createElement('div');
    this.moneyEl.className = 'wl-money';
    this.moneyEl.innerHTML = `<span class="wl-money-icon">${ICON_CASH}</span>`;
    this.moneyValue = document.createElement('span');
    this.moneyValue.className = 'wl-money-value';
    this.moneyValue.textContent = '$0';
    this.moneyEl.appendChild(this.moneyValue);
    layer.appendChild(this.moneyEl);

    // objective banner
    this.objectiveEl = document.createElement('div');
    this.objectiveEl.className = 'wl-objective';
    layer.appendChild(this.objectiveEl);

    // mute
    this.muteBtn = document.createElement('button');
    this.muteBtn.type = 'button';
    this.muteBtn.className = 'wl-mute';
    this.muteBtn.setAttribute('aria-label', 'Toggle sound');
    this.muteBtn.innerHTML = ICON_SPEAKER;
    this.muteBtn.classList.toggle('is-muted', ctx.audio.muted);
    const stop = (e: Event) => e.stopPropagation();
    this.muteBtn.addEventListener('pointerdown', stop);
    this.muteBtn.addEventListener('touchstart', stop, { passive: true });
    this.muteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMute();
    });
    layer.appendChild(this.muteBtn);

    // settings (gear button sits left of the mute button)
    this.perf = new PerfOverlay(ctx, layer);
    this.settings = new SettingsPanel(ctx, layer, this.perf);
    this.settings.onSoundChanged = () => this.muteBtn.classList.toggle('is-muted', ctx.audio.muted);

    // village badge, shop
    this.village = new VillageBadge(ctx, layer);
    this.seasonBadge = new SeasonBadge(ctx, layer);
    this.shop = new ShopPanel(ctx, layer);
    this.build = new BuildPanel(ctx, layer);
    this.manage = new ManagePanel(ctx, layer);
    this.choose = new ChoosePanel(ctx, layer);
    this.market = new MarketPanel(ctx, layer);
    this.quests = new QuestPanel(ctx, layer);
    layer.classList.add('has-quests');
    this.rushBanner = new RushBanner(ctx, layer);
    this.contractCard = new ContractCard(ctx, layer);
    this.eventBanner = new EventBanner(ctx, layer, () => this.rushBanner.visible);
    this.era = new EraCard(ctx, layer);
    this.ageCard = new AgeCard(ctx, layer);
    this.eraChip = new EraChip(ctx, layer);
    this.incomeFeed = new IncomeFeed(ctx, this.moneyEl);
    this.map = new MapPanel(ctx, layer);
    this.mapBtn = this.makeButton('wl-map-btn', 'Map (T)', ICON_MAP, () => this.map.toggle());
    this.marketBtn = this.makeButton('wl-market-btn', 'Market (B)', ICON_MARKET, () => this.toggleMarket());
    this.autoQuality = new AutoQuality(ctx, () => {
      this.settings.sync();
      this.toast('Switched to Low graphics for smoother play (Settings)', { small: true, duration: 4.5 });
    });

    // toast
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'wl-toast';
    this.toastTitle = document.createElement('div');
    this.toastTitle.className = 'wl-toast-title';
    this.toastSub = document.createElement('div');
    this.toastSub.className = 'wl-toast-sub wl-outline';
    this.toastEl.append(this.toastTitle, this.toastSub);
    layer.appendChild(this.toastEl);

    // edge arrow
    this.edgeEl = document.createElement('div');
    this.edgeEl.className = 'wl-edge';
    this.edgeEl.innerHTML = ICON_EDGE_ARROW;
    layer.appendChild(this.edgeEl);

    // float pool
    for (let i = 0; i < FLOAT_POOL; i++) {
      const el = document.createElement('div');
      el.className = 'wl-float wl-outline';
      layer.appendChild(el);
      this.floats.push({ el, active: false, age: 0, dur: 1, rise: 1.2, ox: 0, world: new THREE.Vector3() });
    }

    // onboarding hand, coin flights
    this.moveHand = new MoveHand(ctx, layer);
    this.coins = new CoinBurst(layer);
    this.coins.onArrive = () => {
      this.bump = 1;
      ctx.audio.play('cash', { combo: true, volume: 0.5 });
    };

    // modal cards go on top of everything else
    this.offline = new OfflineCard(ctx, layer);
    this.finale = new FinaleCard(ctx, layer);

    this.chip = new InteractChip(ctx, layer, () => this.anyModalOpen);

    // 3D guide arrow (origin = centre of the arrow; points down)
    this.arrow = HUD.buildArrow();
    this.arrow.visible = false;
    ctx.scene.add(this.arrow);

    ctx.events.on('money:changed', (e) => this.setMoney(e.money, true));
    // 0.9.0: one bottom sheet at a time; T / B open the map / market; a trip ends with a welcome
    ctx.events.on('shop:open', () => this.onlySheet('shop'));
    ctx.events.on('build:open', () => this.onlySheet('build'));
    ctx.events.on('choose:open', () => this.onlySheet('choose'));
    ctx.events.on('manage:open', () => this.onlySheet('manage'));
    ctx.events.on('market:open', () => this.onlySheet('market'));
    ctx.events.on('travel:done', (e) => this.toast(`Welcome to ${e.label}`, { small: true, duration: 2.4 }));
    window.addEventListener('keydown', (e) => this.onKey(e));
    // wave 10 keyboard shortcuts (Game turns the keys into events)
    ctx.events.on('ui:escape', () => this.escape());
    ctx.events.on('ui:mute', () => this.toggleMute());
    ctx.events.on('ui:fullscreen', () => {
      toggleFullscreen();
      this.settings.sync();
    });
    ctx.events.on('finale:start', () => {
      this.toastQueue.length = 0;
      this.finale.schedule();
    });
    // wave 13: the Grand Market's finale card (same stats card, its own title)
    ctx.events.on('finale2:start', () => this.finale.schedule(undefined, 'market'));
  }

  /** True while settings, the map or any bottom sheet (shop, build, choose, manage, market) is open. */
  get anyModalOpen(): boolean {
    return this.settings.isOpen || this.map.visible || this.anySheetOpen;
  }

  /** True while one of the bottom sheets (shop, build, choose, manage, market) is open. */
  private get anySheetOpen(): boolean {
    return this.shop.visible || this.build.visible || this.choose.visible || this.manage.visible || this.market.visible;
  }

  /** A round HUD button in the top-right row (Map, Market). Hidden until update() decides it is on show. */
  private makeButton(cls: string, label: string, icon: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `wl-hudbtn ${cls}`;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.innerHTML = icon;
    b.style.display = 'none';
    const stop = (e: Event) => e.stopPropagation();
    b.addEventListener('pointerdown', stop);
    b.addEventListener('touchstart', stop, { passive: true });
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      this.ctx.audio.unlock();
      this.ctx.audio.play('click');
      onClick();
    });
    this.layer.appendChild(b);
    return b;
  }

  /** Close every bottom sheet except `keep` (they share the same spot on screen). */
  private onlySheet(keep: 'shop' | 'build' | 'choose' | 'manage' | 'market'): void {
    if (keep !== 'shop' && this.shop.visible) this.shop.close();
    if (keep !== 'build' && this.build.visible) this.build.close();
    if (keep !== 'choose' && this.choose.visible) this.choose.close();
    if (keep !== 'manage' && this.manage.visible) this.manage.close();
    if (keep !== 'market' && this.market.visible) this.market.close();
  }

  private toggleMarket(): void {
    if (this.market.visible) this.market.close();
    else this.ctx.events.emit('market:open', {});
  }

  /** T = map, B = market (only once those buttons are on show; never while typing). */
  private onKey(e: KeyboardEvent): void {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (this.settings.isOpen) return;
    if (e.code === 'KeyT' && (this.hasMapBtn || this.map.visible)) {
      e.preventDefault();
      this.map.toggle();
    } else if (e.code === 'KeyB' && (this.hasMarketBtn || this.market.visible)) {
      e.preventDefault();
      this.toggleMarket();
    }
  }

  /** What the mute button does (also the M key). */
  private toggleMute(): void {
    const { audio } = this.ctx;
    audio.unlock();
    const muted = audio.toggleMute();
    this.muteBtn.classList.toggle('is-muted', muted);
    this.settings.sync();
    if (!muted) audio.play('click');
  }

  /** Esc: close the topmost thing (settings, map, a sheet, the era card), else fold the quest card, else open Settings. */
  private escape(): void {
    if (this.settings.isOpen) this.settings.close();
    else if (this.map.visible) this.map.close();
    else if (this.market.visible) this.market.close();
    else if (this.choose.visible) this.choose.close();
    else if (this.manage.visible) this.manage.close();
    else if (this.shop.visible) this.shop.close();
    else if (this.build.visible) this.build.close();
    else if (this.ageCard.visible) this.ageCard.close();
    else if (!this.quests.isCollapsed && !this.quests.isAllDone) this.quests.setCollapsed(true);
    else this.settings.open();
  }

  private static buildArrow(): THREE.Group {
    const g = new THREE.Group();
    const fill = toon(PALETTE.accent, { emissive: PALETTE.accent, emissiveIntensity: 0.25 });
    const outline = basic(0xffffff, { side: THREE.BackSide });
    const coneGeo = geo.cone(0.8, 0.95, 4);
    const shaftGeo = geo.box(0.38, 1.05, 0.38);
    const parts: Array<[THREE.BufferGeometry, number, boolean]> = [
      [coneGeo, -0.5, true],
      [shaftGeo, 0.47, false],
    ];
    for (const [gm, y, flip] of parts) {
      for (const hull of [false, true]) {
        const m = new THREE.Mesh(gm, hull ? outline : fill);
        m.position.y = y;
        if (flip) m.rotation.set(Math.PI, Math.PI / 4, 0);
        else m.rotation.y = Math.PI / 4;
        if (hull) m.scale.setScalar(1.2);
        m.castShadow = false;
        m.receiveShadow = false;
        g.add(m);
      }
    }
    return g;
  }

  // ---------------------------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------------------------

  /** Set the money readout. `animate` counts toward the value and bumps the pill on gains. */
  setMoney(value: number, animate = true): void {
    if (animate && value > this.moneyTarget) this.bump = 1;
    this.moneyTarget = value;
    if (!animate) {
      this.moneyShown = value;
      this.writeMoney();
    }
  }

  /** World-anchored text that rises and fades (e.g. "+$15", "MAX"). */
  floatText(world: THREE.Vector3, text: string, opts?: FloatTextOptions): void {
    let slot: FloatSlot | undefined;
    let oldest = this.floats[0]!;
    for (const s of this.floats) {
      if (!s.active) {
        slot = s;
        break;
      }
      if (s.age / s.dur > oldest.age / oldest.dur) oldest = s;
    }
    slot ??= oldest;
    slot.active = true;
    slot.age = 0;
    slot.dur = opts?.duration ?? 0.9;
    slot.rise = opts?.rise ?? 1.2;
    slot.ox = (Math.random() - 0.5) * 14;
    slot.world.copy(world);
    const el = slot.el;
    el.textContent = text;
    el.style.color = opts?.color ?? '#5ee07a';
    el.style.fontSize = `${opts?.size ?? 26}px`;
    el.style.display = 'block';
    el.style.opacity = '0';
  }

  /** Show the current hint in the top-centre banner (null hides it). */
  setObjective(text: string | null): void {
    this.objWant = text;
  }

  /** Point the guide arrows at a world position (null hides them). */
  setGuideTarget(world: THREE.Vector3 | null): void {
    if (!world) {
      this.hasGuide = false;
      return;
    }
    this.guideTarget.copy(world);
    if (!this.hasGuide && this.guideScale < 0.05) this.guideSnap = true;
    this.hasGuide = true;
  }

  /**
   * Welcome-back card: "While you were away (1 h 20 min) your mill earned $amount" (the money was already
   * credited at load); calls onCollect() exactly once when its button closes it (the caller emits 'offline:collected').
   */
  showOfflineEarnings(amount: number, seconds: number, onCollect: () => void): void {
    this.offline.show(amount, seconds, onCollect);
  }

  /** Quest panel (tests / debug). */
  get questPanel(): QuestPanel {
    return this.quests;
  }

  /** Gold coins burst out of the toast spot and fly into the money pill (quest rewards). */
  coinBurst(count = 10): void {
    const rect = this.moneyEl.getBoundingClientRect();
    const root = this.layer.getBoundingClientRect();
    const w = this.ctx.renderer.width;
    const h = this.ctx.renderer.height;
    this.coins.spawn(count, w / 2, h * 0.36 + 56, rect.left - root.left + 28, rect.top - root.top + rect.height / 2);
  }

  /** 0.9.0 panels (tests / debug). */
  get managePanel(): ManagePanel {
    return this.manage;
  }

  get choosePanel(): ChoosePanel {
    return this.choose;
  }

  get mapPanel(): MapPanel {
    return this.map;
  }

  get marketPanel(): MarketPanel {
    return this.market;
  }

  /** Shop panel (tests / debug). */
  get shopPanel(): ShopPanel {
    return this.shop;
  }

  /** Wave 9: the town's build menu (Town attaches itself to it; tests / debug). */
  get buildPanel(): BuildPanel {
    return this.build;
  }

  /** Settings panel (tests / debug). */
  get settingsPanel(): SettingsPanel {
    return this.settings;
  }

  /** Finale stats card (tests / debug). */
  get finaleCard(): FinaleCard {
    return this.finale;
  }

  /** Centred celebration text that pops in and fades out. Toasts arriving right after another one queue up. */
  toast(title: string, opts?: { sub?: string; duration?: number; small?: boolean }): void {
    const t = { title, sub: opts?.sub ?? '', dur: opts?.duration ?? 2.2, at: this.ctx.time.elapsed, small: opts?.small ?? false };
    // a toast that arrives while another is still fresh waits its turn instead of wiping it (briefly: queued
    // toasts expire TOAST_STALE s after they were asked for, so a burst never drips out for many seconds)
    if (this.toastActive && this.toastAge < 1.0 && this.toastQueue.length < 2) {
      this.toastQueue.push(t);
      return;
    }
    this.showToast(t);
  }

  private showToast(t: { title: string; sub: string; dur: number; at: number; small: boolean }): void {
    this.toastTitle.textContent = t.title;
    this.toastSub.textContent = t.sub;
    this.toastSub.style.display = t.sub ? 'block' : 'none';
    this.toastEl.classList.toggle('is-small', t.small);
    this.toastDur = t.dur;
    this.toastAge = 0;
    this.toastActive = true;
    this.toastEl.style.display = 'block';
    this.toastEl.style.opacity = '0';
  }

  update(dt: number): void {
    this.updateMoney(dt);
    this.updateObjective(dt);
    this.updateFloats(dt);
    this.updateToast(dt);
    this.updateGuide(dt);
    this.shop.update(dt);
    this.build.update(dt);
    this.manage.update(dt);
    this.choose.update(dt);
    this.market.update(dt);
    this.map.update(dt);
    this.eraChip.update(dt);
    this.incomeFeed.update(dt);
    this.ageCard.update(dt);
    this.updateAgeButtons();
    this.settings.update(dt);
    this.offline.update(dt);
    this.finale.update(dt);
    this.quests.update(dt);
    this.rushBanner.update(dt);
    this.contractCard.update(dt);
    this.eventBanner.update(dt);
    this.era.update(dt);
    this.moveHand.update(dt);
    this.coins.update(dt);
    this.chip.update(dt);
    this.autoQuality.update();
    this.perf.update();
    // on phones the shop is a bottom sheet over the FPS readout
    const sheetOpen = this.anySheetOpen;
    if (this.layer.classList.contains('shop-open') !== sheetOpen) {
      this.layer.classList.toggle('shop-open', sheetOpen);
    }
    const questsOpen = !this.quests.isCollapsed && !this.quests.isAllDone;
    if (this.layer.classList.contains('quests-open') !== questsOpen) {
      this.layer.classList.toggle('quests-open', questsOpen);
    }
    const hasVillage = this.village.update(dt);
    if (hasVillage !== this.hasVillage) {
      this.hasVillage = hasVillage;
      this.layer.classList.toggle('has-village', hasVillage);
    }
    const hasSeason = this.seasonBadge.update();
    if (hasSeason !== this.hasSeason) {
      this.hasSeason = hasSeason;
      this.layer.classList.toggle('has-season', hasSeason);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Per-frame pieces
  // ---------------------------------------------------------------------------------------------

  /** Map / Market buttons and the era chip appear with the Ages (map: first expansion offered; market: era 2). */
  private updateAgeButtons(): void {
    const { state } = this.ctx;
    const age = state.eras.age;
    const mapOn = age >= 2 || expansionOffered(state, 2);
    const marketOn = age >= 2;
    if (mapOn !== this.hasMapBtn) {
      this.hasMapBtn = mapOn;
      this.mapBtn.style.display = mapOn ? '' : 'none';
      this.layer.classList.toggle('has-map', mapOn);
    }
    if (marketOn !== this.hasMarketBtn) {
      this.hasMarketBtn = marketOn;
      this.marketBtn.style.display = marketOn ? '' : 'none';
      this.layer.classList.toggle('has-market', marketOn);
    }
    const chipOn = this.eraChip.visible;
    if (chipOn !== this.hasEraChip) {
      this.hasEraChip = chipOn;
      this.layer.classList.toggle('has-erachip', chipOn);
    }
    this.mapBtn.classList.toggle('is-on', this.map.visible);
    this.marketBtn.classList.toggle('is-on', this.market.visible);
  }

  private writeMoney(): void {
    const rounded = Math.round(this.moneyShown);
    if (rounded === this.moneyRounded) return;
    this.moneyRounded = rounded;
    const text = formatMoney(this.moneyShown);
    if (text !== this.moneyText) {
      this.moneyText = text;
      this.moneyValue.textContent = text;
    }
  }

  private updateMoney(dt: number): void {
    const diff = this.moneyTarget - this.moneyShown;
    if (Math.abs(diff) > 0.4) {
      const step = Math.max(Math.abs(diff) * (1 - Math.exp(-9 * dt)), 45 * dt);
      this.moneyShown += Math.sign(diff) * Math.min(step, Math.abs(diff));
    } else {
      this.moneyShown = this.moneyTarget;
    }
    this.writeMoney();

    if (this.bump > 0) {
      this.bump = Math.max(0, this.bump - dt / 0.32);
      const s = 1 + 0.22 * Math.sin(Math.PI * (1 - this.bump));
      this.moneyEl.style.transform = `scale(${s.toFixed(3)})`;
    } else if (this.moneyEl.style.transform) {
      this.moneyEl.style.transform = '';
    }
  }

  private updateObjective(dt: number): void {
    const el = this.objectiveEl;
    if (this.objShown !== this.objWant) {
      if (this.objShown === null) {
        this.objShown = this.objWant;
        this.objK = 0;
        el.textContent = this.objShown;
      } else {
        this.objK -= dt / 0.16;
        if (this.objK <= 0) {
          this.objK = 0;
          this.objShown = this.objWant;
          if (this.objShown !== null) el.textContent = this.objShown;
        }
      }
    } else if (this.objShown !== null) {
      this.objK = Math.min(1, this.objK + dt / 0.38);
    }
    if (this.objShown === null) {
      if (el.style.visibility !== 'hidden') el.style.visibility = 'hidden';
      return;
    }
    const k = this.objK;
    const e = backOut(Math.min(1, k));
    const opacity = String(Math.min(1, k * 2.5));
    const transform = `translate(-50%, ${((1 - e) * -26).toFixed(1)}px) scale(${(0.8 + 0.2 * e).toFixed(3)})`;
    const key = `${opacity}|${transform}`;
    if (key === this.objStyleKey && el.style.visibility === 'visible') return;
    this.objStyleKey = key;
    el.style.visibility = 'visible';
    el.style.opacity = opacity;
    el.style.transform = transform;
  }

  private updateFloats(dt: number): void {
    const rig = this.ctx.cameraRig;
    for (const s of this.floats) {
      if (!s.active) continue;
      s.age += dt;
      const k = s.age / s.dur;
      if (k >= 1) {
        s.active = false;
        s.el.style.display = 'none';
        continue;
      }
      this.tmp3.copy(s.world);
      this.tmp3.y += s.rise * cubicOut(k);
      if (!rig.worldToScreen(this.tmp3, this.tmp2)) {
        s.el.style.opacity = '0';
        continue;
      }
      const pop = s.age < 0.16 ? 0.45 + 0.55 * backOut(s.age / 0.16) : 1;
      const fade = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
      s.el.style.opacity = fade.toFixed(3);
      s.el.style.transform = `translate3d(${(this.tmp2.x + s.ox).toFixed(1)}px, ${this.tmp2.y.toFixed(1)}px, 0) translate(-50%, -50%) scale(${pop.toFixed(3)})`;
    }
  }

  private updateToast(dt: number): void {
    if (!this.toastActive) return;
    this.toastAge += dt;
    const a = this.toastAge;
    const d = this.toastDur;
    if (a >= d) {
      this.toastActive = false;
      this.toastEl.style.display = 'none';
      const now = this.ctx.time.elapsed;
      let next = this.toastQueue.shift();
      while (next && now - next.at > TOAST_STALE) next = this.toastQueue.shift();
      if (next) this.showToast(next);
      return;
    }
    const popK = Math.min(1, a / 0.4);
    const s = 0.2 + 0.8 * backOut(popK);
    const fadeStart = d - 0.45;
    const op = a < 0.08 ? a / 0.08 : a > fadeStart ? 1 - (a - fadeStart) / 0.45 : 1;
    const lift = a > fadeStart ? -((a - fadeStart) / 0.45) * 24 : 0;
    this.toastEl.style.opacity = op.toFixed(3);
    this.toastEl.style.transform = `translate(-50%, calc(-50% + ${lift.toFixed(1)}px)) scale(${s.toFixed(3)})`;
  }

  private updateGuide(dt: number): void {
    const target = this.hasGuide ? 1 : 0;
    this.guideScale += (target - this.guideScale) * (1 - Math.exp(-12 * dt));
    if (Math.abs(target - this.guideScale) < 0.01) this.guideScale = target;

    if (this.guideScale <= 0) {
      this.arrow.visible = false;
      this.edgeEl.style.display = 'none';
      return;
    }

    this.guideTime += dt;
    if (this.guideSnap) {
      this.guidePos.copy(this.guideTarget);
      this.guideSnap = false;
    } else {
      this.guidePos.lerp(this.guideTarget, 1 - Math.exp(-8 * dt));
    }

    // 3D bouncing arrow
    const bob = Math.abs(Math.sin(this.guideTime * 3.4)) * 0.55;
    this.arrow.visible = true;
    this.arrow.position.set(this.guidePos.x, this.guidePos.y + 3.3 + bob, this.guidePos.z);
    this.arrow.rotation.y = this.guideTime * 1.8;
    const sq = 1 + 0.05 * Math.sin(this.guideTime * 6.8);
    const big = this.guideScale * ARROW_SCALE;
    this.arrow.scale.set(big * sq, big / sq, big * sq);

    // screen-edge arrow when the target is off-screen
    const rig = this.ctx.cameraRig;
    this.tmp3.copy(this.guidePos);
    this.tmp3.y += 1;
    if (this.hasGuide && !rig.isOnScreen(this.tmp3, 28)) {
      rig.worldToScreen(this.tmp3, this.tmp2);
      const w = this.ctx.renderer.width;
      const h = this.ctx.renderer.height;
      const cx = w / 2;
      const cy = h / 2;
      const dx = this.tmp2.x - cx;
      const dy = this.tmp2.y - cy;
      const mx = 40;
      const myTop = 96;
      const myBottom = 44;
      // limit along the ray from the centre to the (asymmetric) inner rectangle
      const tx = dx === 0 ? Infinity : (dx > 0 ? w - mx - cx : cx - mx) / Math.abs(dx);
      const ty = dy === 0 ? Infinity : (dy > 0 ? h - myBottom - cy : cy - myTop) / Math.abs(dy);
      const t = Math.min(tx, ty);
      const px = cx + dx * t;
      const py = cy + dy * t;
      const ang = Math.atan2(dy, dx);
      const pulse = 1 + 0.12 * Math.sin(this.guideTime * 7);
      const nudge = 4 * Math.sin(this.guideTime * 7);
      const ox = Math.cos(ang) * nudge;
      const oy = Math.sin(ang) * nudge;
      const e = this.edgeEl.style;
      e.display = 'block';
      e.transform = `translate3d(${(px + ox).toFixed(1)}px, ${(py + oy).toFixed(1)}px, 0) rotate(${ang.toFixed(3)}rad) scale(${(pulse * this.guideScale).toFixed(3)})`;
    } else {
      this.edgeEl.style.display = 'none';
    }
  }
}
