import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { catalog } from '../lib/db';
import { fluidLookupAmounts } from '../lib/fluid-containers';
import { POST } from '../app/api/auto-planner/route';
import { plannerComparisonSummary } from '../lib/planner-balance';
import type { PlannerResult } from '../lib/auto-planner';
after(() => catalog.$disconnect());
for (const expanded of [false, true]) test(`EV seed oil to cetane validates startup for the ${expanded ? 168 : 145}-item needed ban list`, async t => {
  const fluids = ['Methanol','Tetranitromethane','Korn','Fake Jägermeister','Real Jägermeister!','Ethanol','Ethenone','Nitric Acid','Salt Water','Acetone','Nitrogen Dioxide','MTBE Reaction Mixture (Butene)','Ammonia','Oxygen','Wood Vinegar','Acetic Acid','Sulfuric Acid','Carbon Dioxide','Hydrogen','Calcium Acetate Solution','Nether Air','Diluted Acetone','Nether Semifluid','Fermentation Base','Pollution','Trimethyl Borate','Isopropylbenzene','MTBE Reaction Mixture (Butane)','Nitrogen','Waste Liquid','Ammonium Chloride','Fermented Biomass','Platinum Concentrate','Carbon Monoxide','Rum','Vinegar','Vodka','Doppelkorn','Naphthenic Acid','Sulfur Trioxide','Ethylene','Hydrated Ammonium Nitrate Slurry','Nickel Sulfate Water Solution','Pirate Brew','Benzene','Biomass','Phosphoric Acid','Propene'];
  const solids = ['Tiny Pile of Sodium Hydroxide Dust','Sodium Hydroxide Dust','Small Pile of Sodium Hydroxide Dust','Sodium Methoxide Dust','Brine','Gallium Hydroxide Dust','Sodium Dust','Cellulose Fiber','Sodium Aluminate Dust','Sodium Nitrate Dust','Tiny Pile of Sodium Methoxide Dust','Small Pile of Sodium Methoxide Dust','Golden-Brown Cellulose Fiber','Red Cellulose Fiber','Sodium Hydride Dust','Plutonium Oxide-Uranium Mixture Dust','Salt','Ammonium Nitrate Dust','Ghast Tear','Zinc Sulfate Dust','Sodium Sulfate Dust','Tiny Pile of Ammonium Nitrate Dust','Cobalt II Acetate Dust','Small Pile of Ammonium Nitrate Dust'];
  if (expanded) {
    fluids.push('Charcoal Byproducts', 'Nitric Oxide', 'Diluted Sulfuric Acid', 'Thorium Nitrate', 'Green Vitriol Water Solution', 'Blue Vitriol Water Solution');
    solids.push('Olenite Dust', 'Dirty Absorption Filter', 'Concentrated Enriched-Naquadah Sludge Dust', 'Tiny Pile of Sodium Nitrate Dust', 'Deimos Stone Dust', 'Small Pile of Sodium Nitrate Dust', 'Enderpearl Dust', 'Sugar Charcoal', 'Trinium Sulphate Dust', 'Hawthorn Wood');
  }
  const banned = new Set<string>();
  for (const name of fluids) {
    const item = await catalog.item.findFirstOrThrow({ where: { name, kind: 'fluid' } });
    Object.keys(await fluidLookupAmounts(item.id)).forEach(id => banned.add(id));
  }
  for (const name of solids) {
    const item = await catalog.item.findFirstOrThrow({ where: { name, ...(name === 'Sodium Nitrate Dust' ? { id: 'miscutils:itemDustSodiumNitrate' } : {}) }, orderBy: { kind: 'asc' } });
    banned.add(item.id);
  }
  assert.equal(banned.size, expanded ? 168 : 145);
  const input = await catalog.item.findFirstOrThrow({ where: { name: 'Seed Oil Cell' } });
  const target = await catalog.item.findFirstOrThrow({ where: { name: 'Cetane-Boosted Diesel Cell' } });
  const response = await POST(new Request('http://localhost/api/auto-planner', { method: 'POST', body: JSON.stringify({ targetId: target.id, inputIds: [input.id], priority: 'eu', priorities: ['netFuel','eu','output','yield','singleblock'], allowMultiblocks: true, maxTier: 4, maxSteps: 10, maxSuggestions: 100, bannedNeededItemIds: [...banned] }) }));
  const result: PlannerResult = await response.json();
  // No route is known to fit ten steps without a banned-material startup
  // cycle. An incomplete empty search must not claim exhaustive failure.
  assert(Array.isArray(result.plans));
  if (!result.plans.length) assert(result.limited, 'Do not claim this bounded search proved no route exists');
  t.diagnostic(`${result.plans.length} suggestions, ${result.examined} examined`);
  for (const plan of result.plans) {
    assert(plan.steps.length <= 10);
    const { summary } = plannerComparisonSummary(plan, target.id);
    assert(!summary.inputs.some(flow => banned.has(flow.item.id) && !summary.recursiveInputIds.includes(flow.item.id)));
    // Validate independently of the planner's summary/availability helpers.
    const available = new Set<string>();
    const waiting = new Set(plan.steps);
    for (let pass = 0; pass < plan.steps.length; pass++) {
      for (const step of waiting) {
        if (step.recipe.ingredients.some(i => i.direction === 'input' && i.consumed && i.amount > 0 && banned.has(step.variants[`input:${i.slot}`] ?? i.itemId) && !available.has(step.variants[`input:${i.slot}`] ?? i.itemId))) continue;
        for (const i of step.recipe.ingredients) if (i.direction === 'output' && i.amount * i.chance > 0) available.add(i.itemId);
        waiting.delete(step);
      }
    }
    assert.equal(waiting.size, 0, 'A route must start without importing banned ingredients');
    plan.steps.forEach((step, index) => {
      if (['Fluid Canner','Bottler'].includes(step.recipe.handler)) assert(plan.links.some(link => link.target === index));
    });
  }
});
