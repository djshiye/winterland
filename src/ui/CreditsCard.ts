/**
 * [0.9.10 — H2] Settings → Game → About: who made the game, its version and the open-source parts it is built with.
 * The list comes from package.json, so it can't go stale: every runtime dependency (shipped inside the game), plus the
 * devDependencies in BUILT_WITH (Electron runs the desktop app, Vite builds the game). Each line shows the package's
 * licence; LICENSES mirrors the `license` field of node_modules/<name>/package.json, and tests/menus0910.test.ts
 * fails when a package is added without one or a licence no longer matches. Text is set with textContent only.
 */
import { dependencies, devDependencies } from '../../package.json';
import type { GameContext } from '../core/types';
import { GAME_VERSION } from '../core/version';
import { desktop } from '../platform/desktop';
import { h, onTap } from './dom';

/** The game's own licence line (LICENSE at the repo root). */
export const COPYRIGHT = 'Copyright (c) 2026 Dino (djshiye). All rights reserved.';

/** devDependencies that are part of the game players get (the desktop app's runtime, the build tool). */
export const BUILT_WITH: readonly string[] = ['electron', 'vite'];

/** The `license` field of each credited package (SPDX ids). Checked against node_modules by the tests. */
export const LICENSES: Readonly<Record<string, string>> = {
  three: 'MIT',
  '@fontsource/fredoka': 'OFL-1.1',
  electron: 'MIT',
  vite: 'MIT',
};

/** Friendly names and what each part does (a package without an entry shows its own name). */
const ABOUT: Readonly<Record<string, { name: string; what: string }>> = {
  three: { name: 'three.js', what: '3D graphics' },
  '@fontsource/fredoka': { name: 'Fredoka font', what: 'The lettering' },
  electron: { name: 'Electron', what: 'The desktop app' },
  vite: { name: 'Vite', what: 'Builds the game' },
};

/** SPDX ids as players read them. */
const LICENSE_NAMES: Readonly<Record<string, string>> = { MIT: 'MIT', 'OFL-1.1': 'SIL OFL 1.1', 'Apache-2.0': 'Apache 2.0', ISC: 'ISC' };

export interface Credit {
  /** The npm package. */
  pkg: string;
  name: string;
  what: string;
  /** Readable licence name ("MIT", "SIL OFL 1.1"). */
  license: string;
}

/** Pure: the credits for these package.json maps: every dependency and the BUILT_WITH devDependencies present. */
export function creditList(deps: Readonly<Record<string, string>> = dependencies, dev: Readonly<Record<string, string>> = devDependencies): Credit[] {
  const known = Object.keys(ABOUT);
  const rank = (p: string): number => (known.includes(p) ? known.indexOf(p) : known.length);
  // the known parts in ABOUT's order (three.js first), anything new after them
  const pkgs = [...Object.keys(deps), ...BUILT_WITH.filter((p) => p in dev && !(p in deps))].sort((a, b) => rank(a) - rank(b));
  return pkgs.map((pkg) => {
    const spdx = LICENSES[pkg] ?? '';
    return {
      pkg,
      name: ABOUT[pkg]?.name ?? pkg,
      what: ABOUT[pkg]?.what ?? '',
      license: LICENSE_NAMES[spdx] ?? (spdx || 'See its licence'),
    };
  });
}

export class CreditsCard {
  readonly el: HTMLDivElement;
  /** The Back button (Settings focuses it when the view opens). */
  readonly back: HTMLButtonElement;

  constructor(ctx: GameContext, onBack: () => void) {
    this.el = h('div', 'wl-settings-confirm wl-credits');
    const title = h('div', 'wl-confirm-text wl-credits-title');
    title.textContent = 'About Winterland';
    const by = h('p', 'wl-credits-by');
    by.textContent = 'A cozy winter idle game by Dino.';
    const version = h('p', 'wl-credits-version');
    version.textContent = `Version ${desktop()?.version || GAME_VERSION}`;
    const lead = h('div', 'wl-credits-lead');
    lead.textContent = 'Built with';
    const list = h('ul', 'wl-credits-list');
    for (const c of creditList()) {
      const li = h('li', 'wl-credits-row');
      const text = h('div', 'wl-credits-text');
      const name = h('b');
      name.textContent = c.name;
      text.appendChild(name);
      if (c.what) {
        const what = h('span');
        what.textContent = c.what;
        text.appendChild(what);
      }
      const lic = h('span', 'wl-credits-lic');
      lic.textContent = c.license;
      li.append(text, lic);
      list.appendChild(li);
    }
    const copy = h('p', 'wl-credits-copy');
    copy.textContent = COPYRIGHT;
    this.back = h('button', 'wl-btn wl-btn-grey', 'Back');
    this.back.type = 'button';
    onTap(this.back, () => {
      ctx.audio.play('click');
      onBack();
    });
    const row = h('div', 'wl-btn-row');
    row.appendChild(this.back);
    this.el.append(title, by, version, lead, list, copy, row);
  }
}
