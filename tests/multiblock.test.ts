import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Item, Recipe } from '../lib/model';
import { nodeSchema, rate } from '../lib/model';
import { multiblockSetup, multiblockHatchLimits, multiblockOptions, coilHeat } from '../lib/multiblock';
import { overclockRecipe } from '../lib/recipe-overclock';
import { AreaSummaryCache } from '../lib/area-summary-cache';
import { createScaleCalculator } from '../lib/scale-view';
import { findAutoPlans, plannerMachine, type PlannerOptions } from '../lib/auto-planner';
import { plannerBalance } from '../lib/planner-balance';

const plannerOptions: PlannerOptions = { targetId: 'target', priority: 'eu', priorities: ['eu', 'output', 'yield', 'singleblock'], allowMultiblocks: true, maxTier: 2, maxSteps: 10, maxSuggestions: 10, excludedRecipes: [], excludedPlans: [] };

const item = (id: string, name: string, tooltip = '[]'): Item => ({ id, name, tooltip, registryId: id, metadata: 0, mod: 'GregTech', group: '', image: null, kind: 'item' });
const coil = (heat: number) => item(`coil:${heat}`, 'Coil', JSON.stringify([`Base Heating Capacity =${heat} Kelvin`]));
test('cached coil heat refreshes when its tooltip changes', () => {
  const value = coil(1801);
  assert.equal(coilHeat(value), 1801);
  value.tooltip = JSON.stringify(['Base Heating Capacity =2701 Kelvin']);
  assert.equal(coilHeat(value), 2701);
});
const hatch = (tier: string, voltage: number) => item(`hatch:${tier}`, `${tier} Energy Hatch`, JSON.stringify([`Voltage IN: ${voltage} (${tier})`]));
function recipe(name = 'Electric Blast Furnace', heat = 1800): Recipe {
  return { id: 'r', name: 'Test', handler: 'Blast Furnace', durationTicks: 400, euPerTick: 120, layout: '{}', details: JSON.stringify([`Special value: ${heat}`]), ingredients: [],
    craftingMachines: [item('controller', name)], multiblockParts: [coil(1801), coil(2701), coil(3601), coil(6301), hatch('LV', 32), hatch('MV', 128), hatch('HV', 512)] };
}

test('wizard evaluates coil discounts and stores a valid tier-limited hatch configuration', () => {
  const r = recipe();
  const selected = plannerMachine(r, plannerOptions)!;
  assert(selected.multiblock);
  const setup = multiblockSetup(r, selected.machineId, selected.multiblock)!;
  assert(!setup.error);
  assert(['LV', 'MV'].includes(setup.tier));
  assert.equal(setup.coil!.id, 'coil:2701');
  assert.deepEqual(selected.runtime, overclockRecipe(r, selected.machineId, selected.multiblock));
  assert.equal(plannerMachine(r, { ...plannerOptions, allowMultiblocks: false }), null);
  const impossible = recipe('Electric Blast Furnace', 20000);
  assert.equal(plannerMachine(impossible, plannerOptions), null);
});

test('wizard optimizes mixer parallels and keeps configured costs and balanced counts consistent', async () => {
  const r = recipe('Industrial Mixing Machine', 0);
  r.handler = 'Multiblock Mixer';
  r.euPerTick = 30;
  r.durationTicks = 100;
  r.ingredients = [{ itemId: 'target', item: item('target', 'Target'), direction: 'output', amount: 1, chance: 1, consumed: true, slot: 0, x: null, y: null, alternatives: '[]' }];
  const allowedOptions = { ...plannerOptions, maxTier: 5 };
  const selected = plannerMachine(r, { ...allowedOptions, priorities: ['output', 'eu', 'yield', 'singleblock'] })!;
  assert(selected.runtime.parallel! > 1);
  assert.equal(selected.multiblock!.energyHatchId, 'hatch:HV');
  assert.equal(selected.multiblock!.energyHatches, 2);
  const result = await findAutoPlans(allowedOptions, async id => id === 'target' ? [r] : []);
  const plan = result.plans[0];
  assert(plan.steps[0].multiblock);
  const runtime = overclockRecipe(r, plan.steps[0].machineId, plan.steps[0].multiblock);
  assert.equal(plan.totalEu, runtime.euPerTick * runtime.durationTicks / runtime.parallel!);
  assert.deepEqual(plannerBalance(plan).machines, [1]);
  assert(Math.abs(plannerBalance(plan).targetPerSecond! - 20 * runtime.parallel! / runtime.durationTicks) < 1e-10);
});

