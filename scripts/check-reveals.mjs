#!/usr/bin/env node
/**
 * Headless end-to-end check of the wave 7 + 8 reveal order (incl. the furniture workshop) and of save/restore, through the debug API.
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
const vis = `(v=>['truckLoader','ridge','treeFeller','cashTubes','workshop'].filter(k=>v[k]).join(','))(${W}.ctx.state.padsVisible)`;
const flag = (k) => `!!${W}.ctx.state.flags['${k}']`;
const quiet = `(${W}.level.cashPiles().forEach(p=>Object.defineProperty(p,'value',{get:()=>0})),${W}.ctx.economy.spend(${W}.ctx.economy.money),0)`;
const broke = `(${W}.ctx.economy.spend(${W}.ctx.economy.money),0)`;
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
  // wave 8: the workshop pad shows 60 s after the feller (+ the 3.4 s rule delay); ~48 s have passed since the feller
  ['eval:' + `!!${W}.ctx.state.padsVisible.workshop`, 'workshop pad is not shown yet (feller + ~48 s)', false],
  ['sim:18'],
  ['eval:' + `!!${W}.ctx.state.padsVisible.workshop&&!${W}.ctx.state.unlocked.workshop`, 'workshop pad appears about 60 s after the feller', true],
  ['eval:' + flag('reveal:workshopPad'), 'its reveal flag is recorded', true],
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
  // wave 8 after the reload: the workshop pad is still on the floor, then the guide walks the lesson
  ['eval:' + `${W}.level.pads.workshop.visible&&!${W}.level.pads.workshop.unlocked`, 'restored: workshop pad on the floor, not built', true],
  ['eval:' + `(${W}.unlock('cashTubes'),${W}.teleport(24,-1),${W}.ctx.economy.spend(${W}.ctx.economy.money),${W}.addMoney(15000),0)`, 'tubes built, $15,000 in hand'],
  ['sim:1'],
  ['eval:' + obj, 'guide: build the workshop', 'Build the Workshop ($15,000)'],
  ['shot:workshop-pad-guide'],
  ['eval:' + `(${quiet},${W}.unlock('workshop'),0)`, 'quiet the yard, build the workshop (unlock pan plays)'],
  ['sim:1.5'],
  // the 'workshop' quest paid its reward: spend it, or the village pad (affordable, higher priority) leads the guide
  ['eval:' + broke, 'quest reward spent'],
  ['eval:' + `!!${W}.level.workshop&&!!${W}.level.sledCounter&&!!${W}.level.sledCash`, 'workshop, sled counter and sled cash exist', true],
  ['eval:' + `(${W}.level.treeFeller.deck.fill('log',6),${W}.teleport(22.8,4.7),0)`, 'logs on the deck, player beside the hopper'],
  ['sim:1'],
  ['eval:' + obj, 'guide: fetch logs for the workshop', 'Pick up logs for the workshop'],
  ['eval:' + `(${W}.ctx.player.arms.addImmediate(${W}.ctx.items.create('log')),${W}.teleport(22.8,4.7),${broke})`, 'a log in hand'],
  ['sim:1'],
  ['eval:' + obj, 'guide: feed the workshop', 'Feed logs to the workshop'],
  ['shot:feed-guide'],
  ['eval:' + `(${W}.level.workshop.output.fill('furniture',3),0)`, 'chairs on the bench'],
  ['sim:0.5'],
  ['eval:' + `(${W}.ctx.player.arms.take('log'),${broke})`, 'logs out of hand, no money'],
  ['sim:1'],
  ['eval:' + obj, 'guide: grab the chairs', 'Grab the chairs for the dog sleds'],
  ['eval:' + `(${W}.ctx.player.arms.addImmediate(${W}.ctx.items.create('furniture')),${broke})`, 'a chair in hand'],
  ['sim:1'],
  ['eval:' + obj, 'guide: carry chairs to the sleds', 'Carry chairs to the dog sleds'],
  ['shot:carry-guide'],
  ['eval:' + `(${W}.level.sledCash.restoreValue(500),${broke})`, 'cash on the sled pile, no money'],
  ['eval:' + `(${W}.ctx.player.arms.take('furniture'),${W}.level.workshop.output.take('furniture'),${W}.level.workshop.output.take('furniture'),${W}.level.workshop.output.take('furniture'),0)`, 'all chairs gone'],
  ['sim:1'],
  ['eval:' + obj, 'guide: collect the sled cash', 'Walk over the cash to bank it'],
  // the workshop survives a reload too
  ['eval:' + `${W}.level.sledCash.value`, 'sled cash before the save', undefined],
  ['eval:' + `(${W}.save(),0)`, 'save'],
  ['eval:' + `JSON.stringify([${W}.ctx.state.padsVisible,${W}.ctx.state.unlocked,Object.keys(${W}.ctx.state.flags).sort()])`, 'state before reload', 'CAPTURE'],
  ['reload'],
  ['eval:' + `JSON.stringify([${W}.ctx.state.padsVisible,${W}.ctx.state.unlocked,Object.keys(${W}.ctx.state.flags).sort()])`, 'workshop state after reload is identical', 'SAME'],
  ['eval:' + `!!${W}.level.workshop&&${W}.level.pads.workshop.unlocked`, 'restored: workshop built', true],
  ['eval:' + `Math.abs(${W}.level.sledCash.value-500)<=15`, 'restored: sled cash pile value (within one bundle of 500)', true],
  ['sim:8'],
  ['eval:' + `JSON.stringify([${W}.ctx.state.padsVisible,${W}.ctx.state.unlocked,Object.keys(${W}.ctx.state.flags).sort()])`, 'no spurious reveal after the workshop reload', 'SAME'],
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
