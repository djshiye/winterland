#!/usr/bin/env node
/**
 * Headless autoplay: builds the game (via scripts/shot.mjs), lets the intro play, injects the in-page
 * bot (scripts/playtest-bot.js) and plays through phases 1–5, screenshotting each milestone.
 *
 *   node scripts/playtest.mjs [outDir=shots/playtest] [--mobile]
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

const steps = [
  'sim:1.5',
  `shot:${join(out, '00-intro.png')}`,
  'sim:10',
  'eval:__WINTERLAND__.state().phase === "intro" ? (__WINTERLAND__.skipIntro(), "intro still running after 11.5 s: skipped") : "intro finished"',
  `shot:${join(out, '01-start.png')}`,
  `eval:${bot}`,
  ...milestone('harvester', 300, '02-harvester.png', 'harvester'),
  ...milestone('processor', 400, '03-processor.png', 'processor'),
  ...milestone('automation', 400, '04-automation.png', 'westConveyor'),
  ...milestone('bothConveyors', 400, '05-conveyors.png', 'eastConveyor'),
  ...milestone('expansion', 500, '06-expansion.png', 'megaSaw'),
  'eval:JSON.stringify(__bot.runFor(90))',
  `shot:${join(out, '07-late.png')}`,
  'eval:JSON.stringify(__bot.report())',
];

const r = spawnSync(process.execPath, [join(here, 'shot.mjs'), '--timeout', '120000', ...extra, ...steps], {
  stdio: 'inherit',
});
process.exit(r.status ?? 1);
