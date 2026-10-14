#!/usr/bin/env node
/**
 * Headless autoplay: builds the game (via scripts/shot.mjs), lets the intro play, injects the in-page
 * bot (scripts/playtest-bot.js) and plays the whole game — phases 1–5, shop, crew, machine levels, the village
 * and the Great Lodge finale — screenshotting each milestone. Ends with the milestone times (minutes of play).
 *
 *   node scripts/playtest.mjs [outDir=shots/playtest] [--mobile] [--short]   (--short: stop after phase 5)
 *
 * Prints every milestone result as JSON; exits non-zero if the page logged errors (shot.mjs rule).
 * A milestone with "ok": false means the bot could not reach it within its simulated-time budget.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith('--')) ?? 'shots/playtest';
const extra = args.filter((a) => a.startsWith('--'));
mkdirSync(out, { recursive: true });

const bot = readFileSync(join(here, 'playtest-bot.js'), 'utf8');
const milestone = (goal, budget, file, frame) => [
  `eval:JSON.stringify(__bot.runUntil(${JSON.stringify(goal)}, ${budget}))`,
  ...(frame ? [`eval:__bot.frame(${JSON.stringify(frame)})`] : []),
  `shot:${join(out, file)}`,
];

const short = extra.includes('--short');
const steps = [
  'sim:1.5',
  `shot:${join(out, '00-intro.png')}`,
  'sim:10',
  'eval:__WINTERLAND__.state().phase === "intro" ? (__WINTERLAND__.skipIntro(), "intro still running after 11.5 s: skipped") : "intro finished"',
  `shot:${join(out, '01-start.png')}`,
  `eval:${bot}`,
  ...milestone('harvester', 300, '02-harvester.png', 'harvester'),
  ...milestone('shop', 300, '03-shop.png', 'shop'),
  ...milestone('processor', 600, '04-processor.png', 'processor'),
  ...milestone('village', 600, '05-village.png', 'village'),
  ...milestone('bothConveyors', 900, '06-conveyors.png', 'eastConveyor'),
  ...milestone('expansion', 900, '07-megasaw.png', 'megaSaw'),
  'eval:JSON.stringify(__bot.perf())',
  ...(short
    ? []
    : [
        ...milestone('vl:3', 1800, '08-town.png', 'village'),
        ...milestone('vl:4', 1800, '09-winter-city.png', 'village'),
        ...milestone('finale', 1200, '10-finale.png', 'village'),
        'eval:JSON.stringify(__bot.perf())',
      ]),
  'eval:JSON.stringify(__bot.runFor(60))',
  `shot:${join(out, short ? '08-late.png' : '11-late.png')}`,
  'eval:JSON.stringify(__bot.perf())',
  'eval:JSON.stringify(__bot.report().actions)',
  'eval:__bot.milestones().join("\\n")',
];

const r = spawnSync(process.execPath, [join(here, 'shot.mjs'), '--timeout', '120000', ...extra.filter((a) => a !== '--short'), ...steps], {
  stdio: 'inherit',
});
process.exit(r.status ?? 1);