test('wizard accounts for Volcanus auxiliary Pyrotheum without duplicating it', async () => {
  const r = recipe('Volcanus', 1800);
  r.multiblockParts!.push({ ...item('fluid:pyrotheum', 'Blazing Pyrotheum'), kind: 'fluid' });
  r.ingredients = [{ itemId: 'target', item: item('target', 'Target'), direction: 'output', amount: 1, chance: 1, consumed: true, slot: 0, x: null, y: null, alternatives: '[]' }];
  const result = await findAutoPlans({ ...plannerOptions, maxTier: 5 }, async id => id === 'target' ? [r] : []);
  const plan = result.plans[0];
  assert(plan);
  const runtime = overclockRecipe(plan.steps[0].recipe, plan.steps[0].machineId, plan.steps[0].multiblock);
  assert.equal(runtime.ingredients.filter(i => i.itemId === 'fluid:pyrotheum').length, 1);
  assert.equal(plan.supplies.find(s => s.item.id === 'fluid:pyrotheum')!.amount, runtime.durationTicks / 2 / runtime.parallel!);
});
test('EBF applies 900 K EU discounts and 1800 K perfect overclocks', () => {
  const r = recipe();
  const ordinary = multiblockSetup(r, undefined, { coilId: 'coil:1801', energyHatchId: 'hatch:HV' })!;
  assert.equal(ordinary.profile.coils, 16); assert.equal(ordinary.euPerTick, 480); assert.equal(ordinary.durationTicks, 200);
  const hot = multiblockSetup(r, undefined, { coilId: 'coil:3601', energyHatchId: 'hatch:HV' })!;
  assert.equal(hot.heat, 3701); assert.equal(hot.discount, .95 ** 2); assert.equal(hot.perfect, 1);
  assert.equal(hot.euPerTick, 434); assert.equal(hot.durationTicks, 100);
  assert.equal(r.euPerTick, 120); assert.equal(r.durationTicks, 400);
});
test('insufficient coils or hatch power cannot produce a positive output rate', () => {
  const heat = overclockRecipe(recipe('Electric Blast Furnace', 3600), undefined, { coilId: 'coil:1801' });
  assert.equal(heat.durationTicks, 0); assert.equal(heat.euPerTick, 0);
  const power = multiblockSetup(recipe(), undefined, { energyHatchId: 'hatch:LV' })!;
  assert.match(power.error!, /hatches provide/);
});
test('two matching hatches provide 4 A and enable another overclock', () => {
  const one = multiblockSetup(recipe(), undefined, { energyHatchId: 'hatch:MV', coilId: 'coil:1801' })!;
  const two = multiblockSetup(recipe(), undefined, { energyHatchId: 'hatch:MV', energyHatches: 2, coilId: 'coil:1801' })!;
  assert.equal(one.available, 128); assert.equal(two.available, 512);
  assert.equal(one.overclocks, 0); assert.equal(two.overclocks, 1);
  assert.equal(two.heat, 1901);
});
test('Pyrolyse and Oil Cracking use their own coil effects', () => {
  const pyro = multiblockSetup(recipe('Pyrolyse Oven'), undefined, { coilId: 'coil:1801' })!;
  assert.equal(pyro.profile.coils, 9); assert.equal(pyro.durationTicks, 800);
  const better = multiblockSetup(recipe('Pyrolyse Oven'), undefined, { coilId: 'coil:2701' })!;
  assert.equal(better.durationTicks, 400);
  const cracking = multiblockSetup(recipe('Oil Cracking Unit'), undefined, { coilId: 'coil:6301' })!;
  assert.equal(cracking.discount, .5); assert.equal(cracking.euPerTick, 60);
});
test('LCR uses perfect overclocks; unsupported controllers stay unchanged', () => {
  assert.equal(multiblockSetup(recipe('Large Chemical Reactor'), undefined, { energyHatchId: 'hatch:HV' })!.durationTicks, 100);
  const unknown = recipe('Unknown multiblock'); assert.equal(overclockRecipe(unknown), unknown);
});
test('multiblock choices survive schema parsing and invalidate cached group totals', () => {
  const config = { coilId: 'coil:3601', energyHatchId: 'hatch:HV', energyHatches: 1 };
  const saved = nodeSchema.parse({ id: '00000000-0000-4000-8000-000000000000', recipeId: 'r', machines: 1, position: { x: 0, y: 0 }, multiblock: config });
  assert.deepEqual(saved.multiblock, config);
  const area = { position: { x: 0, y: 0 }, width: 100, height: 100 };
  const node = { position: { x: 0, y: 0 }, width: 10, height: 10, recipe: recipe(), machines: 1, variants: {} };
  const cache = new AreaSummaryCache();
  const before = cache.get('a', area, [node]);
  const after = cache.get('a', area, [{ ...node, multiblock: config }]);
  assert.notEqual(before, after); assert.equal(after.euPerTick, 434);
});
test('changing coils updates scaled connected-machine counts even with cached scaling', () => {
  const resource = item('resource', 'Resource');
  const ingredient = { itemId: resource.id, item: resource, amount: 1, chance: 1, consumed: true, slot: 0, x: null, y: null, alternatives: '[]' };
  const nodes = [{ id: 'producer', type: 'recipe', position: { x: 0, y: 0 }, data: { recipe: { ...recipe(), ingredients: [{ ...ingredient, direction: 'output' }] }, machines: 1, variants: {}, scaleAmount: 1, multiblock: { coilId: 'coil:1801', energyHatchId: 'hatch:MV' } } },
    { id: 'consumer', type: 'recipe', position: { x: 0, y: 0 }, data: { recipe: { ...recipe('Vacuum Freezer'), ingredients: [{ ...ingredient, direction: 'input' }] }, machines: 1, variants: {} } }];
  const edges = [{ id: 'edge', source: 'producer', target: 'consumer', sourceHandle: 'output:0', targetHandle: 'input:0' }];
  const calculate = createScaleCalculator();
  assert.equal(calculate(nodes, edges).counts.get('consumer'), 1);
  const changed = nodes.map(n => n.id === 'producer' ? { ...n, data: { ...n.data, multiblock: { coilId: 'coil:3601', energyHatchId: 'hatch:HV' } } } : n);
  assert.equal(calculate(changed, edges).counts.get('consumer'), 4);
});

