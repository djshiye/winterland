#!/usr/bin/env node
/**
 * Pacing check: plays the whole game with the in-page bot (scripts/playtest-bot.js) without screenshots and prints
 * the milestone times (minutes of play) plus every purchase, so economy tuning in config.ts can be compared with
 * the targets in docs/DESIGN.md.
 *
 *   node scripts/balance.mjs [--goal finale] [--budget 5400]   (exits non-zero if the goal isn't reached)
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const budget = Number(opt('--budget', 5400));
// CI: stop at an earlier milestone (any bot goal) and fail when the bot can't reach it in the budget.
const goal = opt('--goal', 'finale');
const bot = readFileSync(join(here, 'playtest-bot.js'), 'utf8');

const steps = [
  'sim:1',
  'eval:(__WINTERLAND__.skipIntro(), "intro skipped")',
  `eval:${bot}`,
  `eval:(() => { const r = __bot.runUntil(${JSON.stringify(goal)}, ${budget}); if (!r.ok) throw new Error("bot did not reach ${goal} in ${budget} s"); return JSON.stringify(r.state); })()`,
  'eval:__bot.milestones().join("\\n")',
  'eval:__bot.report().timeline.filter((e) => e.bought || e.built !== undefined || e.unlocked).map((e) => `${(e.t / 60).toFixed(1)} ${e.bought ?? e.unlocked ?? `plot ${e.built} → ${e.tier}`} ($${e.money})`).join("\\n")',
];
const r = spawnSync(process.execPath, [join(here, 'shot.mjs'), '--timeout', '600000', '--query', 'fresh&noauto', ...steps], { stdio: 'inherit' });
process.exit(r.status ?? 1);
