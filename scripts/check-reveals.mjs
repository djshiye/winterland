#!/usr/bin/env node
/**
 * Headless end-to-end check of the wave 7 reveal order and of save/restore, through the debug API.
 *
 *   node scripts/check-reveals.mjs [--shots dir]
 *
 * One scripts/shot.mjs run (one browser, one build): the steps below drive the game with __WINTERLAND__
 * (skipIntro, unlock, addMoney, buildQuarters, teleport, save, simulate via `sim:`), read the state back with `eval:`
 * and compare it with the expected value. Exits 1 on the first mismatch. `stats.trucksServed` is set directly
 * (a real truck sale needs 3 trucks loaded; the rule only reads that counter).
 *
 * The unit-level version of the same rules is tests/reveals.test.ts (npx vitest run).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shotsIdx = process.argv.indexOf('--shots');
const shotsDir = shotsIdx > 0 ? process.argv[shotsIdx + 1] : null;

const W = '__WINTERLAND__';
const vis = `(v=>['truckLoader','ridge','treeFeller','cashTubes'].filter(k=>v[k]).join(','))(${W}.ctx.state.padsVisible)`;
const flag = (k) => `!!${W}.ctx.state.flags['${k}']`;
const quiet = `(${W}.level.cashPiles().forEach(p=>Object.defineProperty(p,'value',{get:()=>0})),${W}.ctx.economy.spend(${W}.ctx.economy.money),0)`;
const obj = `${W}.level.progression.objective`;

/** [step, label, expected (omit for plain steps)] */
const steps = [
  ['eval:' + `(${W}.clearSave(),${W}.skipIntro(),0)`, 'start fresh, skip intro'],
  ['eval:' + `(['harvester','processor','westConveyor','eastConveyor','megaSaw'].forEach(k=>${W}.unlock(k)),0)`, 'build up to the mega saw'],
  ['sim:8'],
  ['eval:' + vis, 'before any truck sale: no wave 7 pad is shown', ''],
  ['eval:' + `(${W}.ctx.state.stats.trucksServed=3,0)`, '3 truck loads sold'],
  ['sim:5'],
  ['eval:' + vis, 'truck loader appears, nothing else', 'truckLoader'],
  ['eval:' + `(${W}.unlock('truckLoader'),0)`, 'buy the truck loader'],
  ['sim:5'],
  ['eval:' + vis, 'ridge appears after the loader', 'ridge'],
  ['eval:' + `(${W}.unlock('ridge'),0)`, 'buy the ridge'],
  ['sim:0.3'],
  ['shot:ridge-unlock-pan'],
  ['sim:3'],
  ['eval:' + vis, 'feller not yet (ridge moment still playing)', ''],
  ['eval:' + obj, 'guide: east gate', 'Walk through the east gate to Timber Ridge'],
  ['sim:4'],
  ['eval:' + vis, 'tree feller appears once the ridge is open', 'treeFeller'],
  ['sim:14'],
  ['eval:' + vis, 'cash tubes appear later, after the feller pad', 'treeFeller,cashTubes'],
  ['eval:' + `(${W}.teleport(20,-1),0)`, 'walk onto the ridge'],
  ['sim:1'],
  ['eval:' + flag('seen:ridge'), 'east gate hint is done once on the ridge', true],
  ['eval:' + `(${W}.unlock('treeFeller'),0)`, 'build the feller'],
  ['sim:14'],
  // The guide checks need a quiet yard: no cash lying around (the guide collects it first) and no money
  // (it would point at a payable pad first).
  ['eval:' + quiet, 'quiet the yard (cash piles read 0, money 0)'],
  ['sim:0.5'],
  ['eval:' + obj, 'guide: pine logs from the deck', 'Carry pine logs to the train'],
  ['eval:' + `(${W}.teleport(24,-1),${W}.level.treeFeller.deck.count('log')>=4)`, 'the deck has logs', true],
  ['shot:feller-guide'],
  ['eval:' + `(${W}.ctx.economy.spend(${W}.ctx.economy.money),${W}.addMoney(8000),${W}.level.quarters.padSpot())`, 'bunkhouse pad offered (null while Quarters is a stub)', undefined],
  ['sim:1'],
  ['eval:' + `${W}.level.quarters.padSpot()===null||/bunkhouse/.test(${obj})`, 'guide: build the bunkhouse (when its pad exists)', true],
  ['eval:' + `(${W}.buildQuarters(0),${W}.ctx.economy.spend(${W}.ctx.economy.money),${W}.addMoney(7000),0)`, 'bunkhouse built, cash for the pine hauler'],
  ['sim:1'],
  ['eval:' + obj, 'guide: hire the pine hauler', 'Hire the Pine Hauler at the cabin'],
  ['eval:' + `(${W}.setUpgrade('pineHauler',1),0)`, 'pine hauler hired'],
  ['sim:31'],
  ['eval:' + `${W}.ctx.state.flags['reveal:levelPad:treeFeller']===true`, 'feller level pad revealed 30 s after the unlock', true],
  // restore: save, reload, the same pads are shown and nothing new fires
  ['eval:' + `(${W}.save(),0)`, 'save'],
  ['eval:' + `JSON.stringify([${W}.ctx.state.padsVisible,${W}.ctx.state.unlocked,Object.keys(${W}.ctx.state.flags).sort()])`, 'state before reload', 'CAPTURE'],
  ['reload'],
  ['eval:' + `JSON.stringify([${W}.ctx.state.padsVisible,${W}.ctx.state.unlocked,Object.keys(${W}.ctx.state.flags).sort()])`, 'state after reload is identical', 'SAME'],
  ['sim:1'],
  ['eval:' + `${W}.level.pads.cashTubes.visible&&!${W}.level.pads.ridge.visible&&${W}.level.pads.ridge.unlocked`, 'restored: tubes pad on the floor, ridge stays unlocked', true],
  ['sim:8'],
  ['eval:' + `JSON.stringify([${W}.ctx.state.padsVisible,${W}.ctx.state.unlocked,Object.keys(${W}.ctx.state.flags).sort()])`, 'no spurious reveal after the reload', 'SAME'],
  ['shot:after-reload'],
];

const args = ['scripts/shot.mjs', '--size', '800x450'];
for (const [step] of steps) {
  if (step.startsWith('shot:')) {
    if (shotsDir) args.push(`shot:${path.join(shotsDir, step.slice(5))}.png`);
  } else args.push(step);
}
const run = spawnSync('node', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 });
const out = (run.stdout ?? '') + (run.stderr ?? '');
const evals = [...out.matchAll(/eval .* → (.*)$/gm)].map((m) => m[1]);
let ei = 0;
let fails = 0;
let first = null;
for (const [step, label, expected] of steps) {
  if (!step.startsWith('eval:')) continue;
  const got = evals[ei++];
  if (expected === undefined) {
    console.log(`  info  ${label}: ${got}`);
    continue;
  }
  let want = expected;
  if (expected === 'CAPTURE') {
    first = got;
    console.log(`  info  ${label}`);
    continue;
  }
  if (expected === 'SAME') want = first;
  const ok = expected === 'SAME' ? got === first : got === JSON.stringify(want);
  console.log(`${ok ? '  ok   ' : '  FAIL '} ${label}${ok ? '' : `\n         expected ${JSON.stringify(want)}\n         got      ${got}`}`);
  if (!ok) fails++;
}
if (run.status !== 0) {
  console.log(out.split('\n').filter((l) => /page|FAILED|error/i.test(l)).join('\n'));
  fails++;
}
console.log(fails ? `\n${fails} check(s) failed` : '\nreveal order OK');
process.exit(fails ? 1 : 0);