test('industrial mixer fills power-limited parallels before overclocking', () => {
  const r = { ...recipe('Industrial Mixing Machine'), euPerTick: 30, durationTicks: 700 };
  const one = multiblockSetup(r, undefined, { energyHatchId: 'hatch:MV' })!;
  assert.equal(one.parallelLimit, 16);
  assert.equal(one.parallel, 4);
  assert.equal(one.overclocks, 0);
  assert.equal(one.euPerTick, 120);
  assert.equal(one.durationTicks, 200);
  const two = multiblockSetup(r, undefined, { energyHatchId: 'hatch:MV', energyHatches: 2 })!;
  assert.equal(two.parallelLimit, 24); // GT sums hatch voltages for the tier.
  assert.equal(two.parallel, 17);
  assert.equal(two.euPerTick, 510);
  assert.equal(two.durationTicks, 200);
  assert.equal(r.euPerTick, 30);
});

test('bulk parallels respect tier capacity and use spare power for overclocks', () => {
  const r = { ...recipe('Industrial Mixing Machine'), euPerTick: 1, durationTicks: 700 };
  const setup = multiblockSetup(r, undefined, { energyHatchId: 'hatch:HV' })!;
  assert.equal(setup.parallel, 24);
  assert.equal(setup.parallelLimit, 24);
  assert.equal(setup.overclocks, 2);
  assert.equal(setup.euPerTick, 384);
  assert.equal(setup.durationTicks, 50);
  const fast = multiblockSetup({ ...r, durationTicks: 7 }, undefined, { energyHatchId: 'hatch:HV' })!;
  assert.equal(fast.parallel, 47); // Java float speed modifier and truncation.
  assert.equal(fast.durationTicks, 1);
  assert.equal(fast.euPerTick, 384);
});

test('verified industrial profiles apply their individual built-in bonuses', () => {
  const cases = [
    ['Industrial Centrifuge', 2.25, .9, 6],
    ['Industrial Wire Factory', 3, .75, 4],
    ['Large Thermal Refinery', 2.5, .8, 8],
    ['Large Sifter Control Block', 5, .75, 4],
    ['Industrial Extrusion Machine', 3.5, 1, 4],
    ['Industrial Material Press', 6, 1, 4],
    ['Industrial Cutting Factory', 3, .75, 4],
    ['Thermic Heating Device', 2.2, .9, 8],
    ['Industrial Electrolyzer', 2.8, .9, 2],
    ['Amazon Warehousing Depot', 6, .75, 16],
    ['TurboCan Pro', 2, 1, 8],
    ['Big Barrel Brewery', 1.5, 1, 4],
  ] as const;
  for (const [name, speed, discount, parallelPerTier] of cases) {
    const r = { ...recipe(name), euPerTick: 30, durationTicks: 600 };
    const setup = multiblockSetup(r, undefined, { energyHatchId: 'hatch:MV' })!;
    assert.equal(setup.parallelLimit, parallelPerTier * 2, name);
    assert.equal(setup.discount, Math.fround(discount), name);
    assert.equal(setup.durationTicks, Math.floor(600 * Math.fround(1 / Math.fround(speed))), name);
    assert.ok(setup.euPerTick <= setup.available, name);
  }
});

