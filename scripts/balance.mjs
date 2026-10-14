#!/usr/bin/env node
/**
 * Pacing check: plays the whole game with the in-page bot (scripts/playtest-bot.js) without screenshots and prints
 * the milestone times (minutes of play) plus every purchase, so economy tuning in config.ts can be compared with
 * the targets in docs/DESIGN.md.
 *
 *   node scripts/balance.mjs [--budget 5400]
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const bi = args.indexOf('--budget');
const budget = bi >= 0 ? Number(args[bi + 1]) : 5400;
const bot = readFileSync(join(here, 'playtest-bot.js'), 'utf8');

const steps = [
  'sim:1',
  'eval:(__WINTERLAND__.skipIntro(), "intro skipped")',
  `eval:${bot}`,
  `eval:JSON.stringify(__bot.runUntil("finale", ${budget}).state)`,
  'eval:__bot.milestones().join("\\n")',
  'eval:__bot.report().timeline.filter((e) => e.bought || e.built !== undefined || e.unlocked).map((e) => `${(e.t / 60).toFixed(1)} ${e.bought ?? e.unlocked ?? `plot ${e.built} → ${e.tier}`} ($${e.money})`).join("\\n")',
];
const r = spawnSync(process.execPath, [join(here, 'shot.mjs'), '--timeout', '600000', '--query', 'fresh', ...steps], { stdio: 'inherit' });
process.exit(r.status ?? 1);