test('bulk output rates include parallels without multiplying nonconsumable inputs', () => {
  const resource = item('bulk-resource', 'Resource');
  const ingredient = { itemId: resource.id, item: resource, amount: 2, chance: .5, consumed: true, slot: 0, x: null, y: null, alternatives: '[]', direction: 'output' };
  const r = { ...recipe('Industrial Mixing Machine'), euPerTick: 30, durationTicks: 700, ingredients: [ingredient] };
  const runtime = overclockRecipe(r, undefined, { energyHatchId: 'hatch:MV' });
  assert.equal(runtime.parallel, 4);
  assert.equal(rate(runtime.ingredients[0], runtime), .4);
  assert.equal(rate({ ...ingredient, direction: 'input', consumed: false }, runtime), 0);
  assert.equal(runtime.ingredients, r.ingredients);
  const invalid = overclockRecipe(recipe('Industrial Mixing Machine'), undefined, { energyHatchId: 'hatch:LV' });
  assert.equal(invalid.parallel, 0);
  assert.equal(invalid.durationTicks, 0);
});

test('bulk hatch changes update cached group totals and scaled machine ratios', () => {
  const resource = item('bulk-resource', 'Resource');
  const ingredient = { itemId: resource.id, item: resource, amount: 1, chance: 1, consumed: true, slot: 0, x: null, y: null, alternatives: '[]' };
  const r = { ...recipe('Industrial Mixing Machine'), euPerTick: 30, durationTicks: 700, ingredients: [{ ...ingredient, direction: 'output' }] };
  const node = { position: { x: 0, y: 0 }, width: 10, height: 10, recipe: r, machines: 1, variants: {}, multiblock: { energyHatchId: 'hatch:MV' } };
  const area = { position: { x: 0, y: 0 }, width: 100, height: 100 };
  const cache = new AreaSummaryCache();
  assert.equal(cache.get('bulk', area, [node]).euPerTick, 120);
  assert.equal(cache.get('bulk', area, [{ ...node, multiblock: { energyHatchId: 'hatch:MV', energyHatches: 2 } }]).euPerTick, 510);
  const nodes = [{ id: 'producer', type: 'recipe', position: node.position, data: { recipe: r, machines: 1, variants: {}, scaleAmount: 1, multiblock: node.multiblock } },
    { id: 'consumer', type: 'recipe', position: node.position, data: { recipe: { ...recipe('Unknown'), durationTicks: 200, ingredients: [{ ...ingredient, direction: 'input' }] }, machines: 1, variants: {} } }];
  const edges = [{ id: 'e', source: 'producer', target: 'consumer', sourceHandle: 'output:0', targetHandle: 'input:0' }];
  const calculate = createScaleCalculator();
  assert.equal(calculate(nodes, edges).counts.get('consumer'), 4);
  assert.equal(calculate(nodes.map(n => n.id === 'producer' ? { ...n, data: { ...n.data, multiblock: { energyHatchId: 'hatch:MV', energyHatches: 2 } } } : n), edges).counts.get('consumer'), 17);
});

test('Volcanus applies its own speed, discount and fixed parallel limit', () => {
  const r = recipe('Volcanus');
  const setup = multiblockSetup(r, undefined, { energyHatchId: 'hatch:HV', coilId: 'coil:1801' })!;
  assert.equal(setup.profile.coils, 16);
  assert.equal(setup.parallelLimit, 8);
  assert.equal(setup.parallel, 4);
  assert.equal(setup.euPerTick, 432);
  assert.equal(setup.durationTicks, 181);
  assert.equal(setup.heat, 1801); // Volcanus does not get the EBF hatch heat bonus.
  const invalid = multiblockSetup(recipe('Volcanus', 1900), undefined, { energyHatchId: 'hatch:HV', coilId: 'coil:1801' })!;
  assert.match(invalid.error!, /1900|1[.,]900/);
  const upgraded = multiblockSetup({ ...r, multiblockParts: [...r.multiblockParts!, hatch('IV', 8192)] }, undefined, { energyHatchId: 'hatch:IV', coilId: 'coil:3601' })!;
  assert.equal(upgraded.parallel, 8);
  assert.equal(upgraded.perfect, 1);
  assert.ok(upgraded.discount < .9);
  assert.equal(r.durationTicks, 400);
});

test('Volcanus auxiliary pyrotheum demand stays 10 L/s across parallel configurations', () => {
  const fuel = { ...item('fluid:pyrotheum', 'Blazing Pyrotheum'), kind: 'fluid' };
  const r = { ...recipe('Volcanus'), multiblockParts: [...recipe().multiblockParts!, fuel] };
  for (const count of [1, 2]) {
    const runtime = overclockRecipe(r, undefined, { energyHatchId: 'hatch:HV', energyHatches: count });
    const input = runtime.ingredients.find(i => i.itemId === fuel.id)!;
    assert.ok(input);
    assert.equal(rate(input, runtime), 10);
    assert.equal(rate(input, runtime, 3), 30);
  }
  assert.equal(r.ingredients.length, 0);
});

test('hatch capabilities enforce documented counts and minimum tiers', () => {
  const drill = { ...recipe('Fluid Drilling Rig II'), craftingMachines: [item('gregtech:gt.blockmachines:141', 'Fluid Drilling Rig II')] };
  assert.equal(multiblockHatchLimits(drill).max, 1);
  assert.deepEqual(multiblockOptions(drill).hatches.map(i => i.id), ['hatch:HV']);
  assert.equal(multiblockSetup(drill, undefined, { energyHatches: 2, energyHatchId: 'hatch:LV' })!.hatch.id, 'hatch:HV');
  assert.equal(multiblockSetup(drill, undefined, { energyHatches: 2 })!.count, 1);
  // Unverified processing rules must not be guessed from the existence of hatches.
  assert.equal(overclockRecipe(drill, undefined, { energyHatches: 1 }), drill);
  const nuclear = { ...recipe('Nuclear Salt Processing Plant'), craftingMachines: [item('gregtech:gt.blockmachines:749', 'Nuclear Salt Processing Plant')] };
  assert.equal(multiblockSetup(nuclear, undefined, { energyHatches: 1 })!.count, 2);
  const purifier = { ...recipe('Water Purification Plant'), craftingMachines: [item('gregtech:gt.blockmachines:9402', 'Water Purification Plant')] };
  assert.equal(multiblockHatchLimits(purifier).max, 1);
  const fusion = { ...recipe('Compact Fusion Computer MK-I Prototype'), craftingMachines: [item('gregtech:gt.blockmachines:32019', 'Compact Fusion Computer MK-I Prototype')] };
  assert.equal(multiblockHatchLimits(fusion).max, 32);
  assert.equal(multiblockHatchLimits(fusion).minTier, 'LuV');
});

test('wizard gates controllers independently of recipe voltage and low-tier energy hatches', () => {
  const mixer = recipe('Industrial Mixing Machine', 0);
  mixer.euPerTick = 30;
  assert.equal(plannerMachine(mixer, { ...plannerOptions, maxTier: 4 }), null);
  assert(plannerMachine(mixer, { ...plannerOptions, maxTier: 5 }));
  assert.equal(plannerMachine(recipe('Thermic Heating Device', 0), { ...plannerOptions, maxTier: 14 }), null);
});

test('wizard rejects recipes needing coils above the limit and preserves legal multi-amp combinations', () => {
  const hot = recipe('Electric Blast Furnace', 3600);
  assert.equal(plannerMachine(hot, { ...plannerOptions, maxTier: 2 }), null);
  assert(plannerMachine(hot, { ...plannerOptions, maxTier: 3 }));
  const fourAmp = recipe('Electric Blast Furnace', 1700);
  fourAmp.euPerTick = 120;
  const selected = plannerMachine(fourAmp, { ...plannerOptions, maxTier: 1 })!;
  assert(selected);
  assert.equal(selected.multiblock!.energyHatchId, 'hatch:LV');
  assert.equal(selected.multiblock!.energyHatches, 2);
  assert.equal(selected.multiblock!.coilId, 'coil:1801');
});

test('exact-target nested searches enforce the same controller and coil limits', async () => {
  const r = recipe('Industrial Mixing Machine', 0);
  r.euPerTick = 30;
  r.ingredients = [{ itemId: 'target', item: item('target', 'Target'), direction: 'output', amount: 1, chance: 1, consumed: true, slot: 0, x: null, y: null, alternatives: '[]' }];
  for (const exactTarget of [false, true]) {
    const lookup = async (id: string) => id === 'target' ? [r] : [];
    assert.equal((await findAutoPlans({ ...plannerOptions, exactTarget, maxTier: 4 }, lookup)).plans.length, 0);
    assert((await findAutoPlans({ ...plannerOptions, exactTarget, maxTier: 5 }, lookup)).plans.length > 0);
  }
});
